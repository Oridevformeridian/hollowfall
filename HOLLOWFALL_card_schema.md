# HOLLOWFALL — Card Schema & Content Linter (v0.1)

Companion to `HOLLOWFALL_effect_dsl.md` (v0.2) and `HOLLOWFALL_engine_fsm.md`. Defines
the exact shape every card (Rite) must satisfy, plus the validation that runs before
any card ships. Layer A.

## 0. Three-stage validation

Content is gated by three checks, run in order, **fail-closed** (a card that fails any
stage does not ship):

1. **Schema** (§2) — structural shape + enums. Cheap, catches typos and wrong types.
2. **Linter** (§4) — semantics the schema can't express: selector/target compatibility,
   id cross-references, trait/op coherence, deck rules.
3. **Resolve-check** (§5) — a dry run of every effect against a mock game state, proving
   each op and selector actually binds (spec §13.7).

Numeric fields (damage amounts, copy counts) are data and hot-tunable without redeploy;
they still pass through stages 1–2. Structural edits re-run all three.

---

## 1. Registries (the closed sets schema + linter reference)

| Registry | Members |
|---|---|
| `type` | `bane` · `ward` · `offering` · `talisman` · `working` |
| `range` | `self` · `adjacent` · `los` · `anywhere` |
| `targetKind` | `self` · `walker` · `cell` · `wall` · `door` · `object` · `mask` · `sector` · `board` · `spell` · `border` |
| `duration` | `instant` · `temporary` · `permanent` |
| `op` | Sequence · If · Repeat · Choose · DealDamage · Heal · Move · Teleport · ForceRandomMove · ApplyStatus · RemoveStatus · ModifyStat · Transform · EndForm · CreateWall · CreateObject · Crack · DestroyObject · Throw · Unlock · DrawCard · StealCard · EraseRite · EndMaintained |
| `hook` | onCast · onUpkeep · onEnter · onHitBy · onEnd |
| `response.op` | Cancel · Reduce · Evade |
| `reactsTo.kind` | bane · spell · mundane · global · any |
| `stat` | thread · maxThread · speed · points · handSize · baneDamageBonus |
| `statModDuration` | thisTurn · whileMaintained · whileCarried |
| `mechanicalTrait` | fire · water · creation · curse · global · bonecharm · mundane · form · thrown · weapon · trinket |
| `status` (extensible) | daze |
| `form` (extensible) | bear · stone · smoke · hare · wolf |
| `object` (extensible) | flame · wall · door (+ created-object ids) |
| `path` (extensible) | common · ashwalk · bonecraft · stoneshaping · dreamwalking · beastpaths · oldblood |

**Flavor traits** (e.g. `storm`) are allowed beyond `mechanicalTrait`, but must be
declared in a per-build `flavorTraits` registry so the linter can distinguish an
intentional flavor tag from a typo of a mechanical one.

The extensible registries (`status`, `form`, `object`, `path`, `flavorTraits`) are
build inputs; the linter loads them and rejects any id not present.

---

## 2. JSON Schema (draft 2020-12)

Structural shape + enums. Deep semantics of effect nodes are intentionally left to the
linter (§4); the schema validates that a node *is* an object naming a known `op`.

