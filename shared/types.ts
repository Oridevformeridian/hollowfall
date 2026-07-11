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
  points: number;
  severPoints: number;
  hasAttackedThisTurn: boolean;
  isFirstTurnOfMatch: boolean;
  form: 'normal' | 'wolf';
  hasConceded?: boolean;
  sessionToken?: string;
  isDisconnected?: boolean;
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
  tokenPositions: Record<PlayerId, TokenPosition>;
  treasures: Record<string, Treasure>;
  gameLogs?: string[];
}

export type ClientMessage =
  | { event: 'JOIN_ROOM'; payload: { username: string; roomCode: string; color: string; emoji: string; sessionToken?: string } }
  | { event: 'TOGGLE_READY' }
  | { event: 'START_GAME' }
  | { event: 'PLACE_TILE'; payload: { x: number; y: number; rotation: 0 | 90 | 180 | 270 } }
  | { event: 'INTERACT_DOOR'; payload: { tileX: number; tileY: number; r: number; c: number; direction: 'H' | 'V' } }
  | { event: 'MOVE_TOKEN'; payload: TokenPosition }
  | { event: 'SELECT_HERO'; payload: { emoji: string } }
  | { event: 'END_TURN' }
  | { event: 'PLAY_CARD'; payload: { cardId: string; target?: { tileX: number; tileY: number; r: number; c: number; direction?: 'H' | 'V' } } }
  | { event: 'RESET_GAME' }
  | { event: 'LASH_ATTACK'; payload: { targetPlayerId: string } }
  | { event: 'PICKUP_TREASURE'; payload: { treasureId: string } }
  | { event: 'DROP_TREASURE'; payload: { treasureId: string } }
  | { event: 'CONCEDE' };

export type ServerMessage =
  | { event: 'STATE_UPDATE'; payload: GameState }
  | { event: 'PLAY_CARD_ANIMATION'; payload: { cardId: string; casterId: string; target?: any; countered?: 'turn_aside' | 'spirit_skin' | null } }
  | { event: 'LASH_ATTACK_ANIMATION'; payload: { attackerId: string; targetPlayerId: string; damageDealt: number; blockedBySpiritSkin: boolean } }
  | { event: 'ERROR'; payload: { message: string } };
