import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installAutoReload, useWithAutoReload } from '../scripts/reload.js';

let nextId = 0;
let settings, notifications, chat;
beforeEach(() => {
  settings = { enabled: true, announceInChat: true, oncePerTurn: false, reloadActivityName: 'Reload' };
  notifications = [];
  chat = [];
  globalThis.game = { settings: { get: (_module, key) => settings[key] }, combat: null };
  globalThis.ui = { notifications: Object.fromEntries(['info','warn','error'].map(level => [level, text => notifications.push({ level, text })])) };
  globalThis.ChatMessage = { getSpeaker: data => data, create: async data => chat.push(data) };
});

function fixture({ ammo = 1, spent = 12, midi = false, replacement = false } = {}) {
  const events = [];
  const actor = { uuid: `Scene.test.Token.${++nextId}.Actor.pc`, items: new Map() };
  const item = {
    id: 'weapon', uuid: `${actor.uuid}.Item.weapon`, actor, name: 'Lasgun', type: 'weapon', isEmbedded: true, isOwner: true,
    system: { uses: { max: 12, spent, value: 12 - spent }, activities: new Map() },
    flags: {}, getFlag(_module,key) { return this.flags[key]; }, async setFlag(_module,key,value) { this.flags[key] = value; }
  };
  actor.items.set(item.id, item);
  let ammoRemaining = ammo;
  class Attack {
    static metadata = { type: 'attack' };
    constructor(item) { this.id = 'attack'; this.type = 'attack'; this.item = item; }
    get uuid() { return `${this.item.uuid}.Activity.attack`; }
    async use(usage, dialog, message) {
      events.push(['use', this, usage, dialog, message]);
      // dnd5e clones at the beginning of use. This snapshot must already be full.
      const snapshot = { ...this.item.system.uses };
      events.push(['cloned', snapshot.value]);
      if (snapshot.value <= 0) return false;
      const live = this.item.actor.items.get(this.item.id);
      live.system.uses.spent++;
      live.system.uses.value--;
      events.push(['attack']);
      return { rolled: true, item: this.item };
    }
  }
  class MidiAttack extends Attack {
    async use(...args) {
      events.push(['midi-workflow-created']);
      const result = await super.use(...args);
      events.push([result ? 'midi-workflow-started' : 'midi-workflow-aborted']);
      return result;
    }
  }
  const Activity = midi ? MidiAttack : Attack;
  const attack = new Activity(item);
  const reload = {
    id: 'reload', name: 'Reload', type: 'utility', activation: { type: 'special' }, item,
    async _prepareUsageUpdates(config, options) {
      events.push(['check-ammo', config, options]);
      return ammoRemaining > 0 ? { item: [] } : [{ message: 'No ammo' }];
    },
    async consume(config) {
      events.push(['reload', config]);
      if (ammoRemaining <= 0) return false;
      ammoRemaining--;
      let live = actor.items.get(item.id);
      if (replacement) {
        live = { ...live, system: { ...live.system, uses: { ...live.system.uses }, activities: new Map(live.system.activities) } };
        live.system.activities.set('attack', new Activity(live));
        actor.items.set(live.id, live);
      }
      live.system.uses.spent = 0;
      live.system.uses.value = 12;
      return { item: [{ _id: live.id, 'system.uses.spent': 0 }] };
    }
  };
  item.system.activities.set('attack', attack);
  item.system.activities.set('reload', reload);
  return { actor,item,attack,reload,events,Attack,MidiAttack,Activity, get ammo() { return ammoRemaining; } };
}

function install(f) { return installAutoReload({ attack: { documentClass: f.Activity } }); }
const eventNames = f => f.events.map(event => event[0]);

