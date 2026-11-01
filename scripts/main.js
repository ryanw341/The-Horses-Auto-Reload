/*
 * The Horse's Auto Reload — entry point.
 *
 * Settings are registered on init; the use wrappers are installed on ready so the dnd5e
 * system is fully initialised and the module can check it is actually running
 * under a version whose activity API it understands.
 */

import { MODULE_ID, registerSettings } from './settings.js';
import { installAutoReload } from './reload.js';

Hooks.once('init', () => {
  console.log(`${MODULE_ID} | Initializing`);
  registerSettings();
});

Hooks.once('ready', () => {
  if (game.system.id !== 'dnd5e') {
    console.warn(`${MODULE_ID} | not running under dnd5e, staying out of the way`);
    return;
  }

  // Activities arrived in dnd5e 4.0. Earlier versions cannot use this module.
  const major = Number.parseInt(game.system.version, 10);
  if (Number.isFinite(major) && major < 4) {
    console.warn(`${MODULE_ID} | dnd5e ${game.system.version} predates activities; disabled`);
    return;
  }

  const installed = installAutoReload();
  if (installed) console.log(`${MODULE_ID} | Ready`);
  else console.error(`${MODULE_ID} | No supported attack activity class found; auto reload is unavailable.`);
});
