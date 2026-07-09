# HOLLOWFALL — Effect DSL (v0.2)

Companion to `HOLLOWFALL_spec.md` §13.4. Defines the small, sandboxed language that
card (Rite) effects are written in. Everything here is Layer A (functional); no
content names are protected.

### Changelog v0.1 → v0.2 (gaps surfaced by the Ashwalk slice)
- **Direction values** `away` / `toward` for `Move.dir` (§5.3) — directional knockback.
- **`cellOf(x)`** selector helper (§4) — reference a Walker's current cell.
- **`baneDamageBonus`** added to readable stats (§3) and to outgoing-damage resolution.
- **`onObject` / `is`** predicates formalized in the catalog (§3).

---

## 1. Design goals

1. **Data, not code.** An effect is a JSON value (an AST). No arbitrary execution —
   only a fixed catalog of whitelisted **ops**. Designers add cards by writing data,
   never by shipping engine code.
2. **Energy-aware.** `$energy` is always in scope at resolution; most numbers scale
   from it.
3. **Deterministic.** All randomness goes through the match's seeded RNG via the
   `roll` value (spec §13.2). Same seed + same intents → same result.
4. **Composable.** Sequences, conditionals, repeats, and target queries cover every
   mechanic in the main spec.
5. **Lintable.** Every card's effect can be statically checked against the engine's
   op catalog and the card's declared `targetKind` (see §8).

Two surfaces, one meaning: cards are stored as the **JSON AST** below. A thin
human-readable sugar (e.g. `DealDamage($target, $energy) #fire`) may exist in the
card editor, but it compiles 1:1 to the AST; the AST is canonical.

---

## 2. Resolution context

When an effect resolves, these bindings are available:

| Binding | Meaning |
|---|---|
| `$caster` | the Walker who cast the Rite |
| `$target` | the declared primary target (Walker/cell/object/etc.) |
| `$cell` | the targeted cell, if the target is or has a cell |
| `$border` | the targeted border line (wall-creation Rites) |
| `$energy` | integer — the Rite's resolved energy (default 1, or the fueling Offering's value) |
| `$self` | the Rite instance in play (for triggered/maintained effects) |
| `$incoming` | **Wards only** — the in-flight action being responded to (§6) |
| `$rng` | the seeded RNG handle; used only by `roll` |

A maintained Rite's triggered effects (§5) re-bind `$caster`/`$target` to the values
captured at cast time.

---

## 3. Value expressions

A **value** is an integer literal, a context int, an arithmetic node, a die roll, or
a state lookup.

```jsonc
5                                  // literal
"$energy"                          // context int
{ "add": ["$energy", 2] }          // also: sub, mul, min, max  (n-ary)
{ "roll": "d4" }                   // seeded uniform 1..4  (also d2, d3, d6)
{ "stat": ["$target", "thread"] }  // read a stat: thread, maxThread, speed, points,
                                   //   handSize, baneDamageBonus
{ "count": <selector> }            // size of a selection (§4)
```

A **predicate** is a boolean expression, used by `If` and selector `where`:

```jsonc
{ "gte": ["$energy", 3] }                  // also gt, lte, lt, eq, ne
{ "and": [<pred>, <pred>] }                // also or, not
{ "inLOS":  ["$caster", "$target"] }
{ "adjacent": ["$caster", "$target"] }
{ "hasStatus": ["$target", "daze"] }
{ "isForm": ["$target", "wolf"] }
{ "cellEmpty": "$cell" }
{ "onObject": ["$it", "flame"] }           // entity stands on an object of this id
{ "is": ["$it", "flame"] }                 // this object/rite has this id
{ "lte": [{ "roll": "d4" }, 2] }           // a 50% gate
```

---

## 4. Selectors

A **selector** names who/what an op applies to. Either a context binding or a query.

```jsonc
"$caster"        "$target"        "$cell"
{ "select": "walkers",          // walkers | cells | objects | rites
  "where":  { "inLOS": ["$caster", "$it"], "maxRange": 3 },
  "exclude": ["$caster"],       // optional
  "limit":  1,                  // optional; omit = all matches
  "pickBy": "$caster" }         // optional; caster chooses among matches
```

Inside `where`, `$it` refers to the candidate being tested. Spatial helpers usable as
selectors: `cellsAdjacent($caster)`, `cellsInLine($caster, $dir)`, `bordersOf($cell)`,
and `cellOf($caster)` (a Walker's current cell — e.g. to act on the cell *before* a
teleport resolves).

---

## 5. Effect ops (the catalog)

