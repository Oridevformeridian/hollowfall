# FLUXFALL — Game Specification (v0.1, clean-room)

A turn-based tactical arena duel for 2–4 combatants. Working title: **FLUXFALL**.

This document is a **clean-room functional specification**. It captures a set of
tactical-card-combat *mechanics* (which are methods of play and therefore not
themselves copyrightable) and re-expresses them inside an entirely original
theme, vocabulary, and content set. No text, art, names, or flavor from the
source rulebook appear here.

---

## 0. Clean-room boundary (read this first)

The spec is split so the legal boundary is auditable.

**Layer A — Functional mechanics (reused, unprotected).** Turn/phase structure,
the movement-point economy, grid + line-of-sight rules, the five-category card
timing model, energy fueling, maintained-card-as-hand-pressure, the
cancel/reduce/evade counter model, object-damage cracks, the steal-and-hold +
elimination victory model, modular wrap-around board with paired gates. These are
systems, not expression.

**Layer B — Expression (newly authored here).** The name FLUXFALL; the theme
(Weavers channeling Flux in a shifting Lattice); all faction/Discipline names;
all card names and card flavor; all form names; the specific numeric balance set;
the art/UX direction. This layer is original to this document and replaces the
source's expression entirely.

**Rule for contributors:** implement only from this document. Do not consult the
source rulebook, port its card list, or reuse its names. If a number here feels
arbitrary, it is a placeholder to be re-derived in playtest, not copied from
anywhere.

---

## 1. High concept

Two to four **Weavers** are sealed inside the **Lattice**, a reconfigurable vault
of stone-and-circuitry corridors. Each Weaver channels **Flux** — drawn as a hand
of **Workings** (cards) — to move, strike, ward, build, and transform. Each Weaver
guards two **Cores**. You win by being decisive: drag a rival's Core back to your
**Anchor** and hold it, or simply be the last Weaver standing.

It is a free-for-all of hidden hands and sudden reversals on a small, deadly,
mutating grid.

---

## 2. Victory & scoring

- **Match target:** first to **2 points** wins immediately. (Configurable to 3–4
  for longer matches.)
- **Kill point:** reducing a rival Weaver to 0 Vitality *with an attack* scores 1
  point permanently, and you absorb their hand.
- **Heist point:** while an enemy Core rests in your Anchor tile, you hold 1
  point. This point is **conditional** — if that Core leaves your Anchor (picked
  up or knocked out), the point is lost. A carried Core scores nothing.
- **Sole-survivor:** if only one Weaver remains alive, they win regardless of
  points.
- A Weaver who dies *in the act* of an otherwise-winning move is treated as having
  died first (no posthumous win).

---

## 3. The Lattice (board model)

- The arena is built at match start from **modular square tiles**, one per player,
  each a 5×5 grid of cells (25 cells/tile). Tiles are shuffled and randomly
  rotated, then assembled per player count. This is a seeded procedure (see §13.2)
  so matches are reproducible/spectatable.
