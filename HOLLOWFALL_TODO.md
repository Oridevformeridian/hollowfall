# HOLLOWFALL — Build TODO

Legend: `[ ]` todo · `[~]` in progress · `[x]` done

1. `[x]` **Effect-DSL grammar** — formal mini-language for card effects.
   Foundational: both cards and the engine reference it. → `HOLLOWFALL_effect_dsl.md` ✅
2. `[x]` **Engine state machine + combat resolution order** — the phase FSM, the
   nested Ward response-window (priority queue), and exact attack→ward→resolve
   ordering, plus the victory-check hook timing. → `HOLLOWFALL_engine_fsm.md` ✅
3. `[x]` **Vertical-slice Path** — one complete Spirit Path (~12–15 original cards)
   fully written in the DSL, as a DSL stress-test and a balance target.
   → `HOLLOWFALL_path_ashwalk.md` ✅ (24 cards; surfaced 4 small DSL gaps — see its §4)
4. `[x]` **Card schema + content-linter rules** — finalize the JSON schema and the
   automated validation rules a designer's cards must pass.
   → `HOLLOWFALL_card_schema.md` ✅ (3-stage gate: schema → linter → resolve-check)
5. `[x]` **Remaining Paths + first balance pass** — all 7 Path identities, a shared
   balance budget (rate card + hand-pressure lever + clock targets), the counterplay
   web, and Ashwalk reconciled against the budget.
   → `HOLLOWFALL_paths_and_balance.md` ✅ (framework + 1 signature card each)

---
**All 5 items done.** The spec is buildable end-to-end (rules → DSL → engine FSM →
proven content slice → validation pipeline → Path identities + balance framework).

**What's left is execution, not design:**
- Author the ~140 remaining cards against the §1 rate card in the balance doc.
- Build the engine to `HOLLOWFALL_engine_fsm.md`.
- Replace placeholder numbers with playtested ones.

**Open backlog (design-level, surfaced along the way):**
- effect-DSL v0.3: add `$enterer`/`$trigger` bindings (onEnter/onHitBy).
- pipeline: add a Form-definition schema + registry (Beast Paths).
- register terrain object ids (thornbush, etc.).
- (future) richer Ward responses: steal-on-counter, retaliate.
- tuning calls: Immolate ceiling; Ashwalk defensive density.