test('one click reloads once, announces it, and returns the completed attack result', async () => {
  const f = fixture(); install(f);
  const usage = { event: { shiftKey: true }, midiOptions: { advantage: true } };
  const dialog = { configure: false };
  const message = { rollMode: 'gmroll' };
  const result = await f.attack.use(usage, dialog, message);
  assert.equal(result.rolled, true);
  assert.deepEqual(eventNames(f), ['check-ammo','reload','use','cloned','attack']);
  assert.equal(f.events.find(e => e[0] === 'cloned')[1], 12);
  assert.equal(f.ammo, 0);
  assert.equal(f.item.system.uses.value, 11, 'the attack spends one round from the reloaded magazine');
  assert.equal(chat.length, 1);
  assert.match(notifications[0].text, /Reloaded Lasgun/);
  const use = f.events.find(e => e[0] === 'use');
  assert.deepEqual(use[2], usage);
  assert.equal(use[3], dialog); assert.equal(use[4], message);
});

test('reload finishes before MIDI creates its workflow, even with a separately wrapped base class', async () => {
  const f = fixture({ midi: true });
  installAutoReload({ attack: { documentClass: f.Attack }, midiAttack: { documentClass: f.MidiAttack } });
  const result = await f.attack.use();
  assert.equal(result.rolled, true);
  assert.deepEqual(eventNames(f), ['check-ammo','reload','midi-workflow-created','use','cloned','attack','midi-workflow-started']);
  assert.equal(f.ammo, 0);
});

test('empty magazine without ammo never starts the attack or MIDI workflow', async () => {
  const f = fixture({ ammo: 0, midi: true }); install(f);
  assert.equal(await f.attack.use(), false);
  assert.deepEqual(eventNames(f), ['check-ammo']);
  assert.equal(chat.length, 0);
  assert.match(notifications[0].text, /ammunition.*Attack cancelled/);
});

test('an item replacement after consuming ammo is used for the continued attack', async () => {
  const f = fixture({ replacement: true }); install(f);
  const result = await f.attack.use();
  assert.equal(result.rolled, true);
  assert.notEqual(result.item, f.item);
  assert.equal(result.item, f.actor.items.get(f.item.id));
  assert.equal(f.item.system.uses.value, 0, 'old snapshot remains empty and is not reused');
});

test('a stale activity clone reloads and attacks through its own synthetic actor collection', async () => {
  const f = fixture(); install(f);
  const clonedItem = { ...f.item, system: { ...f.item.system, uses: { ...f.item.system.uses }, activities: new Map() } };
  const clone = new f.Activity(clonedItem);
  clonedItem.system.activities.set('attack', clone);
  globalThis.game.actors = { get() { throw new Error('Must never resolve the base actor'); } };
  const result = await clone.use();
  assert.equal(result.item, f.item);
  assert.equal(f.ammo, 0);
});

test('a stale empty activity uses an already loaded live weapon without spending another magazine', async () => {
  const f = fixture({ spent: 4 }); install(f);
  const clonedItem = { ...f.item, system: { ...f.item.system, uses: { max: 12, spent: 12, value: 0 } } };
  const clone = new f.Activity(clonedItem);
  assert.equal((await clone.use()).item, f.item);
  assert.equal(f.ammo, 1);
  assert.deepEqual(eventNames(f), ['use','cloned','attack']);
});

test('failed or cancelled reload consumption cannot produce an attack', async () => {
  for (const failure of [false, undefined, null, []]) {
    const f = fixture(); install(f);
    f.reload.consume = async () => failure;
    assert.equal(await f.attack.use(), false);
    assert.deepEqual(eventNames(f), ['check-ammo']);
  }
});

test('a reload that does not refill the magazine is stopped instead of rolling for free', async () => {
  const f = fixture(); install(f);
  f.reload.consume = async () => ({ item: [] });
  assert.equal(await f.attack.use(), false);
  assert.deepEqual(eventNames(f), ['check-ammo']);
  assert.match(notifications[0].text, /still empty/);
});

test('double-clicks during reloading cannot spend another magazine or roll twice', async () => {
  const f = fixture({ ammo: 2 }); install(f);
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  const original = f.reload._prepareUsageUpdates;
  f.reload._prepareUsageUpdates = async (...args) => { await wait; return original(...args); };
  const first = f.attack.use();
  assert.equal(await f.attack.use(), false);
  release();
  assert.equal((await first).rolled, true);
  assert.equal(f.ammo, 1);
  assert.equal(eventNames(f).filter(name => name === 'attack').length, 1);
});

