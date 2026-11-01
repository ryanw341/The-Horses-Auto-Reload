# The Horse's Auto Reload

When a weapon's magazine is empty, this module spends the ammunition configured on its **Reload** activity, shows a reload notification, and continues the attack **on the same click**. If ammunition is unavailable, the attack is cancelled before any attack roll or MIDI-QOL workflow starts.

Built for the dnd5e activity data model (4.0 and later), developed against **dnd5e 5.3.3** on **Foundry v14**.

## The ammo data model

This is the part future-you will want. The world models ammunition like this:

**The weapon** carries the magazine. `system.uses.max` is the capacity, `system.uses.spent` is how many shots have been fired.

**The attack activity** has one consumption target:

```
{ type: "itemUses", target: "", value: "1" }
```

An empty `target` means *the item itself*, so firing spends one use from the weapon's own magazine.

**The reload activity** is a separate utility activity named `Reload`, with `activation.type === "special"`, and it has two consumption targets:

```
{ type: "itemUses", target: "<ammo>", value: "1" }    spend one charge of the ammo item
{ type: "itemUses", target: "",       value: "-12" }  refill the weapon
```

That **negative value is the important bit**. dnd5e has no "restore uses" consumption type — but consumption is just arithmetic on `spent`, so a negative cost subtracts from `spent` instead of adding to it, which refills the magazine. The number has to match that weapon's capacity, so a 12-round weapon uses `-12`. If you change a weapon's capacity, change this to match or the reload will not fill it.

On a world (non-embedded) item, `target` on the ammo line is the ammo's `system.identifier` — `"power-cell"`, `"magazine"`, `"promethium-1-quart"`. Once the weapon is on an actor, dnd5e resolves that to the actor's embedded item id.

**Ammo items** are consumables with a `system.identifier` and their own `system.uses.max` / `system.uses.spent`, where **uses are magazines remaining**. Quantity is *not* the magazine count.

## How the module hooks in

The module awaits reloading at the beginning of the configured attack activity's `use()` method. The original use then runs once with the refreshed embedded weapon, returning its normal result to the caller. MIDI-QOL's attack class is supported too, including installations that register it as a separate `midiAttack` type.

This happens before dnd5e clones the weapon and before MIDI creates its workflow. The earlier `preUseActivity` approach was too late: it received a stale clone of the empty weapon, and MIDI had already started a workflow. Cancelling that use and retrying could leave the reload complete but require another click to attack.

An empty weapon only continues after both ammo consumption and magazine refill succeed. Missing ammo, a failed reload, or an enabled once-per-turn limit cancels the attack with a notification. Repeated clicks while the reload and attack are pending cannot spend another magazine or roll twice. Loaded weapons follow their normal usage flow.

### Running the reload

The reload is applied with `Activity#consume(usageConfig, messageConfig)` rather than `Activity#use()`. `consume` is public, applies consumption on its own, and creates no chat card and no usage dialog — dnd5e itself calls it this way from the chat card's "consume resource" button. Going through `use()` instead would pop a dialog and start a MIDI workflow for a utility activity, neither of which is wanted.

Whether the ammo can actually be paid is tested with `Activity#_prepareUsageUpdates(config, { returnErrors: true })`, which computes the updates without applying them and returns an array of `ConsumptionError` when they cannot be met. It is the only way to ask "could this be afforded?" without either applying it or popping an error toast. It is a protected method, so it is feature-detected and any failure is treated as "cannot reload".

### The `consume: true` trap

Calling `activity.use({ consume: true }, ...)` from the console looks like it should work and silently does not. Here is why, from `_prepareUsageConfig` in dnd5e 5.3.3:

```js
config.consume ??= {};
config.consume.action ??= hasActionConsumption;
```

`consume: true` is not nullish, so it survives the `??=` and stays a boolean. The next line then assigns a property to a primitive, which throws in strict mode — and module code is always strict. The use never reaches consumption.

`consume` must be an **object** — `{ action, resources, spellSlot }`, where `resources` is either `true` for every target or an array of target indices. Passing `usage = {}` and letting `_prepareUsageConfig` fill it in also works, and is what the sheet does.

## Unlinked tokens

Everything is reached through the activity the hook hands over — `activity.item.actor`. For an unlinked token that is the synthetic actor, which is the one that needs updating. Nothing in the module looks an actor up through `game.actors`, which would find the base actor and write to the wrong place.

## Settings

| Setting | Default | Effect |
| --- | --- | --- |
| Enable Auto Reload | On | Master switch. |
| Announce Reloads in Chat | On | Post a short message when a weapon reloads itself. The brief reload notification is always shown. |
| Limit to One Reload Per Turn | Off | Enforce the once-per-turn limit the Reload activity's description states. Outside combat there are no turns, so the limit does not apply. |
| Reload Activity Name | `Reload` | The activity name treated as a reload. |

## What is verified and what is not

**Checked against dnd5e 5.3.3 and MIDI-QOL 14.0.9 source:** activity cloning and workflow creation order, reload consumption, and the resource dry run. Automated tests cover single-click continuation, stale clones, replacement item documents, synthetic actors, exhausted ammo, cancelled or ineffective reloads, duplicate clicks, and the once-per-turn setting.

An additional source replay ran both systems' actual `use()` methods in a minimal harness. It confirmed reloading happens before both item clones and workflow creation, produces one attack, and creates no attack workflow when ammo is unavailable.

The tests use a simulated Foundry environment. An interactive live-world check and your specific weapon/ammunition configurations are still needed to confirm the installed module combination. The attack's normal targeting, attack configuration, and MIDI automation settings remain in effect; the reload adds no confirmation dialog or second firing click.

## Compatibility

Foundry v13 minimum, verified on v14. Requires the dnd5e system, 4.0 or later — activities do not exist before that, and the module disables itself rather than pretending to work.

## Installation

```
https://raw.githubusercontent.com/ryanw341/The-Horses-Auto-Reload/main/module.json
```

## Development

The activity-selection and magazine-reading logic is free of Foundry API calls and covered by a node test suite:

```bash
npm test
```

Requires Node 21 or later. Tests also run in CI before any release is packaged.
