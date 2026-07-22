# HOLLOWFALL — Match Session, Identity & Turn FSM Architecture (v0.1)

Status: **APPROVED** — executing in phases (see §9).

Applies to the `feature/stateless-firestore-pivot` line (Firestore-backed match state,
RTDB presence, REST action endpoints, 1s server game loop).

## 1. Motivation

The reconnect/disconnect/turn machinery is a set of imperative special-cases, and every
production bug we have hit is the same disease — turn and connection state mutated by hand
in many places, so any path that forgets a field corrupts the machine:

- **Presence set-once** → a blip removed presence forever → false forfeits.
- **`t.set` with `undefined`** → GAMEPLAY transition rolled back → couldn't place the last tile.
- **`passTurn` never re-armed the timer** → turns ended instantly forever.
- **Forfeit filtered `turnOrder` without fixing `activePlayerIndex`** → active player locked out.

The reconnect handler is the canonical example: it rewrites a player id across
`players`, `turnOrder`, `tokenPositions`, `treasures`, `placedTiles` — and the
"Update in roomMetadata" step is commented out, i.e. the fan-out **already dropped a
collection**. Reconnect detection itself is a guess:
`username match AND (isDisconnected OR sessionToken match)`, which is how ghost/duplicate
players and dueling tabs appear.

This doc proposes a layered model that retires the entire class rather than patching paths.

## 2. Design principles

