import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';

// Stateful in-memory Firestore so we can exercise runTransaction end-to-end.
const { store } = vi.hoisted(() => ({ store: new Map<string, any>() }));

// Tokens shaped `tok-<id>` authenticate as playerId <id>; anything else is unauthenticated.
vi.mock('jsonwebtoken', () => ({
  default: {
    sign: vi.fn(() => 'jwt'),
    verify: vi.fn((t: string, _s: any, cb: any) =>
      typeof t === 'string' && t.startsWith('tok-') ? cb(null, { playerId: t.slice(4) }) : cb(new Error('no auth')))
  }
}));
vi.mock('firebase-admin/app', () => ({ initializeApp: vi.fn() }));
vi.mock('firebase-admin/database', () => ({
  getDatabase: vi.fn(() => ({ ref: vi.fn(() => ({ on: vi.fn() })) }))
}));
vi.mock('google-auth-library', () => ({
  OAuth2Client: vi.fn().mockImplementation(() => ({ verifyIdToken: vi.fn() }))
}));

vi.mock('@google-cloud/firestore', () => {
  const clone = (o: any) => JSON.parse(JSON.stringify(o)); // also drops `undefined`, like ignoreUndefinedProperties
  const docRef = (col: string, id: string) => {
    const key = `${col}/${id}`;
    return {
      id, _key: key,
      set: async (data: any) => { store.set(key, clone(data)); },
      get: async () => ({ exists: store.has(key), data: () => store.get(key) }),
      update: async (data: any) => { store.set(key, { ...store.get(key), ...clone(data) }); },
      delete: async () => { store.delete(key); }
    };
  };
  return {
    Firestore: vi.fn().mockImplementation(() => ({
      collection: (col: string) => ({
        doc: (id: string) => docRef(col, id),
        where: (field?: string, op?: string, val?: any) => ({
          onSnapshot: vi.fn(),
          limit: () => ({ get: vi.fn() }),
          get: async () => ({
            docs: [...store.entries()]
              .filter(([k, v]) => k.startsWith(`${col}/`) && (op === '==' ? (v as any)[field!] === val : true))
              .map(([k, v]) => ({ id: k.split('/')[1], data: () => v }))
          })
        })
      }),
      runTransaction: async (fn: any) => fn({
        get: async (ref: any) => ({ exists: store.has(ref._key), data: () => store.get(ref._key) }),
        set: (ref: any, data: any) => { store.set(ref._key, clone(data)); },
        update: (ref: any, data: any) => { store.set(ref._key, { ...store.get(ref._key), ...clone(data) }); },
        delete: (ref: any) => { store.delete(ref._key); }
      })
    }))
  };
});

import { app, removeSeatFromTurnOrder, reconcileMatchConnectivity, startPlacement, createMatch, computeQueuePairings, recordMatchOutcome } from './index';

const ROOM = 'SESSIONTEST';
const join = (seatId: string, sessionId: string, username: string) =>
  request(app).post(`/api/match/${ROOM}/join`).send({ seatId, sessionId, username, roomCode: ROOM, color: '', emoji: '' });
const toggleReady = (seatId: string, sessionId?: string) =>
  request(app).post(`/api/match/${ROOM}/toggle-ready`).send({ seatId, sessionId });

