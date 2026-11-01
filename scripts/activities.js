/*
 * Activity inspection helpers for The Horse's Auto Reload.
 *
 * These take duck-typed plain objects rather than live dnd5e documents, so the
 * selection rules can be tested without a running world. Real activities
 * satisfy the same shape.
 */

/**
 * Find the reload activity on a weapon.
 *
 * The world's convention is a utility activity named "Reload" with an
 * activation type of "special". Both of those are treated as a preference
 * rather than a requirement: a name match is enough to be a candidate, and a
 * candidate that also matches type and activation wins. That way a weapon whose
 * Reload is set up as an action still works, instead of silently doing nothing.
 *
 * @param {Iterable<Object>} activities The item's activities
 * @param {string} [name='Reload'] The activity name to look for
 * @returns {?Object} The best matching activity, or null
 */
export function findReloadActivity(activities, name = 'Reload') {
  const wanted = String(name ?? '').trim().toLowerCase();
  if (!wanted) return null;

  let fallback = null;
  for (const activity of activities?.values?.() ?? activities ?? []) {
    if (String(activity?.name ?? '').trim().toLowerCase() !== wanted) continue;
    const ideal = activity?.type === 'utility' && activity?.activation?.type === 'special';
    if (ideal) return activity;
    fallback ??= activity;
  }
  return fallback;
}

/**
 * Whether an activity is an attack.
 * @param {Object} activity The activity to test
 * @returns {boolean} True for attack activities
 */
export function isAttackActivity(activity) {
  return ['attack', 'midiAttack'].includes(activity?.type)
    || activity?.constructor?.metadata?.type === 'attack';
}

/**
 * Whether an item's uses are exhausted.
 *
 * `system.uses.value` is derived by dnd5e from max minus spent, but `max` can be
 * a formula, so the derived value is preferred and the subtraction is only a
 * fallback. An item with no maximum is not tracking a magazine at all and is
 * never considered empty.
 *
 * @param {Object} uses The item's `system.uses`
 * @returns {boolean} True if the item has a magazine and it is empty
 */
export function isOutOfUses(uses) {
  const max = Number(uses?.max);
  if (!Number.isFinite(max) || max <= 0) return false;

  const derived = Number(uses?.value);
  const remaining = Number.isFinite(derived) ? derived : max - Number(uses?.spent ?? 0);
  return remaining <= 0;
}

/**
 * Whether a reload is allowed given when the last one happened.
 *
 * The limit is one reload per turn, and it only applies inside an encounter —
 * outside combat there are no turns to count, so reloading is unrestricted.
 *
 * @param {?Object} lastReload Record of the previous reload, or null
 * @param {?Object} current The current combat position
 * @returns {boolean} True if a reload may happen now
 */
export function reloadAllowedThisTurn(lastReload, current) {
  if (!lastReload) return true;
  if (!current?.combatId) return true;
  if (lastReload.combatId !== current.combatId) return true;
  return !(lastReload.round === current.round && lastReload.turn === current.turn);
}

/**
 * The usage configuration for running a reload's consumption.
 *
 * `consume` must be an object here, never `true`. dnd5e's `_prepareUsageConfig`
 * does `config.consume ??= {}` and then assigns onto it, so a boolean survives
 * the nullish check and the following property assignment throws in strict mode
 * — which is why passing `{consume: true}` to `use()` appears to silently do
 * nothing. `resources: true` means "every consumption target on this activity",
 * which for a reload is the ammo spend plus the negative refill.
 *
 * @returns {Object} A usage configuration
 */
export function reloadUsageConfig() {
  return {
    consume: { action: false, resources: true, spellSlot: false },
    scaling: 0
  };
}
