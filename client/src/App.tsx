import React, { useState, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import { GameState, ClientMessage, ServerMessage } from './shared/types.ts';
import { FIXED_TILES, TileLayout, HEROES } from './shared/constants.ts';
import { validateTilePlacement } from './shared/validation.ts';

const renderTileSvgContent = (_layout: TileLayout, playerColor: string) => {
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

      {/* Solid Outer border */}
      <rect
        x="0"
        y="0"
        width="100"
        height="100"
        fill="none"
        stroke="rgba(255,255,255,0.2)"
        strokeWidth="1.5"
      />
    </>
  );
};

export default function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  // Helper selectors
  const self = socket?.id && gameState ? gameState.players[socket.id] : null;
  const isHost = self?.isHost || false;
  const playersList = gameState ? Object.values(gameState.players) : [];
  const activePlayerId = gameState?.turnOrder[gameState.activePlayerIndex];
  const isActiveTurn = socket && activePlayerId === socket.id;

  // Render Join / Lobby
  if (!gameState) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <form onSubmit={handleJoin} className="glass-panel w-full max-w-md p-8 flex flex-col gap-6 pulse-glow">
          <div className="text-center">
            <h1 className="text-3xl font-extrabold text-[#00E5FF] m-0 mb-2 tracking-wide">HOLLOWFALL</h1>
            <p className="text-gray-400 text-sm m-0">Thresholds Board Setup & Lobby</p>
          </div>

          {error && (
            <div className="bg-[rgba(255,23,68,0.1)] border border-[var(--accent-crimson)] text-[var(--accent-crimson)] p-3 rounded-lg text-sm text-center">
              {error}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <label className="text-sm font-semibold text-gray-300">Your Name</label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="Spirit Walker"
              className="input-field"
              maxLength={15}
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-semibold text-gray-300">Room Code</label>
            <input
              type="text"
              value={roomCode}
              onChange={e => setRoomCode(e.target.value)}
              placeholder="e.g. THRESH"
              className="input-field"
              maxLength={6}
            />
          </div>


          <button type="submit" className="btn-primary w-full mt-2">
            Connect to Lobby
          </button>
        </form>
      </div>
    );
  }

  // Render Lobby screen (waiting for start)
  if (gameState.phase === 'LOBBY') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6">
        <div className="glass-panel w-full max-w-3xl p-8 flex flex-col gap-6">
          <div className="flex justify-between items-center border-b border-[var(--border-light)] pb-4">
            <div>
              <h2 className="text-2xl font-bold text-[var(--accent-cyan)] m-0">Lobby Room: {gameState.roomCode}</h2>
              <p className="text-gray-400 text-xs mt-1">Waiting for 2 players to start...</p>
            </div>
            {isHost && <span className="text-xs bg-[var(--accent-gold)] text-black px-2.5 py-1 rounded font-bold">LOBBY HOST</span>}
          </div>

          {error && (
            <div className="bg-[rgba(255,23,68,0.1)] border border-[var(--accent-crimson)] text-[var(--accent-crimson)] p-3 rounded-lg text-sm text-center">
              {error}
            </div>
          )}

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '32px',
              alignItems: 'center',
              width: '100%'
            }}
          >
            {/* Column 1: Connected Players & Buttons */}
            <div className="flex flex-col gap-6">
              <div className="flex flex-col gap-3">
                <h3 className="text-sm font-semibold text-gray-400 m-0 uppercase tracking-wider">Connected Players ({playersList.length}/2)</h3>
                <div className="flex flex-col gap-2">
                  {playersList.map(player => (
                    <div key={player.id} className="flex justify-between items-center bg-[rgba(255,255,255,0.03)] p-4 rounded-xl border border-gray-800">
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

              <div className="flex gap-4 mt-2 border-t border-[var(--border-light)] pt-6">
                <button
                  onClick={handleToggleReady}
                  disabled={!self?.emoji}
                  className={`flex-1 ${self?.isReady ? 'btn-secondary' : 'btn-primary'}`}
                >
                  {self?.isReady ? 'Cancel Ready' : 'Ready Up'}
                </button>

                {isHost && (
                  <button
                    onClick={handleStartGame}
                    disabled={playersList.length !== 2 || playersList.some(p => !p.isReady)}
                    className="btn-primary flex-1 bg-gradient-to-r from-[var(--accent-gold)] to-[#ffa600] text-black font-extrabold disabled:opacity-50"
                  >
                    Start Game Setup
                  </button>
                )}
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
            <div style={{ backgroundColor: 'rgba(0,230,118,0.05)', borderColor: 'var(--accent-green)', borderWidth: '1px', borderStyle: 'solid', padding: '16px', borderRadius: '12px', textAlign: 'center' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 'bold', color: 'var(--accent-green)', margin: '0 0 4px 0' }}>MAZE READY</h3>
              <p style={{ fontSize: '12px', color: '#cbd5e1', margin: '0' }}>All 4 board sectors successfully placed and aligned.</p>
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
            transition: 'transform 0.15s ease-out'
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
                        {renderTileSvgContent(FIXED_TILES[tile.tileId - 1], gameState.players[tile.placedBy]?.color || '#00E5FF')}
                      </g>
                    </svg>
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
                              filter: `drop-shadow(0 0 6px ${player?.color})`
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
    </div>
  );
}
