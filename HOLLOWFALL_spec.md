# HOLLOWFALL — Game Specification (v0.2, clean-room)

A turn-based tactical spirit-duel for 2–4 combatants. Working title: **HOLLOWFALL**.
(Formerly FLUXFALL — re-skinned to an original animist theme; mechanics unchanged.)

This document is a **clean-room functional specification**. It captures a set of
tactical-card-combat *mechanics* (methods of play, not copyrightable) and
re-expresses them inside an entirely original theme, vocabulary, and content set.
No text, art, names, or flavor from any source rulebook or any other game's setting
appears here.

### Changelog v0.1 → v0.2
- **Theme swap:** generic "Weaver/Flux/Lattice" skin replaced with an original
  shamanic/animist skin (Walkers, Breath, the Hollow, Masks). Layer A mechanics
  untouched.
- **Fix:** picking up a Mask now correctly ends the ACTION phase as a *base* rule
  (§6.2), not a variant.
- **New:** full Mask-handling rules — carry-one, carry-your-own, free drop, scoring
  window (§6.2).
- **New:** explicit victory-check hook and timing (§2, §13.1).
- **New:** arena scales with player count (§3).
- **New:** healing/regen rule stated (§8.3).
- **New:** onboarding + accessibility requirements (§13.6); meta-scope open question
  (§15).

---

## 0. Clean-room boundary (read this first)

**Layer A — Functional mechanics (reused, unprotected).** Turn/phase structure, the
movement-point economy, grid + line-of-sight rules, the five-category card timing
model, energy fueling, maintained-card-as-hand-pressure, the cancel/reduce/evade
counter model, object-damage cracks, the steal-and-hold + elimination victory model,
modular wrap-around board with paired crossings. Systems, not expression.

**Layer B — Expression (newly authored here).** The name HOLLOWFALL; the theme
(Walkers descending into the Hollow to duel with spirit-Rites); all Path names; all
Rite names and flavor; all form names; the specific numeric balance set; art/UX
direction. Original to this document.

**On inspiration vs. infringement.** This skin draws on *public-domain comparative
shamanism/animism* — three-world cosmology, trance-drumming, totem animals,
spirit-masks, the silver cord — the same well other fantasy works drew from. It does
**not** reuse any specific published game's setting terms, totem roster, or framing.
Keep it that way: build from myth and folklore, not from another product.

**Rule for contributors:** implement only from this document. Do not consult any
source rulebook or port another game's names/lists. Numbers here are playtest
placeholders, not copied values.

---

## 1. High concept

To duel, a **Walker** drums themself into trance and descends into **the Hollow** —
the spirit-side of the world, a shifting maze of root, stone, and bone where 2–4
Walkers hunt one another. A Walker spends **Breath** (drawn as a hand of **Rites**)
to move, call spirits, strike, ward, and take animal forms. Each Walker's power is
bound into two **Masks** they must guard. Drag a rival's Mask back to your **Hearth**
and enshrine it — or sever every rival's life-thread — and the Hollow is yours.

Hidden hands, sudden reversals, a small and lethal mutating grid.

*Cosmology flavor (optional):* the Hollow is the lowest of three worlds; the drum is
the road down; a Walker's body waits above, tethered by a single life-thread. Cut the
thread and the Walker does not return.

---

## 2. Victory & scoring

- **Match target:** first to **2 points** wins. (Configurable 3–4 for longer matches.)
- **Sever point:** reducing a rival Walker to 0 Thread *with an attack* scores 1 point
  permanently, and you absorb their hand.
- **Mask point:** while an enemy Mask rests in your Hearth, you hold 1 point. This
  point is **conditional** — if that Mask leaves your Hearth (picked up or knocked
  out), the point is lost. A carried Mask scores nothing.
- **Sole-survivor:** if only one Walker remains alive, they win regardless of points.
- A Walker who dies *in the act* of an otherwise-winning move is treated as having
  died first (no posthumous win).

**Victory check (engine hook):** evaluate win conditions immediately after **any**
event that changes a point total or the count of living Walkers — a sever, a Mask
entering/leaving a Hearth, an elimination. First condition satisfied ends the match.

---

## 3. The Hollow (board model)

