# HOLLOWFALL — Casual Queue: 1v1 Random Hero (v0.1)

Status: **APPROVED** — executing Q1→Q3 (§10). Decisions: Firestore `casualQueue`; guests allowed; back-to-menu after a match (auto-requeue later); ~2s sweep.

Builds on the session/identity/turn-FSM work (`HOLLOWFALL_match_session_architecture.md`):
durable `seatId`, one-session fencing, and session-bound presence are prerequisites so we
never pair a ghost.

## 1. Goal & scope

A "Play Casual" button that drops a player into a **1v1 match with random heroes**, no lobby.

In scope now: 1v1 only; **random** hero assignment; guests allowed (seatId = guest uuid).
Explicitly out of scope (later): hero **draft** (the queue will switch to it — §8), MMR/ranked,
party/friend invites, >2 players. Steam is a constraint we honor (§9), not built here.

## 2. Matchmaker model

An **in-process sweep** (a `setInterval`, like the game loop) — fits the single always-on
instance (min=1/max=1). Every ~2s it pairs the two oldest **present, current-session** queue
entries into a match. No external matchmaking service.

## 3. Data model (Firestore)

`casualQueue/{seatId}`:
```
{ seatId, sessionId, displayName, enqueuedAt, status: 'waiting' | 'matched', matchId? }
```
- Keyed by durable `seatId` → a seat can hold at most one queue slot (re-enqueue overwrites).
- `sessionId` fences the entry (a stale tab can't hold/cancel someone's slot).
- Presence (RTDB, existing) tells the sweep whether the seat is live.

## 4. Sweep / pairing rules

Each tick:
1. Load `waiting` entries; drop any whose seat is **not present** (reuse `isSeatOnline`) or whose
   `sessionId` no longer matches the seat's active session → delete stale entries.
2. Order by `enqueuedAt`; take the two oldest.
3. In a transaction: create the match (§5), set both entries `status:'matched'` + `matchId`.
4. Clients listen on their own `casualQueue/{seatId}` doc; when `matched`, navigate into `matchId`
   and delete their queue entry. (Server may also GC matched entries after a grace period.)

## 5. Match creation — reuse the setup path

Factor a single `createMatch(seats: SeatInit[], heroStrategy)` used by **both** the existing
host-start flow and the queue, so there is one setup path:
- generate a fresh `roomCode` (match doc id);
- add both seats as players (durable seatIds, `activeSessionId` set), `isReady:true`;
- **heroStrategy = RANDOM**: assign two *distinct* random `HEROES` emojis (skip lobby select);
- set `turnOrder` (randomized), `activePlayerIndex:0`, assign starting tiles (as START_GAME does),
  `phase:'PLACEMENT'`.
This is exactly today's START_GAME setup minus the manual hero pick — extract it so the queue and
the lobby share it (no parallel implementation to drift).

## 6. API

- `POST /api/queue/join`  `{ seatId, sessionId, displayName }` → upsert `casualQueue/{seatId}` waiting.
- `POST /api/queue/leave` `{ seatId, sessionId }` → delete entry (fenced).
- Match assignment is delivered via the client's Firestore listener on `casualQueue/{seatId}`
  (no polling endpoint needed). Entering the match reuses the existing join/gameplay flow.

## 7. Client UX (Q2b)

Wire the **existing casual-match button** (do not add a new one). On click:
1. Enqueue (`queue/join`) and write **queue presence** `queuePresence/{seatId}/{sessionId}=true`
   (RTDB, `onDisconnect().remove()` + `.info/connected` re-register — same pattern as match
   presence). Disconnect while searching → presence drops → the sweep removes the entry (no ghost).
2. Show a **VS screen**: current player on the **left**, challenger on the **right**, each as their
   **character icon (profile emoji) with their name beneath**. While still searching the right side
   is a "Searching for an opponent…" placeholder with a **Cancel** button (`queue/leave`).
3. Listen on `casualQueue/{seatId}`; when `matched`, fill the challenger side from the match doc
   (both players' `emoji` + `username` are already there), then auto-navigate into `matchId`.

**MMR/rank is NOT shown here.** Rank/MMR is displayed only on the **GAME_OVER screen** (ties into
the Club/MMR work, task #7). The VS/matchmaking screen shows icons + names only.

## 8. Hero-selection seam (draft later)

`heroStrategy` is pluggable: `RANDOM` (now) | `MANUAL` (existing lobby) | `DRAFT` (later). DRAFT
becomes a `HERO_SELECT` phase between match creation and PLACEMENT (alternating pick, maybe ban)
that, on completion, calls the same `startPlacement`. Switching casual → draft = add a strategy,
not rewrite the queue.

## 9. Steam / auth (constraint, not built)

Casual allows guests today. When Steam/Google auth is the norm, the queue is unchanged: `seatId`
comes from the verified identity (same seam as everywhere), and one-session fencing already gives
"one account, one queue slot."

## 10. Phasing

- **Q1 — setup extraction:** factor `createMatch(seats, heroStrategy)` from START_GAME; prove the
  lobby path still works (tests). No queue yet.
- **Q2 — queue core:** `casualQueue` doc, join/leave endpoints, the sweep pairing two present
  entries via `createMatch(..., RANDOM)`, client Searching→match navigation. Tests for pairing,
  presence-drop cleanup, session fencing, no-double-pair.
- **Q3 — polish:** cancel edge cases, matched-entry GC, basic UI.

## 11. Open questions

1. Queue storage: Firestore `casualQueue` collection (assumed) vs RTDB. Firestore keeps it with the
   rest of match state and transactional; fine?
2. Guests in casual: allow now (assumed), or require auth even for casual?
3. Re-queue after a match ends: automatic "find next" or back to menu?
4. Sweep cadence: ~2s tick (assumed) vs pair-on-enqueue.
</content>