```jsonc
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "hollowfall/card.schema.json",
  "type": "object",
  "required": ["id", "name", "type", "path"],
  "additionalProperties": false,

  "properties": {
    "id":   { "type": "string", "pattern": "^[a-z]+_[a-z0-9_]+$" },
    "name": { "type": "string", "minLength": 1 },
    "type": { "enum": ["bane","ward","offering","talisman","working"] },
    "path": { "type": "string" },
    "traits": { "type": "array", "items": { "type": "string" }, "uniqueItems": true },
    "range":      { "enum": ["self","adjacent","los","anywhere"] },
    "targetKind": { "enum": ["self","walker","cell","wall","door","object",
                             "mask","sector","board","spell","border"] },
    "duration":   { "enum": ["instant","temporary","permanent"] },
    "baseBreath":  { "type": "integer", "minimum": 0 },
    "breathValue": { "type": "integer", "minimum": 0 },

    "onCast":  { "$ref": "#/$defs/effect" },
    "onUpkeep":{ "$ref": "#/$defs/effect" },
    "onEnter": { "$ref": "#/$defs/effect" },
    "onHitBy": { "$ref": "#/$defs/effect" },
    "onEnd":   { "$ref": "#/$defs/effect" },

    "reactsTo": { "$ref": "#/$defs/reactsTo" },
    "response": { "$ref": "#/$defs/response" },
    "flavor":   { "type": "string" }
  },

  "allOf": [
    {  /* offerings are pure fuel */
      "if":   { "properties": { "type": { "const": "offering" } } },
      "then": {
        "required": ["breathValue"],
        "not": { "anyOf": [
          { "required": ["onCast"] }, { "required": ["onUpkeep"] },
          { "required": ["onEnter"] },{ "required": ["onHitBy"] },
          { "required": ["onEnd"] },  { "required": ["reactsTo"] },
          { "required": ["response"] }
        ] }
      }
    },
    {  /* wards react; they never onCast or maintain */
      "if":   { "properties": { "type": { "const": "ward" } } },
      "then": {
        "required": ["reactsTo", "response"],
        "not": { "anyOf": [
          { "required": ["onCast"] }, { "required": ["onUpkeep"] },
          { "required": ["onEnter"] },{ "required": ["onHitBy"] },
          { "required": ["onEnd"] }
        ] }
      }
    },
    {  /* non-wards never carry a reaction */
      "if":   { "properties": { "type": { "enum": ["bane","working","talisman"] } } },
      "then": { "not": { "anyOf": [
        { "required": ["reactsTo"] }, { "required": ["response"] }
      ] } }
    },
    {  /* instants can't maintain */
      "if":   { "properties": { "duration": { "const": "instant" } } },
      "then": { "not": { "anyOf": [
        { "required": ["onUpkeep"] }, { "required": ["onEnter"] },
        { "required": ["onHitBy"] },  { "required": ["onEnd"] }
      ] } }
    }
  ],

  "$defs": {
    "effect": {
      "type": "object",
      "required": ["op"],
      "properties": {
        "op": { "enum": ["Sequence","If","Repeat","Choose","DealDamage","Heal",
          "Move","Teleport","ForceRandomMove","ApplyStatus","RemoveStatus","ModifyStat",
          "Transform","EndForm","CreateWall","CreateObject","Crack","DestroyObject",
          "Throw","Unlock","DrawCard","StealCard","EraseRite","EndMaintained"] }
      }
      /* per-op args are validated by the linter (§4) and resolve-check (§5) */
    },
    "reactsTo": {
      "type": "object",
      "required": ["kind"],
      "properties": { "kind": { "enum": ["bane","spell","mundane","global","any"] } }
    },
    "response": {
      "type": "object",
      "required": ["op"],
      "properties": { "op": { "enum": ["Cancel","Reduce","Evade"] } }
    }
  }
}
```

---

## 3. Worked: passing cards

```jsonc
// Ember Bolt — valid bane: instant, onCast only, no reaction.
{ "id":"ash_ember_bolt","name":"Ember Bolt","type":"bane","path":"ashwalk",
  "traits":["fire"],"range":"los","targetKind":"walker","duration":"instant",
  "baseBreath":1,"breathValue":2,
  "onCast":{ "op":"DealDamage","to":"$target","amount":"$energy","traits":["fire"] } }

// Flame Ward — valid ward: reactsTo + response, no onCast.
{ "id":"ash_flame_ward","name":"Flame Ward","type":"ward","path":"ashwalk",
  "range":"self","targetKind":"self","duration":"instant","breathValue":2,
  "reactsTo":{ "kind":"bane","targets":"$caster" },
  "response":{ "op":"Reduce","what":"damage","by":{ "add":["$energy",1] } } }

// Emberbreath — valid offering: breathValue only.
{ "id":"ash_emberbreath","name":"Emberbreath","type":"offering","path":"ashwalk",
  "breathValue":3 }
```

---

## 4. Content-linter rules

Semantic checks beyond the schema. **ERROR** = blocks ship; **WARN** = flag for review.

### Per-card coherence
1. **(E) Known ids only.** Every `op`/`hook`/`response.op`/`reactsTo.kind`/`stat`/
   `statModDuration` is in its registry (§1). Every referenced `status`, `form`,
   `object`, and the card's `path` exists in the loaded extensible registry.
2. **(E) Target/op compatibility.** Each op's target resolves to a kind the op accepts,
   and is consistent with the card's `targetKind`:

   | op | requires target kind |
   |---|---|
   | DealDamage / ApplyStatus / RemoveStatus / Transform / EndForm / Heal / StealCard / DrawCard | walker (or self) |
   | Move / Teleport / ForceRandomMove | walker (or self) |
   | CreateWall | border |
   | CreateObject | cell |
   | Crack / DestroyObject / Throw | object |
   | Unlock | door |
   | EraseRite / EndMaintained | spell |

