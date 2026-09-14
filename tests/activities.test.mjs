import test from 'node:test';
import assert from 'node:assert/strict';

import {
  findReloadActivity,
  isAttackActivity,
  isOutOfUses,
  reloadAllowedThisTurn,
  reloadUsageConfig
} from '../scripts/activities.js';

/* -------------------------------------------- */
/*  Finding the reload activity                 */
/* -------------------------------------------- */

const attack = { id: 'a1', type: 'attack', name: 'Attack', activation: { type: 'action' } };
const reload = { id: 'a2', type: 'utility', name: 'Reload', activation: { type: 'special' } };

test('finds the reload activity alongside the attack', () => {
  assert.equal(findReloadActivity([attack, reload]), reload);
});

test('ignores a weapon with no reload activity', () => {
  assert.equal(findReloadActivity([attack]), null);
});

test('matches the reload name case-insensitively and ignores padding', () => {
  const padded = { ...reload, name: '  reload  ' };
  assert.equal(findReloadActivity([attack, padded]), padded);
});

test('accepts a reload set up as an action rather than special', () => {
  // Being strict here would mean silently doing nothing on a weapon that is
  // only slightly differently configured.
  const asAction = { id: 'a3', type: 'utility', name: 'Reload', activation: { type: 'action' } };
  assert.equal(findReloadActivity([attack, asAction]), asAction);
});

test('prefers the conventional reload when several match the name', () => {
  const odd = { id: 'a3', type: 'damage', name: 'Reload', activation: { type: 'action' } };
  assert.equal(findReloadActivity([odd, reload]), reload, 'the utility/special one wins');
});

test('honours a custom reload activity name', () => {
  const swap = { id: 'a4', type: 'utility', name: 'Swap Magazine', activation: { type: 'special' } };
  assert.equal(findReloadActivity([attack, swap], 'Swap Magazine'), swap);
  assert.equal(findReloadActivity([attack, swap], 'Reload'), null);
});

test('tolerates junk in the activity list', () => {
  assert.equal(findReloadActivity([null, undefined, {}, reload]), reload);
  assert.equal(findReloadActivity(undefined), null);
  assert.equal(findReloadActivity([reload], ''), null);
});

test('identifies attack activities', () => {
  assert.equal(isAttackActivity(attack), true);
  assert.equal(isAttackActivity(reload), false);
  assert.equal(isAttackActivity(undefined), false);
});

/* -------------------------------------------- */
/*  Reading the magazine                        */
/* -------------------------------------------- */

test('an empty magazine is out of uses', () => {
  assert.equal(isOutOfUses({ max: 12, spent: 12, value: 0 }), true);
});

test('a partly full magazine is not out of uses', () => {
  assert.equal(isOutOfUses({ max: 12, spent: 11, value: 1 }), false);
});

test('falls back to max minus spent when no derived value is present', () => {
  // `max` can be a formula, so the derived value is preferred when it exists.
  assert.equal(isOutOfUses({ max: 12, spent: 12 }), true);
  assert.equal(isOutOfUses({ max: 12, spent: 5 }), false);
});

test('an item with no magazine is never considered empty', () => {
  // A sword has no uses; it must never be treated as needing a reload.
  assert.equal(isOutOfUses({ max: 0, spent: 0 }), false);
  assert.equal(isOutOfUses({}), false);
  assert.equal(isOutOfUses(undefined), false);
});

test('a formula maximum that did not resolve is not treated as empty', () => {
  assert.equal(isOutOfUses({ max: '@details.level', spent: 0 }), false);
});

test('an over-spent magazine counts as empty', () => {
  assert.equal(isOutOfUses({ max: 12, spent: 15, value: -3 }), true);
});

/* -------------------------------------------- */
/*  Once per turn                               */
/* -------------------------------------------- */

const here = { combatId: 'c1', round: 3, turn: 2 };

test('allows a reload when none has happened', () => {
  assert.equal(reloadAllowedThisTurn(null, here), true);
});

test('blocks a second reload on the same turn', () => {
  assert.equal(reloadAllowedThisTurn({ combatId: 'c1', round: 3, turn: 2 }, here), false);
});

test('allows a reload again on the next turn', () => {
  assert.equal(reloadAllowedThisTurn({ combatId: 'c1', round: 3, turn: 1 }, here), true);
});

test('allows a reload again on the next round', () => {
  assert.equal(reloadAllowedThisTurn({ combatId: 'c1', round: 2, turn: 2 }, here), true);
});

test('does not carry the limit across encounters', () => {
  assert.equal(reloadAllowedThisTurn({ combatId: 'old', round: 3, turn: 2 }, here), true);
});

test('does not apply the limit outside combat', () => {
  // There are no turns to be limited to.
  assert.equal(reloadAllowedThisTurn({ combatId: 'c1', round: 3, turn: 2 }, null), true);
});

/* -------------------------------------------- */
/*  Usage configuration                         */
/* -------------------------------------------- */

test('the reload usage config never passes consume as a boolean', () => {
  // dnd5e's _prepareUsageConfig does `config.consume ??= {}` and then assigns
  // onto it. A boolean survives the nullish check, and the assignment that
  // follows throws in strict mode — which is why `{consume: true}` appears to
  // silently do nothing. It must be an object.
  const config = reloadUsageConfig();
  assert.equal(typeof config.consume, 'object');
  assert.notEqual(config.consume, null);
});

test('the reload usage config asks for every consumption target', () => {
  // A reload has two: spend one ammo charge, and the negative value that
  // refills the weapon. Both must run.
  assert.equal(reloadUsageConfig().consume.resources, true);
});

test('the reload usage config does not spend an action or a spell slot', () => {
  const config = reloadUsageConfig();
  assert.equal(config.consume.action, false);
  assert.equal(config.consume.spellSlot, false);
});

test('the reload usage config is a fresh object each time', () => {
  // It is handed to dnd5e, which mutates it.
  assert.notEqual(reloadUsageConfig(), reloadUsageConfig());
});