Every effect is one of these nodes. `to`/`who`/`target` take selectors; numeric args
take values.

### 5.1 Control flow
```jsonc
{ "op": "Sequence", "steps": [ <effect>, ... ] }          // in order, all resolve
{ "op": "If", "cond": <pred>, "then": [..], "else": [..] }
{ "op": "Repeat", "times": <value>, "do": [ <effect>, ... ] }
{ "op": "Choose", "by": "$caster", "options": [ {label, do:[..]}, ... ] }
```

### 5.2 Combat & vitals
```jsonc
{ "op": "DealDamage", "to": <sel>, "amount": <value>, "traits": ["fire"] }
{ "op": "Heal",       "to": <sel>, "amount": <value> }            // capped at maxThread
```
`DealDamage` is the single damage entry point. The engine, not the card, then applies
global trait rules: `fire` damage destroys the target's `bonecharm` Talismans; the
3-damage-per-crack rule (spec §8.4) fires automatically when `to` resolves to an
object; lethal damage triggers death/scoring (spec §8.3).

### 5.3 Movement & position
```jsonc
{ "op": "Move",            "who": <sel>, "dir": <direction>, "distance": <value> }
{ "op": "Teleport",        "who": <sel>, "toCell": <sel>, "requireLOS": true, "maxRange": <value> }
{ "op": "ForceRandomMove", "who": <sel>, "steps": <value> }       // seeded direction
```
A `<direction>` is a literal `n|e|s|w`, the bound `$dir`, or a computed value
`{ "away": [src, who] }` / `{ "toward": [src, who] }`. `Move` respects walls, so a push
naturally stops when it hits one.

### 5.4 Status & stats
```jsonc
{ "op": "ApplyStatus",  "to": <sel>, "status": "daze", "stacks": <value> }
{ "op": "RemoveStatus", "from": <sel>, "status": "daze", "stacks": <value> }
{ "op": "ModifyStat",   "target": <sel>, "stat": "speed|maxThread",
                        "delta": <value>, "duration": "thisTurn|whileMaintained|whileCarried" }
```

### 5.5 Forms
```jsonc
{ "op": "Transform", "who": <sel>, "form": "bear|stone|smoke|hare|wolf" }  // replaces current form
{ "op": "EndForm",   "who": <sel> }
```

### 5.6 Terrain & objects
```jsonc
{ "op": "CreateWall",   "border": <sel>, "cracks": <value> }
{ "op": "CreateObject", "cell": <sel>, "object": "<id>", "fillsCell": false, "cracks": <value> }
{ "op": "Crack",        "object": <sel>, "cracks": <value> }     // manual crack (rare; usually via DealDamage)
{ "op": "DestroyObject","object": <sel> }
{ "op": "Throw",        "object": <sel>, "toCell": <sel> }       // landing per spec §9.5
{ "op": "Unlock",       "door": <sel>, "duration": "thisTurn" }
```
Creation respects spec §9.3 (never in a Hearth / occupied cell; walls on borders only).

### 5.7 Cards & rites
```jsonc
{ "op": "DrawCard",      "who": <sel>, "count": <value> }
{ "op": "StealCard",     "from": <sel>, "count": <value>, "pickBy": "$caster" }
{ "op": "EraseRite",     "rite": <sel> }                        // discard a Rite in play
{ "op": "EndMaintained", "rite": <sel> }                        // end a maintained Rite/effect
```

---

## 6. Triggers (maintained / temporary Rites)

A Rite with `duration` of `temporary` or `permanent` may carry **trigger hooks** at
top level instead of (or in addition to) a one-shot `onCast`. Each hook is an effect.

| Hook | Fires when |
|---|---|
| `onCast` | the Rite resolves (one-shot) |
| `onUpkeep` | the caster's UPKEEP, while maintained (spec §5.1) — recurring damage/effects live here |
| `onEnter` | a Walker enters a cell/object this Rite governs |
| `onHitBy` | the bearer takes an attack |
| `onEnd` | the Rite ends/expires/is dispelled (cleanup of created objects, etc.) |

Temporary duration = `$energy` turns; the engine tracks Breath tokens and ticks them
each UPKEEP automatically — the card does **not** count down itself.

---

## 7. Reactions (Wards)

A Rite of `type: "ward"` omits `onCast` and instead declares a reaction. The engine's
response-window (spec §13.1) offers the Ward when a matching action is in flight and
binds that action to `$incoming`.

