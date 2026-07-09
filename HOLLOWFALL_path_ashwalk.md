# HOLLOWFALL — Spirit Path: ASHWALK (vertical slice, v0.1)

Companion to `HOLLOWFALL_spec.md` (§12), `HOLLOWFALL_effect_dsl.md`, and
`HOLLOWFALL_engine_fsm.md`. A complete, buildable Path written entirely in the effect
DSL — also the stress-test that surfaces missing DSL/engine primitives (see §4).
All names, numbers, and flavor are original (Layer B); placeholders for playtest.

**Identity.** Ashwalk calls the spirits of fire and storm — the most raw burst damage
in the game, paid for with fragility: little board control, fire that can rebound on
its caster, and an over-reliance on landing hits before being countered. The Path's
`fire` damage destroys enemy `bonecharm` Talismans and is itself canceled by `water`.

**Deck.** 24 cards across 14 designs (copies in the table). Counts are a starting
ratio, not gospel (spec §15).

---

## 1. Path at a glance

| Card | Type | Range | Dur. | baseBreath | spend-value | × | One-line |
|---|---|---|---|---|---|---|---|
| Ember Bolt | bane | LOS | instant | 1 | 2 | 4 | the workhorse dart of flame |
| Firebrand | bane | LOS | instant | 1 | 3 | 2 | a heavier, slower gout |
| Chain Lightning | bane | LOS | instant | 1 | 3 | 2 | leaps to a second body |
| Scorch | bane | LOS | temporary | 1 | 2 | 2 | a clinging burn over time |
| Immolate | bane | LOS | instant | 1 | 4 | 1 | huge damage, bites the hand that casts it |
| Thunderclap | bane | self | instant | 1 | 3 | 1 | a storm-burst that dazes all around you |
| Flame Ward | ward | self | instant | 1 | 2 | 2 | heat that turns a blow aside |
| Backlash | ward | self | instant | 1 | 2 | 1 | a storm-quick dodge |
| Gale Shove | working | LOS | instant | 1 | 2 | 2 | a gust that hurls a rival back |
| Wildfire | working | cell | temporary | 1 | 2 | 2 | a spreading flame that burns each turn |
| Cinderstep | working | self | instant | 1 | 2 | 1 | blink away, leave fire behind |
| Heat Shimmer | working | self | temporary | 1 | 1 | 1 | quickened by rising heat |
| Mantle of Embers | talisman | self | permanent | 1 | 2 | 1 | a cloak of fire that sharpens every strike |
| Emberbreath | offering | — | — | — | 3 | 2 | the drummer's hot breath, fuel |

> Every non-Offering card still carries a **spend-value** so it can be sacrificed as
> Breath to fuel another Rite or a Quicken (spec §7.1). Hard choices: burn the bolt,
> or throw the bolt?

---

## 2. Cards in full (DSL)

### Banes

```jsonc
// Ember Bolt — the staple. Damage scales straight off energy.
{ "id":"ash_ember_bolt", "name":"Ember Bolt", "type":"bane", "path":"ashwalk",
  "traits":["fire"], "range":"los", "targetKind":"walker",
  "duration":"instant", "baseBreath":1, "breathValue":2,
  "onCast": { "op":"DealDamage", "to":"$target", "amount":"$energy", "traits":["fire"] } }
```
```jsonc
// Firebrand — flat +2 on top of energy; your reliable finisher.
{ "id":"ash_firebrand", "name":"Firebrand", "type":"bane", "path":"ashwalk",
  "traits":["fire"], "range":"los", "targetKind":"walker",
  "duration":"instant", "baseBreath":1, "breathValue":3,
  "onCast": { "op":"DealDamage", "to":"$target",
              "amount":{ "add":["$energy",2] }, "traits":["fire"] } }
```
```jsonc
// Chain Lightning — full hit to target, near-full to one adjacent rival (min 1).
{ "id":"ash_chain_lightning", "name":"Chain Lightning", "type":"bane", "path":"ashwalk",
  "traits":["storm"], "range":"los", "targetKind":"walker",
  "duration":"instant", "baseBreath":1, "breathValue":3,
  "onCast": { "op":"Sequence", "steps":[
    { "op":"DealDamage", "to":"$target", "amount":"$energy" },
    { "op":"DealDamage",
      "to": { "select":"walkers", "where":{ "adjacent":["$target","$it"] },
              "exclude":["$target"], "limit":1, "pickBy":"$caster" },
      "amount": { "max":[1, { "sub":["$energy",1] }] } }
  ] } }
```
```jsonc
// Scorch — a fire curse: 1 fire/upkeep for `energy` turns (temporary tracks itself).
{ "id":"ash_scorch", "name":"Scorch", "type":"bane", "path":"ashwalk",
  "traits":["fire","curse"], "range":"los", "targetKind":"walker",
  "duration":"temporary", "baseBreath":1, "breathValue":2,
  "onUpkeep": { "op":"DealDamage", "to":"$target", "amount":1, "traits":["fire"] } }
```
```jsonc
// Immolate — energy×2 to the target, 1 fire recoil to you. High risk, high ceiling.
{ "id":"ash_immolate", "name":"Immolate", "type":"bane", "path":"ashwalk",
  "traits":["fire"], "range":"los", "targetKind":"walker",
  "duration":"instant", "baseBreath":1, "breathValue":4,
  "onCast": { "op":"Sequence", "steps":[
    { "op":"DealDamage", "to":"$target", "amount":{ "mul":["$energy",2] }, "traits":["fire"] },
    { "op":"DealDamage", "to":"$caster", "amount":1, "traits":["fire"] }
  ] } }
```
```jsonc
// Thunderclap — self-centered AoE: damage + Daze to every adjacent rival. Positional.
{ "id":"ash_thunderclap", "name":"Thunderclap", "type":"bane", "path":"ashwalk",
  "traits":["storm"], "range":"self", "targetKind":"self",
  "duration":"instant", "baseBreath":1, "breathValue":3,
  "onCast": { "op":"Sequence", "steps":[
    { "op":"DealDamage",
      "to":{ "select":"walkers", "where":{ "adjacent":["$caster","$it"] }, "exclude":["$caster"] },
      "amount":"$energy" },
    { "op":"ApplyStatus",
      "to":{ "select":"walkers", "where":{ "adjacent":["$caster","$it"] }, "exclude":["$caster"] },
      "status":"daze", "stacks":1 }
  ] } }
```

