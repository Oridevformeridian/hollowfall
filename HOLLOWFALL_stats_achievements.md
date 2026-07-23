# HOLLOWFALL — Stats & Achievements (v0.2)

Status: **APPROVED.** Server-authoritative.

## 1. Principles

- **Server-authoritative, client display-only.** The server computes and stores all stat/achievement
  progress (at GAME_OVER and on sever events). The client only *reads and renders* what the server
  has already unlocked — it never decides or writes achievement state.
- **Modes that count:** **casual** and **competitive** (ranked, future). **Custom matches count for
  NOTHING** — no stats, no achievements.
- **Auth required for tracked play.** Stats/achievements live on `players/{userId}`. Consequently
  **guests cannot play casual** (casual is tracked) — **guests play custom only**. (Behavior change,
  see §6.)
- **No backfill.** Tracking starts the moment this ships; prior matches don't count.

## 2. Achievement flavors

Two axes, per §1's answer:
- **General PVP** achievements aggregate **casual + competitive** (e.g. total severs from both).
- **Casual-specific** achievements track casual only, with **much higher** thresholds.
- (Competitive-specific can mirror casual later; not built now.)

## 3. Data model (`players/{userId}`, additive, server-written only)

```
stats: {
  casualWins, casualLosses, competitiveWins, competitiveLosses,
  casualSevers, competitiveSevers,          // general PVP severs = casual + competitive
  casualAces,                               // casual 1v1 wins that were an "ace" (see §5)
  flawlessWins,                             // wins taking 0 damage all match (casual or competitive)
  casualMatches, competitiveMatches
}
achievements: { [achId]: { unlocked: bool, unlockedAt?, progress? } }
```

Per-match tracking on `GameState` to evaluate at end: `damageTakenThisMatch[seatId]`, and (for Ace)
`severShotsUsed[seatId]` — count of the attacker's damaging actions (lash / attack spell) that landed.
`severPoints` already exists per player. Each seat's hero `class` comes from `HEROES`.

## 4. Recording (server, once per match at GAME_OVER)

A single `recordMatchOutcome(room)` guarded by `room.statsRecorded`, called wherever phase becomes
GAME_OVER (victory, forfeit, concede, bound-fate). **Only when `room.mode` is casual or competitive**
(custom returns immediately). For each seat with a `userId` (guests skipped):
- W/L for the mode; `+matchesPlayed`.
- `casualSevers`/`competitiveSevers += seat.severPoints`.
- Ace: if casual 1v1 win and it qualifies (§5) → `casualAces++`.
- Flawless: if win and `damageTakenThisMatch == 0` → `flawlessWins++`.
- Evaluate achievements (§7) and set unlock/progress.
One Firestore update per authed seat.

## 5. The "Ace"

An **ace** = win a **casual 1v1** by severing the opponent having cast **≤ 3 damage spells** the whole
match (no more than 3). Damage spells = attack spells (Kindle the Storm / Fireball / Immolate). Track
`damageSpellsCast[seatId]` per match; at match end, if casual 1v1 win && seat severed the opponent &&
`damageSpellsCast[seatId] <= 3` → ace. Tiers: **Ace 10 / 25 / 50**.

## 6. Behavior change — guests barred from casual

Casual is now auth-gated (it's tracked). Required changes:
- **Server:** `POST /api/queue/join` rejects unauthenticated requests (`401`, guests can't queue).
- **Client:** the Club **Casual Match** button requires login — if not signed in, prompt to sign in
  instead of enqueueing. Custom lobby remains open to guests.

## 7. Achievements (starter registry — data, server-evaluated)

Each: `{ id, name, description, category, evaluate(ctx) }`; `ctx` = { statsBefore, match, seatId,
isWinner, mode, seversThisMatch, killedClasses[], damageTaken, isAce }.
- **General PVP severs:** Sever I/II/III — 10 / 50 / 100 (casual+competitive).
- **Casual severs (higher):** Casual Sever I/II/III — 100 / 500 / 1000.
- **Casual Ace:** Ace I/II/III — 10 / 25 / 50 aces.
- **Flawless Courier:** win a match taking 0 damage (casual or competitive) — tiers 1 / 5 / 10.
- **Mirror Sever:** sever an opponent of your own class (e.g. Ashwalker sevities Ashwalker).
- (Registry is data — adding achievements is a new entry, no plumbing.)

## 8. Client — Achievements tab (Club), display-only

New Achievements button in the park view. Stats header (casual W/L + win-rate, PVP severs, aces,
flawless) + achievement grid (locked / `progress/threshold` / unlocked), all read from the authed
profile. Guests: "Sign in to track stats & achievements."

## 9. Phasing

- **S1 — outcome recording (+ guest/casual gating):** per-match tracking fields; `recordMatchOutcome`
  writing W/L, severs, aces, flawless, matches (casual/competitive only) at GAME_OVER, once; auth-gate
  casual queue (server 401 + client sign-in prompt). Tests.
- **S2 — achievements framework:** registry + `evaluate` hooks + starter set; profile `achievements`.
- **S3 — Achievements tab UI** in Club.
</content>
