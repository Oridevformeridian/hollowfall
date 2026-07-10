import React, { useState, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import { GameState, ClientMessage, ServerMessage } from './shared/types.ts';
import { FIXED_TILES, TileLayout, HEROES, BASIC_CARDS } from './shared/constants.ts';
import { validateTilePlacement, validateTokenMove, validateDoorInteract, rotateBorderCoordinate, hasLineOfSight } from './shared/validation.ts';

const renderTileSvgContent = (
  layout: TileLayout,
  playerColor: string,
  tilePos?: { x: number; y: number },
  doorsState?: Record<string, 'OPEN' | 'CLOSED'>,
  rotation?: 0 | 90 | 180 | 270,
  onInteractDoor?: (tileX: number, tileY: number, r: number, c: number, direction: 'H' | 'V') => void,
  myTokenPos?: any,
  isActiveTurn?: boolean,
  selfAp?: number,
  placedTiles?: any,
  wallsState?: Record<string, boolean>,
  isGameplay?: boolean
) => {
  const rot = rotation || 0;
  const cells = [];
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      cells.push(
        <rect
          key={`cell-${r}-${c}`}
          x={c * 20}
          y={r * 20}
          width="20"
          height="20"
          fill="rgba(255, 255, 255, 0.01)"
          stroke="rgba(255, 255, 255, 0.05)"
          strokeWidth="0.5"
        />
      );
    }
  }

  return (
    <>
      {/* 5x5 Grid Cells */}
      {cells}

      {/* Starting Star in Center */}
      <polygon
        points="50,40.2 52.8,47.2 59.8,47.2 54.2,51.4 57,58.4 50,54.2 43,58.4 45.8,51.4 40.2,47.2 47.2,47.2"
        fill={playerColor}
        stroke={playerColor}
        strokeWidth="1"
        style={{ filter: `drop-shadow(0 0 5px ${playerColor})` }}
      />

      {/* Render Walls */}
      {layout.vWalls.map((w, idx) => (
        <line
          key={`vwall-${idx}`}
          x1={(w.c + 1) * 20}
          y1={w.r * 20}
          x2={(w.c + 1) * 20}
          y2={(w.r + 1) * 20}
          stroke="#475569" // slate wall color
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      ))}

      {layout.hWalls.map((w, idx) => (
        <line
          key={`hwall-${idx}`}
          x1={w.c * 20}
          y1={(w.r + 1) * 20}
          x2={(w.c + 1) * 20}
          y2={(w.r + 1) * 20}
          stroke="#475569" // slate wall color
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      ))}

      {/* Render Dynamic Raised Stone Walls */}
      {(() => {
        const dynamicWalls = [];
        if (tilePos && wallsState) {
          for (let r = 0; r < 5; r++) {
            for (let c = 0; c < 4; c++) {
              const wallKey = `${tilePos.x},${tilePos.y}:${r},${c}:V`;
              if (wallsState[wallKey]) {
                dynamicWalls.push(
                  <line
                    key={`dyn-vwall-${r}-${c}`}
                    x1={(c + 1) * 20}
                    y1={r * 20}
                    x2={(c + 1) * 20}
                    y2={(r + 1) * 20}
                    stroke="#FF6D00"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    style={{ filter: 'drop-shadow(0 0 3px #FF6D00)' }}
                  />
                );
              }
            }
          }
          for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 5; c++) {
              const wallKey = `${tilePos.x},${tilePos.y}:${r},${c}:H`;
              if (wallsState[wallKey]) {
                dynamicWalls.push(
                  <line
                    key={`dyn-hwall-${r}-${c}`}
                    x1={c * 20}
                    y1={(r + 1) * 20}
                    x2={(c + 1) * 20}
                    y2={(r + 1) * 20}
                    stroke="#FF6D00"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    style={{ filter: 'drop-shadow(0 0 3px #FF6D00)' }}
                  />
                );
              }
            }
          }
        }
        return dynamicWalls;
      })()}

      {/* Render Doors */}
      {layout.vDoors.map((d, idx) => {
        let isOpen = false;
        let canClick = false;
        let placedR = d.r;
        let placedC = d.c;
        let placedDir: 'H' | 'V' = 'V';

        if (tilePos && doorsState && rotation !== undefined) {
          const placed = rotateBorderCoordinate(d.r, d.c, 'V', rot);
          placedR = placed.r;
          placedC = placed.c;
          placedDir = placed.direction;
          const doorKey = `${tilePos.x},${tilePos.y}:${placedR},${placedC}:${placedDir}`;
          isOpen = doorsState[doorKey] === 'OPEN';

          if (myTokenPos && isActiveTurn && selfAp && selfAp > 0 && placedTiles) {
            canClick = validateDoorInteract(myTokenPos, { tileX: tilePos.x, tileY: tilePos.y, r: placedR, c: placedC, direction: placedDir }, placedTiles).valid;
          }
        }

        return (
          <g key={`vdoor-g-${idx}`} transform={`rotate(${-rot} ${(d.c + 1) * 20} ${d.r * 20 + 10})`}>
            <text
              x={(d.c + 1) * 20}
              y={d.r * 20 + 10}
              fontSize="7"
              textAnchor="middle"
              dominantBaseline="middle"
              style={{
                cursor: canClick && onInteractDoor ? 'pointer' : 'default',
                pointerEvents: 'auto',
                userSelect: 'none',
                filter: canClick ? 'drop-shadow(0 0 3px #00E676)' : 'none',
                opacity: isOpen ? 0.4 : 1,
                transition: 'all 0.2s'
              }}
              onClick={(e) => {
                if (canClick && onInteractDoor && tilePos) {
                  e.stopPropagation();
                  onInteractDoor(tilePos.x, tilePos.y, placedR, placedC, placedDir);
                }
              }}
            >
              {isOpen ? '🔓' : '🚪'}
            </text>
          </g>
        );
      })}

      {layout.hDoors.map((d, idx) => {
        let isOpen = false;
        let canClick = false;
        let placedR = d.r;
        let placedC = d.c;
        let placedDir: 'H' | 'V' = 'H';

        if (tilePos && doorsState && rotation !== undefined) {
          const placed = rotateBorderCoordinate(d.r, d.c, 'H', rot);
          placedR = placed.r;
          placedC = placed.c;
          placedDir = placed.direction;
          const doorKey = `${tilePos.x},${tilePos.y}:${placedR},${placedC}:${placedDir}`;
          isOpen = doorsState[doorKey] === 'OPEN';

          if (myTokenPos && isActiveTurn && selfAp && selfAp > 0 && placedTiles) {
            canClick = validateDoorInteract(myTokenPos, { tileX: tilePos.x, tileY: tilePos.y, r: placedR, c: placedC, direction: placedDir }, placedTiles).valid;
          }
        }

        return (
          <g key={`hdoor-g-${idx}`} transform={`rotate(${-rot} ${d.c * 20 + 10} ${(d.r + 1) * 20})`}>
            <text
              x={d.c * 20 + 10}
              y={(d.r + 1) * 20}
              fontSize="7"
              textAnchor="middle"
              dominantBaseline="middle"
              style={{
                cursor: canClick && onInteractDoor ? 'pointer' : 'default',
                pointerEvents: 'auto',
                userSelect: 'none',
                filter: canClick ? 'drop-shadow(0 0 3px #00E676)' : 'none',
                opacity: isOpen ? 0.4 : 1,
                transition: 'all 0.2s'
              }}
              onClick={(e) => {
                if (canClick && onInteractDoor && tilePos) {
                  e.stopPropagation();
                  onInteractDoor(tilePos.x, tilePos.y, placedR, placedC, placedDir);
                }
              }}
            >
              {isOpen ? '🔓' : '🚪'}
            </text>
          </g>
        );
      })}

      {/* Outer borders with exit gaps */}
      {/* North */}
      <line x1="0" y1="0" x2="40" y2="0" stroke="#475569" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="60" y1="0" x2="100" y2="0" stroke="#475569" strokeWidth="2.5" strokeLinecap="round" />
      {/* South */}
      <line x1="0" y1="100" x2="40" y2="100" stroke="#475569" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="60" y1="100" x2="100" y2="100" stroke="#475569" strokeWidth="2.5" strokeLinecap="round" />
      {/* West */}
      <line x1="0" y1="0" x2="0" y2="40" stroke="#475569" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="0" y1="60" x2="0" y2="100" stroke="#475569" strokeWidth="2.5" strokeLinecap="round" />
      {/* East */}
      <line x1="100" y1="0" x2="100" y2="40" stroke="#475569" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="100" y1="60" x2="100" y2="100" stroke="#475569" strokeWidth="2.5" strokeLinecap="round" />
      {/* Treasure Spawns at corners (0,0) and (4,4) - only shown when not active gameplay */}
      {!isGameplay && (
        <>
          <g transform={`rotate(${-rot} 10 10)`}>
            <text x="10" y="11" fontSize="7" textAnchor="middle" dominantBaseline="middle" style={{ userSelect: 'none' }}>💎</text>
          </g>
          <g transform={`rotate(${-rot} 90 90)`}>
            <text x="90" y="91" fontSize="7" textAnchor="middle" dominantBaseline="middle" style={{ userSelect: 'none' }}>💎</text>
          </g>
        </>
      )}
    </>
  );
};