describe('durable seat identity + session fencing', () => {
  beforeEach(() => store.clear());

  it('keys the seat by durable seatId and returns it', async () => {
    const r = await join('seat-A', 'sess-1', 'alice');
    expect(r.status).toBe(200);
    expect(r.body.playerId).toBe('seat-A');
    expect(store.get(`matches/${ROOM}`).players['seat-A'].activeSessionId).toBe('sess-1');
  });

  it('accepts actions from the current session', async () => {
    await join('seat-A', 'sess-1', 'alice');
    const r = await toggleReady('seat-A', 'sess-1');
    expect(r.status).toBe(200);
    expect(store.get(`matches/${ROOM}`).players['seat-A'].isReady).toBe(true);
  });

  it('re-join with the same seatId takes over the session without duplicating the seat', async () => {
    await join('seat-A', 'sess-1', 'alice');
    const r = await join('seat-A', 'sess-2', 'alice');
    expect(r.status).toBe(200);
    const match = store.get(`matches/${ROOM}`);
    expect(Object.keys(match.players)).toEqual(['seat-A']);
    expect(match.players['seat-A'].activeSessionId).toBe('sess-2');
  });

  it('fences out a superseded (stale) session with 409, and the new session still works', async () => {
    await join('seat-A', 'sess-1', 'alice');
    await join('seat-A', 'sess-2', 'alice'); // takeover
    const stale = await toggleReady('seat-A', 'sess-1');
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe('SESSION_SUPERSEDED');
    const current = await toggleReady('seat-A', 'sess-2');
    expect(current.status).toBe(200);
  });

  it('does not remap ids on reconnect — turnOrder/positions keep the same seatId', async () => {
    await join('seat-A', 'sess-1', 'alice');
    await join('seat-B', 'sess-b', 'bob');
    // simulate an in-progress match keyed by the durable seat ids
    const m = store.get(`matches/${ROOM}`);
    m.turnOrder = ['seat-A', 'seat-B'];
    m.tokenPositions = { 'seat-A': { tileX: 0, tileY: 0, r: 2, c: 2 } };
    store.set(`matches/${ROOM}`, m);
    // alice reconnects on a new session
    await join('seat-A', 'sess-1b', 'alice');
    const after = store.get(`matches/${ROOM}`);
    expect(after.turnOrder).toEqual(['seat-A', 'seat-B']);      // unchanged
    expect(after.tokenPositions['seat-A']).toBeTruthy();         // not moved to a new id
    expect(after.players['seat-A'].activeSessionId).toBe('sess-1b');
  });
});

describe('turn FSM: removeSeatFromTurnOrder keeps activePlayerIndex valid', () => {
  const mkPlayer = (id: string) => ({ id, username: id, hand: [], deck: [], graveyard: [], ap: 0, isFirstTurnOfMatch: false, form: 'normal' });
  const mkRoom = (order: string[], activeIdx: number) => ({
    roomCode: 'X', turnOrder: [...order], activePlayerIndex: activeIdx,
    players: Object.fromEntries(order.map(id => [id, mkPlayer(id)])), gameLogs: []
  } as any);

  const cases: [string[], number, string, string][] = [
    // [turnOrder, activeIdx, seatToRemove, expectedActiveAfter]
    [['A', 'B', 'C'], 0, 'A', 'B'],        // active leaves -> next
    [['A', 'B', 'C'], 2, 'A', 'C'],        // non-active leaves -> active unchanged
    [['A', 'B', 'C'], 1, 'A', 'B'],        // earlier non-active leaves -> active unchanged
    [['A', 'B', 'C'], 2, 'C', 'A'],        // active (last) leaves -> wraps
    [['A', 'B', 'C', 'D'], 3, 'A', 'D'],   // non-active leaves, active near end
    [['A', 'B', 'C', 'D'], 1, 'B', 'C'],   // active leaves -> next (mid)
  ];

  it.each(cases)('order=%j active=%i remove=%s -> active %s', (order, idx, remove, expected) => {
    const room = mkRoom(order, idx);
    removeSeatFromTurnOrder(room, remove);
    expect(room.turnOrder).not.toContain(remove);
    expect(room.turnOrder[room.activePlayerIndex]).toBe(expected);
  });

  it('2 players, active leaves -> the single remaining seat is active', () => {
    const room = mkRoom(['A', 'B'], 0);
    removeSeatFromTurnOrder(room, 'A');
    expect(room.turnOrder).toEqual(['B']);
    expect(room.turnOrder[room.activePlayerIndex]).toBe('B');
  });
});