### Wards

```jsonc
// Flame Ward — reduce an incoming attack's damage by energy+1.
{ "id":"ash_flame_ward", "name":"Flame Ward", "type":"ward", "path":"ashwalk",
  "traits":["fire"], "range":"self", "targetKind":"self",
  "duration":"instant", "baseBreath":1, "breathValue":2,
  "reactsTo": { "kind":"bane", "targets":"$caster" },
  "response": { "op":"Reduce", "what":"damage", "by":{ "add":["$energy",1] } } }
```
```jsonc
// Backlash — storm-quick dodge: evade on a d4 roll of 1–2.
{ "id":"ash_backlash", "name":"Backlash", "type":"ward", "path":"ashwalk",
  "traits":["storm"], "range":"self", "targetKind":"self",
  "duration":"instant", "baseBreath":1, "breathValue":2,
  "reactsTo": { "kind":"bane", "targets":"$caster" },
  "response": { "op":"Evade", "onRoll":{ "lte":[ {"roll":"d4"}, 2 ] } } }
```

### Workings

```jsonc
// Gale Shove — no damage, so it isn't your attack: push a rival `energy` cells away.
{ "id":"ash_gale_shove", "name":"Gale Shove", "type":"working", "path":"ashwalk",
  "traits":["storm","mundane"], "range":"los", "targetKind":"walker",
  "duration":"instant", "baseBreath":1, "breathValue":2,
  "onCast": { "op":"Move", "who":"$target",
              "dir":{ "away":["$caster","$target"] }, "distance":"$energy" } }
```
```jsonc
// Wildfire — lay flame on a cell; 1 fire/upkeep to anyone standing in it.
{ "id":"ash_wildfire", "name":"Wildfire", "type":"working", "path":"ashwalk",
  "traits":["fire","creation"], "range":"los", "targetKind":"cell",
  "duration":"temporary", "baseBreath":1, "breathValue":2,
  "onCast":   { "op":"CreateObject", "cell":"$cell", "object":"flame", "fillsCell":false },
  "onUpkeep": { "op":"DealDamage",
                "to":{ "select":"walkers", "where":{ "onObject":["$it","flame"] } },
                "amount":1, "traits":["fire"] },
  "onEnd":    { "op":"DestroyObject",
                "object":{ "select":"objects", "where":{ "is":["$it","flame"] } } } }
```
```jsonc
// Cinderstep — blink up to 2 in LOS, leaving fire on the cell you left.
{ "id":"ash_cinderstep", "name":"Cinderstep", "type":"working", "path":"ashwalk",
  "traits":["fire"], "range":"self", "targetKind":"cell",
  "duration":"instant", "baseBreath":1, "breathValue":2,
  "onCast": { "op":"Sequence", "steps":[
    { "op":"CreateObject", "cell":{ "cellOf":"$caster" }, "object":"flame", "fillsCell":false },
    { "op":"Teleport", "who":"$caster", "toCell":"$target", "requireLOS":true, "maxRange":2 }
  ] } }
```
```jsonc
// Heat Shimmer — +1 speed while maintained (lasts `energy` turns).
{ "id":"ash_heat_shimmer", "name":"Heat Shimmer", "type":"working", "path":"ashwalk",
  "traits":["storm"], "range":"self", "targetKind":"self",
  "duration":"temporary", "baseBreath":1, "breathValue":1,
  "onCast": { "op":"ModifyStat", "target":"$caster", "stat":"speed",
              "delta":1, "duration":"whileMaintained" } }
```