function playVictoryChime() {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    
    const now = ctx.currentTime;
    
    // Celebratory major chord arpeggio: C4, E4, G4, C5
    const freqs = [261.63, 329.63, 392.00, 523.25];
    
    freqs.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + idx * 0.15);
      
      // Envelope
      gain.gain.setValueAtTime(0, now + idx * 0.15);
      gain.gain.linearRampToValueAtTime(0.15, now + idx * 0.15 + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.15 + 1.2);
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.start(now + idx * 0.15);
      osc.stop(now + idx * 0.15 + 1.3);
    });

    // Add a shimmering high C6 note at the end
    const shimmer = ctx.createOscillator();
    const shimmerGain = ctx.createGain();
    shimmer.type = 'sine';
    shimmer.frequency.setValueAtTime(1046.50, now + 0.6);
    shimmerGain.gain.setValueAtTime(0, now + 0.6);
    shimmerGain.gain.linearRampToValueAtTime(0.05, now + 0.6 + 0.05);
    shimmerGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.6 + 1.5);
    shimmer.connect(shimmerGain);
    shimmerGain.connect(ctx.destination);
    shimmer.start(now + 0.6);
    shimmer.stop(now + 0.6 + 1.6);

  } catch (e) {
    console.error('AudioContext failed:', e);
  }
}

const ANIMALS = ['frog', 'duck', 'crab', 'bear', 'lion', 'wolf', 'deer', 'goat', 'owl', 'fish', 'fox', 'bird', 'cat', 'dog', 'pig'];
const ITEMS = ['cup', 'spoon', 'fork', 'pen', 'book', 'key', 'bag', 'shoe', 'hat', 'box', 'bowl', 'lamp', 'door', 'desk', 'clock'];
const COLORS = ['red', 'blue', 'green', 'pink', 'gray', 'teal', 'gold', 'yellow', 'black', 'white', 'orange', 'brown', 'purple'];

function generateLobbyName(): string {
  const w1 = COLORS[Math.floor(Math.random() * COLORS.length)];
  const w2 = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  const w3 = ITEMS[Math.floor(Math.random() * ITEMS.length)];
  return `${w1}-${w2}-${w3}`;
}