describe('gameplay flow: setup -> GAMEPLAY -> turn pass (through real endpoints)', () => {
  beforeEach(() => store.clear());
  const sess: Record<string, string> = { A: 'sA', B: 'sB' };
  const send = (action: string, seatId: string, body: any = {}) =>
    request(app).post(`/api/match/${ROOM}/${action}`).send({ seatId, sessionId: sess[seatId], roomCode: ROOM, ...body });

  it('final tile transitions to GAMEPLAY with an armed timer; end-turn advances + re-arms', async () => {
    await send('join', 'A', { username: 'alice' });
    await send('join', 'B', { username: 'bob' });
    await send('toggle-ready', 'A');
    await send('toggle-ready', 'B');
    expect((await send('start', 'A')).status).toBe(200);

    let m = store.get(`matches/${ROOM}`);
    expect(m.phase).toBe('PLACEMENT');

    // tile 1 at (0,0) by the active seat
    let active = m.turnOrder[m.activePlayerIndex];
    expect((await send('place-tile', active, { x: 0, y: 0, rotation: 0 })).status).toBe(200);
    m = store.get(`matches/${ROOM}`);
    expect(m.phase).toBe('PLACEMENT'); // one tile still to place

    // tile 2 at (1,0) by the next active seat -> triggers GAMEPLAY (the "second tile" bug)
    active = m.turnOrder[m.activePlayerIndex];
    expect((await send('place-tile', active, { x: 1, y: 0, rotation: 0 })).status).toBe(200);
    m = store.get(`matches/${ROOM}`);
    expect(m.phase).toBe('GAMEPLAY');
    expect(typeof m.turnExpiresAt).toBe('number');       // timer armed (the "instant turns" bug)
    expect(m.turnExpiresAt).toBeGreaterThan(Date.now());

    // end-turn advances to the next seat AND re-arms the timer
    const prevActiveIdx = m.activePlayerIndex;
    active = m.turnOrder[m.activePlayerIndex];
    expect((await send('end-turn', active, { discardHand: false })).status).toBe(200);
    m = store.get(`matches/${ROOM}`);
    expect(m.activePlayerIndex).not.toBe(prevActiveIdx); // turn advanced
    expect(m.turnExpiresAt).toBeGreaterThan(Date.now());  // re-armed for the next player
  });
});

describe('concede ends a 2-player game (through real endpoints)', () => {
  beforeEach(() => store.clear());
  const sess: Record<string, string> = { A: 'sA', B: 'sB' };
  const send = (action: string, seatId: string, body: any = {}) =>
    request(app).post(`/api/match/${ROOM}/${action}`).send({ seatId, sessionId: sess[seatId], roomCode: ROOM, ...body });

  async function reachGameplay() {
    await send('join', 'A', { username: 'alice' });
    await send('join', 'B', { username: 'bob' });
    await send('toggle-ready', 'A');
    await send('toggle-ready', 'B');
    await send('start', 'A');
    let m = store.get(`matches/${ROOM}`);
    await send('place-tile', m.turnOrder[m.activePlayerIndex], { x: 0, y: 0, rotation: 0 });
    m = store.get(`matches/${ROOM}`);
    await send('place-tile', m.turnOrder[m.activePlayerIndex], { x: 1, y: 0, rotation: 0 });
    return store.get(`matches/${ROOM}`);
  }

  it('the active player conceding ends the match; the other survives', async () => {
    let m = await reachGameplay();
    expect(m.phase).toBe('GAMEPLAY');
    const conceder = m.turnOrder[m.activePlayerIndex];
    expect((await send('concede', conceder)).status).toBe(200);
    m = store.get(`matches/${ROOM}`);
    expect(m.phase).toBe('GAME_OVER');
    expect(m.players[conceder].hasConceded).toBe(true);
    const other = conceder === 'A' ? 'B' : 'A';
    expect(m.players[other].hasConceded).toBeFalsy();
  });
});

describe('authorization & turn guards (negative paths)', () => {
  beforeEach(() => store.clear());
  const sess: Record<string, string> = { A: 'sA', B: 'sB' };
  const send = (action: string, seatId: string, body: any = {}) =>
    request(app).post(`/api/match/${ROOM}/${action}`).send({ seatId, sessionId: sess[seatId], roomCode: ROOM, ...body });

  it('only the host can set victory points, and the value must be in range', async () => {
    await send('join', 'A', { username: 'alice' }); // A is host (first in)
    await send('join', 'B', { username: 'bob' });

    const ok = await send('set-victory-points', 'A', { victoryPointsTarget: 3 });
    expect(ok.status).toBe(200);
    expect(store.get(`matches/${ROOM}`).victoryPointsTarget).toBe(3);

    const notHost = await send('set-victory-points', 'B', { victoryPointsTarget: 4 });
    expect(notHost.status).toBe(400);
    expect(store.get(`matches/${ROOM}`).victoryPointsTarget).toBe(3); // unchanged

    const outOfRange = await send('set-victory-points', 'A', { victoryPointsTarget: 99 });
    expect(outOfRange.status).toBe(400);
    expect(store.get(`matches/${ROOM}`).victoryPointsTarget).toBe(3); // unchanged
  });

  it('a non-active player cannot place a tile during PLACEMENT', async () => {
    await send('join', 'A', { username: 'alice' });
    await send('join', 'B', { username: 'bob' });
    await send('toggle-ready', 'A');
    await send('toggle-ready', 'B');
    await send('start', 'A');

    const m = store.get(`matches/${ROOM}`);
    const active = m.turnOrder[m.activePlayerIndex];
    const other = active === 'A' ? 'B' : 'A';

    const rejected = await send('place-tile', other, { x: 0, y: 0, rotation: 0 });
    expect(rejected.status).toBe(400);
    expect(rejected.body.error).toMatch(/not your turn/i);
    expect(Object.keys(store.get(`matches/${ROOM}`).placedTiles)).toHaveLength(0); // nothing placed
  });
});

