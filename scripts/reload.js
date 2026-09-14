/*
 * Auto-reload logic for The Horse's Auto Reload.
 *
 * VERSION-SENSITIVE. Everything here is written against dnd5e 5.3.3, whose
 * activity API differs from both the pre-4.0 item API and from 6.x. The
 * specific things depended on, and where they are verified in the system source
 * (module/documents/activity/mixin.mjs):
 *
 *   - `dnd5e.preUseActivity` fires via Hooks.call at the very top of
 *     `Activity#use`, before the usage dialog, before scaling, and before
 *     consumption. Returning false aborts with no side effects, because
 *     everything preceding it is a clone and some config marshalling. That
 *     makes it the only safe place to intervene.
 *
 *   - `Activity#consume(usageConfig, messageConfig)` is public and applies
 *     consumption on its own, without a usage dialog and without creating a
 *     chat card. dnd5e itself calls it this way from the chat card's
 *     "consume resource" button. Reload is run through this rather than
 *     through `use()` so it stays quiet and never enters a MIDI workflow.
 *
 *   - `Activity#_prepareUsageUpdates(config, {returnErrors: true})` computes
 *     the updates without applying them, returning an array of
 *     ConsumptionErrors when they cannot be paid. That is the only way to ask
 *     "could this be afforded?" without either applying it or popping an error
 *     toast at the user. It is a protected method, so it is feature-detected
 *     and failure is treated as "cannot reload".
 *
 * ACTOR RESOLUTION. Everything is reached through the activity handed to the
 * hook — `activity.item.actor`. For an unlinked token that is the synthetic
 * actor, which is what we want. Nothing here looks anything up via
 * `game.actors`, which would find the base actor and write to the wrong place.
 */

import { MODULE_ID } from './settings.js';
import {
  findReloadActivity,
  isAttackActivity,
  isOutOfUses,
  reloadAllowedThisTurn,
  reloadUsageConfig
} from './activities.js';

/**
 * Activities whose next use is our own re-invocation and must not be
 * intercepted again. Entries are consumed on read, so the guard cannot outlive
 * the use it was set for and cannot wedge the module permanently.
 * @type {Set<string>}
 */
const reinvoking = new Set();

/**
 * A stable key for an activity, used by the re-entrancy guard.
 * @param {Object} activity The activity
 * @returns {string} A key
 */
function activityKey(activity) {
  return activity?.uuid ?? `${activity?.item?.uuid ?? 'unknown'}.${activity?.id ?? 'unknown'}`;
}

/**
 * Read a setting, tolerating the module being half-initialised.
 * @param {string} key Setting name
 * @param {*} fallback Value to use if the setting cannot be read
 * @returns {*} The setting value
 */
function setting(key, fallback) {
  try {
    return game.settings.get(MODULE_ID, key);
  } catch {
    return fallback;
  }
}

/**
 * Whether MIDI-QOL appears to be in the middle of a workflow for this item.
 *
 * UNVERIFIED against midi-qol 14.0.9 — MIDI's internals are not a published
 * API, so this fails open: if the shape is not what is expected, it reports
 * "not busy" and the module proceeds. The real protection against fighting MIDI
 * is intervening at `preUseActivity`, which fires before MIDI does any work.
 *
 * @param {Object} item The weapon
 * @returns {boolean} True if a workflow seems to be in progress
 */
function midiWorkflowInProgress(item) {
  try {
    const workflows = globalThis.MidiQOL?.Workflow?.workflows;
    if (!workflows) return false;
    const values = typeof workflows.values === 'function' ? [...workflows.values()] : Object.values(workflows);
    return values.some(workflow => {
      const sameItem = workflow?.item?.uuid && workflow.item.uuid === item?.uuid;
      const finished = workflow?.currentAction === undefined || /complete|rollfinished/i.test(String(workflow?.currentAction ?? ''));
      return sameItem && !finished;
    });
  } catch {
    return false;
  }
}

/**
 * The current combat position, for the once-per-turn limit.
 * @returns {?Object} Combat position, or null when out of combat
 */
function combatPosition() {
  const combat = game.combat;
  if (!combat) return null;
  return { combatId: combat.id, round: combat.round ?? 0, turn: combat.turn ?? 0 };
}

/**
 * Ask whether a reload could be paid for, without paying for it.
 * @param {Object} reload The reload activity
 * @returns {Promise<boolean>} True if the ammo cost can be met
 */
async function canPayReload(reload) {
  if (typeof reload?._prepareUsageUpdates !== 'function') return false;
  try {
    const result = await reload._prepareUsageUpdates(reloadUsageConfig(), { returnErrors: true });
    // An Object is a set of updates; an Array is a list of ConsumptionErrors.
    return foundry.utils.getType(result) === 'Object';
  } catch (err) {
    console.warn(`${MODULE_ID} | could not test the reload cost`, err);
    return false;
  }
}