- Built at match start from **modular square Grounds**, each a 5×5 grid (25 cells).
  Grounds are shuffled, randomly rotated, and assembled. Seeded (see §13.2) for
  reproducible/spectatable matches.
- **Arena scales with player count.** Use enough Grounds that every Walker has a home
  Ground, with the assembled shape and Ground count varying by 2/3/4 players (tune in
  playtest; the source ratios are starting points, not gospel).
- Each Ground carries one **Hearth** cell (its owner's home + start) and two **Mask
  spawn** cells.
- **Edges wrap.** Walking off an open edge re-enters the directly opposite edge for 1
  movement point.
- **Crossings** are paired teleport cells on edges where the opposite-edge rule
  doesn't apply; entering one Crossing exits its matched partner for 1 movement point.
  Crossings are fixed in arena space and do **not** move when Grounds move (§9.4).
- Cells block movement via **walls**, **columns** (wall endpoints), and **locked
  doors**. Outer-perimeter walls are indestructible and impassable.

### 3.1 Line of sight (LOS)
- Trace a straight segment from the center of the source cell to the center of the
  target cell (or to the targeted wall/door itself).
- Any wall or column intersecting the segment **blocks** LOS.
- Objects/Walkers/Masks do **not** block LOS unless their Rite states they "fill the
  cell."
- Through a Crossing or wrap edge, the two connected cells are treated as directly
  adjacent for LOS and range.

### 3.2 Adjacency
- Adjacent = same cell or one of the 8 surrounding cells (diagonals included) **and**
  unobstructed LOS to it.

---

## 4. Combatant state

Each Walker is an entity with:

| Field | Meaning | Start |
|---|---|---|
| `thread` | life (the silver cord); die at ≤0 | 15 (hard cap 20) |
| `position` | cell on the grid | own Hearth |
| `hand` | secret Rites held | 5 dealt |
| `inPlay` | maintained Rites + carried Talismans (count vs hand limit) | empty |
| `carriedMask` | at most one Mask | none |
| `form` | current body form (default or one form) | Default |
| `statuses` | daze stack, etc. | empty |
| `points` | scored | 0 |

**Hand limit:** 7. Maintained Rites and carried Talismans count against it — every
persistent effect you keep running is a card you can't hold. (A variant relaxes
this — §14.)

---

## 5. Turn structure (state machine)

Clockwise; one **active** Walker at a time. Three ordered phases; model each as an
explicit engine state.

### 5.1 UPKEEP
1. Resolve any "on your upkeep" effects of the active Walker's maintained Rites.
2. Remove one Breath token from each *temporary* maintained Rite; any that hit 0 end
   and are discarded.
3. If the active Walker holds any **Daze** tokens, discard one — they are dazed this
   turn (§11).

