import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';

// Stateful in-memory Firestore so we can exercise runTransaction end-to-end.
const { store } = vi.hoisted(() => ({ store: new Map<string, any>() }));

vi.mock('jsonwebtoken', () => ({
  default: { sign: vi.fn(() => 'jwt'), verify: vi.fn((_t, _s, cb) => cb(new Error('no auth'))) }
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
  return {
    Firestore: vi.fn().mockImplementation(() => ({
      collection: (col: string) => ({
        doc: (id: string) => ({ id, _key: `${col}/${id}` }),
        where: () => ({ onSnapshot: vi.fn(), limit: () => ({ get: vi.fn() }) })
      }),
      runTransaction: async (fn: any) => fn({
        get: async (ref: any) => ({ exists: store.has(ref._key), data: () => store.get(ref._key) }),
        set: (ref: any, data: any) => { store.set(ref._key, clone(data)); },
        update: (ref: any, data: any) => { store.set(ref._key, { ...store.get(ref._key), ...clone(data) }); }
      })
    }))
  };
});

import { app, removeSeatFromTurnOrder } from './index';

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