```jsonc
"reactsTo": { "kind": "bane", "targets": "$caster" },   // predicate over $incoming
"response": <one of:>
   { "op": "Cancel" }                                   // discard the action, no effect
   { "op": "Reduce", "what": "damage|duration", "by": <value> }
   { "op": "Evade",  "onRoll": { "lte": [ {"roll":"d4"}, 2 ] } }   // success → no effect on $caster
```

`reactsTo.kind` may be `bane | spell | mundane | global | any`. Reduce-to-0 follows
spec §8.2 (no secondary effects; duration-to-0 = cancel). Multiple Wards chain
(innermost resolves first).

---

## 8. Static validation (linter rules)

A card fails the build if any holds:

1. An `op` not in the catalog (§5), or a hook not in §6.
2. A selector resolves to a kind incompatible with the card's `targetKind`
   (e.g. `DealDamage to: $target` on a card whose `targetKind` is `door`).
3. `$energy` used on a card with no `baseBreath`/fuel path.
4. `reactsTo`/`response` present on a non-`ward` card, or absent on a `ward` card.
5. `onUpkeep`/`onEnd` present on an `instant`-duration card.
6. `Transform`/`EndForm` outside a card tagged trait `form`.
7. A `CreateWall` target that isn't a `border`, or `CreateObject` into a Hearth.
8. Any `roll` used outside a value/predicate position (RNG must flow through `$rng`).

---

## 9. Worked examples (the §12.1 cards, fully written)

```jsonc
// Kindle the Storm — Bane, LOS, instant, fire
"effect": { "op": "DealDamage", "to": "$target", "amount": "$energy", "traits": ["fire"] }
```
```jsonc
// Turn Aside — Ward: cancel one incoming Bane
"reactsTo": { "kind": "bane", "targets": "$caster" },
"response": { "op": "Cancel" }
```
```jsonc
// Spirit-Skin — Ward: reduce incoming damage by energy
"reactsTo": { "kind": "bane", "targets": "$caster" },
"response": { "op": "Reduce", "what": "damage", "by": "$energy" }
```
```jsonc
// Miststep — Working: teleport up to 3 cells in LOS
"onCast": { "op": "Teleport", "who": "$caster", "toCell": "$target",
            "requireLOS": true, "maxRange": 3 }
```
```jsonc
// Open the Way — Working, mundane: unlock a door this turn
"traits": ["mundane"],
"onCast": { "op": "Unlock", "door": "$target", "duration": "thisTurn" }
```
```jsonc
// Raise Stone — Working, permanent: build a wall (5 cracks)
"duration": "permanent",
"onCast": { "op": "CreateWall", "border": "$border", "cracks": 5 }
```
```jsonc
// Wasting Curse — Bane, LOS, temporary, curse: 2 dmg each upkeep for energy turns
"duration": "temporary", "traits": ["curse"],
"onUpkeep": { "op": "DealDamage", "to": "$target", "amount": 2 }
```
```jsonc
// Bear-Charm — Talisman, bonecharm: +2 maxThread while carried
"type": "talisman", "traits": ["bonecharm"], "duration": "permanent",
"onCast": { "op": "ModifyStat", "target": "$caster", "stat": "maxThread",
            "delta": 2, "duration": "whileCarried" }
```
```jsonc
// Don the Wolf — Working, form: become Wolf
"traits": ["form"],
"onCast": { "op": "Transform", "who": "$caster", "form": "wolf" }
```
```jsonc
// Wildfire — Working, board, temporary: 1 fire dmg/upkeep to every Walker on a flame cell
"duration": "temporary",
"onCast":   { "op": "CreateObject", "cell": "$cell", "object": "flame", "fillsCell": false },
"onUpkeep": { "op": "DealDamage",
              "to": { "select": "walkers", "where": { "onObject": ["$it", "flame"] } },
              "amount": 1, "traits": ["fire"] },
"onEnd":    { "op": "DestroyObject", "object": { "select": "objects",
              "where": { "is": ["$it", "flame"] } } }
```
```jsonc
// Deep Breath — Offering: no effect block; carries breathValue 4 (spent to fuel)
"type": "offering", "breathValue": 4
```

---

## 10. Notes for the engine team

- The op catalog is the **whole** trust boundary. Adding mechanics = adding ops here
  (and to the linter), never letting card data express logic outside it.
- Global trait rules (fire↔water cancel, fire destroys bonecharm, the crack rule, the
  Golden-Rule precedence where card text overrides defaults) live in the engine and
  are triggered by traits/ops — cards never re-implement them.
- Every op must be a pure function of (game state, context, RNG draws) so the seeded
  replay (spec §13.2) is exact.

*End of Effect DSL v0.1.*