test('a failed attempt releases the guard so adding ammo permits a later click', async () => {
  const f = fixture(); install(f);
  const original = f.reload._prepareUsageUpdates;
  f.reload._prepareUsageUpdates = async () => [{ message: 'empty' }];
  assert.equal(await f.attack.use(), false);
  f.reload._prepareUsageUpdates = original;
  assert.equal((await f.attack.use()).rolled, true);
});

test('the once-per-turn limit blocks an empty attack, and records successful reloads', async () => {
  settings.oncePerTurn = true;
  game.combat = { id: 'combat', round: 1, turn: 0 };
  const f = fixture({ ammo: 2 }); install(f);
  assert.equal((await f.attack.use()).rolled, true);
  assert.deepEqual(f.item.flags.lastReload, { combatId: 'combat', round: 1, turn: 0 });
  f.item.system.uses.value = 0;
  f.item.system.uses.spent = 12;
  assert.equal(await f.attack.use(), false);
  assert.equal(f.ammo, 1);
  assert.match(notifications.at(-1).text, /already reloaded this turn/);
});

test('a loaded magazine is used normally without touching reload resources or caller configs', async () => {
  const f = fixture({ ammo: 0, spent: 10 }); install(f);
  const usage = { scaling: 2 };
  assert.equal((await f.attack.use(usage)).rolled, true);
  assert.deepEqual(eventNames(f), ['use','cloned','attack']);
  assert.equal(f.events[0][2], usage);
  assert.equal(notifications.length, 0);
});

test('disabled module, inaccessible items, and non-attacks delegate unchanged', async () => {
  const f = fixture();
  let calls = 0;
  const invoke = () => { calls++; return 'original'; };
  settings.enabled = false;
  assert.equal(await useWithAutoReload(f.attack, invoke), 'original');
  settings.enabled = true;
  f.item.isOwner = false;
  assert.equal(await useWithAutoReload(f.attack, invoke), 'original');
  f.item.isOwner = true;
  assert.equal(await useWithAutoReload({ type: 'utility' }, invoke), 'original');
  assert.equal(calls, 3);
  assert.equal(f.ammo, 1);
});

test('missing reload activity blocks an empty weapon and custom activity names work', async () => {
  const f = fixture(); install(f);
  f.reload.name = 'Swap Cell';
  assert.equal(await f.attack.use(), false);
  settings.reloadActivityName = 'Swap Cell';
  assert.equal((await f.attack.use()).rolled, true);
});

test('turning chat announcements off retains the nonblocking reload notification', async () => {
  settings.announceInChat = false;
  const f = fixture(); install(f);
  assert.equal((await f.attack.use()).rolled, true);
  assert.equal(chat.length, 0);
  assert.match(notifications[0].text, /Reloaded/);
});

test('chat weapon names are escaped', async () => {
  const f = fixture(); install(f);
  f.item.name = '<img onerror="bad">';
  assert.equal((await f.attack.use()).rolled, true);
  assert.match(chat[0].content, /&lt;img/);
  assert.doesNotMatch(chat[0].content, /<img/);
});

test('installation respects an existing accessor wrapper without replacing its descriptor', async () => {
  const f = fixture();
  let underlying = f.Activity.prototype.use;
  let writes = 0;
  Object.defineProperty(f.Activity.prototype, 'use', {
    configurable: false,
    get() { return underlying; },
    set(value) { writes++; underlying = value; }
  });
  assert.equal(install(f), 1);
  assert.equal((await f.attack.use()).rolled, true);
  assert.equal(writes, 1);
  assert.equal(install(f), 1);
  assert.equal(writes, 1);
  assert.equal(typeof Object.getOwnPropertyDescriptor(f.Activity.prototype, 'use').get, 'function');
});

test('installation is repeatable and ignores unrelated activity types', () => {
  const f = fixture();
  assert.equal(install(f), 1);
  const installed = f.Activity.prototype.use;
  assert.equal(install(f), 1);
  assert.equal(f.Activity.prototype.use, installed);
  class Utility { async use() {} }
  const original = Utility.prototype.use;
  assert.equal(installAutoReload({ utility: { documentClass: Utility } }), 0);
  assert.equal(Utility.prototype.use, original);
});