1. **Identity is durable, connection-independent, and provider-pluggable.** A seat id is
   assigned once and never rewritten; all game collections key off it forever. `seatId` comes
   from an auth-provider seam — guest (localStorage uuid) today, Google/**Steam** later — so
   adding a provider is a new token verifier, not a schema change. For authed users the server
   derives `seatId` from the *validated* ticket and never trusts a client-claimed id.
2. **One user, one session (exclusive access).** Each seat has exactly one live session,
   enforced by a fencing token. Newest session wins; stale sessions are locked out.
3. **Turn state is an explicit FSM.** All turn changes go through a single set of transition
   functions; `activePlayerIndex` / deadline are never set ad hoc.
4. **The match doc is the recovery record.** Absolute timestamps + persisted phase mean any
   instance (or a restarted loop) resumes deterministically. The loop is stateless.
5. **Writes are ordered and idempotent.** A monotonic version guards against stale writes;
   an intent log makes actions replayable and duplicate-safe.

## 3. Layered model

| Layer | Owns | State | Reconnect impact |
|---|---|---|---|
| Identity | who holds the seat | `seatId` (durable) | never rewritten → remap deleted |
| Session | exclusive access | `activeSessionId` per seat (fence) | reconnect = claim seat, bump session, fence old |
| Presence | liveness | RTDB `presence[seatId] = { sessionId, online }` | just re-registers |
| Turn FSM | whose turn + deadline | `{ activeSeat, deadlineAt, paused, pausedRemainingMs }` | timeout/forfeit/resume via one path |
| Write ordering | idempotency, recovery | `version` + optional intent log | stale/duplicate writes rejected |

## 4. Data model (Firestore `matches/{roomCode}`)

New / changed fields (additive; see §9 migration):

```
seats: {                       // replaces ad-hoc players keyed by mutable id
  [seatId]: {
    seatId, displayName, userId?, isGuest,
    activeSessionId: string | null,   // fencing token; null = seat empty/offline
    connected: boolean,               // derived from presence, cached for the loop
    ...existing per-player game fields (ap, thread, hand, ...)
  }
}
turnOrder: seatId[]             // durable ids, never rewritten
turn: {
  activeSeat: seatId | null,
  deadlineAt: number | null,   // absolute epoch ms; null when not counting
  paused: boolean,
  pausedRemainingMs: number | null
}
version: number                // monotonic; bumped on every accepted write
phase: 'LOBBY'|'PLACEMENT'|'GAMEPLAY'|'GAME_OVER'
```

`seatId` via a provider seam (`verifyIdentity(req) -> { seatId, displayName, isGuest }`):
- guest → client-minted uuid in `localStorage` (low-stakes placeholder);
- Google (today) / **Steam (future)** → `seatId` derived from a server-verified token/ticket.
Adding Steam = one new verifier branch; nothing else in the model changes.

Deferred (not built now): `matches/{roomCode}/intents/{seq}` append-only log. Only add it if a
concrete need appears (replay / anti-cheat).

## 5. Session & exclusivity protocol

**Join / reconnect (single path — no username matching):**
1. Client sends `{ roomCode, authToken?, guestSeatId?, sessionId }` (fresh `sessionId` per
   tab/connection). Server runs `verifyIdentity` → `seatId` (validated for authed users;
   client uuid for guests). A **Steam friend-join** is just an invite/connect-string carrying
   `roomCode` + the Steam auth ticket — it lands on this same path.
2. Server, in a transaction:
   - If `seats[seatId]` absent and phase is `LOBBY` and room not full → create the seat.
   - Set `seats[seatId].activeSessionId = sessionId` (**takeover: newest wins**).
   - Return the seat + current state. No id rewriting anywhere.
3. Previous session, on its next action/presence heartbeat, fails the fence check and is told
   `SESSION_SUPERSEDED` → shows "opened elsewhere," goes read-only.

**Fencing (every action & presence write):**
- Request carries `sessionId`. Server rejects if `sessionId ≠ seats[seatId].activeSessionId`
  with `409 SESSION_SUPERSEDED`. This single check subsumes the old "stale disconnect from a
  superseded connection" handling.

**Presence:** RTDB `presence/{roomCode}/{seatId} = { sessionId, online:true }`, re-registered
on `.info/connected` (already implemented). The loop treats a seat online only if
`presence.sessionId === activeSessionId` (ignores a lingering old session's node).

## 6. Turn FSM

States: `LOBBY → PLACEMENT → GAMEPLAY → GAME_OVER`. Within `GAMEPLAY`, the turn cycle is
owned by four pure transitions — the **only** code allowed to touch `turn` / `turnOrder`:

- `beginTurn(room, seatId)` — set `activeSeat`, `deadlineAt = now + TURN_MS`, `paused=false`,
  grant AP, reset per-turn flags, log.
- `endTurn(room)` — end-of-turn upkeep for the active seat (draw/discard), advance to the next
  **live** seat, then `beginTurn`.
- `pauseTurn(room)` — `paused=true`, `pausedRemainingMs = deadlineAt - now`, clear `deadlineAt`.
- `resumeTurn(room)` — `deadlineAt = now + pausedRemainingMs`, `paused=false`.

Removal (forfeit/concede/defeat) is one helper `removeSeat(room, seatId)`:
- capture `activeSeat`; filter `turnOrder`; if the removed seat was active → advance;
  else keep the same active seat and recompute its index; handle 1-left/0-left endgame.
(This is the corrected logic we already validated, centralized so no caller re-implements it.)

Derived, never stored redundantly: "is it my turn" = `turn.activeSeat === mySeatId`;
"time left" = `turn.paused ? pausedRemainingMs : deadlineAt - now`. Client and loop compute
from the same fields.

## 7. Server loop & recovery

The 1s loop becomes a pure function of persisted state, per active match:
- `if (!turn.paused && turn.deadlineAt && now >= turn.deadlineAt) endTurn(room)`.
- For each seat: reconcile `connected` from presence; if active seat went offline →
  `pauseTurn` + start a concession countdown; if it returns → `resumeTurn`; if countdown
  elapses → `removeSeat`.
Because everything is absolute-timestamped and persisted, a fresh instance or a restarted loop
recovers with no in-memory assumptions. Requires **`min_instance_count = 1`** so the loop is
always alive (see §8); `max_instance_count = 1` keeps a single loop to avoid duplicate ticks.

## 8. Concurrency & ordering

- Keep Firestore transactions. Add `version`: each accepted write asserts it read the latest
  and increments; the loop and REST handlers therefore can't silently clobber each other.
- Handlers stay **pure mutations of `room`** (no external side effects) so transaction retries
  are safe — already true today; keep it an invariant.
- **Infra:** make `scaling { min_instance_count = 1, max_instance_count = 1 }` **explicit** in
  `terraform/main.tf`. Today it is min=1/max=1 live only as a leftover from a prior apply, not
  declared — a latent lockout (if it ever resets to min=0, the game loop dies on idle and every
  match freezes).

## 9. Migration & phasing

Incremental; no big-bang merge. Each phase ships and is verified on its own.

- **Phase 0 (infra, tiny):** make min=1/max=1 explicit in terraform.
- **Phase 1 (identity + session):** introduce `seatId` + `activeSessionId` fencing; client sends
  both; delete the id-remap block and the username-match reconnect; presence keyed by seat+session.
  *Biggest bug-class win, self-contained.*
- **Phase 2 (turn FSM):** extract `beginTurn/endTurn/pauseTurn/resumeTurn/removeSeat`; route every
  caller through them; derive turn/time on client from `turn`.
- **Phase 3 (light ordering):** add a `version` compare-and-set guard only. **Intent log is
  deferred** — not built until a concrete need (replay/anti-cheat).

Back-compat: **hard cutover.** In-flight matches finish on the current build; the new model
applies to matches created after deploy. No dual-read shim (not worth the weight for a game
still in testing). Phases ship one at a time and are verified independently.

Steam-readiness is a non-goal to *build* now but a constraint we honor: the identity seam (§4)
and the one-session fence (§5) are exactly what a future Steam auth + friend-join needs, so no
rework is required when it lands. We do not build Steam plumbing in these phases.

## 10. What gets deleted

- The ~65-line reconnect id-remap fan-out (`players`/`turnOrder`/`tokenPositions`/`treasures`/
  `placedTiles`/metadata rewriting).
- The username-or-token-or-disconnected reconnect heuristic.
- Ad-hoc `activePlayerIndex = ...` / `turnExpiresAt = ...` assignments scattered across handlers.

## 11. Decisions (lean defaults — keeping it thin for Steam later)

1. **Guest seat persistence:** localStorage uuid only. No signed cookies / guest-spoofing
   hardening — that concern goes away once real auth (Google/Steam) is the norm; not worth
   building bespoke guest security now.
2. **Takeover policy:** newest-session-wins (matches "one Steam account = one session"); old
   session goes read-only with `SESSION_SUPERSEDED`. No manual kick UI.
3. **Migration:** hard cutover; in-flight matches finish on the old build.
4. **Turn / concession windows:** keep 45s / 45s.
5. **Intent log:** deferred; `version` compare-and-set only in Phase 3.

Remaining genuinely-open item: whether Phase 3's `version` guard is even needed given Firestore
transactions already serialize — likely yes for clean client reconciliation, but we can decide
after Phases 1–2 land.
</content>
