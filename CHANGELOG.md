# Changelog

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