### 5.2 ACTION
Budget, freely interleaved:
- Spend **movement points** (base 3).
- Make **at most one attack** (forbidden on a Walker's first turn of the match).
- Play any number of **non-attack** Rites (Offerings, Talismans, Workings, neutral
  effects).
Order is free: move, call, move again, strike, move again — as budget allows.

### 5.3 CLEANUP
1. Discard any number of cards (optional).
2. Draw up to 2, never exceeding hand limit 7.
3. Pass to the next Walker.

Empty draw pile → reshuffle discard. Over the hand limit (from a sever, an effect,
etc.) → immediately discard down to 7.

---

## 6. Movement

- 1 MP = move to one orthogonally adjacent cell. **No diagonal movement** (diagonals
  matter for *targeting*, not stepping).
- Cannot pass through walls, locked doors, or movement-blocking objects.
- May enter/share/stop in a cell containing another Walker.
- **Quickening (speed boost):** once per turn, discard one Offering (or any Rite
  showing a Breath value) for extra MP equal to that value, at any point in the turn.
- **Form speed change mid-turn:** if base speed changes mid-turn, remaining MP shifts
  by the delta; may go to/below 0 (no further movement until raised back above 0).
- **Wrap / Crossing moves:** 1 MP each.
- **Random direction:** seeded uniform roll over the 4 orthogonals; move one cell.

### 6.1 Doors
- **Locked by default**; opening requires a Key-type Rite.
- Doors in a Walker's *own* home Ground are always unlocked for them.
- A door auto-relocks once no Walker is adjacent. You may hold it open for followers;
  you may also call *through* an open door without stepping through.

### 6.2 Masks (the objectives) — **base rules**
- A Mask sits on a cell. A Walker on that cell may pick it up during movement.
- **Picking up a Mask immediately ends the ACTION phase** — you proceed straight to
  CLEANUP. (This is core, and it's what makes the steal a real commitment.)
- **Carry one at a time.** A Mask is *not* a hand card — it attaches to the carrier
  and doesn't count against the hand limit.
- You may carry **your own** Mask, including retrieving it from an enemy's Hearth.
- **Dropping is free** (no MP) into your current cell, any time on your turn.
- **Scoring:** an enemy Mask dropped in your Hearth holds 1 point *while it stays
  there* (see §2). Dropping it there does not cost the turn.
- On death, a Walker's Masks remain in play where they lie (§8.3).

---

## 7. Rite (card) system

### 7.1 Types & timing

| Type | Plays on | Limit/turn | Notes |
|---|---|---|---|
| **Bane** (attack) | your ACTION | 1 (it *is* your attack) | can't also weapon/unarmed-attack that turn |
| **Ward** (counter) | *any* turn, as a response | unlimited | only cards playable off-turn |
| **Offering** (energy) | your ACTION | unlimited | fuels movement or a Rite |
| **Talisman** (item) | your ACTION | unlimited | persistent; carried; counts vs hand limit |
| **Working** (neutral) | your ACTION | unlimited | utility, terrain, buffs, forms |

A Rite without a fuel value can still be **spent for its printed Breath value**
instead of played for effect.

### 7.2 Schema (data model)

```jsonc
{
  "id": "ash_kindle_storm",
  "name": "Kindle the Storm",
  "type": "bane",              // bane | ward | offering | talisman | working
  "path": "ashwalk",           // see §12
  "traits": ["fire"],          // see §7.7
  "range": "los",              // self | adjacent | los | anywhere
  "targetKind": "walker",      // walker | cell | wall | door | object | mask | sector | spell | board | border
  "duration": "instant",       // instant | temporary | permanent
  "baseBreath": 1,             // default energy if not fueled
  "breathValue": 3,            // value when SPENT as an Offering instead
  "effect": "DealDamage(target, energy)",   // effect-DSL, §13.4
  "flavor": "Authored here; not derived from any source text."
}
```

### 7.3 Range categories
`self` (caster only) · `adjacent` (same/adjacent cell + LOS) · `los` (anything you can
see, any distance unless stated) · `anywhere` (no LOS needed / range irrelevant).

### 7.4 Target kinds
`walker` · `cell` (some require an *empty* cell) · `wall` · `door` · `object`
(inanimate, incl. dropped Talismans; carried Talismans are **not** objects) · `mask`
(never an "object") · `sector` (one Ground) · `board` (whole Hollow) · `spell` (a Rite
in play) · `border` (a line between two cells — wall creation).

### 7.5 Durations
- **Instant:** resolve, then discard (with any Offerings spent).
- **Temporary:** placed in play with Breath tokens equal to its energy; one ticks off
  each Upkeep; discarded at 0. Maintained while active.
- **Permanent:** stays until the caster ends it or it's destroyed. Maintained while
  active.
- Duration locks at cast time; temporary effects can't be extended later. The caster
  may voluntarily end any maintained Rite on their turn, removing its effects and any
  objects it created.

### 7.6 Breath & fueling
- Default energy of a Rite is **1**.
- When casting, discard one Offering to **replace** (not add to) that 1 with the
  Offering's value. A Rite fueled with a 5-Offering has energy 5.
- Effects scale on `energy`: damage = energy, duration = energy turns, etc.
- Track temporary Rites with Breath tokens equal to energy.

### 7.7 Traits
`fire` / `water` (cancel each other) · `creation` (places a lasting object; never in a
Hearth) · `curse` (lingering attack) · `global` (whole-Hollow; always has LOS for
cancel/dispel) · `bonecharm` (a carved bone/stone Talisman; **destroyed if its bearer
takes fire damage**) · `mundane` (non-magical; **cannot be countered**) · `form`
(transformation; one at a time) · `thrown` · `weapon` · `trinket`. Extensible.

---

## 8. Combat & resolution

### 8.1 Making an attack
- One attack per turn, never on your first turn.
- An attack is a **Bane**, a **weapon/thrown Talisman**, or an **unarmed Lash** (1
  physical damage to a Walker in your cell or adjacent; no card, but uses your attack).
- Declare target → play the card(s) → target may respond with Ward(s).
- Attacks **auto-hit** unless a Ward intervenes.

### 8.2 Wards: cancel / reduce / evade
- **Cancel:** attack discarded, no effect (a canceled attack *still* uses the
  attacker's attack for the turn).
- **Reduce:** lower damage or duration. Reduced to 0 damage → none, and on-hit
  secondary effects do **not** trigger. Duration reduced to 0 → canceled.
- **Evade:** the Rite resolves but misses the evader; often a die roll decides (e.g.
  evade on a 1–2 of d4). Some Banes are flagged un-evadable.
- Multiple Wards may stack against one attack; resolve one before committing the next.

### 8.3 Thread, death, absorption, healing
- Damage subtracts from `thread`.
- **Healing:** rites may restore Thread up to the cap of 20; excess is wasted. There is
  **no passive regeneration** — the only way up is an effect.
- At ≤0 Thread the cord is cut: figure removed; carried Talismans drop as objects in
  the death cell; maintained Rites discarded; the Walker's Masks remain in play where
  they lie.
- **Direct sever by attack** → killer scores 1 point and takes the dead Walker's
  remaining hand (not carried Talismans or maintained Rites); then discards to limit.
- **Indirect death** (standing in a hazard, collapsing wall) → that hand is discarded
  and **no one scores**.

### 8.4 Damaging objects
- Only walls, doors, and explicitly-damageable created/dropped objects can be hit.
- Every **3 damage in a single hit = 1 crack**; sub-3 does nothing; remainder below the
  next multiple of 3 is wasted (7 dmg → 2 cracks).
- Destroy thresholds: **wall = 5 cracks**, **door = 3 cracks**. Outer walls, Masks, and
  objects without a stated crack limit are indestructible.
- Destroying a wall/door leaves a "destroyed" marker (a new wall may later be built
  there). A column attached to nothing is removed with it.

---

## 9. Objects, terrain & the mutating Hollow

### 9.1 Mobile vs immobile
- **Mobile** objects can be picked up (1 MP while on them) and carried as Talismans;
  **immobile** objects are fixed. Board-printed walls/doors are immobile.

### 9.2 Pick up / drop
- Picking up a mobile object costs 1 MP and moves its card into `inPlay` (counts vs
  hand limit; make room first if full). You can't forcibly take another Walker's
  carried Talisman unless a card says so.
- Drop a carried Talisman into your cell any time on your turn (free); it becomes a
  dropped object. Multiple dropped objects may share a cell.

### 9.3 Creating objects/terrain
- Creation lasts only as long as its Rite's duration (unless Permanent-Creations
  variant is on, §14).
- **Cannot** create in a Hearth or in a cell already holding an object/Mask/being.
  Walls are created on a **border line**, never diagonally, and not where a wall
  already exists.

### 9.4 Moving Grounds
- Rotating/swapping Grounds: Crossings stay put in arena space. A created wall
  straddling a moving Ground boundary is **destroyed**; a damaged/destroyed wall
  straddling it is **repaired**. Aligned double walls count as a single wall.

### 9.5 Throwing
- Only Rites flagged `thrown` may be thrown. A thrown object lands on its target's
  cell; if a barrier/full-cell target is in the way, it lands in the last cell it
  passed through before impact.

---

## 10. Forms (animal shapes)

- A `form` Rite swaps the Walker into an alternate **form**; only one at a time — a new
  form replaces the prior one.
- Each form alters stats (notably base speed, §6) and carries a **weakness**, so no
  form is strictly best.
- Original form set (Layer B; rename/extend freely): **Bear-form** (slow,
  high-impact), **Stone-form** (slow, armored, fire-vulnerable), **Smoke-form**
  (slips through gaps / special movement), **Hare-form** (fast, fragile, evade-prone),
  **Wolf-form** (fast melee).
- Implementation: a form is a stat/ability overlay + a model swap; ending it restores
  the Default overlay.

---

## 11. Status effects

- **Daze:** while dazed for a turn, the Walker may move **or** attack, not both; if they
  attack they cannot voluntarily leave their cell that turn. Other actions (pick up,
  neutral Workings) are unaffected. Daze tokens stack for duration; one sheds each
  Upkeep.
- Status system is data-driven; add more (root, hush, burn-over-time) via the same
  token+upkeep pattern.

---

## 12. Spirit Paths (the re-themed card groups)

Cards group into **Paths** for flavor and draft. Each match uses the universal
**Common Drum** set plus a selected subset, shuffled into one shared draw pile (or
split pools for the draft variant). All names original (Layer B):

- **Common Drum** — rites every Walker knows (movement, basic strikes, keys, a ward).
  Always in the deck.
- **Ashwalk** — fire and storm; the deadliest raw output. (`fire` heavy.)
- **Bonecraft** — `bonecharm` Talismans: carved bone/stone charms granting standing
  boons, fragile to fire.
- **Stoneshaping** — `creation`: walls, hazards, terrain shaping; litters the Hollow.
- **Dreamwalking** — mind spirits: steal/erase Rites, plentiful small Offerings.
- **Beast Paths** — the form set (§10); powerful, each form with a weakness.
- **Old Blood** — ancestral generalist set with above-average raw Breath.

### 12.1 Example cards (authored here to illustrate each mechanic, not ported)

| Name | Path | Type | Range | Dur. | Effect sketch |
|---|---|---|---|---|---|
| Kindle the Storm | Ashwalk | bane | LOS | instant | `DealDamage(target, energy)`; `fire` |
| Wildfire | Ashwalk | working | board | temporary | each Upkeep, deal 1 to all in lit cells |
| Turn Aside | Common Drum | ward | self | instant | cancel one incoming Bane |
| Spirit-Skin | Common Drum | ward | self | instant | reduce incoming damage by `energy` |
| Miststep | Common Drum | working | self | instant | teleport up to 3 cells in LOS |
| Open the Way | Common Drum | working | door | instant | unlock target door this turn; `mundane` |
| Raise Stone | Stoneshaping | working | border | permanent | create a wall (5 cracks) |
| Wasting Curse | Old Blood | bane | LOS | temporary | `curse`: 2 dmg each Upkeep for `energy` turns |
| Bear-Charm | Bonecraft | talisman | self | permanent | `bonecharm`: +2 max Thread while carried |
| Don the Wolf | Beast Paths | working | self | permanent | `form` → Wolf-form |
| Deep Breath | Old Blood | offering | — | — | Breath value 4 |

All names, numbers, and flavor above are placeholders authored for this spec.

---

## 13. Digital implementation

### 13.1 Architecture
- **Authoritative simulation.** One deterministic rules engine owns all state; clients
  send *intents* and receive validated deltas. Never trust client-side resolution —
  hidden hands make anti-cheat essential.
- Engine is a **finite state machine** over the phases in §5, with a nested **response
  window** state for Ward exchanges (the only off-turn interaction). Model the window
  as a priority queue: attacker declares → defender may respond → either may chain →
  resolve innermost first.
- **Victory hook:** after every state mutation that can change points or living-Walker
  count, run the §2 check before yielding control.

### 13.2 Determinism & seeding
- All randomness (Ground shuffle/rotation, dice, random direction, draw order) flows
  through **one seeded PRNG** per match. Persist seed + ordered intent log → full
  match is reproducible for replays, spectating, dispute resolution.

### 13.3 Multiplayer model
- Turn-based → **async** (play-by-turn, push notifications) and **live** both run on the
  same engine. Add per-turn timer + auto-pass/forfeit for live play.
- **Hidden information:** each client sees only its own hand + public state. Server
  sends redacted views; opponents' hands are counts, not contents. Ward windows reveal
  only that a response *may* occur, not what's held.

### 13.4 Effect DSL / scripting
- Cards reference effects via a small sandboxed **effect language** (or a registry of
  typed effect functions), so content is data, not redeploys. Primitives: `DealDamage`,
  `Heal`, `Move`, `ForceRandomMove`, `CreateWall`, `CreateObject`, `Teleport`,
  `ApplyStatus`, `Transform`, `ModifyStat`, `Counter(kind)`, `StealCard`,
  `EndMaintained`, `Crack`, etc. Each reads `energy` from cast context.
- **Precedence rule:** card text overrides general rules. Implement as a
  resolution pipeline where card-level handlers can short-circuit/rewrite defaults.

### 13.5 AI opponents
- For solo/fill. Suggested stack: legal-move enumeration → heuristic eval (Thread swing,
  board control, Mask threat, tempo of maintained cards vs hand pressure) → optional
  shallow expectimax over die/random outcomes. Difficulty tiers gate lookahead depth
  and Ward-bluffing.

### 13.6 UX, onboarding & accessibility
- Life dial → animated **Thread bar** (0–20). Tokens → state badges (Breath on
  maintained Rites, Daze pips, cracks on walls).
- The **maintained-Rites tray** is a first-class UI region sharing the 7-slot hand
  capacity — surface this pressure clearly; it's the core economy.
- Secret hand, public board: a clear visual language for "what everyone sees" vs "what
  only you see."
- **Telegraph LOS and range** on hover/selection (highlight legal target cells) — LOS
  tracing is the #1 new-player stumble.
- Animate Ward windows with a short, skippable decision prompt for the defender.
- **Onboarding:** a guided tutorial is required, not optional — the two hard concepts
  are LOS tracing and the off-turn Ward window. Teach them in isolation before a full
  match.
- **Accessibility:** color carries identity here (Hearths, Masks, Crossings), so use
  colorblind-safe palettes plus shape/sigil redundancy; support text scaling and
  reduced-motion; never encode required info in color alone.

### 13.7 Content pipeline
- Cards, forms, Paths, Grounds, statuses are **data files** validated against schemas
  (§7.2). A card editor + an "does this effect resolve against engine primitives"
  linter lets designers add content without engineering. Balance values live in data,
  hot-tunable.

---

## 14. Variants (config flags)

- **Open Hands:** maintained Rites *don't* count against hand limit.
- **Lasting Works:** created walls/hazards persist without being maintained (and can't
  be self-dispelled).
- **Heavy Talismans:** picking up *any* object ends your ACTION phase (as Masks do).
- **Bound Fate:** if both of a Walker's Masks sit in *enemies'* Hearths at once, that
  Walker is eliminated (no one scores the sever).
- **Mask-Only:** win only via Masks (two enemy Masks in your Hearth) or sole-survivor;
  severs score nothing.
- **Great Drum:** shuffle all Paths together for a chaotic pool.
- **Long Hunt:** match target 3 or 4 points.
- **Draft:** split players into two pools; each drafts Paths into a separate deck.

---

## 15. Open questions / balance notes

- Base numbers (Thread 15/cap 20, base speed 3, hand limit 7, draw 2, crack thresholds
  5/3) are inherited *structural* ratios — placeholders to re-derive in playtest, not
  sacred.
- Canonical RNG surface: keep a discrete d4-style roller (easy to telegraph) or move to
  continuous probabilities for evade/random-direction.
- First-turn attack ban + turn-order advantage in a free-for-all: confirm seating
  fairness (catch-up rule? simultaneous first turn?).
- Define exact Ward-chain depth limits to bound the response-window recursion.
- **Meta-scope (unanswered):** is HOLLOWFALL a single-match game, or is there
  progression — unlockable Paths, cosmetic masks, ranked seasons? This shapes economy,
  content cadence, and live-ops and should be decided before content scale-up.

---

## 16. Glossary (original terms)

**Walker** — a player's combatant (a spirit-walker). **Breath** — the spirit-power
resource; also the token unit of energy/duration. **Thread** — life (the silver cord);
0 = death. **Rite** — a card. **Bane / Ward / Offering / Talisman / Working** — the five
Rite types. **Path** — a themed group of Rites. **the Hollow** — the modular spirit-maze
arena. **Ground** — a 5×5 board tile. **cell** — one grid square. **Hearth** — a Walker's
home cell. **Mask** — a stealable objective (two per Walker). **Crossing** — paired
teleport edge cells. **bonecharm** — a fire-fragile carved Talisman. **form** — an
alternate animal shape. **Daze** — the move-or-attack status. **crack** — a unit of
structural damage to objects.

---

*End of spec v0.2. Layer B (theme, names, numbers) is authored here and free to revise;
Layer A mechanics are the functional target to implement.*
