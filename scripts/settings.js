/*
 * Settings for The Horse's Auto Reload.
 */

export const MODULE_ID = 'the-horses-auto-reload';

/**
 * Register world settings. Called from the init hook.
 */
export function registerSettings() {
  game.settings.register(MODULE_ID, 'enabled', {
    name: 'Enable Auto Reload',
    hint: 'Automatically run a weapon\u2019s Reload activity when an attack would fail only because the magazine is empty.',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, 'announceInChat', {
    name: 'Announce Reloads in Chat',
    hint: 'Post a short chat message when a weapon reloads automatically.',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, 'oncePerTurn', {
    name: 'Limit to One Reload Per Turn',
    hint: 'Enforce the once-per-turn limit that the Reload activity\u2019s description states. Outside combat there are no turns, so the limit does not apply.',
    scope: 'world',
    config: true,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, 'reloadActivityName', {
    name: 'Reload Activity Name',
    hint: 'The name of the activity treated as a reload. Change this only if your weapons name it something other than "Reload".',
    scope: 'world',
    config: true,
    type: String,
    default: 'Reload'
  });
}