3. **(E) `$energy` needs a fuel path.** A card referencing `$energy` must be fuelable
   (`baseBreath` present; offerings can't reference effects at all).
4. **(E) Form trait gate.** A card whose effect tree contains `Transform`/`EndForm`
   must include trait `form`; conversely `form`-tagged cards must transform.
5. **(E) Stat-mod scoping.** `ModifyStat.duration` of `whileCarried` only on `talisman`;
   `whileMaintained` only on `temporary`/`permanent`.
6. **(E) Maintained hooks need maintained duration.** `onUpkeep`/`onEnter`/`onHitBy`/
   `onEnd` require `duration` ∈ {temporary, permanent} (schema blocks instant; linter
   confirms a duration is present at all).
7. **(E) Determinism.** `roll` appears only in value/predicate positions; no other op
   introduces randomness.
8. **(E) Hearth safety (static).** A `CreateObject`/`CreateWall` whose cell/border is a
   compile-time constant must not be a Hearth (runtime Hearth/occupancy is still
   re-checked by the engine, spec §9.3).
9. **(W) Trait sanity.** Every trait ∈ `mechanicalTrait` ∪ build `flavorTraits`; an
   unknown trait warns (likely a typo of a mechanical one).
10. **(W) Range/target agreement.** e.g. `range:self` ⇒ `targetKind:self`; `targetKind:
    border` ⇒ a wall-creation op present. Mismatches warn.

### Cross-reference / identity
11. **(E) Unique ids.** `id` is globally unique and matches `^[a-z]+_[a-z0-9_]+$`.
12. **(W) Path-prefix convention.** `id` prefix should equal `path` (e.g. `ash_*` for
    `ashwalk`) — warn if not, for human grep-ability.

### Deck / Path level
13. **(E) Single-path cards.** Every card in a Path file declares that Path's id.
14. **(E) Copy manifest.** The Path's copy-count manifest references only ids defined in
    the file, and each count ≥ 1.
15. **(W) Distribution.** Per-type mix within soft bounds (e.g. a Path that is 90%
    wards) warns as likely-unfun, not illegal.
16. **(E) Deck build.** A built match deck = `common` + N selected Paths (N per config);
    `common` is always included. A build omitting `common` or exceeding N is rejected.

---

## 5. Worked: failing cards (one rule each)

```jsonc
// ✗ Rule (schema if/then + linter 6): a ward must react, not onCast.
{ "id":"x_bad_ward","name":"Bad Ward","type":"ward","path":"ashwalk",
  "onCast":{ "op":"DealDamage","to":"$caster","amount":1 } }

// ✗ Rule 4: Transforms without the `form` trait.
{ "id":"x_sneaky_shift","name":"Sneaky Shift","type":"bane","path":"ashwalk",
  "traits":["fire"],"range":"self","targetKind":"self","duration":"instant",
  "baseBreath":1,
  "onCast":{ "op":"Transform","who":"$caster","form":"wolf" } }

// ✗ Rule 1: status id "stun" is not in the registry (the id is "daze").
{ "id":"x_wrong_status","name":"Wrong Status","type":"bane","path":"ashwalk",
  "range":"los","targetKind":"walker","duration":"instant","baseBreath":1,
  "onCast":{ "op":"ApplyStatus","to":"$target","status":"stun","stacks":1 } }

// ✗ Rule 2: CreateWall targets a cell, but walls go on borders.
{ "id":"x_wall_on_cell","name":"Wall On Cell","type":"working","path":"stoneshaping",
  "range":"los","targetKind":"cell","duration":"permanent","baseBreath":1,
  "onCast":{ "op":"CreateWall","border":"$cell","cracks":5 } }

// ✗ Schema (offering purity): an offering carrying an effect.
{ "id":"x_loaded_offering","name":"Loaded Offering","type":"offering","path":"ashwalk",
  "breathValue":3,
  "onCast":{ "op":"DealDamage","to":"$target","amount":1 } }
```

---

## 6. Pipeline integration

- The three stages run on every content PR; CI fails the PR on any ERROR. WARNs post as
  review comments, not blocks.
- The **resolve-check** (stage 3) loads the extensible registries + a mock board and
  executes each hook once against a stub state, asserting every op resolves and every
  selector binds to a non-empty/typed result where required. This is what catches a
  selector that's structurally valid but can never match (e.g. `select objects where
  is($it,"flaem")` — a misspelled object id that schema/linter id-checks should already
  catch, but the resolve-check is the backstop).
- Registries are versioned with the engine: adding a `status`/`form`/`object`/`op`
  means a registry + (for ops) an engine handler land together, so content can never
  reference a primitive the engine doesn't implement.

*End of Card Schema & Linter v0.1.*
