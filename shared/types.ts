export type PlayerId = string;
export type GamePhase = 'LOBBY' | 'DRAFT' | 'PLACEMENT' | 'GAMEPLAY' | 'GAME_OVER';

export interface Player {
  id: PlayerId;
  username: string;
  color: string;
  emoji: string;
  isReady: boolean;
  isHost: boolean;
  assignedTileIndex: number | null; // 0..3 index of distributed fixed tiles
  ap: number;
  thread: number;
  maxThread: number;
  hand: Card[];
  deck: Card[];
  points: number;
  severPoints: number;
  hasAttackedThisTurn: boolean;
  isFirstTurnOfMatch: boolean;
  form: 'normal' | 'wolf';
  hasConceded?: boolean;
  sessionToken?: string;
  activeSessionId?: string | null; // fencing token: the one live session allowed to act as this seat
  isDisconnected?: boolean;
  concessionExpiresAt?: number; // timestamp when the player will automatically concede due to disconnect
  hasThorns?: boolean;
  hasTurnAside?: boolean;
  hasSpiritSkin?: boolean;
  thorns?: number;
  spiritSkin?: number;
  graveyard?: Card[];
  expendPile?: Card[];
}

export interface Treasure {
  id: string;
  tileX: number;
  tileY: number;
  r: number;
  c: number;
  ownerId: string;
  carrierId: string | null;
}

export interface Card {
  id: string;
  name: string;
  type: 'bane' | 'ward' | 'working' | 'talisman' | 'offering';
  description: string;
  expend?: boolean;
}

export interface Coordinate {
  x: number; // Macro grid X coordinate (0,0 is start)
  y: number; // Macro grid Y coordinate
}

export interface PlacedTile {
  tileId: number; // 1..4 corresponding to the fixed tiles
  position: Coordinate;
  rotation: 0 | 90 | 180 | 270;
  placedBy: PlayerId;
}

export interface TokenPosition {
  tileX: number;
  tileY: number;
  r: number; // micro grid cell row (0..4)
  c: number; // micro grid cell col (0..4)
}

export interface GameState {
  roomCode: string;
  phase: GamePhase;
  players: Record<PlayerId, Player>;
  turnOrder: PlayerId[];
  activePlayerIndex: number;
  placedTiles: Record<string, PlacedTile>; // Key format: "x,y"
  doorsState: Record<string, 'OPEN' | 'CLOSED'>; // Key format: "x,y:r,c:direction"
  wallsState: Record<string, boolean>; // Key format: "x,y:r,c:direction"
  wallHp?: Record<string, number>; // Key format: "x,y:r,c:direction"
  tokenPositions: Record<PlayerId, TokenPosition>;
  treasures: Record<string, Treasure>;
  gameLogs?: string[];
  victoryPointsTarget?: number;
  mode?: 'casual' | 'custom'; // 'casual' = matchmade (hide join code); undefined/'custom' = lobby match
  // Transient "last visualized action" for combat animations. seq is monotonic; the client
  // fires the animation once per new seq (persisted in state since there's no socket channel).
  lastEvent?: {
    seq: number;
    kind: 'card' | 'lash';
    cardId?: string;
    casterId?: string;
    attackerId?: string;
    from?: { tileX: number; tileY: number; r: number; c: number };
    to?: { tileX: number; tileY: number; r: number; c: number; direction?: 'H' | 'V' };
    targetPlayerId?: string;
    targetWall?: { tileX: number; tileY: number; r: number; c: number; direction: 'H' | 'V' };
    countered?: 'turn_aside' | 'spirit_skin' | null;
    damageDealt?: number;
    blockedBySpiritSkin?: boolean;
  };
  turnStartedAt?: number;
  turnExpiresAt?: number;
  isTurnPaused?: boolean;
  turnPausedRemainingMs?: number;
  gameStartedAt?: number;
  gameEndedAt?: number;
}

export type ClientMessage =
  | { event: 'JOIN_ROOM'; payload: { username: string; roomCode: string; color: string; emoji: string; sessionToken?: string } }
  | { event: 'TOGGLE_READY' }
  | { event: 'START_GAME' }
  | { event: 'PLACE_TILE'; payload: { x: number; y: number; rotation: 0 | 90 | 180 | 270 } }
  | { event: 'INTERACT_DOOR'; payload: { tileX: number; tileY: number; r: number; c: number; direction: 'H' | 'V' } }
  | { event: 'MOVE_TOKEN'; payload: TokenPosition }
  | { event: 'SELECT_HERO'; payload: { emoji: string } }
  | { event: 'END_TURN'; payload?: { discardHand?: boolean } }
  | { event: 'PLAY_CARD'; payload: { cardId: string; target?: { tileX: number; tileY: number; r: number; c: number; direction?: 'H' | 'V' } } }
  | { event: 'RESET_GAME' }
  | { event: 'LASH_ATTACK'; payload: { targetPlayerId?: string; targetWall?: { tileX: number; tileY: number; r: number; c: number; direction: 'H' | 'V' } } }
  | { event: 'PICKUP_TREASURE'; payload: { treasureId: string } }
  | { event: 'DROP_TREASURE'; payload: { treasureId: string } }
  | { event: 'CONCEDE' }
  | { event: 'SET_VICTORY_POINTS_TARGET'; payload: { victoryPointsTarget: number } };

export type ServerMessage =
  | { event: 'STATE_UPDATE'; payload: GameState }
  | { event: 'PLAY_CARD_ANIMATION'; payload: { cardId: string; casterId: string; target?: any; countered?: 'turn_aside' | 'spirit_skin' | null } }
  | { event: 'LASH_ATTACK_ANIMATION'; payload: { attackerId: string; targetPlayerId?: string; targetWall?: { tileX: number; tileY: number; r: number; c: number; direction: 'H' | 'V' }; damageDealt: number; blockedBySpiritSkin: boolean } }
  | { event: 'ERROR'; payload: { message: string } };
