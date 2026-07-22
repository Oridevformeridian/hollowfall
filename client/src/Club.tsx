import { useState, useEffect } from 'react';
import { GoogleOAuthProvider, GoogleLogin } from '@react-oauth/google';
import { ref, onValue, set, onDisconnect, remove } from 'firebase/database';
import { rtdb } from './firebase';
import { HEROES } from './shared/constants';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || 'dummy-client-id.apps.googleusercontent.com';

export default function Club() {
  const initialToken = localStorage.getItem('hollowfall_auth_token');
  const storedDisplayName = localStorage.getItem('hollowfall_display_name');
  
  const [token, setToken] = useState<string | null>(initialToken);
  const [displayName, setDisplayName] = useState<string>(storedDisplayName || '');
  const [emoji, setEmoji] = useState<string>(HEROES[0].emoji);
  
  // If they have a token and have completed setup, drop them right into the park
  const [view, setView] = useState<'login' | 'setup' | 'park'>(
    initialToken ? (localStorage.getItem('hollowfall_setup_complete') ? 'park' : 'setup') : 'login'
  );
  
  const [onlineCount, setOnlineCount] = useState<number>(0);
  const [showSettings, setShowSettings] = useState<boolean>(false);

  const latestRoom = localStorage.getItem('hollowfall_latest_room');
  const latestUsername = localStorage.getItem('hollowfall_latest_username');

  useEffect(() => {
    if (view !== 'park') return undefined;

    // Generate a random session ID for presence
    const sessionId = Math.random().toString(36).substring(2, 15);
    const userRef = ref(rtdb, `presence/${sessionId}`);
    const presenceRef = ref(rtdb, 'presence');

    // Set ourselves as online and schedule removal on disconnect
    set(userRef, true);
    onDisconnect(userRef).remove();

    // Listen to global presence count
    const unsubscribe = onValue(presenceRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        setOnlineCount(Object.keys(data).length);
      } else {
        setOnlineCount(0);
      }
    });

    return () => {
      remove(userRef);
      unsubscribe();
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
        
        // If the backend already has an emoji saved for them, they've completed setup previously
        if (data.emoji) {
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
      // Success! Move to park view
      localStorage.setItem('hollowfall_setup_complete', 'true');
      localStorage.setItem('hollowfall_display_name', displayName);
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
        <h1 style={{ fontSize: '3rem', fontWeight: 'bold', marginBottom: '1rem', background: 'linear-gradient(to right, #00E5FF, #FF6D00)', WebkitBackgroundClip: 'text', color: 'transparent' }}>
          Welcome to the Hollowfall Club
        </h1>
        <p style={{ fontSize: '1.25rem', color: '#a1a1aa', marginBottom: '2rem' }}>Select an area of the park to visit.</p>
        
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

        <div style={{ position: 'relative', width: '80%', maxWidth: '900px', borderRadius: '16px', overflow: 'hidden', border: '4px solid #333' }}>
          <img src="/club_park_map.jpg" alt="Amusement Park Map" style={{ width: '100%', display: 'block' }} />
          
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
              CENTER CROSS (5 BUTTONS) 
             ========================================================= */}
          
          {/* 1. Casual Match (Top of Center) */}
          <button 
            className="park-label"
            onClick={() => alert('Casual Match coming soon!')}
            style={{ top: '35%', left: '50%', background: 'rgba(0, 200, 83, 0.85)', color: 'white', boxShadow: '0 0 15px rgba(0, 200, 83, 0.5)' }}
          >
            ⚔️ Casual Match
          </button>

          {/* 2. Practice Match (Left of Center) */}
          <button 
            className="park-label"
            onClick={() => alert('Practice Match (CPU) coming soon!')}
            style={{ top: '50%', left: '30%', background: 'rgba(96, 125, 139, 0.85)', color: 'white', boxShadow: '0 0 15px rgba(96, 125, 139, 0.5)' }}
          >
            🤖 Practice (CPU)
          </button>

          {/* 3. Central Park (Center) */}
          <button 
            className="park-label"
            onClick={() => alert('Central Park coming soon!')}
            style={{ 
              top: '50%', left: '50%', 
              background: `rgba(0, 229, 255, ${Math.min(0.85 + (onlineCount * 0.05), 1)})`, 
              color: 'black', 
              boxShadow: `0 0 ${20 + (onlineCount * 10)}px rgba(0, 229, 255, ${Math.min(0.5 + (onlineCount * 0.1), 1)})` 
            }}
          >
            ⛲ Central Park ({onlineCount})
          </button>

          {/* 4. Competitive Arena (Right of Center) */}
          <button 
            className="park-label"
            onClick={() => alert('Competitive Arena coming soon!')}
            style={{ top: '50%', left: '70%', background: 'rgba(255, 109, 0, 0.85)', color: 'white', boxShadow: '0 0 20px rgba(255, 109, 0, 0.5)' }}
          >
            🎢 Competitive Arena
          </button>

          {/* 5. Custom Match (Bottom of Center) */}
          <button 
            className="park-label"
            onClick={() => window.location.href = '/lobby'}
            style={{ top: '65%', left: '50%', background: 'rgba(213, 0, 249, 0.85)', color: 'white', boxShadow: '0 0 20px rgba(213, 0, 249, 0.5)' }}
          >
            🎲 Custom Match
          </button>


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
