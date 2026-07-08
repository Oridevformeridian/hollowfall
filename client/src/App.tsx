import React, { useState, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import { GameState, ClientMessage, ServerMessage } from './shared/types.ts';
import { FIXED_TILES } from './shared/constants.ts';
import { validateTilePlacement } from './shared/validation.ts';

export default function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Form states
  const [username, setUsername] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [selectedColor, setSelectedColor] = useState('#00E5FF');

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
      payload: { username, roomCode, color: selectedColor }
    });
  };

  const handleToggleReady = () => {
    sendEvent({ event: 'TOGGLE_READY' });
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

          <div className="flex flex-col gap-2">
            <label className="text-sm font-semibold text-gray-300">Select Avatar Color</label>
            <div className="flex gap-3 justify-center">
              {['#00E5FF', '#FFD600', '#FF1744', '#00E676', '#D500F9', '#FF6D00'].map(c => (
                <button
                  type="button"
                  key={c}
                  onClick={() => setSelectedColor(c)}
                  style={{ backgroundColor: c, border: selectedColor === c ? '3px solid #ffffff' : 'none' }}
                  className="w-8 h-8 rounded-full cursor-pointer transition-transform hover:scale-110"
                />
              ))}
            </div>
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
        <div className="glass-panel w-full max-w-xl p-8 flex flex-col gap-6">
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

          <div className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold text-gray-400 m-0 uppercase tracking-wider">Connected Players ({playersList.length}/2)</h3>
            <div className="flex flex-col gap-2">
              {playersList.map(player => (
                <div key={player.id} className="flex justify-between items-center bg-[rgba(255,255,255,0.03)] p-4 rounded-xl border border-gray-800">
                  <div className="flex items-center gap-3">
                    <div className="w-3.5 h-3.5 rounded-full" style={{ backgroundColor: player.color }} />
                    <span className="font-semibold text-white">{player.username} {player.id === socket?.id && '(You)'}</span>
                  </div>
                  <span className={`text-xs px-3 py-1.5 rounded-full font-bold ${player.isReady ? 'bg-[rgba(0,230,118,0.15)] text-[var(--accent-green)]' : 'bg-gray-800 text-gray-400'}`}>
                    {player.isReady ? 'READY' : 'NOT READY'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-4 mt-4 border-t border-[var(--border-light)] pt-6">
            <button
              onClick={handleToggleReady}
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

  // Validate if a coordinates placement is allowed
  const isPlacementValid = (x: number, y: number) => {
    if (!isActiveTurn || gameState.phase !== 'PLACEMENT') return false;
    const tileIndex = self?.assignedTileIndex;
    if (tileIndex === null || tileIndex === undefined) return false;
    return validateTilePlacement(x, y, tileIndex, socket?.id || '', gameState.placedTiles).valid;
  };

  return (
    <div className="flex-1 flex flex-col md:flex-row h-screen overflow-hidden">
      {/* Sidebar - Players & Game Phase Info */}
      <div className="w-full md:w-80 bg-[var(--bg-dark)] border-b md:border-b-0 md:border-r border-[var(--border-light)] p-6 flex flex-col justify-between overflow-y-auto">
        <div className="flex flex-col gap-6">
          <div>
            <h1 className="text-xl font-black text-[var(--accent-cyan)] m-0 tracking-wider">HOLLOWFALL</h1>
            <p className="text-gray-400 text-xs m-0">Setup Phase — Contiguous Exit Match</p>
          </div>

          <div className="flex flex-col gap-3">
            <h3 className="text-xs font-bold text-gray-500 m-0 uppercase tracking-widest">Turn Rotation</h3>
            <div className="flex flex-col gap-2">
              {gameState.turnOrder.map((pId) => {
                const player = gameState.players[pId];
                const isActive = pId === activePlayerId;
                return (
                  <div
                    key={pId}
                    style={{ borderColor: isActive ? 'var(--accent-gold)' : 'var(--border-light)' }}
                    className={`flex justify-between items-center p-3 rounded-xl border ${isActive ? 'bg-[rgba(255,214,0,0.05)] pulse-glow' : 'bg-transparent'}`}
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: player.color }} />
                      <span className="font-semibold text-sm">{player.username}</span>
                    </div>
                    {isActive && <span className="text-[10px] bg-[var(--accent-gold)] text-black font-extrabold px-1.5 py-0.5 rounded">ACTIVE</span>}
                  </div>
                );
              })}
            </div>
          </div>

          {gameState.phase === 'PLACEMENT' && activeTileLayout && (
            <div className="flex flex-col gap-4 bg-[rgba(255,255,255,0.02)] p-4 rounded-xl border border-gray-800">
              <h3 className="text-xs font-bold text-gray-400 m-0 uppercase tracking-widest">Your Assigned Tile</h3>
              <div className="flex flex-col items-center">
                <span className="text-sm font-bold text-white mb-2">{activeTileLayout.name}</span>
                {/* SVG Render of Tile layout */}
                <svg className="w-36 h-36 border border-gray-800 rounded bg-black" viewBox="0 0 100 100">
                  <g transform={`rotate(${rotation} 50 50)`}>
                    {/* Draw Paths */}
                    {/* (This is a simplified visual representation of paths) */}
                    <rect x="0" y="0" width="100" height="100" fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
                    {/* Draw Tile layout specifics based on ID */}
                    <path
                      d={
                        activeTileLayout.id === 1 ? 'M 50 0 L 50 100 M 0 50 L 100 50' : // Crossroads
                        activeTileLayout.id === 2 ? 'M 50 0 L 50 50 L 100 50' :        // Corner
                        activeTileLayout.id === 3 ? 'M 50 0 L 50 100' :               // Straight
                        'M 50 0 L 50 50 M 0 50 L 100 50'                              // T-Junction
                      }
                      fill="none"
                      stroke="var(--accent-cyan)"
                      strokeWidth="6"
                      strokeLinecap="round"
                    />
                    {/* Exits */}
                    <circle cx="50" cy="5" r="4" fill="var(--accent-cyan)" />
                    {activeTileLayout.id !== 2 && <circle cx="50" cy="95" r="4" fill="var(--accent-cyan)" />}
                    {activeTileLayout.id !== 3 && <circle cx="95" cy="50" r="4" fill="var(--accent-cyan)" />}
                    {activeTileLayout.id !== 2 && activeTileLayout.id !== 3 && <circle cx="5" cy="50" r="4" fill="var(--accent-cyan)" />}
                    
                    {/* Center Lair */}
                    <circle cx="50" cy="50" r="6" fill="#000" stroke="var(--accent-gold)" strokeWidth="2" />
                    <text x="50" y="53" textAnchor="middle" fill="var(--accent-gold)" fontSize="8" fontWeight="bold">S</text>
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
            <div className="bg-[rgba(0,230,118,0.05)] border border-[var(--accent-green)] p-4 rounded-xl text-center">
              <h3 className="text-sm font-bold text-[var(--accent-green)] m-0 mb-1">MAZE READY</h3>
              <p className="text-xs text-gray-300 m-0">All 4 board sectors successfully placed and aligned.</p>
            </div>
          )}
        </div>

        <div className="mt-6 border-t border-[var(--border-light)] pt-4 text-center">
          <span className="text-[10px] text-gray-500 font-mono">Room: {gameState.roomCode}</span>
        </div>
      </div>

      {/* Main Board Space */}
      <div className="flex-1 bg-[var(--bg-deep)] overflow-auto p-6 flex items-center justify-center relative">
        {error && (
          <div className="absolute top-6 left-6 right-6 z-50 bg-[rgba(255,23,68,0.9)] border border-[var(--accent-crimson)] text-white p-3 rounded-lg text-sm text-center shadow-lg">
            {error}
          </div>
        )}

        {/* 2D Board Rendering */}
        <div
          className="grid gap-4 p-6 border border-gray-800 rounded-3xl bg-[rgba(255,255,255,0.01)]"
          style={{
            gridTemplateColumns: `repeat(${maxX - minX + 1}, minmax(100px, 120px))`
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
                  aspectRatio: '1',
                  borderColor: isHovered && isValid ? 'var(--accent-green)' : tile ? 'var(--border-light)' : 'rgba(255,255,255,0.03)'
                }}
                className={`relative flex items-center justify-center border-2 border-dashed rounded-2xl transition-all cursor-pointer ${
                  tile ? 'bg-black border-solid' : isValid ? 'hover:bg-[rgba(0,230,118,0.05)]' : 'opacity-40 cursor-not-allowed'
                }`}
              >
                {tile ? (
                  // Placed Tile
                  <div className="absolute inset-2 flex items-center justify-center">
                    <svg className="w-full h-full" viewBox="0 0 100 100">
                      <g transform={`rotate(${tile.rotation} 50 50)`}>
                        <rect x="0" y="0" width="100" height="100" fill="none" stroke="rgba(255,255,255,0.05)" />
                        <path
                          d={
                            tile.tileId === 1 ? 'M 50 0 L 50 100 M 0 50 L 100 50' :
                            tile.tileId === 2 ? 'M 50 0 L 50 50 L 100 50' :
                            tile.tileId === 3 ? 'M 50 0 L 50 100' :
                            'M 50 0 L 50 50 M 0 50 L 100 50'
                          }
                          fill="none"
                          stroke="var(--accent-cyan)"
                          strokeWidth="6"
                          strokeLinecap="round"
                        />
                        <circle cx="50" cy="5" r="4" fill="var(--accent-cyan)" />
                        {tile.tileId !== 2 && <circle cx="50" cy="95" r="4" fill="var(--accent-cyan)" />}
                        {tile.tileId !== 3 && <circle cx="95" cy="50" r="4" fill="var(--accent-cyan)" />}
                        {tile.tileId !== 2 && tile.tileId !== 3 && <circle cx="5" cy="50" r="4" fill="var(--accent-cyan)" />}
                        
                        {/* Center Lair */}
                        <circle cx="50" cy="50" r="6" fill="#000" stroke="var(--accent-gold)" strokeWidth="2" />
                        <text x="50" y="53" textAnchor="middle" fill="var(--accent-gold)" fontSize="8" fontWeight="bold">S</text>
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
                              backgroundColor: player?.color,
                              boxShadow: `0 0 10px ${player?.color}`
                            }}
                            className="absolute w-5 h-5 rounded-full border border-white pulse-glow flex items-center justify-center"
                          >
                            <span className="text-[8px] text-black font-extrabold">{player?.username.charAt(0)}</span>
                          </div>
                        );
                      }
                      return null;
                    })}
                  </div>
                ) : isHovered && isValid && activeTileLayout ? (
                  // Placement Preview Hover
                  <div className="absolute inset-2 flex items-center justify-center opacity-70">
                    <svg className="w-full h-full" viewBox="0 0 100 100">
                      <g transform={`rotate(${rotation} 50 50)`}>
                        <path
                          d={
                            activeTileLayout.id === 1 ? 'M 50 0 L 50 100 M 0 50 L 100 50' :
                            activeTileLayout.id === 2 ? 'M 50 0 L 50 50 L 100 50' :
                            activeTileLayout.id === 3 ? 'M 50 0 L 50 100' :
                            'M 50 0 L 50 50 M 0 50 L 100 50'
                          }
                          fill="none"
                          stroke="var(--accent-green)"
                          strokeWidth="6"
                          strokeLinecap="round"
                        />
                      </g>
                    </svg>
                  </div>
                ) : (
                  // Coordinate display for empty grid cells
                  <span className="text-[10px] font-mono text-gray-600">{x}, {y}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