export default function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [targetingCardId, setTargetingCardId] = useState<string | null>(null);
  const [playedGameOverSound, setPlayedGameOverSound] = useState(false);
  const [activeAnimation, setActiveAnimation] = useState<{
    cardId: string;
    casterId: string;
    from: { tileX: number; tileY: number; r: number; c: number };
    to?: { tileX: number; tileY: number; r: number; c: number; direction?: 'H' | 'V' };
    countered?: 'turn_aside' | 'spirit_skin' | null;
  } | null>(null);
  const [hoveredPlayerId, setHoveredPlayerId] = useState<string | null>(null);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [hoveredCardId, setHoveredCardId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const gameStateRef = React.useRef(gameState);
  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  useEffect(() => {
    if (gameState?.phase === 'GAME_OVER') {
      if (!playedGameOverSound) {
        playVictoryChime();
        setPlayedGameOverSound(true);
      }
    } else {
      if (playedGameOverSound) {
        setPlayedGameOverSound(false);
      }
    }
  }, [gameState?.phase, playedGameOverSound]);

  // Form states
  const [username, setUsername] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [dimensions, setDimensions] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 1200,
    height: typeof window !== 'undefined' ? window.innerHeight : 800
  });

  useEffect(() => {
    const handleResize = () => {
      setDimensions({
        width: window.innerWidth,
        height: window.innerHeight
      });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Interactive placement states
  const [hoverCoord, setHoverCoord] = useState<{ x: number; y: number } | null>(null);
  const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0);

  // Initialize socket connection
  useEffect(() => {
    const s = io();
    setSocket(s);

    s.on('connect', () => {
      console.log('Connected to server');
      setError(null);
    });

    s.on('message', (messageStr: string) => {
      try {
        const msg: ServerMessage = JSON.parse(messageStr);
        if (msg.event === 'STATE_UPDATE') {
          setGameState(msg.payload);
          setError(null);
        } else if (msg.event === 'PLAY_CARD_ANIMATION') {
          const { cardId, casterId, target, countered } = msg.payload;
          const casterPos = gameStateRef.current?.tokenPositions[casterId];
          if (casterPos) {
            setActiveAnimation({
              cardId,
              casterId,
              from: { ...casterPos },
              to: target ? { ...target } : undefined,
              countered
            });
            setTimeout(() => {
              setActiveAnimation(null);
            }, 2500);
          }
        } else if (msg.event === 'ERROR') {
          setError(msg.payload.message);
        }
      } catch (err) {
        console.error('Failed to parse server message', err);
      }
    });

    s.on('connect_error', () => {
      setError('Connection to backend server failed. Make sure server is running.');
    });

    return () => {
      s.disconnect();
    };
  }, []);

  const sendEvent = (event: ClientMessage) => {
    if (socket) {
      socket.emit('message', JSON.stringify(event));
    }
  };

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !roomCode) {
      setError('Username and Room Code are required.');
      return;
    }
    sendEvent({
      event: 'JOIN_ROOM',
      payload: { username, roomCode, color: '', emoji: '' }
    });
  };

  const handleCreate = () => {
    if (!username) {
      setError('Please enter your name first.');
      return;
    }
    const newRoomCode = generateLobbyName();
    setRoomCode(newRoomCode);
    sendEvent({
      event: 'JOIN_ROOM',
      payload: { username, roomCode: newRoomCode, color: '', emoji: '' }
    });
  };

  const handleToggleReady = () => {
    sendEvent({ event: 'TOGGLE_READY' });
  };

  const handleSelectHero = (emoji: string) => {
    sendEvent({
      event: 'SELECT_HERO',
      payload: { emoji }
    });
  };

  const handleStartGame = () => {
    sendEvent({ event: 'START_GAME' });
  };

  const handleRotate = () => {
    setRotation(prev => ((prev + 90) % 360) as 0 | 90 | 180 | 270);
  };

  const handlePlaceTile = (x: number, y: number) => {
    sendEvent({
      event: 'PLACE_TILE',
      payload: { x, y, rotation }
    });
    // Reset rotation preview for next turn
    setRotation(0);
  };

  const handleMoveToken = (pos: any) => {
    sendEvent({
      event: 'MOVE_TOKEN',
      payload: pos
    });
  };

  const handleInteractDoor = (tileX: number, tileY: number, r: number, c: number, direction: 'H' | 'V') => {
    sendEvent({
      event: 'INTERACT_DOOR',
      payload: { tileX, tileY, r, c, direction }
    });
  };

  const handleEndTurn = () => {
    sendEvent({ event: 'END_TURN' });
  };

  const handlePlayCard = (cardId: string, target?: any) => {
    sendEvent({
      event: 'PLAY_CARD',
      payload: { cardId, target }
    });
    setTargetingCardId(null);
    setSelectedCardId(null);
  };

  const handleResetGame = () => {
    sendEvent({ event: 'RESET_GAME' });
  };

  const handleCopyRoomCode = () => {
    if (gameState?.roomCode) {
      navigator.clipboard.writeText(gameState.roomCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Helper selectors
  const self = socket?.id && gameState ? gameState.players[socket.id] : null;
  const isHost = self?.isHost || false;
  const playersList = gameState ? Object.values(gameState.players) : [];
  const activePlayerId = gameState?.turnOrder[gameState.activePlayerIndex];
  const isActiveTurn = !!(socket && activePlayerId === socket.id);
  const myTokenPos = socket?.id && gameState ? gameState.tokenPositions[socket.id] : null;

  // Keyboard arrow movement controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!gameState || gameState.phase !== 'GAMEPLAY' || !isActiveTurn || !myTokenPos) return;

      // Ignore input elements to allow normal typing
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') {
        return;
      }

      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyS', 'KeyA', 'KeyD'].includes(e.code)) {
        e.preventDefault();
      }

      let dr = 0;
      let dc = 0;

      if (e.code === 'ArrowUp' || e.code === 'KeyW') {
        dr = -1;
      } else if (e.code === 'ArrowDown' || e.code === 'KeyS') {
        dr = 1;
      } else if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
        dc = -1;
      } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
        dc = 1;
      } else {
        return;
      }

      let targetR = myTokenPos.r + dr;
      let targetC = myTokenPos.c + dc;
      let targetTileX = myTokenPos.tileX;
      let targetTileY = myTokenPos.tileY;

      if (targetR < 0) {
        targetTileY += 1;
        targetR = 4;
      } else if (targetR > 4) {
        targetTileY -= 1;
        targetR = 0;
      }

      if (targetC < 0) {
        targetTileX -= 1;
        targetC = 4;
      } else if (targetC > 4) {
        targetTileX += 1;
        targetC = 0;
      }

      const targetPos = { tileX: targetTileX, tileY: targetTileY, r: targetR, c: targetC };

      const validation = validateTokenMove(
        myTokenPos,
        targetPos,
        gameState.placedTiles,
        gameState.doorsState,
        gameState.wallsState
      );

      if (validation.valid) {
        handleMoveToken(targetPos);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [gameState, isActiveTurn, myTokenPos]);

  // Render Join / Lobby
  if (!gameState) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          padding: '24px',
          width: '100%',
          boxSizing: 'border-box'
        }}
      >
        <div
          className="glass-panel pulse-glow"
          style={{
            width: '100%',
            maxWidth: '440px',
            padding: '32px',
            display: 'flex',
            flexDirection: 'column',
            gap: '24px',
            alignItems: 'center',
            textAlign: 'center',
            boxSizing: 'border-box'
          }}
        >
          <div>
            <h1 className="text-3xl font-extrabold text-[#00E5FF] m-0 mb-2 tracking-wide" style={{ textAlign: 'center' }}>
              HOLLOWFALL
            </h1>
            <p className="text-gray-400 text-sm m-0" style={{ textAlign: 'center' }}>
              Thresholds Board Setup & Lobby
            </p>
          </div>

          {error && (
            <div
              style={{
                backgroundColor: 'rgba(255,23,68,0.1)',
                border: '1px solid var(--accent-crimson)',
                color: 'var(--accent-crimson)',
                padding: '12px',
                borderRadius: '8px',
                fontSize: '14px',
                textAlign: 'center',
                width: '100%',
                boxSizing: 'border-box'
              }}
            >
              {error}
            </div>
          )}

          {/* Name Input - Always Required */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', alignItems: 'center' }}>
            <label className="text-sm font-semibold text-gray-300">Your Name</label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="Spirit Walker"
              className="input-field text-center"
              style={{ width: '100%', textAlign: 'center' }}
              maxLength={15}
            />
          </div>

          <div style={{ width: '100%', borderTop: '1px solid var(--border-light)', margin: '8px 0' }} />

          {/* Option A: Create a Match */}
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <h3 style={{ fontSize: '14px', color: 'var(--accent-gold)', margin: 0, fontWeight: 'bold' }}>Option A: Host New Game</h3>
            <p style={{ fontSize: '11px', color: '#64748b', margin: 0 }}>Generates a random, easy-to-read name you can share over Discord.</p>
            <button
              type="button"
              onClick={handleCreate}
              className="btn-primary"
              style={{
                width: '100%',
                backgroundColor: 'var(--accent-gold)',
                color: 'black',
                fontWeight: 'bold',
                marginTop: '4px'
              }}
            >
              ✨ Create Match
            </button>
          </div>

          <div style={{ width: '100%', borderTop: '1px solid var(--border-light)', margin: '8px 0' }} />

          {/* Option B: Join Existing Match */}
          <form
            onSubmit={handleJoin}
            style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '12px' }}
          >
            <h3 style={{ fontSize: '14px', color: 'var(--accent-cyan)', margin: 0, fontWeight: 'bold' }}>Option B: Join Existing Game</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%', alignItems: 'center' }}>
              <input
                type="text"
                value={roomCode}
                onChange={e => setRoomCode(e.target.value)}
                placeholder="e.g. mystic-lair-seer"
                className="input-field text-center"
                style={{ width: '100%', textAlign: 'center' }}
                maxLength={30}
              />
            </div>
            <button
              type="submit"
              className="btn-secondary"
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                fontWeight: 'bold'
              }}
            >
              ➔ Join Match
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Render Lobby screen (waiting for start)
  if (gameState.phase === 'LOBBY') {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          padding: '24px',
          width: '100%',
          boxSizing: 'border-box'
        }}
      >
        <div
          className="glass-panel"
          style={{
            width: '100%',
            maxWidth: '768px',
            padding: '32px',
            display: 'flex',
            flexDirection: 'column',
            gap: '24px',
            boxSizing: 'border-box'
          }}
        >
          <div className="flex flex-col items-center justify-center border-b border-[var(--border-light)] pb-4 text-center gap-1.5">
            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
              <h2 className="text-2xl font-bold text-[var(--accent-cyan)] m-0">Lobby Room: {gameState.roomCode}</h2>
              <button
                onClick={handleCopyRoomCode}
                title="Copy Room Code"
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: copied ? 'var(--accent-green)' : '#94a3b8',
                  padding: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'color 0.2s',
                  position: 'relative'
                }}
              >
                {copied ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                )}
                {copied && (
                  <span style={{
                    position: 'absolute',
                    top: '-24px',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    backgroundColor: '#00E676',
                    color: 'black',
                    fontSize: '10px',
                    fontWeight: 'bold',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    whiteSpace: 'nowrap',
                    boxShadow: '0 2px 5px rgba(0,0,0,0.3)'
                  }}>
                    Copied!
                  </span>
                )}
              </button>
            </div>
            <p className="text-gray-400 text-xs m-0">Waiting for 2 players to start...</p>
            {isHost && <span className="text-xs bg-[var(--accent-gold)] text-black px-2.5 py-1 rounded font-bold mt-1">LOBBY HOST</span>}
          </div>

          {error && (
            <div
              style={{
                backgroundColor: 'rgba(255,23,68,0.1)',
                border: '1px solid var(--accent-crimson)',
                color: 'var(--accent-crimson)',
                padding: '12px',
                borderRadius: '8px',
                fontSize: '14px',
                textAlign: 'center',
                width: '100%'
              }}
            >
              {error}
            </div>
          )}

          {/* Centered two elements: Connected Players (Left) & Choose Your Hero (Right) */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '32px',
              alignItems: 'center',
              width: '100%'
            }}
          >
            {/* Column 1: Connected Players */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <h3 className="text-sm font-semibold text-gray-400 m-0 uppercase tracking-wider" style={{ textAlign: 'center' }}>
                Connected Players ({playersList.length}/2)
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {playersList.map(player => (
                  <div
                    key={player.id}
                    className="flex justify-between items-center bg-[rgba(255,255,255,0.03)] p-4 rounded-xl border border-gray-800"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-3.5 h-3.5 rounded-full" style={{ backgroundColor: player.color }} />
                      <span className="font-semibold text-white" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <span style={{ fontSize: '48px', lineHeight: '1' }}>{player.emoji}</span>
                        <span>{player.username} {player.id === socket?.id && '(You)'}</span>
                      </span>
                    </div>
                    <span className={`text-xs px-3 py-1.5 rounded-full font-bold ${player.isReady ? 'bg-[rgba(0,230,118,0.15)] text-[var(--accent-green)]' : 'bg-gray-800 text-gray-400'}`}>
                      {player.isReady ? 'READY' : 'NOT READY'}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Column 2: Choose Your Hero Picker */}
            {(() => {
              const takenEmojis = playersList
                .filter(p => p.id !== socket?.id)
                .map(p => p.emoji);
              return (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
                  <h3 className="text-sm font-semibold text-gray-400 m-0 uppercase tracking-wider font-bold text-center">Choose Your Hero</h3>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(5, 80px)',
                      gap: '12px',
                      justifyContent: 'center'
                    }}
                  >
                    {HEROES.map(hero => {
                      const isTaken = takenEmojis.includes(hero.emoji);
                      const isSelected = self?.emoji === hero.emoji;
                      return (
                        <button
                          type="button"
                          key={hero.emoji}
                          onClick={() => !isTaken && handleSelectHero(hero.emoji)}
                          disabled={isTaken}
                          style={{
                            fontSize: '48px',
                            width: '80px',
                            height: '80px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            border: isSelected
                              ? `4px solid ${hero.color}`
                              : isTaken
                              ? '2px dashed #334155'
                              : '2px solid var(--border-light)',
                            borderRadius: '16px',
                            backgroundColor: isSelected
                              ? `${hero.color}22`
                              : 'rgba(0, 0, 0, 0.2)',
                            cursor: isTaken ? 'not-allowed' : 'pointer',
                            opacity: isTaken ? 0.25 : 1,
                            transition: 'all 0.2s',
                            boxShadow: isSelected ? `0 0 15px ${hero.color}` : 'none'
                          }}
                          className={isTaken ? '' : 'hover:scale-105'}
                          title={isTaken ? `${hero.name} (Already Taken)` : hero.name}
                        >
                          {hero.emoji}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Centered Ready/Start buttons below both elements */}
          <div
            style={{
              display: 'flex',
              gap: '16px',
              marginTop: '24px',
              borderTop: '1px solid var(--border-light)',
              paddingTop: '24px',
              justifyContent: 'center',
              width: '100%',
              maxWidth: '440px',
              marginLeft: 'auto',
              marginRight: 'auto'
            }}
          >
            <button
              onClick={handleToggleReady}
              disabled={!self?.emoji}
              className={`flex-1 ${self?.isReady ? 'btn-secondary' : 'btn-primary'}`}
              style={{ minWidth: '150px' }}
            >
              {self?.isReady ? 'Cancel Ready' : 'Ready Up'}
            </button>

            {isHost && (
              <button
                onClick={handleStartGame}
                disabled={playersList.length !== 2 || playersList.some(p => !p.isReady)}
                className="btn-primary flex-1 bg-gradient-to-r from-[var(--accent-gold)] to-[#ffa600] text-black font-extrabold disabled:opacity-50"
                style={{ minWidth: '170px' }}
              >
                Start Game Setup
              </button>
            )}
          </div>

          {/* Spacing boundary box spacer */}
          <div style={{ height: '1.2rem' }} />
        </div>
      </div>
    );
  }
  // Active board placement or finalized gameplay preview
  const activeTileIndex = self?.assignedTileIndex;
  const activeTileLayout = activeTileIndex !== null && activeTileIndex !== undefined ? FIXED_TILES[activeTileIndex] : null;

  // Let's establish grid bounds for the board display.
  // The macro coordinates are dynamically updated based on placed tiles.
  // Let's scan placed coordinates and compute the bounding box.
  const placedList = Object.values(gameState.placedTiles);
  const xs = placedList.map(t => t.position.x);
  const ys = placedList.map(t => t.position.y);
  let minX: number;
  let maxX: number;
  let minY: number;
  let maxY: number;

  if (gameState.phase === 'PLACEMENT') {
    minX = xs.length > 0 ? Math.min(-1, ...xs) - 1 : -2;
    maxX = xs.length > 0 ? Math.max(1, ...xs) + 1 : 2;
    minY = ys.length > 0 ? Math.min(-1, ...ys) - 1 : -2;
    maxY = ys.length > 0 ? Math.max(1, ...ys) + 1 : 2;
  } else {
    minX = xs.length > 0 ? Math.min(...xs) : 0;
    maxX = xs.length > 0 ? Math.max(...xs) : 0;
    minY = ys.length > 0 ? Math.min(...ys) : 0;
    maxY = ys.length > 0 ? Math.max(...ys) : 0;
  }

  const macroGrid: { x: number; y: number }[] = [];
  for (let y = maxY; y >= minY; y--) {
    for (let x = minX; x <= maxX; x++) {
      macroGrid.push({ x, y });
    }
  }

  const cellWidth = gameState.phase === 'GAMEPLAY' ? 320 : 110;
  const subCellSize = cellWidth / 5;
  const tokenSize = Math.floor(subCellSize * 0.8);

  const getCellCoords = (tileX: number, tileY: number, r: number, c: number) => {
    const colIdx = tileX - minX;
    const rowIdx = tileY - minY;
    const x = 24 + colIdx * (cellWidth + 16) + c * subCellSize + subCellSize / 2;
    const y = 24 + rowIdx * (cellWidth + 16) + r * subCellSize + subCellSize / 2;
    return { x, y };
  };

  const getBorderCoords = (tileX: number, tileY: number, r: number, c: number, direction: 'H' | 'V') => {
    const colIdx = tileX - minX;
    const rowIdx = tileY - minY;
    const tileLeft = 24 + colIdx * (cellWidth + 16);
    const tileTop = 24 + rowIdx * (cellWidth + 16);
    if (direction === 'H') {
      return {
        x: tileLeft + c * subCellSize + subCellSize / 2,
        y: tileTop + (r + 1) * subCellSize
      };
    } else {
      return {
        x: tileLeft + (c + 1) * subCellSize,
        y: tileTop + r * subCellSize + subCellSize / 2
      };
    }
  };

  const isMobile = dimensions.width <= 768;
  const availableWidth = dimensions.width - (isMobile ? 0 : 320) - 80;
  const availableHeight = dimensions.height - (isMobile ? 300 : 0) - 80;

  const cols = maxX - minX + 1;
  const rows = maxY - minY + 1;
  const boardW = cols * cellWidth + (cols - 1) * 16 + 48;
  const boardH = rows * cellWidth + (rows - 1) * 16 + 48;

  const scaleX = availableWidth / boardW;
  const scaleY = availableHeight / boardH;
  const scaleFactor = Math.max(0.3, Math.min(1.5, scaleX, scaleY));

  // Validate if a coordinates placement is allowed
  const isPlacementValid = (x: number, y: number) => {
    if (!isActiveTurn || gameState.phase !== 'PLACEMENT') return false;
    const tileIndex = self?.assignedTileIndex;
    if (tileIndex === null || tileIndex === undefined) return false;
    return validateTilePlacement(x, y, tileIndex, socket?.id || '', gameState.placedTiles, gameState.turnOrder.length).valid;
  };

  return (
    <div className="app-layout">
      {/* Sidebar - Players & Game Phase Info */}
      <div className="sidebar">
        <div className="sidebar-section">
          <div>
            <h1 className="text-xl font-black text-[var(--accent-cyan)] m-0 tracking-wider">HOLLOWFALL</h1>
            <p className="text-gray-400 text-xs m-0">
              {gameState.phase === 'PLACEMENT' ? 'Tile Setup' : 'Gameplay Phase'}
            </p>
          </div>

          {gameState.phase === 'PLACEMENT' && activeTileLayout && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', backgroundColor: 'rgba(255,255,255,0.02)', padding: '16px', borderRadius: '12px', border: '1px solid #1a1f26' }}>
              <h3 className="text-xs font-bold text-gray-400 m-0 uppercase tracking-widest">Your Assigned Tile</h3>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <span className="text-sm font-bold text-white mb-2">{activeTileLayout.name}</span>
                {/* SVG Render of Tile layout */}
                <svg className="w-36 h-36 border border-gray-800 rounded bg-black" viewBox="0 0 100 100">
                  <g transform={`rotate(${rotation} 50 50)`}>
                    {renderTileSvgContent(activeTileLayout, self?.color || '#00E5FF')}
                  </g>
                </svg>
              </div>

              {isActiveTurn && (
                <button onClick={handleRotate} className="btn-secondary w-full text-xs py-2 flex items-center justify-center gap-2">
                  Rotate Tile (90° CW)
                </button>
              )}
            </div>
          )}

          {gameState.phase === 'GAMEPLAY' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '16px' }}>
              <div style={{ backgroundColor: 'rgba(0,230,118,0.05)', borderColor: 'var(--accent-green)', borderWidth: '1px', borderStyle: 'solid', padding: '12px', borderRadius: '12px', textAlign: 'center' }}>
                <h3 style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--accent-green)', margin: '0 0 2px 0' }}>MAZE READY</h3>
                <p style={{ fontSize: '11px', color: '#cbd5e1', margin: '0' }}>All 4 sectors aligned.</p>
              </div>


              {/* Active Player Actions */}
              {isActiveTurn && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px', marginBottom: '8px' }}>
                  {/* Pick Up Treasure Button */}
                  {(() => {
                    const sameCellTreasures = gameState.treasures && myTokenPos
                      ? Object.values(gameState.treasures).filter(
                          t => t.tileX === myTokenPos.tileX &&
                               t.tileY === myTokenPos.tileY &&
                               t.r === myTokenPos.r &&
                               t.c === myTokenPos.c &&
                               t.carrierId === null
                        )
                      : [];
                    if (sameCellTreasures.length > 0 && self && self.ap > 0) {
                      return sameCellTreasures.map(t => {
                        const owner = gameState.players[t.ownerId];
                        const label = owner
                          ? `📥 Pick Up ${owner.username}'s Mask`
                          : `📥 Pick Up Mask`;

                        // Check if it's player's own mask at default position
                        let isOwnDefault = false;
                        if (t.ownerId === socket?.id) {
                          const ownerTile = Object.values(gameState.placedTiles).find(tile => tile.placedBy === socket.id);
                          if (ownerTile) {
                            const isOwnerTile = t.tileX === ownerTile.position.x && t.tileY === ownerTile.position.y;
                            const isCorner = (t.r === 0 || t.r === 4) && (t.c === 0 || t.c === 4);
                            if (isOwnerTile && isCorner) {
                              isOwnDefault = true;
                            }
                          }
                        }

                        return (
                          <button
                            key={`pickup-${t.id}`}
                            disabled={isOwnDefault}
                            onClick={() => sendEvent({ event: 'PICKUP_TREASURE', payload: { treasureId: t.id } })}
                            className={isOwnDefault ? "btn-secondary" : "btn-primary"}
                            style={{
                              width: '100%',
                              backgroundColor: isOwnDefault ? 'rgba(255,255,255,0.02)' : 'var(--accent-gold)',
                              color: isOwnDefault ? '#64748b' : 'black',
                              fontWeight: 'bold',
                              fontSize: '13px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '6px',
                              opacity: isOwnDefault ? 0.5 : 1,
                              cursor: isOwnDefault ? 'not-allowed' : 'pointer'
                            }}
                          >
                            {label} {isOwnDefault ? '(Home)' : '(Ends Turn)'}
                          </button>
                        );
                      });
                    }
                    return null;
                  })()}

                  {/* Drop Treasure Button */}
                  {(() => {
                    const carriedTr = gameState.treasures
                      ? Object.values(gameState.treasures).find(t => t.carrierId === socket?.id)
                      : null;
                    if (carriedTr) {
                      return (
                        <button
                          onClick={() => sendEvent({ event: 'DROP_TREASURE', payload: { treasureId: carriedTr.id } })}
                          className="btn-secondary"
                          style={{
                            width: '100%',
                            borderColor: 'var(--accent-gold)',
                            color: 'var(--accent-gold)',
                            fontWeight: 'bold',
                            fontSize: '13px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '6px'
                          }}
                        >
                          📤 Drop Mask (Free Action)
                        </button>
                      );
                    }
                    return null;
                  })()}

                  {/* Lash Adjacent Walker Buttons */}
                  {(() => {
                    const lashable = gameState && myTokenPos && self && self.ap > 0 && !self.hasAttackedThisTurn && !self.isFirstTurnOfMatch
                      ? Object.values(gameState.players).filter(p => {
                          if (p.id === socket?.id || p.thread <= 0) return false;
                          const toPos = gameState.tokenPositions[p.id];
                          if (!toPos) return false;
                          
                          const dr = Math.abs(toPos.r - myTokenPos.r);
                          const dc = Math.abs(toPos.c - myTokenPos.c);
                          const dx = toPos.tileX - myTokenPos.tileX;
                          const dy = toPos.tileY - myTokenPos.tileY;
                          const dtX = Math.abs(dx);
                          const dtY = Math.abs(dy);

                          const isSameCell = dtX === 0 && dtY === 0 && dr === 0 && dc === 0;
                          const isAdjacent = (dtX <= 1 && dtY <= 1) && (
                            (dtX === 0 && dtY === 0 && dr <= 1 && dc <= 1) ||
                            (dx === 1 && dy === 0 && myTokenPos.r === 2 && myTokenPos.c === 4 && toPos.r === 2 && toPos.c === 0) ||
                            (dx === -1 && dy === 0 && myTokenPos.r === 2 && myTokenPos.c === 0 && toPos.r === 2 && toPos.c === 4) ||
                            (dx === 0 && dy === 1 && myTokenPos.r === 0 && myTokenPos.c === 2 && toPos.r === 4 && toPos.c === 2) ||
                            (dx === 0 && dy === -1 && myTokenPos.r === 4 && myTokenPos.c === 2 && toPos.r === 0 && toPos.c === 2)
                          );

                          if (!isSameCell && !isAdjacent) return false;
                          
                          return hasLineOfSight(myTokenPos, toPos, gameState.placedTiles, gameState.doorsState, gameState.wallsState);
                        })
                      : [];

                    return lashable.map(p => (
                      <button
                        key={`lash-${p.id}`}
                        onClick={() => sendEvent({ event: 'LASH_ATTACK', payload: { targetPlayerId: p.id } })}
                        className="btn-primary"
                        style={{
                          width: '100%',
                          backgroundColor: 'var(--accent-crimson)',
                          color: 'white',
                          fontWeight: 'bold',
                          fontSize: '13px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '6px'
                        }}
                      >
                        ⚔️ Lash {p.username} (-1 AP, 1 Dmg)
                      </button>
                    ));
                  })()}
                </div>
              )}

              {/* End Turn Button (only for active player) */}
              {isActiveTurn && (
                <button
                  onClick={handleEndTurn}
                  className="btn-primary"
                  style={{
                    width: '100%',
                    marginTop: '8px',
                    backgroundColor: 'var(--accent-cyan)',
                    fontWeight: 'bold',
                    fontSize: '13px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  End Turn ➔
                </button>
              )}

              {/* Reset / Exit Match Button */}
              <button
                onClick={handleResetGame}
                className="btn-secondary"
                style={{
                  width: '100%',
                  marginTop: '16px',
                  borderColor: 'rgba(239, 68, 68, 0.4)',
                  color: '#ef4444',
                  fontWeight: 'bold',
                  fontSize: '12px',
                  padding: '6px 0',
                }}
              >
                🚪 Quit to Lobby
              </button>
            </div>
          )}

          {/* Ritual Log / Game Feed */}
          {gameState && gameState.gameLogs && gameState.gameLogs.length > 0 && (
            <div
              style={{
                marginTop: '24px',
                borderTop: '1px solid var(--border-light)',
                paddingTop: '16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                textAlign: 'left'
              }}
            >
              <h3 className="text-xs font-bold text-gray-400 m-0 uppercase tracking-widest">Ritual Feed</h3>
              <div
                style={{
                  maxHeight: '160px',
                  overflowY: 'auto',
                  backgroundColor: 'rgba(0,0,0,0.2)',
                  borderRadius: '8px',
                  padding: '8px',
                  border: '1px solid rgba(255,255,255,0.03)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                  fontFamily: 'monospace',
                  fontSize: '11px',
                  color: '#94a3b8',
                  lineHeight: '1.4'
                }}
              >
                {gameState.gameLogs.map((log, idx) => (
                  <div key={`log-${idx}`} style={{ wordBreak: 'break-all' }}>
                    {log}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div style={{ marginTop: '24px', borderTop: '1px solid var(--border-light)', paddingTop: '16px', textAlign: 'center' }}>
          <span style={{ fontSize: '10px', color: '#64748b', fontFamily: 'monospace' }}>Room: {gameState.roomCode}</span>
        </div>
      </div>

      {/* Main Board Space */}
      <div
        className="main-content"
        style={{
          overflow: 'auto',
          paddingBottom: gameState.phase === 'GAMEPLAY' ? '220px' : '24px',
          boxSizing: 'border-box'
        }}
      >
        {/* Turn Indicator Overlay (Top Right) */}
        {gameState.turnOrder.length > 0 && (
          <div
            style={{
              position: 'absolute',
              top: '24px',
              right: '24px',
              zIndex: 40,
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              backgroundColor: 'rgba(15, 23, 42, 0.85)',
              backdropFilter: 'blur(8px)',
              border: '1px solid var(--border-light)',
              padding: '8px 12px',
              borderRadius: '12px',
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.4)'
            }}
          >
            {gameState.turnOrder.map((pId) => {
              const player = gameState.players[pId];
              const isActive = pId === activePlayerId;
              return (
                <div
                  key={pId}
                  onMouseEnter={() => setHoveredPlayerId(pId)}
                  onMouseLeave={() => setHoveredPlayerId(null)}
                  style={{
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 12px',
                    borderRadius: '8px',
                    border: isActive ? `2px solid ${player.color}` : '2px solid transparent',
                    boxShadow: isActive ? `0 0 10px ${player.color}44` : 'none',
                    backgroundColor: isActive ? 'rgba(255, 255, 255, 0.03)' : 'transparent',
                    transition: 'all 0.2s'
                  }}
                >
                  <span style={{ fontSize: '22px', lineHeight: '1' }}>{player.emoji}</span>
                  <span style={{ fontSize: '13px', fontWeight: 'bold', color: 'white' }}>
                    {player.username} {pId === socket?.id && '(You)'}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Hover Player Status Inspector Panel */}
        {hoveredPlayerId && (() => {
          const player = gameState.players[hoveredPlayerId];
          if (!player) return null;
          const apCount = player.ap || 0;
          const apIcons = '⚡'.repeat(apCount) + '⚪'.repeat(Math.max(0, 3 - apCount));
          const isMe = hoveredPlayerId === socket?.id;
          const isActive = hoveredPlayerId === activePlayerId;

          return (
            <div
              className="player-inspector-card"
              style={{
                position: 'absolute',
                top: '150px',
                right: '24px',
                zIndex: 45,
                backgroundColor: 'rgba(15, 23, 42, 0.95)',
                backdropFilter: 'blur(12px)',
                border: `2px solid ${player.color}`,
                boxShadow: `0 0 15px ${player.color}44`,
                padding: '14px',
                borderRadius: '16px',
                width: '180px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                textAlign: 'left'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '24px' }}>{player.emoji}</span>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 'bold', color: 'white' }}>
                      {player.username} {isMe && '(You)'}
                    </span>
                  </div>
                  <span style={{ fontSize: '10px', color: '#64748b' }}>
                    {isActive ? 'Active Turn' : 'Waiting...'}
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '11px', color: '#94a3b8' }}>🧵 Thread:</span>
                  <span style={{ fontSize: '11px', color: 'white', fontWeight: 'bold' }}>
                    {player.thread} / {player.maxThread}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '11px', color: '#94a3b8' }}>🏆 Score:</span>
                  <span style={{ fontSize: '11px', color: 'var(--accent-gold)', fontWeight: 'bold' }}>
                    {player.points} / 2 pts
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '11px', color: '#94a3b8' }}>⚡ Breath AP:</span>
                  <span style={{ fontSize: '11px', color: 'white', fontWeight: 'bold' }}>
                    {apIcons}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '11px', color: '#94a3b8' }}>⚔️ Attack:</span>
                  <span style={{ fontSize: '11px', color: player.hasAttackedThisTurn ? '#ef4444' : player.isFirstTurnOfMatch ? '#64748b' : 'var(--accent-green)', fontWeight: 'bold' }}>
                    {player.hasAttackedThisTurn ? 'Used' : player.isFirstTurnOfMatch ? 'Forbidden' : 'Ready'}
                  </span>
                </div>
                {/* Carrying status */}
                {(() => {
                  const carried = gameState.treasures ? Object.values(gameState.treasures).find(t => t.carrierId === hoveredPlayerId) : null;
                  if (carried) {
                    return (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '2px' }}>
                        <span style={{ fontSize: '11px', color: '#94a3b8' }}>💎 Carrying:</span>
                        <span style={{ fontSize: '11px', color: 'var(--accent-cyan)', fontWeight: 'bold' }}>
                          {carried.ownerId === hoveredPlayerId ? 'Own Mask' : "Rival's Mask"}
                        </span>
                      </div>
                    );
                  }
                  return null;
                })()}
              </div>
            </div>
          );
        })()}
        {error && (
          <div style={{ position: 'absolute', top: '24px', left: '24px', right: '24px', zIndex: 50, backgroundColor: 'rgba(255,23,68,0.9)', border: '1px solid var(--accent-crimson)', color: 'white', padding: '12px', borderRadius: '8px', fontSize: '14px', textAlign: 'center', boxShadow: '0 4px 20px rgba(0,0,0,0.5)' }}>
            {error}
          </div>
        )}

        {/* 2D Board Rendering */}
        <div
          className="board-container"
          style={{
            gridTemplateColumns: `repeat(${maxX - minX + 1}, ${cellWidth}px)`,
            transform: `scale(${scaleFactor})`,
            transformOrigin: 'center center',
            transition: 'transform 0.15s ease-out',
            marginBottom: '24px'
          }}
        >
          {macroGrid.map(({ x, y }) => {
            const key = `${x},${y}`;
            const tile = gameState.placedTiles[key];
            const isValid = isPlacementValid(x, y);
            const isHovered = hoverCoord?.x === x && hoverCoord?.y === y;

            return (
              <div
                key={key}
                onMouseEnter={() => setHoverCoord({ x, y })}
                onMouseLeave={() => setHoverCoord(null)}
                onClick={() => isValid && handlePlaceTile(x, y)}
                style={{
                  width: `${cellWidth}px`,
                  height: `${cellWidth}px`,
                  visibility: (!tile && gameState.phase === 'GAMEPLAY') ? 'hidden' : 'visible'
                }}
                className={`board-cell ${
                  tile ? 'placed-tile' :
                  isValid ? 'valid-placement' :
                  'disabled-cell'
                }`}
              >
                {tile ? (
                  // Placed Tile
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
                    <svg style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0, zIndex: 25, pointerEvents: 'none' }} viewBox="0 0 100 100">
                      <g transform={`rotate(${tile.rotation} 50 50)`}>
                        {renderTileSvgContent(
                          FIXED_TILES[tile.tileId - 1],
                          gameState.players[tile.placedBy]?.color || '#00E5FF',
                          { x, y },
                          gameState.doorsState,
                          tile.rotation,
                          handleInteractDoor,
                          myTokenPos,
                          isActiveTurn,
                          self?.ap,
                          gameState.placedTiles,
                          gameState.wallsState,
                          gameState.phase === 'GAMEPLAY'
                        )}
                      </g>
                    </svg>

                    {/* Render bridge connector East if tile to the right exists */}
                    {gameState.placedTiles[`${x + 1},${y}`] && (
                      <div
                        style={{
                          position: 'absolute',
                          left: `${cellWidth}px`,
                          top: `${subCellSize * 2}px`,
                          width: '16px',
                          height: `${subCellSize}px`,
                          backgroundColor: 'rgba(71, 85, 105, 0.15)',
                          borderTop: '2.5px solid #475569',
                          borderBottom: '2.5px solid #475569',
                          zIndex: 5,
                          pointerEvents: 'none'
                        }}
                      />
                    )}

                    {/* Render bridge connector South if tile below exists */}
                    {gameState.placedTiles[`${x},${y - 1}`] && (
                      <div
                        style={{
                          position: 'absolute',
                          left: `${subCellSize * 2}px`,
                          top: `${cellWidth}px`,
                          width: `${subCellSize}px`,
                          height: '16px',
                          backgroundColor: 'rgba(71, 85, 105, 0.15)',
                          borderLeft: '2.5px solid #475569',
                          borderRight: '2.5px solid #475569',
                          zIndex: 5,
                          pointerEvents: 'none'
                        }}
                      />
                    )}
                    {/* Interactive overlay cells for token movement */}
                    {gameState.phase === 'GAMEPLAY' && (
                      <div
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          right: 0,
                          bottom: 0,
                          display: 'grid',
                          gridTemplateColumns: 'repeat(5, 1fr)',
                          gridTemplateRows: 'repeat(5, 1fr)',
                          zIndex: 20,
                          pointerEvents: 'none'
                        }}>
                        {Array.from({ length: 25 }).map((_, idx) => {
                          const r = Math.floor(idx / 5);
                          const c = idx % 5;
                          const targetPos = { tileX: x, tileY: y, r, c };

                          // Check if this cell contains a lashable player
                           const lashablePlayer = !targetingCardId && gameState && myTokenPos && self && isActiveTurn && self.ap > 0 && !self.hasAttackedThisTurn && !self.isFirstTurnOfMatch
                             ? Object.values(gameState.players).find(p => {
                                 if (p.id === socket?.id || p.thread <= 0) return false;
                                 const toPos = gameState.tokenPositions[p.id];
                                 if (!toPos) return false;
                                 if (toPos.tileX !== x || toPos.tileY !== y || toPos.r !== r || toPos.c !== c) return false;

                                 const dr = Math.abs(toPos.r - myTokenPos.r);
                                 const dc = Math.abs(toPos.c - myTokenPos.c);
                                 const dx = toPos.tileX - myTokenPos.tileX;
                                 const dy = toPos.tileY - myTokenPos.tileY;
                                 const dtX = Math.abs(dx);
                                 const dtY = Math.abs(dy);

                                 const isSameCell = dtX === 0 && dtY === 0 && dr === 0 && dc === 0;
                                 const isAdjacent = (dtX <= 1 && dtY <= 1) && (
                                   (dtX === 0 && dtY === 0 && dr <= 1 && dc <= 1) ||
                                   (dx === 1 && dy === 0 && myTokenPos.r === 2 && myTokenPos.c === 4 && toPos.r === 2 && toPos.c === 0) ||
                                   (dx === -1 && dy === 0 && myTokenPos.r === 2 && myTokenPos.c === 0 && toPos.r === 2 && toPos.c === 4) ||
                                   (dx === 0 && dy === 1 && myTokenPos.r === 0 && myTokenPos.c === 2 && toPos.r === 4 && toPos.c === 2) ||
                                   (dx === 0 && dy === -1 && myTokenPos.r === 4 && myTokenPos.c === 2 && toPos.r === 0 && toPos.c === 2)
                                 );

                                 if (!isSameCell && !isAdjacent) return false;
                                 
                                 return hasLineOfSight(myTokenPos, toPos, gameState.placedTiles, gameState.doorsState, gameState.wallsState);
                               })
                             : null;

                          // 1. Regular token movement highlight
                          const isValidMove = !targetingCardId && !lashablePlayer && myTokenPos && isActiveTurn && self && self.ap > 0 && validateTokenMove(
                            myTokenPos,
                            targetPos,
                            gameState.placedTiles,
                            gameState.doorsState,
                            gameState.wallsState,
                            gameState.tokenPositions
                          ).valid;

                          // 2. Kindle the Storm targeting
                          let isKindleTarget = false;
                          if (targetingCardId === 'ash_kindle_storm' && isActiveTurn) {
                            const occupiedPlayerId = Object.keys(gameState.tokenPositions).find(pId => {
                              const pos = gameState.tokenPositions[pId];
                              return pos.tileX === x && pos.tileY === y && pos.r === r && pos.c === c;
                            });
                            isKindleTarget = !!occupiedPlayerId && occupiedPlayerId !== socket?.id;
                          }

                          // 3. Miststep targeting
                          let isMiststepTarget = false;
                          if (targetingCardId === 'working_miststep' && isActiveTurn && myTokenPos) {
                            const globalR_from = myTokenPos.tileY * 5 + myTokenPos.r;
                            const globalC_from = myTokenPos.tileX * 5 + myTokenPos.c;
                            const globalR_to = y * 5 + r;
                            const globalC_to = x * 5 + c;
                            const dist = Math.abs(globalR_from - globalR_to) + Math.abs(globalC_from - globalC_to);
                            const isOccupied = Object.values(gameState.tokenPositions).some(pos => {
                              return pos.tileX === x && pos.tileY === y && pos.r === r && pos.c === c;
                            });
                            isMiststepTarget = dist <= 3 && !isOccupied;
                          }

                          // 4. Raise Stone cell detection (player's current cell)
                          const isRaiseStoneCell = targetingCardId === 'working_raise_stone' && isActiveTurn && myTokenPos && myTokenPos.tileX === x && myTokenPos.tileY === y && myTokenPos.r === r && myTokenPos.c === c;

                          return (
                            <div
                              key={`cell-overlay-${r}-${c}`}
                              onClick={(e) => {
                                if (lashablePlayer) {
                                  e.stopPropagation();
                                  sendEvent({ event: 'LASH_ATTACK', payload: { targetPlayerId: lashablePlayer.id } });
                                } else if (isValidMove) {
                                  e.stopPropagation();
                                  handleMoveToken(targetPos);
                                } else if (isKindleTarget) {
                                  e.stopPropagation();
                                  handlePlayCard('ash_kindle_storm', targetPos);
                                } else if (isMiststepTarget) {
                                  e.stopPropagation();
                                  handlePlayCard('working_miststep', targetPos);
                                }
                              }}
                              style={{
                                position: 'relative',
                                cursor: (isValidMove || lashablePlayer || isKindleTarget || isMiststepTarget) ? 'pointer' : 'default',
                                pointerEvents: (isValidMove || lashablePlayer || isKindleTarget || isMiststepTarget || isRaiseStoneCell) ? 'auto' : 'none',
                                border: lashablePlayer
                                  ? '2px solid var(--accent-crimson)'
                                  : isValidMove
                                  ? '1.5px dashed var(--accent-green)'
                                  : isKindleTarget
                                  ? '2px solid var(--accent-crimson)'
                                  : isMiststepTarget
                                  ? '1.5px dashed var(--accent-cyan)'
                                  : 'none',
                                backgroundColor: lashablePlayer
                                  ? 'rgba(239, 68, 68, 0.15)'
                                  : isValidMove
                                  ? 'rgba(0, 230, 118, 0.1)'
                                  : isKindleTarget
                                  ? 'rgba(255, 23, 68, 0.15)'
                                  : isMiststepTarget
                                  ? 'rgba(0, 229, 255, 0.1)'
                                  : 'transparent',
                                borderRadius: '4px',
                                transition: 'all 0.15s ease'
                              }}
                              title={
                                isValidMove
                                  ? 'Move here'
                                  : isKindleTarget
                                  ? 'Target with Kindle the Storm'
                                  : isMiststepTarget
                                  ? 'Teleport here'
                                  : ''
                              }
                            >
                              {/* Edge-zone selectors for Raise Stone */}
                              {isRaiseStoneCell && (
                                <>
                                  {r > 0 && (
                                    <div
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handlePlayCard('working_raise_stone', { tileX: x, tileY: y, r: r - 1, c, direction: 'H' });
                                      }}
                                      style={{ position: 'absolute', top: 0, left: '6px', right: '6px', height: '6px', backgroundColor: '#FF6D00', cursor: 'pointer', borderRadius: '2px', boxShadow: '0 0 5px #FF6D00', zIndex: 10 }}
                                      title="Raise North wall"
                                    />
                                  )}
                                  {r < 4 && (
                                    <div
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handlePlayCard('working_raise_stone', { tileX: x, tileY: y, r, c, direction: 'H' });
                                      }}
                                      style={{ position: 'absolute', bottom: 0, left: '6px', right: '6px', height: '6px', backgroundColor: '#FF6D00', cursor: 'pointer', borderRadius: '2px', boxShadow: '0 0 5px #FF6D00', zIndex: 10 }}
                                      title="Raise South wall"
                                    />
                                  )}
                                  {c > 0 && (
                                    <div
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handlePlayCard('working_raise_stone', { tileX: x, tileY: y, r, c: c - 1, direction: 'V' });
                                      }}
                                      style={{ position: 'absolute', left: 0, top: '6px', bottom: '6px', width: '6px', backgroundColor: '#FF6D00', cursor: 'pointer', borderRadius: '2px', boxShadow: '0 0 5px #FF6D00', zIndex: 10 }}
                                      title="Raise West wall"
                                    />
                                  )}
                                  {c < 4 && (
                                    <div
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handlePlayCard('working_raise_stone', { tileX: x, tileY: y, r, c, direction: 'V' });
                                      }}
                                      style={{ position: 'absolute', right: 0, top: '6px', bottom: '6px', width: '6px', backgroundColor: '#FF6D00', cursor: 'pointer', borderRadius: '2px', boxShadow: '0 0 5px #FF6D00', zIndex: 10 }}
                                      title="Raise East wall"
                                    />
                                  )}
                                </>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {/* Render dynamic uncarried treasures */}
                    {gameState.treasures && Object.values(gameState.treasures).map((tr) => {
                      if (tr.tileX === x && tr.tileY === y && tr.carrierId === null) {
                        return (
                          <div
                            key={tr.id}
                            style={{
                              position: 'absolute',
                              left: `${tr.c * subCellSize}px`,
                              top: `${tr.r * subCellSize}px`,
                              width: `${subCellSize}px`,
                              height: `${subCellSize}px`,
                              fontSize: `${Math.floor(tokenSize * 0.5)}px`,
                              lineHeight: `${subCellSize}px`,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              zIndex: 27,
                              pointerEvents: 'none',
                              userSelect: 'none'
                            }}
                          >
                            💎
                          </div>
                        );
                      }
                      return null;
                    })}

                    {/* Render spawn Token (in gameplay phase) */}
                    {Object.entries(gameState.tokenPositions).map(([pId, pos]) => {
                      if (pos.tileX === x && pos.tileY === y) {
                        const player = gameState.players[pId];
                        const isCarrying = gameState.treasures && Object.values(gameState.treasures).some(t => t.carrierId === pId);
                        return (
                          <div
                            key={pId}
                            onMouseEnter={() => setHoveredPlayerId(pId)}
                            onMouseLeave={() => setHoveredPlayerId(null)}
                            style={{
                              position: 'absolute',
                              left: `${pos.c * subCellSize}px`,
                              top: `${pos.r * subCellSize}px`,
                              width: `${subCellSize}px`,
                              height: `${subCellSize}px`,
                              fontSize: `${tokenSize}px`,
                              lineHeight: `${subCellSize}px`,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              filter: `drop-shadow(0 0 6px ${player?.color})`,
                              zIndex: 30,
                              pointerEvents: 'auto',
                              cursor: 'pointer'
                            }}
                            className="floating-emoji"
                          >
                            {player?.emoji}
                            {isCarrying && (
                              <span style={{ fontSize: '10px', position: 'absolute', bottom: '-4px', right: '-4px', filter: 'drop-shadow(0 0 2px #00E5FF)' }}>
                                💎
                              </span>
                            )}
                          </div>
                        );
                      }
                      return null;
                    })}
                  </div>
                ) : isHovered && isValid && activeTileLayout ? (
                  // Placement Preview Hover
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0.6 }}>
                    <svg style={{ width: '100%', height: '100%' }} viewBox="0 0 100 100">
                      <g transform={`rotate(${rotation} 50 50)`}>
                        {renderTileSvgContent(activeTileLayout, self?.color || '#00E5FF')}
                      </g>
                    </svg>
                  </div>
                ) : (
                  // Coordinate display for empty grid cells
                  <span className="board-cell-coords">{x}, {y}</span>
                )}
              </div>
            );
          })}

          {/* Spell Animations Overlay */}
          {activeAnimation && (() => {
            const pFrom = getCellCoords(activeAnimation.from.tileX, activeAnimation.from.tileY, activeAnimation.from.r, activeAnimation.from.c);
            let pTo = activeAnimation.to ? getCellCoords(activeAnimation.to.tileX, activeAnimation.to.tileY, activeAnimation.to.r, activeAnimation.to.c) : null;
            if (activeAnimation.cardId === 'working_raise_stone' && activeAnimation.to && activeAnimation.to.direction) {
              pTo = getBorderCoords(activeAnimation.to.tileX, activeAnimation.to.tileY, activeAnimation.to.r, activeAnimation.to.c, activeAnimation.to.direction);
            }

            return (
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  pointerEvents: 'none',
                  zIndex: 100,
                  gridColumn: '1 / -1',
                  gridRow: '1 / -1'
                }}
              >
                {activeAnimation.cardId === 'ash_kindle_storm' && pTo && (
                  <div
                    className="kindle-spell-effect"
                    style={{
                      '--from-x': `${pFrom.x}px`,
                      '--from-y': `${pFrom.y}px`,
                      '--to-x': `${pTo.x}px`,
                      '--to-y': `${pTo.y}px`
                    } as React.CSSProperties}
                  >
                    <div className="caster-glow" style={{ left: pFrom.x, top: pFrom.y }} />
                    <div className="kindle-projectile" />
                    <div className="kindle-explosion" style={{ left: pTo.x, top: pTo.y }} />
                    {activeAnimation.countered && (
                      <div className="shield-effect" style={{ left: pTo.x, top: pTo.y }} />
                    )}
                  </div>
                )}

                {activeAnimation.cardId === 'working_miststep' && pTo && (
                  <div className="miststep-effect">
                    <div className="miststep-fadeout" style={{ left: pFrom.x, top: pFrom.y }} />
                    <div className="miststep-fadein" style={{ left: pTo.x, top: pTo.y }} />
                  </div>
                )}

                {activeAnimation.cardId === 'working_raise_stone' && pTo && (
                  <div className="raise-stone-effect" style={{ left: pTo.x, top: pTo.y }} />
                )}

                {activeAnimation.cardId === 'talisman_bear_charm' && (
                  <div className="bear-charm-effect" style={{ left: pFrom.x, top: pFrom.y }} />
                )}

                {activeAnimation.cardId === 'working_don_wolf' && (
                  <div className="don-wolf-effect" style={{ left: pFrom.x, top: pFrom.y }}>
                    🐺
                  </div>
                )}

                {activeAnimation.cardId === 'offering_deep_breath' && (
                  <div className="deep-breath-effect" style={{ left: pFrom.x, top: pFrom.y }} />
                )}

                {/* Floating Card Announcement */}
                {(() => {
                  const card = BASIC_CARDS.find(c => c.id === activeAnimation.cardId);
                  const caster = gameState?.players[activeAnimation.casterId];
                  if (!card || !caster) return null;

                  const typeColors = {
                    bane: 'var(--accent-crimson)',
                    ward: 'var(--accent-gold)',
                    working: 'var(--accent-cyan)',
                    talisman: 'var(--accent-green)',
                    offering: '#FFAB40'
                  };
                  const color = typeColors[card.type] || '#FFFFFF';

                  return (
                    <div
                      style={{
                        position: 'absolute',
                        top: '50%',
                        left: '50%',
                        transform: 'translate(-50%, -50%)',
                        zIndex: 150,
                        pointerEvents: 'none',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '12px',
                        animation: 'floatingCardReveal 2.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards'
                      }}
                    >
                      <div style={{
                        fontSize: '14px',
                        fontWeight: 'bold',
                        color: '#E2E8F0',
                        textShadow: '0 2px 4px rgba(0,0,0,0.8)',
                        backgroundColor: 'rgba(15, 23, 42, 0.8)',
                        padding: '4px 12px',
                        borderRadius: '12px',
                        border: '1px solid rgba(255,255,255,0.05)',
                        backdropFilter: 'blur(4px)'
                      }}>
                        {caster.username} plays:
                      </div>
                      <div
                        style={{
                          width: '160px',
                          height: '240px',
                          backgroundColor: 'rgba(15, 23, 42, 0.95)',
                          border: `2px solid ${color}`,
                          borderRadius: '16px',
                          boxShadow: `0 0 25px ${color}`,
                          padding: '16px',
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'space-between',
                          backdropFilter: 'blur(12px)',
                          position: 'relative',
                          overflow: 'hidden'
                        }}
                      >
                        <div style={{
                          position: 'absolute',
                          top: '-10px',
                          right: '-10px',
                          width: '40px',
                          height: '40px',
                          background: color,
                          transform: 'rotate(45deg)',
                          opacity: 0.15
                        }} />

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <div style={{
                            fontSize: '11px',
                            textTransform: 'uppercase',
                            letterSpacing: '2px',
                            color: color,
                            fontWeight: 'bold'
                          }}>
                            {card.type}
                          </div>
                          <div style={{
                            fontSize: '16px',
                            fontWeight: 'bold',
                            color: 'white',
                            lineHeight: '1.2'
                          }}>
                            {card.name}
                          </div>
                        </div>

                        <div style={{
                          fontSize: '12px',
                          color: '#94a3b8',
                          lineHeight: '1.4',
                          marginBottom: '16px'
                        }}>
                          {card.description}
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            );
          })()}
        </div>
      </div>

      {/* Card Hand / Inventory HUD */}
      {gameState.phase === 'GAMEPLAY' && self && (
        <div
          style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            height: '210px',
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            backdropFilter: 'blur(12px)',
            borderTop: '2px solid var(--border-light)',
            padding: '12px 24px',
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            zIndex: 100,
            boxShadow: '0 -10px 30px rgba(0,0,0,0.5)',
            boxSizing: 'border-box'
          }}
        >
          {/* Left Summary label */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', zIndex: 125, minWidth: '100px' }}>
            <span style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--accent-cyan)', textTransform: 'uppercase', letterSpacing: '1px' }}>
              Your Hand
            </span>
            <span style={{ fontSize: '11px', color: '#94a3b8' }}>
              ({self.hand.length}/7 Rites)
            </span>
            {targetingCardId && (
              <span style={{ fontSize: '10px', color: 'var(--accent-crimson)', animation: 'pulse 1.5s infinite', fontWeight: 'bold', marginTop: '4px' }}>
                🎯 Target Needed
              </span>
            )}
          </div>

          {/* Cards List (Centered horizontally, fully formed) */}
          <div
            style={{
              display: 'flex',
              gap: '16px',
              overflowX: 'auto',
              pointerEvents: 'auto',
              flexGrow: 1,
              justifyContent: 'center',
              alignItems: 'center',
              padding: '0 24px'
            }}
          >
            {self.hand.map((card) => {
              const isSelected = selectedCardId === card.id;
              const isHovered = hoveredCardId === card.id;

              const isBane = card.type === 'bane';
              const isWard = card.type === 'ward';
              const isWorking = card.type === 'working';
              const isOffering = card.type === 'offering';

              const typeColor = isBane
                ? '#ff1744'
                : isWard
                ? '#ffd600'
                : isWorking
                ? '#00e5ff'
                : (isOffering || card.type === 'talisman')
                ? '#00e676'
                : '#94a3b8';

              const canCast = isActiveTurn && self.ap > 0 && !isWard;

              return (
                <div
                  key={card.id}
                  onMouseEnter={() => setHoveredCardId(card.id)}
                  onMouseLeave={() => setHoveredCardId(null)}
                  onClick={() => {
                    if (!canCast) return;
                    const noTargetNeeded = card.id === 'talisman_bear_charm' || card.id === 'working_don_wolf' || card.id === 'offering_deep_breath';
                    if (isSelected) {
                      if (noTargetNeeded) {
                        handlePlayCard(card.id);
                        setSelectedCardId(null);
                      } else {
                        setTargetingCardId(null);
                        setSelectedCardId(null);
                      }
                    } else {
                      setSelectedCardId(card.id);
                      if (!noTargetNeeded) {
                        setTargetingCardId(card.id);
                      } else {
                        setTargetingCardId(null);
                      }
                    }
                  }}
                  style={{
                    width: '110px',
                    height: '165px',
                    minWidth: '110px',
                    maxWidth: '110px',
                    minHeight: '165px',
                    maxHeight: '165px',
                    flexShrink: 0,
                    backgroundColor: 'rgba(15, 23, 42, 0.98)',
                    border: isSelected 
                      ? '2px solid var(--accent-cyan)' 
                      : isHovered 
                      ? `2px solid ${typeColor}` 
                      : `1px solid ${typeColor}66`,
                    borderRadius: '12px',
                    boxShadow: isSelected 
                      ? `0 0 20px var(--accent-cyan)` 
                      : isHovered 
                      ? `0 0 12px ${typeColor}` 
                      : `0 0 6px ${typeColor}22`,
                    padding: '10px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    cursor: canCast ? 'pointer' : 'not-allowed',
                    transition: 'all 0.15s ease-out',
                    boxSizing: 'border-box',
                    position: 'relative',
                    opacity: (targetingCardId && !isSelected) ? 0.5 : 1
                  }}
                >
                  {/* Circular AP Cost Indicator */}
                  {!isOffering && (
                    <div style={{
                      position: 'absolute',
                      top: '-6px',
                      left: '-6px',
                      width: '16px',
                      height: '16px',
                      borderRadius: '50%',
                      backgroundColor: 'var(--accent-cyan)',
                      color: 'black',
                      fontSize: '9px',
                      fontWeight: 'bold',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      boxShadow: '0 0 4px var(--accent-cyan)',
                      zIndex: 10
                    }}>
                      1
                    </div>
                  )}

                  {/* Corner Accent */}
                  <div style={{
                    position: 'absolute',
                    top: '-6px',
                    right: '-6px',
                    width: '20px',
                    height: '20px',
                    background: typeColor,
                    transform: 'rotate(45deg)',
                    opacity: 0.15,
                    pointerEvents: 'none'
                  }} />

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    <span style={{ fontSize: '8px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '1px', color: typeColor }}>
                      {card.type}
                    </span>
                    <span style={{ fontSize: '10px', fontWeight: 'bold', color: 'white', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {card.name}
                    </span>
                  </div>

                  {/* Description */}
                  <div style={{
                    fontSize: '9px',
                    color: '#94a3b8',
                    lineHeight: '1.25',
                    opacity: 1,
                    flexGrow: 1,
                    display: 'flex',
                    alignItems: 'center',
                    marginTop: '4px'
                  }}>
                    {card.description}
                  </div>

                  {/* CTA Label */}
                  <div style={{
                    fontSize: '8px',
                    fontWeight: 'bold',
                    color: isSelected ? 'var(--accent-cyan)' : '#64748b',
                    textAlign: 'center',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    opacity: 1,
                    marginTop: '2px'
                  }}>
                    {isWard
                      ? '🛡️ Defense'
                      : isSelected 
                      ? (card.id === 'talisman_bear_charm' || card.id === 'working_don_wolf' || card.id === 'offering_deep_breath'
                        ? '➔ Click to Cast' 
                        : '🎯 Target board') 
                      : '⚡ Cast Rite'}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Right helper buttons / controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', zIndex: 125, minWidth: '100px', justifyContent: 'flex-end' }}>
            {targetingCardId && (
              <button
                onClick={() => {
                  setTargetingCardId(null);
                  setSelectedCardId(null);
                }}
                className="btn-secondary"
                style={{ padding: '4px 10px', fontSize: '11px', color: 'var(--accent-crimson)', borderColor: 'var(--accent-crimson)' }}
              >
                Cancel Target
              </button>
            )}
          </div>
        </div>
      )}

      {/* Game Over Modal */}
      {gameState.phase === 'GAME_OVER' && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(3, 4, 5, 0.95)',
            backdropFilter: 'blur(10px)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
          }}
        >
          {/* Confetti particles */}
          {Array.from({ length: 40 }).map((_, i) => {
            const left = Math.random() * 100;
            const delay = Math.random() * 4;
            const size = Math.random() * 8 + 6;
            const colors = ['#ffd700', '#ffb700', '#ffdf00', '#ffe853', '#d4af37'];
            const bg = colors[Math.floor(Math.random() * colors.length)];
            return (
              <div
                key={`confetti-${i}`}
                className="confetti-particle"
                style={{
                  left: `${left}%`,
                  width: `${size}px`,
                  height: `${size}px`,
                  backgroundColor: bg,
                  boxShadow: `0 0 8px ${bg}aa`,
                  animationDelay: `${delay}s`,
                }}
              />
            );
          })}

          <div
            className="victory-panel"
            style={{
              textAlign: 'center',
              padding: '40px',
              borderRadius: '24px',
              border: '2px solid var(--accent-gold)',
              backgroundColor: 'rgba(15, 23, 42, 0.9)',
              backdropFilter: 'blur(16px)',
              boxShadow: '0 0 40px rgba(255, 214, 0, 0.25)',
              maxWidth: '480px',
              width: '90%',
              position: 'relative',
              boxSizing: 'border-box'
            }}
          >
            {/* Victory radial glow behind winner */}
            <div className="victory-glow" />

            <span style={{ fontSize: '56px', display: 'block', marginBottom: '16px', filter: 'drop-shadow(0 0 12px var(--accent-gold))' }}>🏆</span>
            <h2 style={{ color: 'var(--accent-gold)', fontSize: '32px', fontWeight: '900', margin: '0 0 8px 0', letterSpacing: '3px', textTransform: 'uppercase', textShadow: '0 0 10px rgba(255,214,0,0.3)' }}>MATCH COMPLETE</h2>
            
            {(() => {
              const winner = Object.values(gameState.players).find(p => p.points >= 2);
              if (winner) {
                return (
                  <div style={{ margin: '24px 0' }}>
                    <span style={{ fontSize: '64px', display: 'block', margin: '8px 0', filter: 'drop-shadow(0 0 10px rgba(255,255,255,0.4))' }}>{winner.emoji}</span>
                    <h3 style={{ fontSize: '24px', color: 'white', margin: '0', fontWeight: 'bold' }}>{winner.username} Wins!</h3>
                    <p style={{ fontSize: '13px', color: '#94a3b8', marginTop: '6px' }}>Successfully reached 2 victory points!</p>
                  </div>
                );
              }
              return <p style={{ color: 'white', margin: '24px 0' }}>A legendary battle has ended!</p>;
            })()}

            {/* Match Statistics Table */}
            <div style={{ margin: '24px 0', border: '1px solid var(--border-light)', borderRadius: '12px', padding: '16px', backgroundColor: 'rgba(255,255,255,0.02)', textAlign: 'left' }}>
              <h4 style={{ color: 'var(--accent-cyan)', fontSize: '14px', margin: '0 0 12px 0', letterSpacing: '1px', textTransform: 'uppercase', fontWeight: 'bold' }}>Match Summary</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px', gap: '8px', fontSize: '12px', color: '#94a3b8', borderBottom: '1px solid var(--border-light)', paddingBottom: '6px', marginBottom: '6px', fontWeight: 'bold' }}>
                <span>Player</span>
                <span style={{ textAlign: 'center' }}>Kills</span>
                <span style={{ textAlign: 'center' }}>Points</span>
              </div>
              {Object.values(gameState.players).map(p => (
                <div key={p.id} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px', gap: '8px', fontSize: '13px', color: 'white', padding: '4px 0' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>{p.emoji}</span>
                    <span style={{ fontWeight: p.points >= 2 ? 'bold' : 'normal', color: p.points >= 2 ? 'var(--accent-gold)' : 'white' }}>{p.username}</span>
                  </span>
                  <span style={{ textAlign: 'center' }}>{p.severPoints || 0}</span>
                  <span style={{ textAlign: 'center', fontWeight: 'bold', color: 'var(--accent-gold)' }}>{p.points} / 2</span>
                </div>
              ))}
            </div>

            <button
              onClick={handleResetGame}
              className="btn-primary"
              style={{
                width: '100%',
                marginTop: '16px',
                backgroundColor: 'var(--accent-gold)',
                color: 'black',
                fontWeight: 'bold',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px'
              }}
            >
              🚪 Quit to Lobby
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