describe('reconcileMatchConnectivity (game loop per-tick logic)', () => {
  const mkPlayer = (id: string) => ({ id, username: id, hand: [], deck: [], graveyard: [], ap: 3, isDisconnected: false });
  const mkRoom = (order: string[], activeIdx: number, extra: any = {}) => ({
    roomCode: 'X', phase: 'GAMEPLAY', turnOrder: [...order], activePlayerIndex: activeIdx,
    players: Object.fromEntries(order.map(id => [id, mkPlayer(id)])),
    turnExpiresAt: Date.now() + 45000, isTurnPaused: false, victoryPointsTarget: 2, gameLogs: [], ...extra
  } as any);
  const online = (...ids: string[]) => (seat: any) => ids.includes(seat.id);

  it('active player going offline pauses the turn', () => {
    const room = mkRoom(['A', 'B'], 0);
    expect(reconcileMatchConnectivity(room, Date.now(), online('B'))).toBe(true);
    expect(room.players['A'].isDisconnected).toBe(true);
    expect(typeof room.players['A'].concessionExpiresAt).toBe('number');
    expect(room.isTurnPaused).toBe(true);
  });

  it('non-active player offline does NOT pause the turn', () => {
    const room = mkRoom(['A', 'B'], 0); // A active
    reconcileMatchConnectivity(room, Date.now(), online('A')); // B offline
    expect(room.players['B'].isDisconnected).toBe(true);
    expect(room.isTurnPaused).toBeFalsy();
  });

  it('reconnecting the active player resumes the timer', () => {
    const room = mkRoom(['A', 'B'], 0, { isTurnPaused: true, turnPausedRemainingMs: 30000, turnExpiresAt: undefined });
    room.players['A'].isDisconnected = true;
    room.players['A'].concessionExpiresAt = Date.now() + 45000;
    reconcileMatchConnectivity(room, Date.now(), online('A', 'B'));
    expect(room.players['A'].isDisconnected).toBe(false);
    expect(room.isTurnPaused).toBe(false);
    expect(room.turnExpiresAt).toBeGreaterThan(Date.now());
  });

  it('forfeits past the concession window; 2p -> GAME_OVER and the other wins', () => {
    const room = mkRoom(['A', 'B'], 0);
    room.players['A'].isDisconnected = true;
    room.players['A'].concessionExpiresAt = Date.now() - 1;
    expect(reconcileMatchConnectivity(room, Date.now(), online('B'))).toBe(true);
    expect(room.turnOrder).toEqual(['B']);
    expect(room.phase).toBe('GAME_OVER');
    expect(room.players['B'].points).toBe(room.victoryPointsTarget);
  });

  it('is a no-op when everyone is connected', () => {
    const room = mkRoom(['A', 'B'], 0);
    expect(reconcileMatchConnectivity(room, Date.now(), online('A', 'B'))).toBe(false);
    expect(room.isTurnPaused).toBeFalsy();
  });

  it('does not re-forfeit an already-removed player on the next tick', () => {
    const room = mkRoom(['A', 'B'], 0);
    room.players['A'].isDisconnected = true;
    room.players['A'].concessionExpiresAt = Date.now() - 1;
    reconcileMatchConnectivity(room, Date.now(), online('B')); // forfeits A
    reconcileMatchConnectivity(room, Date.now(), online('B')); // A now out of turnOrder
    expect(room.turnOrder).toEqual(['B']);
    expect(room.gameLogs.filter((l: string) => /forfeited/.test(l)).length).toBe(1);
  });
});

