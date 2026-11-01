# Changelog

## 1.0.1

- Fixed empty weapons reloading but requiring a second click to attack. Reload now completes before weapon cloning and MIDI-QOL workflow creation, then the same use continues with the updated embedded weapon.
- Empty weapons with no ammunition, failed reload consumption, or a magazine that remains empty cannot roll an attack.
- Added a nonblocking reload notification while preserving the optional chat announcement.
- Prevented repeated clicks during a reload from spending multiple magazines or rolling duplicate attacks.
- Preserved custom ammo targets, synthetic token actors, the configured Reload activity name, and the optional once-per-turn limit.
- Added integration-style tests for single-click use, MIDI workflow ordering, and failure handling.

## 1.0.0

Initial release.

- Runs a weapon's Reload activity automatically when an attack would fail only
  because the magazine is empty, then carries on with the attack.
- Does nothing when the ammunition is also gone, so dnd5e's own out-of-ammo
  failure stands.
- Intercepts at `dnd5e.preUseActivity`, ahead of the usage dialog, consumption
  and anything MIDI-QOL does.
- Applies the reload through `Activity#consume`, so no usage dialog or extra
  chat card appears and no MIDI workflow starts for the utility activity.
- Tests the ammo cost with `_prepareUsageUpdates({returnErrors: true})` before
  spending anything.
- Works on unlinked token actors: everything resolves through the activity's own
  item and synthetic actor.
- Settings for the master switch, chat announcements, the once-per-turn limit,
  and the reload activity name.