/**
 * Apply a reload's consumption: spend the ammo and refill the magazine.
 * @param {Object} reload The reload activity
 * @returns {Promise<boolean>} True if consumption was applied
 */
async function applyReload(reload) {
  try {
    const updates = await reload.consume(reloadUsageConfig(), {});
    return updates !== false;
  } catch (err) {
    console.error(`${MODULE_ID} | reload consumption failed`, err);
    return false;
  }
}

/**
 * Announce an automatic reload in chat.
 * @param {Object} item The weapon
 */
async function announce(item) {
  if (!setting('announceInChat', true)) return;
  try {
    const actor = item.actor;
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor, token: actor?.token }),
      content: `<p><em>Reloads ${foundry.utils.escapeHTML?.(item.name) ?? item.name}.</em></p>`
    });
  } catch (err) {
    console.warn(`${MODULE_ID} | could not post the reload message`, err);
  }
}

/**
 * Record that a reload happened, for the once-per-turn limit.
 * @param {Object} item The weapon
 */
async function recordReload(item) {
  if (!setting('oncePerTurn', false)) return;
  const position = combatPosition();
  if (!position) return;
  try {
    await item.setFlag(MODULE_ID, 'lastReload', position);
  } catch (err) {
    console.warn(`${MODULE_ID} | could not record the reload`, err);
  }
}

/**
 * Reload if possible, then run the attack that was cancelled.
 *
 * The attack is re-invoked whether or not the reload succeeded. If the ammo was
 * empty too, the attack runs exactly as it would have and the player sees
 * dnd5e's own out-of-ammo failure, rather than the attack quietly vanishing.
 *
 * @param {Object} activity The attack activity
 * @param {Object} reload The reload activity
 * @param {Object} usageConfig The prepared usage configuration
 * @param {Object} dialogConfig The dialog configuration
 * @param {Object} messageConfig The message configuration
 * @param {string} key The re-entrancy key
 */
async function reloadThenAttack(activity, reload, usageConfig, dialogConfig, messageConfig, key) {
  try {
    if (await canPayReload(reload)) {
      if (await applyReload(reload)) {
        await recordReload(activity.item);
        await announce(activity.item);
      }
    }
  } catch (err) {
    console.error(`${MODULE_ID} | auto reload failed`, err);
  }

  try {
    // The guard is consumed by the hook on the way through, so the re-invoked
    // attack is not intercepted. It is cleared again below in case `use()`
    // bailed before reaching the hook at all.
    await activity.use(usageConfig, dialogConfig, messageConfig);
  } catch (err) {
    console.error(`${MODULE_ID} | could not re-run the attack after reloading`, err);
  } finally {
    reinvoking.delete(key);
  }
}

/**
 * Handle `dnd5e.preUseActivity`.
 *
 * This hook is synchronous, so the decision to intervene has to be made without
 * awaiting anything. The cheap check — does the weapon have a magazine and is
 * it empty — is made here, and the expensive question of whether the ammo can
 * actually be paid is settled afterwards, once the use has been cancelled and
 * we are free to await. Cancelling is safe to do speculatively because the
 * attack is always re-invoked either way.
 *
 * @param {Object} activity The activity being used
 * @param {Object} usageConfig Usage configuration
 * @param {Object} dialogConfig Dialog configuration
 * @param {Object} messageConfig Message configuration
 * @returns {boolean} False to cancel this use
 */
export function onPreUseActivity(activity, usageConfig, dialogConfig, messageConfig) {
  const key = activityKey(activity);

  // Our own re-invocation. Consume the guard and let it through.
  if (reinvoking.has(key)) {
    reinvoking.delete(key);
    return true;
  }

  try {
    if (!setting('enabled', true)) return true;
    if (!isAttackActivity(activity)) return true;

    const item = activity?.item;
    if (item?.type !== 'weapon') return true;
    if (!isOutOfUses(item.system?.uses)) return true;

    const reload = findReloadActivity(item.system?.activities ?? [], setting('reloadActivityName', 'Reload'));
    if (!reload) return true;

    if (setting('oncePerTurn', false)) {
      const last = item.getFlag?.(MODULE_ID, 'lastReload') ?? null;
      if (!reloadAllowedThisTurn(last, combatPosition())) return true;
    }

    if (midiWorkflowInProgress(item)) return true;

    reinvoking.add(key);
    // Deliberately not awaited: the hook must return synchronously.
    reloadThenAttack(activity, reload, usageConfig, dialogConfig, messageConfig, key);
    return false;
  } catch (err) {
    // Anything unexpected must leave the attack alone rather than eat it.
    console.error(`${MODULE_ID} | auto reload check failed, letting the attack proceed`, err);
    reinvoking.delete(key);
    return true;
  }
}