describe('startPlacement (shared LOBBY -> PLACEMENT setup)', () => {
  it('sets PLACEMENT, seeds turnOrder from players, and hands each player one tile', () => {
    const room: any = {
      roomCode: 'X', phase: 'LOBBY',
      players: { A: { id: 'A', username: 'A', assignedTileIndex: null }, B: { id: 'B', username: 'B', assignedTileIndex: null } },
      turnOrder: [], activePlayerIndex: 5, systemMessages: []
    };
    startPlacement(room);
    expect(room.phase).toBe('PLACEMENT');
    expect(room.activePlayerIndex).toBe(0);
    expect([...room.turnOrder].sort()).toEqual(['A', 'B']);
    for (const id of room.turnOrder) {
      expect(room.players[id].assignedTileIndex).toBeGreaterThanOrEqual(0);
      expect(room.players[id].assignedTileIndex).toBeLessThanOrEqual(3);
    }
  });
});

describe('casual queue: createMatch', () => {
  it('builds a ready 1v1 in PLACEMENT with distinct heroes and durable seat keys', () => {
    const room: any = createMatch([
      { seatId: 'seat-A', sessionId: 'sA', displayName: 'alice' },
      { seatId: 'seat-B', sessionId: 'sB', displayName: 'bob' }
    ], 'RANDOM');
    expect(room.phase).toBe('PLACEMENT');
    expect(Object.keys(room.players).sort()).toEqual(['seat-A', 'seat-B']);
    expect(room.players['seat-A'].isReady && room.players['seat-B'].isReady).toBe(true);
    // heroes assigned and distinct
    expect(room.players['seat-A'].emoji).toBeTruthy();
    expect(room.players['seat-A'].emoji).not.toBe(room.players['seat-B'].emoji);
    // durable seats carry their session; each got a starting tile
    expect(room.players['seat-A'].activeSessionId).toBe('sA');
    expect([...room.turnOrder].sort()).toEqual(['seat-A', 'seat-B']);
    for (const id of room.turnOrder) expect(room.players[id].assignedTileIndex).toBeGreaterThanOrEqual(0);
  });
});

describe('casual queue: computeQueuePairings', () => {
  const live = (present: string[]) => (e: any) => present.includes(e.seatId);
  it('drops non-present entries and pairs the oldest two', () => {
    const entries = [
      { seatId: 'C', sessionId: 's', enqueuedAt: 30 },
      { seatId: 'A', sessionId: 's', enqueuedAt: 10 },
      { seatId: 'GHOST', sessionId: 's', enqueuedAt: 5 },
      { seatId: 'B', sessionId: 's', enqueuedAt: 20 }
    ];
    const { pairs, stale } = computeQueuePairings(entries, live(['A', 'B', 'C']));
    expect(stale.map(e => e.seatId)).toEqual(['GHOST']);
    expect(pairs).toHaveLength(1);                 // C is left waiting (odd one out)
    expect(pairs[0].map(e => e.seatId)).toEqual(['A', 'B']); // oldest two, in order
  });
});

describe('casual queue: join/leave endpoints (auth-gated)', () => {
  beforeEach(() => store.clear());
  // Authenticated as seat `id` via a tok-<id> token; the server derives seatId from the token.
  const q = (action: string, id: string, body: any = {}) =>
    request(app).post(`/api/queue/${action}`).set('Authorization', `Bearer tok-${id}`).send(body);

  it('join enqueues a waiting entry keyed by the authed seat; leave (fenced) removes it', async () => {
    expect((await q('join', 'A', { sessionId: 's1', displayName: 'alice' })).status).toBe(200);
    const e = store.get('casualQueue/A');
    expect(e).toMatchObject({ seatId: 'A', sessionId: 's1', status: 'waiting' });

    await q('leave', 'A', { sessionId: 'WRONG' });   // stale session can't cancel
    expect(store.has('casualQueue/A')).toBe(true);
    await q('leave', 'A', { sessionId: 's1' });       // current session can
    expect(store.has('casualQueue/A')).toBe(false);
  });

  it('rejects an unauthenticated (guest) join with 401', async () => {
    const res = await request(app).post('/api/queue/join').send({ seatId: 'A', sessionId: 's1' });
    expect(res.status).toBe(401);
    expect(store.has('casualQueue/A')).toBe(false);
  });
});

