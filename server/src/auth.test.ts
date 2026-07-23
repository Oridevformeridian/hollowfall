import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from './index';

// Mock jsonwebtoken
vi.mock('jsonwebtoken', () => ({
  default: {
    sign: vi.fn(() => 'mocked-jwt-token'),
    verify: vi.fn((token, secret, cb) => {
      if (token === 'valid-token') {
        cb(null, { playerId: 'mock-player-id' });
      } else {
        cb(new Error('Invalid token'));
      }
    }),
  }
}));

// Mock Google Auth
vi.mock('google-auth-library', () => {
  return {
    OAuth2Client: vi.fn().mockImplementation(() => ({
      verifyIdToken: vi.fn().mockImplementation(async ({ idToken }) => {
        if (idToken === 'valid-google-token') {
          return {
            getPayload: () => ({
              sub: 'google-subject-123',
              name: 'Test Wanderer'
            })
          };
        }
        throw new Error('Invalid token');
      })
    }))
  };
});

// Mock Firestore using vi.hoisted to prevent ReferenceError
const mocks = vi.hoisted(() => {
  const mockUpdate = vi.fn();
  const mockSet = vi.fn();
  const mockGet = vi.fn();
  const mockLimit = vi.fn(() => ({ get: mockGet }));
  const mockWhere = vi.fn(() => ({ limit: mockLimit }));
  
  // We need to return an object with an onSnapshot function to prevent top-level errors in index.ts
  const mockOnSnapshot = vi.fn();
  mockWhere.mockImplementation(() => ({
    limit: mockLimit,
    onSnapshot: mockOnSnapshot
  }));
  
  const mockDoc = vi.fn(() => ({ update: mockUpdate, set: mockSet, id: 'mock-player-id' }));
  
  return { mockUpdate, mockSet, mockGet, mockLimit, mockWhere, mockDoc, mockOnSnapshot };
});

const { mockUpdate, mockSet, mockGet, mockWhere } = mocks;

vi.mock('@google-cloud/firestore', () => {
  return {
    Firestore: vi.fn().mockImplementation(() => ({
      collection: vi.fn(() => ({
        where: mocks.mockWhere,
        doc: mocks.mockDoc
      }))
    }))
  };
});

// Also mock firebase-admin to prevent errors when index.ts initializes it
vi.mock('firebase-admin/app', () => ({
  initializeApp: vi.fn()
}));

vi.mock('firebase-admin/database', () => ({
  getDatabase: vi.fn(() => ({
    ref: vi.fn(() => ({
      on: vi.fn()
    }))
  }))
}));

describe('Authentication and Profile REST API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/auth/google', () => {
    it('returns 400 if idToken is missing', async () => {
      const res = await request(app).post('/api/auth/google').send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('idToken is required');
    });

    it('returns 401 if idToken is invalid', async () => {
      const res = await request(app)
        .post('/api/auth/google')
        .send({ idToken: 'invalid-token' });
      expect(res.status).toBe(401);
    });

    it('creates a new player and returns JWT on valid token (New User)', async () => {
      mockGet.mockResolvedValueOnce({ empty: true }); // No existing user

      const res = await request(app)
        .post('/api/auth/google')
        .send({ idToken: 'valid-google-token' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.token).toBe('mocked-jwt-token');
      // Privacy: a new account must NOT be named with the Google-provided name.
      expect(res.body.displayName).not.toBe('Test Wanderer');
      expect(res.body.displayName).toMatch(/^Wanderer_/);

      expect(mockWhere).toHaveBeenCalledWith('identities.google', '==', 'google-subject-123');
      expect(mockSet).toHaveBeenCalled();
    });

    it('returns existing player JWT on valid token (Returning User)', async () => {
      mockGet.mockResolvedValueOnce({
        empty: false,
        docs: [{
          id: 'existing-player-id',
          data: () => ({ displayName: 'Existing Wanderer' })
        }]
      }); // User exists

      const res = await request(app)
        .post('/api/auth/google')
        .send({ idToken: 'valid-google-token' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.token).toBe('mocked-jwt-token');
      expect(res.body.displayName).toBe('Existing Wanderer');
      expect(mockSet).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/player/profile', () => {
    it('returns 401 if no Authorization header provided', async () => {
      const res = await request(app).post('/api/player/profile').send({ displayName: 'New Name' });
      expect(res.status).toBe(401);
    });

    it('returns 403 if token is invalid', async () => {
      const res = await request(app)
        .post('/api/player/profile')
        .set('Authorization', 'Bearer invalid-token')
        .send({ displayName: 'New Name' });
      expect(res.status).toBe(403);
    });

    it('returns 400 if displayName is missing', async () => {
      const res = await request(app)
        .post('/api/player/profile')
        .set('Authorization', 'Bearer valid-token')
        .send({ emoji: '🔥' });
      expect(res.status).toBe(400);
    });

    it('updates profile in Firestore successfully', async () => {
      mockUpdate.mockResolvedValueOnce({});

      const res = await request(app)
        .post('/api/player/profile')
        .set('Authorization', 'Bearer valid-token')
        .send({ displayName: 'Updated Name', emoji: '💀' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockUpdate).toHaveBeenCalledWith({ displayName: 'Updated Name', emoji: '💀' });
    });
  });
});
