import React, { useState, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import { GameState, ClientMessage, ServerMessage } from './shared/types.ts';
import { FIXED_TILES, TileLayout, HEROES } from './shared/constants.ts';
import { validateTilePlacement, validateTokenMove, validateDoorInteract, rotateBorderCoordinate } from './shared/validation.ts';

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
  wallsState?: Record<string, boolean>
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
        points="50,36 54,46 64,46 56,52 60,62 50,56 40,62 44,52 36,46 46,46"
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
      {/* Treasure Spawns at corners (0,0) and (4,4) */}
      <g transform={`rotate(${-rot} 10 10)`}>
        <text x="10" y="11" fontSize="7" textAnchor="middle" dominantBaseline="middle" style={{ userSelect: 'none' }}>💎</text>
      </g>
      <g transform={`rotate(${-rot} 90 90)`}>
        <text x="90" y="91" fontSize="7" textAnchor="middle" dominantBaseline="middle" style={{ userSelect: 'none' }}>💎</text>
      </g>
    </>
  );
};

export default function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [targetingCardId, setTargetingCardId] = useState<string | null>(null);

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
  };

  const handleResetGame = () => {
    sendEvent({ event: 'RESET_GAME' });
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
        <form
          onSubmit={handleJoin}
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
                width: '100%'
              }}
            >
              {error}
            </div>
          )}

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

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', alignItems: 'center' }}>
            <label className="text-sm font-semibold text-gray-300">Room Code</label>
            <input
              type="text"
              value={roomCode}
              onChange={e => setRoomCode(e.target.value)}
              placeholder="e.g. THRESH"
              className="input-field text-center"
              style={{ width: '100%', textAlign: 'center' }}
              maxLength={6}
            />
          </div>

          <button
            type="submit"
            className="btn-primary"
            style={{
              width: '100%',
              marginTop: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center'
            }}
          >
            Connect to Lobby
          </button>
        </form>
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
            <h2 className="text-2xl font-bold text-[var(--accent-cyan)] m-0">Lobby Room: {gameState.roomCode}</h2>
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
                      <span className="font-semibold text-white" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '26px', lineHeight: '1' }}>{player.emoji}</span>
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
                      gridTemplateColumns: 'repeat(5, 42px)',
                      gap: '6px',
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
                            fontSize: '24px',
                            width: '42px',
                            height: '42px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            border: isSelected
                              ? `2.5px solid ${hero.color}`
                              : isTaken
                              ? '1px dashed #334155'
                              : '1px solid var(--border-light)',
                            borderRadius: '8px',
                            backgroundColor: isSelected
                              ? `${hero.color}22`
                              : 'rgba(0, 0, 0, 0.2)',
                            cursor: isTaken ? 'not-allowed' : 'pointer',
                            opacity: isTaken ? 0.25 : 1,
                            transition: 'all 0.2s',
                            boxShadow: isSelected ? `0 0 10px ${hero.color}` : 'none'
                          }}
                          className={isTaken ? '' : 'hover:scale-110'}
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
  const minX = Math.min(-1, ...xs) - 1;
  const maxX = Math.max(1, ...xs) + 1;
  const minY = Math.min(-1, ...ys) - 1;
  const maxY = Math.max(1, ...ys) + 1;

  const macroGrid: { x: number; y: number }[] = [];
  for (let y = maxY; y >= minY; y--) {
    for (let x = minX; x <= maxX; x++) {
      macroGrid.push({ x, y });
    }
  }

  const cellWidth = gameState.phase === 'GAMEPLAY' ? 320 : 110;
  const subCellSize = cellWidth / 5;
  const tokenSize = Math.floor(subCellSize * 0.8);

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

              {/* Character HUD List */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <h3 className="text-xs font-bold text-gray-400 m-0 uppercase tracking-widest">Player Status</h3>
                {gameState.turnOrder.map((pId) => {
                  const player = gameState.players[pId];
                  const isActive = pId === activePlayerId;
                  const isMe = pId === socket?.id;
                  
                  // Render Action Points as Emoji Lightning bolts
                  const apCount = player.ap || 0;
                  const apIcons = '⚡'.repeat(apCount) + '⚪'.repeat(Math.max(0, 3 - apCount));

                  return (
                    <div
                      key={pId}
                      style={{
                        backgroundColor: 'rgba(255, 255, 255, 0.02)',
                        border: isActive ? `2px solid ${player.color}` : '1px solid #1a1f26',
                        borderRadius: '12px',
                        padding: '12px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px',
                        boxShadow: isActive ? `0 0 12px ${player.color}33` : 'none',
                        transition: 'all 0.2s'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '24px' }}>{player.emoji}</span>
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ fontSize: '13px', fontWeight: 'bold', color: 'white' }}>
                                {player.username} {isMe && '(You)'}
                              </span>
                              {player.form === 'wolf' && (
                                <span style={{ fontSize: '10px', color: 'var(--accent-cyan)' }} title="Wolf Form: Moves cost 0 AP!">🐺 Wolf</span>
                              )}
                            </div>
                            <span style={{ fontSize: '10px', color: '#64748b' }}>
                              {isActive ? 'Active Turn' : 'Waiting...'}
                            </span>
                          </div>
                        </div>
                        {isActive && (
                          <span style={{ fontSize: '12px', color: player.color, fontWeight: 'bold' }}>
                            ACTIVE
                          </span>
                        )}
                      </div>

                      {/* Vitals indicators */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '8px', marginTop: '4px' }}>
                        {/* Health (Thread) */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: '11px', color: '#94a3b8' }}>🧵 Thread:</span>
                          <span style={{ fontSize: '11px', color: 'white', fontWeight: 'bold' }}>
                            {player.thread} / {player.maxThread}
                          </span>
                        </div>
                        {/* Score */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: '11px', color: '#94a3b8' }}>🏆 Score:</span>
                          <span style={{ fontSize: '11px', color: 'var(--accent-gold)', fontWeight: 'bold' }}>
                            {player.points} / 2 pts
                          </span>
                        </div>
                        {/* AP Actions */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '2px' }}>
                          <span style={{ fontSize: '11px', color: '#94a3b8' }}>Actions:</span>
                          <span style={{ fontSize: '13px', letterSpacing: '2px' }}>{apIcons}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

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
            </div>
          )}
        </div>

        <div style={{ marginTop: '24px', borderTop: '1px solid var(--border-light)', paddingTop: '16px', textAlign: 'center' }}>
          <span style={{ fontSize: '10px', color: '#64748b', fontFamily: 'monospace' }}>Room: {gameState.roomCode}</span>
        </div>
      </div>

      {/* Main Board Space */}
      <div className="main-content" style={{ overflow: 'hidden' }}>
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
                  style={{
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
                    <svg style={{ width: '100%', height: '100%' }} viewBox="0 0 100 100">
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
                          gameState.wallsState
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

                          // 1. Regular token movement highlight
                          const isValidMove = !targetingCardId && myTokenPos && isActiveTurn && self && self.ap > 0 && validateTokenMove(
                            myTokenPos,
                            targetPos,
                            gameState.placedTiles,
                            gameState.doorsState,
                            gameState.wallsState
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
                            isMiststepTarget = dist <= 3;
                          }

                          // 4. Raise Stone cell detection (player's current cell)
                          const isRaiseStoneCell = targetingCardId === 'working_raise_stone' && isActiveTurn && myTokenPos && myTokenPos.tileX === x && myTokenPos.tileY === y && myTokenPos.r === r && myTokenPos.c === c;

                          return (
                            <div
                              key={`cell-overlay-${r}-${c}`}
                              onClick={(e) => {
                                if (isValidMove) {
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
                                cursor: (isValidMove || isKindleTarget || isMiststepTarget) ? 'pointer' : 'default',
                                pointerEvents: (isValidMove || isKindleTarget || isMiststepTarget || isRaiseStoneCell) ? 'auto' : 'none',
                                border: isValidMove
                                  ? '1.5px dashed var(--accent-green)'
                                  : isKindleTarget
                                  ? '2px solid var(--accent-crimson)'
                                  : isMiststepTarget
                                  ? '1.5px dashed var(--accent-cyan)'
                                  : 'none',
                                backgroundColor: isValidMove
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
                    {/* Render spawn Token (in gameplay phase) */}
                    {Object.entries(gameState.tokenPositions).map(([pId, pos]) => {
                      if (pos.tileX === x && pos.tileY === y) {
                        const player = gameState.players[pId];
                        return (
                          <div
                            key={pId}
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
                              pointerEvents: 'none'
                            }}
                            className="floating-emoji"
                          >
                            {player?.emoji}
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
            height: '180px',
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            backdropFilter: 'blur(12px)',
            borderTop: '2px solid var(--border-light)',
            padding: '16px 24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            zIndex: 100,
            boxShadow: '0 -10px 30px rgba(0,0,0,0.5)',
            boxSizing: 'border-box'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--accent-cyan)', textTransform: 'uppercase', letterSpacing: '1px' }}>
                Your Hand ({self.hand.length}/7 Rites)
              </span>
              {targetingCardId && (
                <span style={{ fontSize: '11px', color: 'var(--accent-crimson)', animation: 'pulse 1.5s infinite', fontWeight: 'bold' }}>
                  🎯 SELECT A TARGET ON THE BOARD FOR {self.hand.find(c => c.id === targetingCardId)?.name.toUpperCase()}
                </span>
              )}
            </div>
            {targetingCardId && (
              <button
                onClick={() => setTargetingCardId(null)}
                className="btn-secondary"
                style={{ padding: '2px 8px', fontSize: '11px', color: 'var(--accent-crimson)', borderColor: 'var(--accent-crimson)' }}
              >
                Cancel Target
              </button>
            )}
          </div>

          {/* Horizontal Cards Scroll list */}
          <div
            style={{
              display: 'flex',
              gap: '16px',
              overflowX: 'auto',
              paddingBottom: '8px',
              flexGrow: 1
            }}
          >
            {self.hand.map((card) => {
              const isTargeting = targetingCardId === card.id;
              const isBane = card.type === 'bane';
              const isWard = card.type === 'ward';
              const isWorking = card.type === 'working';
              const isOffering = card.type === 'offering';

              const typeColor = isBane
                ? 'var(--accent-crimson)'
                : isWard
                ? 'var(--accent-gold)'
                : isWorking
                ? 'var(--accent-cyan)'
                : isOffering
                ? 'var(--accent-green)'
                : '#94a3b8';

              const canCast = isActiveTurn && self.ap > 0 && !isWard;

              return (
                <div
                  key={card.id}
                  style={{
                    minWidth: '220px',
                    maxWidth: '220px',
                    backgroundColor: 'rgba(255,255,255,0.02)',
                    border: isTargeting ? '2px solid var(--accent-cyan)' : `1px solid ${typeColor}66`,
                    borderRadius: '10px',
                    padding: '10px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    boxShadow: isTargeting ? '0 0 10px var(--accent-cyan)44' : 'none',
                    opacity: (targetingCardId && !isTargeting) ? 0.4 : 1,
                    transition: 'all 0.2s',
                    boxSizing: 'border-box'
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <span style={{ fontSize: '12px', fontWeight: 'bold', color: 'white' }}>{card.name}</span>
                      <span
                        style={{
                          fontSize: '8px',
                          fontWeight: 'bold',
                          color: typeColor,
                          border: `1px solid ${typeColor}`,
                          padding: '1px 4px',
                          borderRadius: '4px',
                          textTransform: 'uppercase'
                        }}
                      >
                        {card.type}
                      </span>
                    </div>
                    <p style={{ fontSize: '10px', color: '#94a3b8', margin: '4px 0 0 0', lineHeight: '1.3' }}>
                      {card.description}
                    </p>
                  </div>

                  <div style={{ marginTop: '8px' }}>
                    {isWard ? (
                      <span style={{ fontSize: '9px', color: '#64748b', fontStyle: 'italic', display: 'block', textAlign: 'center' }}>
                        Auto-triggers on defense
                      </span>
                    ) : (
                      <button
                        disabled={!canCast}
                        onClick={() => {
                          const noTargetNeeded = card.id === 'talisman_bear_charm' || card.id === 'working_don_wolf' || card.id === 'offering_deep_breath';
                          if (noTargetNeeded) {
                            handlePlayCard(card.id);
                          } else {
                            setTargetingCardId(card.id);
                          }
                        }}
                        className={canCast ? 'btn-primary' : 'btn-secondary'}
                        style={{
                          width: '100%',
                          padding: '4px 0',
                          fontSize: '11px',
                          opacity: canCast ? 1 : 0.5,
                          cursor: canCast ? 'pointer' : 'not-allowed'
                        }}
                      >
                        {isTargeting ? 'Select Target...' : 'Cast Rite'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
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
          <div style={{ textAlign: 'center', padding: '40px', borderRadius: '24px', border: '2px solid var(--accent-gold)', backgroundColor: 'rgba(255,255,255,0.01)', boxShadow: '0 0 30px rgba(255, 214, 0, 0.15)', maxWidth: '480px', width: '90%' }}>
            <span style={{ fontSize: '48px', display: 'block', marginBottom: '16px' }}>🏆</span>
            <h2 style={{ color: 'var(--accent-gold)', fontSize: '28px', fontWeight: 'black', margin: '0 0 8px 0', letterSpacing: '2px' }}>MATCH COMPLETE</h2>
            
            {(() => {
              const winner = Object.values(gameState.players).find(p => p.points >= 2);
              if (winner) {
                return (
                  <div style={{ margin: '24px 0' }}>
                    <span style={{ fontSize: '64px', display: 'block', margin: '8px 0' }}>{winner.emoji}</span>
                    <h3 style={{ fontSize: '20px', color: 'white', margin: '0' }}>{winner.username} Wins!</h3>
                    <p style={{ fontSize: '13px', color: '#94a3b8', marginTop: '4px' }}>Successfully severed the thread of their opponent twice.</p>
                  </div>
                );
              }
              return <p style={{ color: 'white', margin: '24px 0' }}>A legendary battle has ended!</p>;
            })()}

            {isHost ? (
              <button
                onClick={handleResetGame}
                className="btn-primary"
                style={{ width: '100%', marginTop: '16px', backgroundColor: 'var(--accent-gold)', color: 'black', fontWeight: 'bold' }}
              >
                Restart Game Lobby
              </button>
            ) : (
              <p style={{ fontSize: '12px', color: '#64748b', margin: '16px 0 0 0' }}>Waiting for host to restart lobby...</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