describe('casual queue: pairing grace window', () => {
  const now = 1_000_000;
  it('pairs two just-enqueued entries even before presence registers', () => {
    const entries = [
      { seatId: 'A', sessionId: 's', enqueuedAt: now - 1000 },
      { seatId: 'B', sessionId: 's', enqueuedAt: now - 500 }
    ];
    const { pairs, stale } = computeQueuePairings(entries, () => false, now); // nobody "live" yet
    expect(stale).toHaveLength(0);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].map(e => e.seatId)).toEqual(['A', 'B']);
  });
  it('GCs a non-live entry once past the grace window', () => {
    const entries = [{ seatId: 'OLD', sessionId: 's', enqueuedAt: now - 60000 }];
    const { pairs, stale } = computeQueuePairings(entries, () => false, now);
    expect(pairs).toHaveLength(0);
    expect(stale.map(e => e.seatId)).toEqual(['OLD']);
  });
});

describe('recordMatchOutcome (casual/competitive stats -> profiles, once)', () => {
  beforeEach(() => store.clear());

  it('writes W/L, severs, ace and flawless to authed profiles; idempotent', async () => {
    store.set('players/A', { displayName: 'alice', stats: {} });
    store.set('players/B', { displayName: 'bob', stats: {} });
    // finished casual 1v1: A won (severed B), took no damage, cast 2 attack spells
    store.set('matches/R', {
      roomCode: 'R', mode: 'casual', phase: 'GAME_OVER', turnOrder: ['A', 'B'], activePlayerIndex: 0,
      damageSpellsCast: { A: 2, B: 5 },
      players: {
        A: { id: 'A', points: 2, thread: 15, maxThread: 15, severPoints: 1 },
        B: { id: 'B', points: 0, thread: 0, maxThread: 15, severPoints: 0 }
      }
    });
    await recordMatchOutcome('R');
    const a = store.get('players/A').stats, b = store.get('players/B').stats;
    expect(a).toMatchObject({ casualWins: 1, casualMatches: 1, casualSevers: 1, casualAces: 1, flawlessWins: 1 });
    expect(a.casualLosses).toBeUndefined();
    expect(b).toMatchObject({ casualLosses: 1, casualMatches: 1, casualSevers: 0 });
    expect(b.casualAces).toBeUndefined();
    expect(store.get('matches/R').statsRecorded).toBe(true);

    await recordMatchOutcome('R'); // idempotent
    expect(store.get('players/A').stats.casualWins).toBe(1);
  });

  it('does not record custom matches at all', async () => {
    store.set('players/A', { stats: {} });
    store.set('matches/C', {
      roomCode: 'C', mode: 'custom', phase: 'GAME_OVER', turnOrder: ['A'],
      players: { A: { id: 'A', points: 2, thread: 15, maxThread: 15, severPoints: 0 } }
    });
    await recordMatchOutcome('C');
    expect(store.get('players/A').stats).toEqual({});
    expect(store.get('matches/C').statsRecorded).toBeUndefined();
  });

  it('no ace when >3 damage spells were cast', async () => {
    store.set('players/A', { stats: {} });
    store.set('players/B', { stats: {} });
    store.set('matches/R2', {
      roomCode: 'R2', mode: 'casual', phase: 'GAME_OVER', turnOrder: ['A', 'B'],
      damageSpellsCast: { A: 4 },
      players: {
        A: { id: 'A', points: 2, thread: 12, maxThread: 15, severPoints: 1 },
        B: { id: 'B', points: 0, thread: 0, maxThread: 15, severPoints: 0 }
      }
    });
    await recordMatchOutcome('R2');
    expect(store.get('players/A').stats.casualAces).toBeUndefined();  // 4 spells -> no ace
    expect(store.get('players/A').stats.flawlessWins).toBeUndefined(); // took damage -> not flawless
    expect(store.get('players/A').stats.casualWins).toBe(1);
  });
});
