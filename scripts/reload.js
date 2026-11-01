/*
 * Await the reload before the attack's outermost use() call creates item clones
 * or a MIDI-QOL workflow. dnd5e.preUseActivity is too late: both already exist.
 * Consumption still uses dnd5e's configured Reload resource targets, including
 * custom ammunition. No separate utility-activity workflow is started.
 */
import { MODULE_ID } from './settings.js';
import { findReloadActivity, isAttackActivity, isOutOfUses, reloadAllowedThisTurn, reloadUsageConfig } from './activities.js';

const WRAPPED = Symbol.for(`${MODULE_ID}.use-wrapper`);
const CONTINUATION = Symbol('auto-reload-continuation');
const pending = new Set();
const installedClasses = new WeakSet();

function setting(key, fallback) {
  try { return game.settings.get(MODULE_ID, key) ?? fallback; }
  catch { return fallback; }
}

function weaponKey(item) {
  return item.uuid ?? `${item.actor?.uuid ?? 'unknown'}.${item.id}`;
}

/** Resolve through the activity's own actor, including synthetic token actors. */
function liveActivity(activity) {
  const item = activity.item;
  return item.actor?.items?.get(item.id)?.system?.activities?.get(activity.id) ?? activity;
}

function combatPosition() {
  const combat = game.combat;
  return combat ? { combatId: combat.id, round: combat.round ?? 0, turn: combat.turn ?? 0 } : null;
}

function notify(level, message) {
  try { globalThis.ui?.notifications?.[level]?.(message); }
  catch (error) { console.warn(`${MODULE_ID} | could not display notification`, error); }
}

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

async function announce(item) {
  notify('info', `Reloaded ${item.name}. Continuing the attack.`);
  if (!setting('announceInChat', true)) return;
  try {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: item.actor, token: item.actor?.token }),
      content: `<p><em>Reloaded ${escapeHTML(item.name)}.</em></p>`
    });
  } catch (error) { console.warn(`${MODULE_ID} | could not post the reload message`, error); }
}

async function recordReload(item) {
  const position = combatPosition();
  if (!setting('oncePerTurn', false) || !position) return;
  try { await item.setFlag(MODULE_ID, 'lastReload', position); }
  catch (error) { console.warn(`${MODULE_ID} | could not record the reload`, error); }
}

function isUpdateObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Continue the same attack invocation only after a successful reload. Unlike the
 * old synchronous-hook retry, callers receive the actual attack result/promise.
 * `invoke` calls the original use() implementation on the supplied activity.
 */
export async function useWithAutoReload(activity, invoke, usage = {}, dialog = {}, message = {}) {
  if (!setting('enabled', true) || !isAttackActivity(activity)) return invoke(activity, usage, dialog, message);
  const item = activity.item;
  if (item?.type !== 'weapon' || item.isEmbedded === false || item.isOwner === false || item.pack
    || activity.canUse === false) return invoke(activity, usage, dialog, message);

  const key = weaponKey(item);
  const continuation = `${key}.${activity.id}`;
  // A MIDI attack can call a separately registered base attack class through
  // super.use(). Let that inner call through without admitting a second click.
  if (usage[CONTINUATION] === continuation) return invoke(activity, usage, dialog, message);
  if (pending.has(key)) {
    notify('info', `${item.name} is already reloading or finishing its attack.`);
    return false;
  }
  let current = liveActivity(activity);
  if (!isOutOfUses(current.item.system?.uses)) {
    // A previously captured empty activity may outlive a manual reload.
    return invoke(isOutOfUses(item.system?.uses) ? current : activity, usage, dialog, message);
  }

  pending.add(key);
  try {
    const weapon = current.item;
    const reload = findReloadActivity(weapon.system?.activities ?? [], setting('reloadActivityName', 'Reload'));
    if (!reload || typeof reload._prepareUsageUpdates !== 'function' || typeof reload.consume !== 'function') {
      notify('warn', `${weapon.name} is empty and has no usable Reload activity. Attack cancelled.`);
      return false;
    }
    if (setting('oncePerTurn', false)
      && !reloadAllowedThisTurn(weapon.getFlag?.(MODULE_ID, 'lastReload'), combatPosition())) {
      notify('warn', `${weapon.name} is empty and has already reloaded this turn. Attack cancelled.`);
      return false;
    }
    const preview = await reload._prepareUsageUpdates(reloadUsageConfig(), { returnErrors: true });
    if (!isUpdateObject(preview)) {
      notify('warn', `Not enough ammunition or resources to reload ${weapon.name}. Attack cancelled.`);
      return false;
    }
    const updates = await reload.consume(reloadUsageConfig(), {});
    if (!isUpdateObject(updates)) {
      notify('warn', `Could not reload ${weapon.name}. Attack cancelled.`);
      return false;
    }
    // Actor updates can replace the embedded item. Never attack using the old
    // empty clone or a stale collection entry after consumption completes.
    current = liveActivity(current);
    if (isOutOfUses(current.item.system?.uses)) {
      notify('warn', `${weapon.name} is still empty after reloading. Check its Reload activity. Attack cancelled.`);
      return false;
    }
    await recordReload(current.item);
    await announce(current.item);
    const continuedUsage = { ...usage };
    Object.defineProperty(continuedUsage, CONTINUATION, { value: continuation });
    return await invoke(current, continuedUsage, dialog, message);
  } catch (error) {
    console.error(`${MODULE_ID} | reload or attack failed`, error);
    notify('error', `Could not complete the reload and attack for ${item.name}. See the console for details.`);
    return false;
  } finally { pending.delete(key); }
}

/** Install after dnd5e and MIDI-QOL have registered their activity classes. */
export function installAutoReload(activityTypes = globalThis.CONFIG?.DND5E?.activityTypes) {
  const classes = new Set(Object.entries(activityTypes ?? {})
    .filter(([key, entry]) => ['attack', 'midiAttack'].includes(key) || entry?.documentClass?.metadata?.type === 'attack')
    .map(([, entry]) => entry?.documentClass).filter(Boolean));
  let installed = 0;
  for (const Activity of classes) {
    const original = Activity.prototype?.use;
    if (typeof original !== 'function') continue;
    if (original[WRAPPED] || installedClasses.has(Activity)) { installed++; continue; }
    const wrapper = function (usage = {}, dialog = {}, message = {}) {
      return useWithAutoReload(this, (current, nextUsage, nextDialog, nextMessage) =>
        original.call(current, nextUsage, nextDialog, nextMessage), usage, dialog, message);
    };
    Object.defineProperty(wrapper, WRAPPED, { value: true });
    // Assignment respects accessors installed by wrapper libraries. Replacing
    // their property descriptor would bypass their chain or throw if locked.
    Activity.prototype.use = wrapper;
    installedClasses.add(Activity);
    installed++;
  }
  return installed;
}