- Each tile carries one **Anchor** cell (its owner's home + start) and two **Core
  spawn** cells.
- **Edges wrap.** Walking off an open edge re-enters the directly opposite edge for
  1 movement point.
- **Gates** are paired teleport cells on edges where the opposite-edge rule
  doesn't apply; entering one gate exits its color-matched partner for 1 movement
  point. Gates are fixed in arena space and do **not** move when tiles move (§9.4).
- Cells block movement via **walls**, **columns** (wall endpoints), and **locked
  doors**. Outer-perimeter walls are indestructible and impassable.

### 3.1 Line of sight (LOS)
- Trace a straight segment from the center of the source cell to the center of the
  target cell (or to the targeted wall/door itself).
- Any wall or column intersecting the segment **blocks** LOS.
- Objects/Weavers/Cores do **not** block LOS unless their card explicitly states
  they "fill the cell."
- When tracing through a gate or a wrap edge, the two connected cells are treated
  as directly adjacent for both LOS and range.

### 3.2 Adjacency
- Adjacent = same cell or one of the 8 surrounding cells (diagonals included),
  **and** unobstructed LOS to it.

---

## 4. Combatant state

Each Weaver is an entity with:

| Field | Meaning | Start |
|---|---|---|
| `vitality` | hit points; die at ≤0 | 15 (hard cap 20) |
| `position` | cell on the grid | own Anchor |
| `hand` | secret Workings held | 5 dealt |
| `inPlay` | maintained Workings + carried Relics (count vs hand limit) | empty |
| `carriedCore` | at most one Core | none |
| `form` | current body form (default or one transform) | Default |
| `statuses` | stagger stack, etc. | empty |
| `points` | scored | 0 |

**Hand limit:** 7. Maintained Workings and carried Relics count against it,
creating the central resource tension: every persistent effect you keep running is
a card you can't hold. (A variant relaxes this — §14.)

---

## 5. Turn structure (state machine)

Play proceeds clockwise; one Weaver is **active** at a time. A turn is three
ordered phases. Model each as an explicit state for the engine.

### 5.1 UPKEEP
1. Resolve any "on your upkeep" effects of the active Weaver's maintained Workings.
2. Remove one Flux token from each of the active Weaver's *temporary* maintained
   Workings; any that hit 0 tokens end and are discarded.
3. If the active Weaver holds any **Stagger** tokens, discard one — they are
   staggered this turn (§11).

### 5.2 ACTION
The active Weaver has a budget and may interleave these freely:
- Spend **movement points** (base 3).
- Make **at most one attack** (forbidden on a Weaver's very first turn of the
  match).
- Play any number of **non-attack** Workings (Charges, Relics, Tricks, neutral
  effects).
Order is free: move, cast, move again, attack, move again — as budget allows.

### 5.3 CLEANUP
1. Discard any number of cards from hand (optional).
2. Draw up to 2, never exceeding the hand limit of 7.
3. Turn passes to the next Weaver.

If the draw pile empties, reshuffle the discard pile into a new pile. If a Weaver
ever exceeds the hand limit (from absorbing a kill, an effect, etc.), they
immediately discard down to 7.

---

## 6. Movement

- 1 movement point (MP) = move to one orthogonally adjacent cell. **No diagonal
  movement.** (Diagonals matter for *targeting*, not stepping.)
- Cannot pass through walls, locked doors, or movement-blocking objects.
- May enter/share/stop in a cell containing another Weaver.
- **Speed boost:** once per turn, discard one Charge (or any Working showing a Flux
  value) to gain extra MP equal to that value. Usable at any point in the turn.
- **Form speed change mid-turn:** if base speed changes mid-turn (e.g. a
  transform), remaining MP shifts by the delta. It can go to/below 0 (no further
  movement until raised back above 0 by a boost).
- **Wrap / Gate moves:** 1 MP each (§3).
- **Random direction:** some effects force a random step. The engine rolls a
  uniform direction from the 4 orthogonals (seeded RNG, §13.2) and moves the
  Weaver one cell that way.

### 6.1 Doors
- Doors are **locked by default**; opening requires a Key-type Working.
- Doors in a Weaver's *own* home tile are always unlocked for them.
- A door auto-relocks once no Weaver is adjacent. You may hold it open to let
  others follow; you can also cast *through* an open door without stepping through.

---

## 7. Card (Working) system

### 7.1 Types & timing

| Type | Plays on | Limit/turn | Notes |
|---|---|---|---|
| **Strike** (attack) | your ACTION | 1 (it *is* your attack) | can't also punch/weapon-attack that turn |
| **Ward** (counter) | *any* turn, as a response | unlimited | the only cards playable off-turn |
| **Charge** (energy) | your ACTION | unlimited | fuels movement or a Working |
| **Relic** (item) | your ACTION | unlimited | persistent; carried; counts vs hand limit |
| **Trick** (neutral) | your ACTION | unlimited | utility, terrain, buffs, etc. |

A Working without a fuel value can still be **spent for its printed Flux value**
instead of played for effect.

### 7.2 Schema (data model)

```jsonc
{
  "id": "pyr_emberlance",
  "name": "Ember Lance",
  "type": "strike",            // strike | ward | charge | relic | trick
  "discipline": "pyrics",      // see §12
  "traits": ["fire"],          // see §7.6
  "range": "los",              // self | adjacent | los | anywhere
  "targetKind": "weaver",      // weaver | cell | wall | door | object | core | sector | spell | board
  "duration": "instant",       // instant | temporary | permanent
  "baseFlux": 1,               // default energy if not fueled
  "fluxValue": 3,              // value when SPENT as a charge instead
  "effect": "DealDamage(target, energy)",   // effect-DSL, §13.4
  "flavor": "Authored here; not derived from any source text."
}
```

### 7.3 Range categories
`self` (caster only) · `adjacent` (same/adjacent cell + LOS) · `los` (anything you
can see, any distance unless stated) · `anywhere` (no LOS needed / range
irrelevant, e.g. board-wide effects).

### 7.4 Target kinds
`weaver` · `cell` (some require an *empty* cell: no object/Core/being/Weaver) ·
`wall` · `door` · `object` (inanimate, incl. dropped Relics; carried Relics are
**not** objects) · `core` (never an "object") · `sector` (one tile) · `board`
(whole arena) · `spell` (a Working in play, possibly restricted) · `border` (a line
between two cells — used by wall-creating effects).

### 7.5 Durations
- **Instant:** resolve, then discard (with any Charges spent).
- **Temporary:** placed in play with Flux tokens equal to its energy; one ticks off
  each Upkeep; discarded at 0. Maintained while active.
- **Permanent:** stays in play until the caster ends it or it's destroyed.
  Maintained while active.
- Duration is locked at cast time; temporary effects cannot be extended later. The
  caster may voluntarily end any maintained Working on their turn; ending it
  immediately removes its effects and any objects it created.

### 7.6 Energy & boosting
- Default energy of a Working is **1**.
- When casting, you may discard one Charge to **replace** (not add to) that 1 with
  the Charge's value. A spell fueled with a 5-Charge has energy 5.
- Effects scale on `energy`: damage = energy, duration = energy turns, etc.
- Place Flux tokens on a temporary Working equal to its energy to track remaining
  turns.

### 7.7 Traits (tags with rules + flavor hooks)
`fire` / `water` (can cancel each other) · `creation` (places a lasting object;
never in an Anchor cell) · `curse` (lingering attack) · `global` (whole-Lattice;
always has LOS for cancel/dispel purposes) · `reagent` (a gem-type Relic;
**destroyed if its holder takes fire damage**) · `mundane` (non-magical; **cannot
be countered**) · `transformation` (one at a time; replaces prior form) · `thrown`
· `weapon` · `trinket`. Traits are extensible.

---

## 8. Combat & resolution

### 8.1 Making an attack
- Exactly one attack per turn, and never on your first turn.
- An attack is either a **Strike** card, a **weapon/thrown Relic**, or a **punch**
  (1 physical damage to a Weaver in your cell or adjacent; no card needed, but it
  uses up your attack).
- Declare target → play the card(s) → target may respond with Ward(s).
- Attacks **auto-hit** unless a Ward intervenes.

### 8.2 Wards: cancel / reduce / evade
- **Cancel:** the attack is discarded with no effect (a canceled attack *still*
  uses the attacker's attack for the turn).
- **Reduce:** lower the damage or the duration. A spell reduced to 0 damage deals
  none — and secondary on-hit effects do **not** trigger. A duration reduced to 0
  is canceled.
- **Evade:** the spell resolves but misses the evader; often a die roll decides
  (e.g. evade on a 1–2 of d4). Some Strikes are flagged un-evadable.
- Multiple Wards may stack against one attack; the defender may resolve one before
  committing the next.

### 8.3 Damage, death, absorption
- Damage subtracts from `vitality` (floor effects at the 0-death threshold).
- At ≤0 Vitality the Weaver dies: figure removed; carried Relics drop as objects in
  the death cell; maintained Workings discarded; their Cores stay in play.
- **Direct kill by attack** → killer scores 1 point and takes the dead Weaver's
  remaining hand (not their carried Relics or maintained Workings); then discards
  to hand limit if needed.
- **Indirect kill** (e.g. standing in a created hazard, collapsing wall) → the dead
  Weaver's hand is discarded and **no one scores**.

### 8.4 Damaging objects
- Only walls, doors, and explicitly-damageable created/dropped objects can be hit.
- Every **3 damage in a single hit = 1 crack**; sub-3 damage does nothing and
  remainder below the next multiple of 3 is wasted (7 dmg → 2 cracks).
- Destroy thresholds: **wall = 5 cracks**, **door = 3 cracks**. Outer walls, Cores,
  and objects without a stated crack limit are indestructible.
- Destroying a wall/door leaves a "destroyed" marker (a new wall may later be built
  there). A column left attached to nothing is removed with it.

---

## 9. Objects, terrain & the mutating Lattice

### 9.1 Mobile vs immobile
- **Mobile** objects can be picked up (1 MP while on them) and carried as Relics;
  **immobile** objects are fixed. Board-printed walls/doors are immobile.

### 9.2 Pick up / drop
- Picking up a mobile object costs 1 MP and moves its card into your `inPlay`
  (counts vs hand limit; make room first if full). You can't forcibly take another
  Weaver's carried Relic unless a card says so.
- Drop a carried Relic into your cell any time on your turn (free); it becomes a
  dropped object. Multiple dropped objects may share a cell.

### 9.3 Creating objects/terrain
- Creation effects place an object/wall token; it lasts only as long as its
  Working's duration (unless the Permanent-Creations variant is on, §14).
- **Cannot** create in an Anchor cell or in a cell already holding an
  object/Core/being. Walls are created on a **border line**, never diagonally, and
  not where a wall already exists.

### 9.4 Moving tiles
- Effects that rotate/swap tiles: gates stay put in arena space. A created wall
  straddling a moving tile boundary is **destroyed**; a damaged/destroyed wall
  straddling it is **repaired**. Aligned double walls (one per tile) count as a
  single wall.

### 9.5 Throwing
- Only Workings flagged `thrown` may be thrown. A thrown object lands on its
  target's cell; if a barrier/full-cell target is in the way, it lands in the last
  cell it passed through before impact.

---

## 10. Forms (transformations)

- A `transformation` Working swaps the Weaver into an alternate **form**; only one
  form at a time — a new transform replaces the prior one.
- Each form alters stats (notably base speed, see §6) and carries a **weakness** so
  no form is strictly better.
- Original form set (Layer B; rename/extend freely): **Titan** (slow, high-impact),
  **Bulwark** (slow, armored, fire-vulnerable), **Ooze** (squeezes/special
  movement), **Sprite** (fast, fragile, evade-prone), **Beast** (fast melee).
- Implementation: a form is a stat/ability overlay + a model swap; ending it
  restores the Default overlay.

---

## 11. Status effects

- **Stagger:** while staggered for a turn, the Weaver may move **or** attack, not
  both, and if they choose to attack they cannot voluntarily leave their cell that
  turn. Other actions (pick up, neutral Tricks) are unaffected. Stagger tokens
  stack to set duration; one is shed each Upkeep.
- The status system is data-driven; add more (root, silence, burn-over-time) via
  the same token+upkeep pattern.

---

## 12. Disciplines (the re-themed card groups)

Cards are grouped into **Disciplines** for deckbuilding flavor and draft. Each game
uses the universal **Common** set plus a selected subset, shuffled into one shared
draw pile (or split pools for the draft variant). Names and identities below are
original (Layer B):

- **Common** — baseline Workings every Weaver knows (movement tricks, basic
  strikes, keys, a shield). Always in the deck.
- **Pyrics** — aggressive elemental damage; fireballs, lightning; the deadliest in
  raw output. (`fire` heavy.)
- **Forge** — `reagent` Relics: carried gems granting standing buffs, fragile to
  fire.
- **Architecture** — `creation`: walls, hazards, terrain shaping; litters the
  Lattice.
- **Psionics** — mind effects: steal/erase Workings, plentiful small Charges.
- **Morphology** — the transform set (§10), powerful but each form has a weakness.
- **Praxis** — balanced generalist set with above-average raw Flux.

### 12.1 Example cards (authored here to illustrate each mechanic, not ported)

| Name | Disc. | Type | Range | Dur. | Effect sketch |
|---|---|---|---|---|---|
| Ember Lance | Pyrics | strike | LOS | instant | `DealDamage(target, energy)`; `fire` |
| Backdraft | Pyrics | trick | board | temporary | each Upkeep, deal 1 to all in lit cells |
| Mirror Ward | Common | ward | self | instant | cancel one incoming Strike |
| Half-Guard | Common | ward | self | instant | reduce incoming damage by `energy` |
| Phase Step | Common | trick | self | instant | teleport up to 3 cells in LOS |
| Skeleton Key | Common | trick | door | instant | unlock target door this turn; `mundane` |
| Raise Bulwark | Architecture | trick | border | permanent | create a wall (5 cracks) |
| Brittle Hex | Psionics | strike | LOS | temporary | `curse`: 2 dmg each Upkeep for `energy` turns |
| Hardstone | Forge | relic | self | permanent | `reagent`: +2 max Vitality while carried |
| Beast Shift | Morphology | trick | self | permanent | `transformation` → Beast form |
| Surge | Praxis | charge | — | — | Flux value 4 |

All names, numbers, and flavor above are placeholders authored for this spec.

---

## 13. Digital implementation

### 13.1 Architecture
- **Authoritative simulation.** A single deterministic rules engine owns all state;
  clients send *intents* (move to cell X, play card Y at target Z, respond with
  Ward W) and receive validated state deltas. Never trust client-side resolution —
  hidden hands make anti-cheat essential.
- Engine is a **finite state machine** over the phases in §5, with a nested
  **response window** state for Ward exchanges (the only off-turn interaction).
  Model the response window as a priority queue: attacker declares → defender may
  respond → either may chain → resolve innermost first.

### 13.2 Determinism & seeding
- All randomness (tile shuffle/rotation, dice, random direction, draw order) flows
  through **one seeded PRNG** per match. Persist the seed + the ordered intent log;
  the entire match is then reproducible for replays, spectating, and dispute
  resolution.

### 13.3 Multiplayer model
- Turn-based, so **async** (play-by-turn, push notifications) and **live
  hot-seat/online** both work on the same engine. Add a per-turn timer + an
  auto-pass/forfeit policy for live play.
- **Hidden information:** each client sees only its own hand and public state. The
  server sends redacted views; opponents' hands are counts, not contents. Ward
  windows must reveal only that a response *may* occur, not what's held.

### 13.4 Effect DSL / scripting
- Cards reference effects by a small, sandboxed **effect language** (or a registry
  of typed effect functions) rather than raw code, so content is data, not
  redeploys. Primitives: `DealDamage`, `Heal`, `Move`, `ForceRandomMove`,
  `CreateWall`, `CreateObject`, `Teleport`, `ApplyStatus`, `Transform`,
  `ModifyStat`, `Counter(kind)`, `StealCard`, `EndMaintained`, `Crack`, etc. Each
  reads `energy` from the cast context.
- A "Golden Rule" precedence: **card text overrides general rules.** Implement as
  an effect-resolution pipeline where card-level handlers can short-circuit or
  rewrite the default resolution.

### 13.5 AI opponents
- Needed for solo/fill. Suggested stack: legal-move enumeration → heuristic
  evaluation (Vitality swing, board control, Core threat, tempo of maintained
  cards vs hand pressure) → optionally a shallow expectimax over the d4/random
  outcomes. Difficulty tiers gate lookahead depth and Ward-bluffing.

### 13.6 UX implications of the physical → digital port
- Life dial → animated **Vitality bar** (0–20).
- Tokens → state badges (Flux tokens on maintained cards, Stagger pips, cracks on
  walls).
- The **maintained-cards tray** is a first-class UI region: it visibly eats hand
  capacity (7 slots total shared with hand) — surface this pressure clearly, it's
  the core economy.
- Secret hand, public board: clear visual language for "what everyone sees" vs
  "what only you see."
- Telegraph **LOS and range** on hover/selection (highlight legal target cells),
  since LOS tracing is unintuitive without help.
- Animate Ward windows with a short, skippable decision prompt for the defender.

### 13.7 Content pipeline
- Cards, forms, Disciplines, tiles, and statuses are all **data files** validated
  against schemas (§7.2). A card editor + an automated "does this card's effect
  resolve against the engine primitives" linter lets designers add content without
  engineering. Balance values live in data and are hot-tunable.

---

## 14. Variants (config flags)

Expose these as match settings; each maps to a single engine toggle:

- **Loose Minds:** maintained Workings *don't* count against hand limit.
- **Permanent Creations:** created walls/hazards persist without being maintained
  (and can't be self-dispelled).
- **Heavy Relics:** picking up any object ends your ACTION phase immediately (as
  Cores do), discouraging pick-up/drop juggling.
- **Lethal Cores:** if both of a Weaver's Cores sit in *enemies'* Anchors at once,
  that Weaver is eliminated (no one scores the kill).
- **Heist-Only:** win only via Cores (two enemy Cores in your Anchor) or
  sole-survivor; kills score nothing.
- **Grand Deck:** shuffle all Disciplines together for a chaotic pool.
- **Extended:** match target 3 or 4 points.
- **Draft:** split players into two pools; each drafts Disciplines into a separate
  deck they draw from.

---

## 15. Open questions / balance notes

- The base numbers (Vitality 15/cap 20, base speed 3, hand limit 7, draw 2, crack
  thresholds 5/3) are inherited *structural* ratios; treat them as starting
  placeholders and re-derive through playtest rather than treating any as sacred.
- Decide the canonical RNG surface: keep a d4-style discrete roller for parity, or
  move to continuous probabilities for evade/random-direction. The discrete version
  is easier to reason about and telegraph.
- First-turn attack ban + turn-order advantage in a free-for-all: confirm seating
  fairness, possibly with a catch-up or simultaneous-first-turn rule.
- Define exact Ward-chain depth limits to bound the response-window recursion.

---

## 16. Glossary (original terms)

**Weaver** — a player's combatant. **Flux** — the magical resource; also the token
unit of energy/duration. **Working** — a card. **Strike/Ward/Charge/Relic/Trick** —
the five card types. **Discipline** — a themed group of Workings. **Lattice** — the
modular arena. **Cell / Tile** — a grid square / a 5×5 board piece. **Anchor** — a
Weaver's home cell. **Core** — a stealable objective token (two per Weaver).
**Gate** — paired teleport edge cells. **Reagent** — a gem-type Relic, fire-fragile.
**Form** — an alternate transformed body. **Stagger** — the move-or-attack status.
**Crack** — a unit of structural damage to objects.

---

*End of spec v0.1. Layer B content (names, numbers, theme) is authored here and
free to revise; Layer A mechanics are the functional target to implement.*