### Talisman

```jsonc
// Mantle of Embers — +1 to all your Bane damage while carried.
{ "id":"ash_mantle_embers", "name":"Mantle of Embers", "type":"talisman", "path":"ashwalk",
  "traits":["fire"], "range":"self", "targetKind":"self",
  "duration":"permanent", "baseBreath":1, "breathValue":2,
  "onCast": { "op":"ModifyStat", "target":"$caster", "stat":"baneDamageBonus",
              "delta":1, "duration":"whileCarried" } }
```

### Offering

```jsonc
// Emberbreath — pure fuel; spend for 3 Breath.
{ "id":"ash_emberbreath", "name":"Emberbreath", "type":"offering", "path":"ashwalk",
  "breathValue":3 }
```

---

## 3. How this slice exercises the systems

- **Energy scaling:** every Bane reads `$energy` (Ember Bolt linear, Firebrand `+2`,
  Immolate `×2`) — verifies value expressions `add`/`mul`/`max`/`sub`.
- **Fire trait pipeline:** 7 cards carry `fire`, so the engine's global rules fire —
  bonecharm destruction and `water` cancellation — without any card re-specifying them.
- **Multi-target selection:** Chain Lightning and Thunderclap both use `select walkers
  where adjacent(...)` with `exclude`/`limit`/`pickBy`.
- **Hazards & triggers:** Wildfire and Scorch validate `onUpkeep`/`onEnd` and
  temporary self-ticking durations.
- **Reactions:** Flame Ward (Reduce) and Backlash (Evade) exercise the response-window
  ops; both bind to `$incoming` via `reactsTo`.
- **Self-cost & lethality:** Immolate's recoil routes through the same `DealDamage` →
  death/scoring path (engine FSM §4.2), and can sever the *caster* if reckless.
- **Move-XOR-attack interplay:** Gale Shove is a `mundane` Working (no damage) so it
  doesn't consume your attack — but if you're Dazed, moving the rival is fine while you
  still can't also attack.

---

## 4. DSL/engine gaps this slice surfaced (feedback → item #1)

Writing real content found four primitives the published DSL doesn't yet cover. None
are blocking; all are small, additive, and within the "add an op, not arbitrary code"
trust model. Recommend folding these into `HOLLOWFALL_effect_dsl.md` v0.2:

1. **Directional `away` / `toward` value** (Gale Shove, Cinderstep-adjacent).
   `Move.dir` currently takes a literal or `$dir`. Add a computed direction value
   `{ "away":[src, who] }` / `{ "toward":[src, who] }`. Knockback stops at walls
   naturally because `Move` already respects them.
2. **`cellOf(x)` selector** (Cinderstep). Need to reference a Walker's *current* cell
   (to drop fire where they were before teleporting). Add `cellOf` to §4 helpers.
3. **`baneDamageBonus` (and symmetric) readable stat** (Mantle of Embers). Cleanest way
   to express "+1 to your outgoing Bane damage" is a stat the engine reads inside
   `applyAttackEffect` (FSM §4.2). Add `baneDamageBonus` to the `stat` list (DSL §3) and
   have `applyAttackEffect` add it to `baseDamage`. Avoids a bespoke aura system.
4. **`onObject(x, objId)` and `is(x, objId)` predicates** (Wildfire — already used in the
   DSL doc's example but never listed in §3 predicates). Formalize both in the predicate
   catalog.

*(Noted but not needed here: a "retaliate" Ward that reduces **and** burns the attacker
would require letting a `response` carry a trailing effect. Flame Ward is kept pure for
now; flag for a future Path that wants reflect damage.)*

---

## 5. Balance notes (for the playtest pass)

- Ashwalk should win damage races and lose grinds. Watch the **Immolate** ceiling at
  high energy (`energy×2` + Mantle `+1`) against the 15 starting Thread — a fueled
  Immolate + Firebrand could be a two-card kill; that may be correct for a glass-cannon
  Path, or may need an energy cap.
- **Thunderclap** rewards walking into a cluster (free-for-all incentive) but punishes
  the caster's positioning — good tension; confirm the Daze isn't oppressive in 1v1.
- **Backlash** evade rate (50% on d4 ≤2) plus **Flame Ward** reduction may over-defend a
  Path that's supposed to be fragile; consider one fewer Ward or a higher evade
  threshold if Ashwalk feels too survivable.
- Fire fragility is the intended counterplay: any `water` Path hard-counters Ashwalk's
  output, and Mantle/being-on-fire is risky into mirror matches.

*End of Ashwalk slice v0.1.*
