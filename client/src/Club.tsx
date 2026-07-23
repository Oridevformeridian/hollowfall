import { useState, useEffect, useRef } from 'react';
import { GoogleOAuthProvider, GoogleLogin } from '@react-oauth/google';
import { ref, set, onDisconnect, remove, onValue } from 'firebase/database';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { rtdb, db } from './firebase';
import { HEROES } from './shared/constants';
import { GUEST_SEAT_ID, SESSION_ID } from './identity';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || 'dummy-client-id.apps.googleusercontent.com';

export default function Club() {
  const initialToken = localStorage.getItem('hollowfall_auth_token');
  const storedDisplayName = localStorage.getItem('hollowfall_display_name');
  
  const [token, setToken] = useState<string | null>(initialToken);
  const [displayName, setDisplayName] = useState<string>(storedDisplayName || '');
  const [emoji, setEmoji] = useState<string>(localStorage.getItem('hollowfall_emoji') || HEROES[0].emoji);
  
  // If they have a token and have completed setup, drop them right into the park
  const [view, setView] = useState<'login' | 'setup' | 'park'>(
    initialToken ? (localStorage.getItem('hollowfall_setup_complete') ? 'park' : 'setup') : 'login'
  );
  
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [isMobile, setIsMobile] = useState<boolean>(window.innerWidth <= 768);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // --- Casual matchmaking ---
  const [casualState, setCasualState] = useState<'idle' | 'searching' | 'matched'>('idle');
  const [matchup, setMatchup] = useState<{ me: { emoji: string; name: string }; opp: { emoji: string; name: string }; matchId: string } | null>(null);
  const searchCleanup = useRef<null | (() => void)>(null);
  const stopCasual = () => { if (searchCleanup.current) { searchCleanup.current(); searchCleanup.current = null; } };

  const startCasual = async () => {
    // Casual is auth-only (it's tracked). Guests play custom only.
    if (!token) { alert('Sign in to play Casual Matchmaking.'); setView('login'); return; }
    setCasualState('searching');
    setMatchup(null);
    try {
      const res = await fetch('/api/queue/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ seatId: GUEST_SEAT_ID, sessionId: SESSION_ID, displayName: displayName || 'Wanderer' })
      });
      if (res.status === 401) { setCasualState('idle'); alert('Sign in to play Casual Matchmaking.'); setView('login'); return; }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to join queue');
      const seatId: string = data.seatId;

      // Queue presence: re-registers on reconnect, removed on disconnect — the sweep never pairs a ghost.
      const presenceRef = ref(rtdb, `queuePresence/${seatId}/${SESSION_ID}`);
      const connectedRef = ref(rtdb, '.info/connected');
      const unsubConn = onValue(connectedRef, (snap) => {
        if (snap.val() !== true) return;
        onDisconnect(presenceRef).remove().then(() => set(presenceRef, true).catch(() => {})).catch(() => {});
      });

      // Wait for the matchmaker; on match, reveal the VS then enter the match (App auto-rejoins).
      const unsubQueue = onSnapshot(doc(db, 'casualQueue', seatId), async (snap) => {
        const entry = snap.data() as any;
        if (entry && entry.status === 'matched' && entry.matchId) {
          const matchSnap = await getDoc(doc(db, 'matches', entry.matchId));
          const match = matchSnap.data() as any;
          if (match && match.players) {
            const me = match.players[seatId];
            const opp = Object.values(match.players).find((p: any) => p.id !== seatId) as any;
            setMatchup({
              me: { emoji: me?.emoji || '❔', name: me?.username || (displayName || 'You') },
              opp: { emoji: opp?.emoji || '❔', name: opp?.username || 'Challenger' },
              matchId: entry.matchId
            });
          }
          setCasualState('matched');
          setTimeout(() => {
            sessionStorage.setItem('hollowfall_active_room', entry.matchId);
            sessionStorage.setItem('hollowfall_active_username', displayName || 'Wanderer');
            window.location.href = '/lobby';
          }, 1800);
        }
      });

      searchCleanup.current = () => {
        unsubConn();
        unsubQueue();
        onDisconnect(presenceRef).cancel().catch(() => {});
        remove(presenceRef).catch(() => {});
      };
    } catch (e) {
      console.error('Casual queue join failed', e);
      setCasualState('idle');
    }
  };

  const cancelCasual = async () => {
    stopCasual();
    setCasualState('idle');
    setMatchup(null);
    try {
      await fetch('/api/queue/leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ seatId: GUEST_SEAT_ID, sessionId: SESSION_ID })
      });
    } catch (e) { console.error('Casual queue leave failed', e); }
  };

  useEffect(() => () => stopCasual(), []); // cancel any in-flight search on unmount

  const latestRoom = localStorage.getItem('hollowfall_latest_room');
  const latestUsername = localStorage.getItem('hollowfall_latest_username');

  useEffect(() => {
    if (view !== 'park') return undefined;

    // Generate a random session ID for presence
    const sessionId = Math.random().toString(36).substring(2, 15);
    const userRef = ref(rtdb, `presence/${sessionId}`);
    
    // Set user online
    set(userRef, true);
    
    // Remove on disconnect
    onDisconnect(userRef).remove();

    return () => {
      remove(userRef);
    };
  }, [view]);

  const handleLoginSuccess = async (credentialResponse: any) => {
    try {
      const res = await fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: credentialResponse.credential }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to login');
      if (data.token) {
        localStorage.setItem('hollowfall_auth_token', data.token);
        localStorage.setItem('hollowfall_display_name', data.displayName || '');
        setToken(data.token);
        setDisplayName(data.displayName || '');
        
        // If the backend already has an emoji (chosen Wanderer) saved, restore it and skip setup.
        if (data.emoji) {
          setEmoji(data.emoji);
          localStorage.setItem('hollowfall_emoji', data.emoji);
          localStorage.setItem('hollowfall_setup_complete', 'true');
          setView('park');
        } else {
          setView('setup');
        }
      }
    } catch (e) {
      console.error('Login failed', e);
      alert('Login failed. Ensure you are using the cloudshell domain.');
    }
  };

  const saveProfile = async () => {
    try {
      const res = await fetch('/api/player/profile', {
        method: 'POST',
        credentials: 'include',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify({ displayName, emoji }),
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to update profile');
      }
      // Success! Cache the chosen Wanderer + name and move to park view.
      localStorage.setItem('hollowfall_setup_complete', 'true');
      localStorage.setItem('hollowfall_display_name', displayName);
      localStorage.setItem('hollowfall_emoji', emoji);
      setView('park');
    } catch (e: any) {
      console.error('Error saving profile', e);
      alert(`Error saving profile: ${e.message}`);
    }
  };

  if (view === 'park') {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        minHeight: '100vh', backgroundColor: '#0f0f11', color: 'white', fontFamily: 'system-ui, sans-serif'
      }}>

        {/* Casual matchmaking VS overlay */}
        {casualState !== 'idle' && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(6,8,12,0.96)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 28 }}>
            <div style={{ fontSize: 18, letterSpacing: 2, opacity: 0.8, textTransform: 'uppercase' }}>
              {casualState === 'matched' ? 'Match Found' : 'Finding an opponent…'}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 20 : 56 }}>
              {/* You (left) */}
              <div style={{ textAlign: 'center', width: 150 }}>
                <div style={{ fontSize: 76, lineHeight: 1 }}>{matchup ? matchup.me.emoji : '❔'}</div>
                <div style={{ marginTop: 10, fontWeight: 700 }}>{matchup ? matchup.me.name : (displayName || 'You')}</div>
              </div>
              <div style={{ fontSize: 44, fontWeight: 900, color: '#FF6D00' }}>VS</div>
              {/* Challenger (right) */}
              <div style={{ textAlign: 'center', width: 150 }}>
                {casualState === 'matched' && matchup ? (
                  <>
                    <div style={{ fontSize: 76, lineHeight: 1 }}>{matchup.opp.emoji}</div>
                    <div style={{ marginTop: 10, fontWeight: 700 }}>{matchup.opp.name}</div>
                  </>
                ) : (
                  <>
                    <div style={{ width: 68, height: 68, margin: '4px auto', borderRadius: '50%', border: '5px solid #2a2a2a', borderTopColor: '#00C853', animation: 'spin 1s linear infinite' }} />
                    <div style={{ marginTop: 10, opacity: 0.7 }}>Searching…</div>
                  </>
                )}
              </div>
            </div>
            {casualState === 'searching'
              ? <button onClick={cancelCasual} style={{ marginTop: 8, padding: '10px 28px', borderRadius: 8, border: '1px solid #555', background: 'transparent', color: 'white', cursor: 'pointer' }}>Cancel</button>
              : <div style={{ opacity: 0.7 }}>Entering match…</div>}
          </div>
        )}

        <style>
          {`
            @keyframes spin { 100% { transform: rotate(360deg); } }
            @keyframes pulse { 
              0% { transform: translate(-50%, -50%) scale(1); }
              50% { transform: translate(-50%, -50%) scale(1.05); }
              100% { transform: translate(-50%, -50%) scale(1); }
            }
            .park-label {
              position: absolute;
              transform: translate(-50%, -50%);
              padding: 0.75rem 1.5rem;
              font-size: 1.25rem;
              font-weight: bold;
              border-radius: 50px;
              border: 2px solid rgba(255, 255, 255, 0.2);
              cursor: pointer;
              transition: all 0.2s;
              display: flex;
              align-items: center;
              gap: 0.5rem;
              backdrop-filter: blur(4px);
            }
            .park-label:hover {
              transform: translate(-50%, -50%) scale(1.1);
              z-index: 10;
              border-color: rgba(255, 255, 255, 0.8);
            }
          `}
        </style>

        <div style={{ position: 'relative', width: isMobile ? '100%' : '80%', maxWidth: '900px', borderRadius: '16px', overflow: 'hidden', border: '4px solid #333' }}>
          <img src={isMobile ? "/club_park_map_mobile.jpg" : "/club_park_map.jpg"} alt="Amusement Park Map" style={{ width: '100%', display: 'block' }} />
          
          {/* Active Game Reconnect (Supercedes everything if active) */}
          {latestRoom && latestUsername && (
            <button 
              className="park-label"
              onClick={() => {
                sessionStorage.setItem('hollowfall_active_room', latestRoom);
                sessionStorage.setItem('hollowfall_active_username', latestUsername);
                window.location.href = '/lobby';
              }}
              style={{ 
                top: '20%', left: '50%', 
                background: 'linear-gradient(45deg, #FF0055, #FF9900)', 
                color: 'white', 
                boxShadow: '0 0 30px rgba(255, 0, 85, 0.8)',
                zIndex: 20,
                animation: 'pulse 2s infinite'
              }}
            >
              ⚡ Reconnect to Active Match ({latestRoom})
            </button>
          )}

          {/* =========================================================
              CENTER STACK (4 BUTTONS) 
             ========================================================= */}
          
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            alignItems: 'center',
            zIndex: 10
          }}>
            {/* 1. Casual Match */}
            <button 
              className="park-label"
              onClick={startCasual}
              style={{ position: 'relative', transform: 'none', background: 'rgba(0, 200, 83, 0.85)', color: 'white', boxShadow: '0 0 15px rgba(0, 200, 83, 0.5)' }}
            >
              ⚔️ Casual Match
            </button>

            {/* 2. Competitive Arena */}
            <button 
              className="park-label"
              onClick={() => alert('Competitive Arena coming soon!')}
              style={{ position: 'relative', transform: 'none', background: 'rgba(255, 109, 0, 0.85)', color: 'white', boxShadow: '0 0 20px rgba(255, 109, 0, 0.5)' }}
            >
              🎢 Competitive Arena
            </button>

            {/* 3. Custom Match */}
            <button 
              className="park-label"
              onClick={() => window.location.href = '/lobby'}
              style={{ position: 'relative', transform: 'none', background: 'rgba(213, 0, 249, 0.85)', color: 'white', boxShadow: '0 0 20px rgba(213, 0, 249, 0.5)' }}
            >
              🎲 Custom Match
            </button>

            {/* 4. Practice Match (CPU) */}
            <button 
              className="park-label"
              onClick={() => alert('Practice Match (CPU) coming soon!')}
              style={{ position: 'relative', transform: 'none', background: 'rgba(96, 125, 139, 0.85)', color: 'white', boxShadow: '0 0 15px rgba(96, 125, 139, 0.5)' }}
            >
              🤖 Practice (CPU)
            </button>
          </div>


          {/* =========================================================
              THE 4 CORNERS
             ========================================================= */}

          {/* Top Left: Store */}
          <button 
            className="park-label"
            onClick={() => alert('Store coming soon!')}
            style={{ top: '15%', left: '15%', background: 'rgba(255, 214, 0, 0.85)', color: 'black', boxShadow: '0 0 15px rgba(255, 214, 0, 0.5)' }}
          >
            🏪 Store
          </button>

          {/* Top Right: Friends/Invite */}
          <button 
            className="park-label"
            onClick={() => alert('Friends & Invites coming soon!')}
            style={{ top: '15%', left: '85%', background: 'rgba(41, 121, 255, 0.85)', color: 'white', boxShadow: '0 0 15px rgba(41, 121, 255, 0.5)' }}
          >
            👥 Friends
          </button>

          {/* Bottom Left: Achievements */}
          <button 
            className="park-label"
            onClick={() => alert('Achievements coming soon!')}
            style={{ top: '85%', left: '15%', background: 'rgba(255, 145, 0, 0.85)', color: 'white', boxShadow: '0 0 15px rgba(255, 145, 0, 0.5)' }}
          >
            🏆 Achievements
          </button>

          {/* Bottom Right: Settings & Logout */}
          <div style={{ position: 'absolute', top: '85%', left: '85%', transform: 'translate(-50%, -50%)', zIndex: 30 }}>
            <button 
              onClick={() => setShowSettings(!showSettings)}
              style={{
                padding: '0.75rem 1.5rem',
                fontSize: '1.25rem',
                fontWeight: 'bold',
                borderRadius: '50px',
                border: '2px solid rgba(255, 255, 255, 0.2)',
                cursor: 'pointer',
                background: 'rgba(50, 50, 50, 0.85)', 
                color: 'white', 
                boxShadow: '0 0 15px rgba(50, 50, 50, 0.5)',
                backdropFilter: 'blur(4px)'
              }}
            >
              ⚙️ Settings
            </button>
            {showSettings && (
              <div style={{
                position: 'absolute',
                bottom: '120%',
                right: '0',
                background: 'rgba(20, 20, 20, 0.95)',
                border: '1px solid #444',
                borderRadius: '12px',
                padding: '8px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                minWidth: '150px'
              }}>
                <button 
                  onClick={() => setView('setup')}
                  style={{ background: 'transparent', color: 'white', border: 'none', padding: '8px', textAlign: 'left', cursor: 'pointer', borderRadius: '4px' }}
                  onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                  onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  👤 Edit Profile
                </button>
                <button 
                  onClick={() => {
                    localStorage.removeItem('hollowfall_auth_token');
                    localStorage.removeItem('hollowfall_setup_complete');
                    localStorage.removeItem('hollowfall_display_name');
                    localStorage.removeItem('hollowfall_emoji');
                    window.location.reload();
                  }}
                  style={{ background: 'transparent', color: '#ff4444', border: 'none', padding: '8px', textAlign: 'left', cursor: 'pointer', borderRadius: '4px' }}
                  onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255,68,68,0.1)'}
                  onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  🚪 Sign Out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        backgroundColor: '#0f0f11',
        color: 'white',
        fontFamily: 'system-ui, sans-serif'
      }}>
        <h1 style={{ fontSize: '3rem', fontWeight: 'bold', marginBottom: '1rem', background: 'linear-gradient(to right, #00E5FF, #FF6D00)', WebkitBackgroundClip: 'text', color: 'transparent' }}>
          The Club
        </h1>
        
        {view === 'login' ? (
          <div style={{ marginTop: '2rem', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <p style={{ fontSize: '1.25rem', color: '#a1a1aa', marginBottom: '1rem' }}>Login to access the clubhouse</p>
            <GoogleLogin
              onSuccess={handleLoginSuccess}
              onError={() => console.log('Login Failed')}
            />
          </div>
        ) : (
          <div style={{ marginTop: '2rem', display: 'flex', flexDirection: 'column', gap: '1.5rem', width: '350px' }}>
            <h2 style={{ fontSize: '1.5rem', borderBottom: '1px solid #333', paddingBottom: '0.5rem', textAlign: 'center' }}>Profile Setup</h2>
            
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '1.1rem' }}>
              Display Name
              <input 
                value={displayName} 
                onChange={(e) => setDisplayName(e.target.value)} 
                style={{ padding: '0.75rem', borderRadius: '4px', border: '1px solid #333', background: '#1a1a1f', color: 'white', fontSize: '1.1rem', outline: 'none' }} 
              />
            </label>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <span style={{ fontSize: '1.1rem' }}>Select your Wanderer</span>
              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(5, 1fr)', 
                gap: '10px',
                background: '#1a1a1f',
                padding: '10px',
                borderRadius: '8px',
                border: '1px solid #333'
              }}>
                {HEROES.map((h, idx) => (
                  <button
                    key={idx}
                    onClick={() => setEmoji(h.emoji)}
                    title={`${h.name} (${h.class})`}
                    style={{
                      background: emoji === h.emoji ? h.color : '#2a2a35',
                      border: `2px solid ${emoji === h.emoji ? 'white' : 'transparent'}`,
                      borderRadius: '8px',
                      fontSize: '2rem',
                      padding: '10px 0',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      boxShadow: emoji === h.emoji ? `0 0 10px ${h.color}` : 'none'
                    }}
                  >
                    {h.emoji}
                  </button>
                ))}
              </div>
              <div style={{ textAlign: 'center', fontSize: '0.9rem', color: '#a1a1aa', marginTop: '0.25rem', height: '1.5rem' }}>
                {HEROES.find(h => h.emoji === emoji)?.name} - {HEROES.find(h => h.emoji === emoji)?.class}
              </div>
            </div>

            <button 
              onClick={saveProfile}
              style={{ marginTop: '0.5rem', padding: '1rem', background: '#00E5FF', color: 'black', fontSize: '1.1rem', fontWeight: 'bold', borderRadius: '4px', border: 'none', cursor: 'pointer', transition: 'background 0.2s' }}
              onMouseOver={(e) => e.currentTarget.style.background = '#00B8D4'}
              onMouseOut={(e) => e.currentTarget.style.background = '#00E5FF'}
            >
              Save & Continue
            </button>
            <button 
              onClick={() => {
                localStorage.removeItem('hollowfall_auth_token');
                setToken(null);
                setView('login');
              }}
              style={{ padding: '0.5rem', background: 'transparent', color: '#666', border: 'none', cursor: 'pointer' }}>
              Logout
            </button>
          </div>
        )}
      </div>
    </GoogleOAuthProvider>
  );
}
