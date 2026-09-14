# The Horse's Auto Reload

When a ranged weapon's attack would fail **only** because its magazine is empty, this module runs the weapon's Reload activity first and then carries on with the attack. If the ammunition is gone too, it does nothing and the normal out-of-ammo failure stands.

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

`dnd5e.preUseActivity` fires at the very top of `Activity#use`, before the usage dialog, before scaling, and before consumption. Everything ahead of it is a clone and some config marshalling, so returning `false` there cancels with no side effects. That makes it the only safe interception point, and it is also ahead of anything MIDI-QOL does.

The hook is synchronous, so the module cannot await anything before deciding. It makes the cheap check there — is this an attack, on a weapon, with a magazine, and is the magazine empty — cancels the use, and then settles the expensive question asynchronously. The attack is re-invoked either way, so cancelling speculatively is safe: if the ammo turns out to be empty too, the attack runs exactly as it would have and the player sees dnd5e's own failure.

A one-shot re-entrancy guard, consumed by the hook on the way through, keeps the re-invoked attack from being intercepted again.

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
| Announce Reloads in Chat | On | Post a short message when a weapon reloads itself. |
| Limit to One Reload Per Turn | Off | Enforce the once-per-turn limit the Reload activity's description states. Outside combat there are no turns, so the limit does not apply. |
| Reload Activity Name | `Reload` | The activity name treated as a reload. |

## What is verified and what is not

**Verified against the dnd5e 5.3.3 source**, read from the `release-5.3.3` tag: the five activity hooks and their signatures; that `preUseActivity` is synchronous and returning `false` aborts cleanly; that `consume()` applies updates to `this.actor`; that `_prepareUsageUpdates` with `returnErrors` is a safe dry run; and the `consume: true` failure above.

**Not verified, because it needs a live world:** the interaction with midi-qol 14.0.9. The module intervenes before MIDI does any work and re-invokes through `use()` so MIDI sees an ordinary attack, but the MIDI-busy check is written against internals that are not a published API and deliberately fails open — if it cannot tell, it proceeds. Also unverified: the exact shape of the weapons and ammo in your world.

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
