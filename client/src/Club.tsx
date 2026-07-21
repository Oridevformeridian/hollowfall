import React, { useState } from 'react';
import { GoogleOAuthProvider, GoogleLogin } from '@react-oauth/google';
import { HEROES } from './shared/constants';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || 'dummy-client-id.apps.googleusercontent.com';

export default function Club() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('hollowfall_auth_token'));
  const [displayName, setDisplayName] = useState<string>('');
  const [emoji, setEmoji] = useState<string>(HEROES[0].emoji);
  const [view, setView] = useState<'login' | 'setup' | 'park'>(token ? 'setup' : 'login');

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
        setToken(data.token);
        setDisplayName(data.displayName || '');
        setView('setup');
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
          
          {/* Competitive Arena (Top Left Coaster) */}
          <button 
            className="park-label"
            onClick={() => alert('Competitive Arena coming soon!')}
            style={{ top: '25%', left: '25%', background: 'rgba(255, 109, 0, 0.85)', color: 'white', boxShadow: '0 0 20px rgba(255, 109, 0, 0.5)' }}
          >
            🎢 Competitive Arena
          </button>

          {/* Central Park - Social (Middle Fountain) */}
          <button 
            className="park-label"
            onClick={() => alert('Central Park coming soon!')}
            style={{ top: '55%', left: '50%', background: 'rgba(0, 229, 255, 0.85)', color: 'black', boxShadow: '0 0 20px rgba(0, 229, 255, 0.5)' }}
          >
            ⛲ Central Park
          </button>

          {/* Settings (Top Right Ferris Wheel) */}
          <button 
            className="park-label"
            onClick={() => alert('Settings coming soon!')}
            style={{ top: '25%', left: '80%', background: 'rgba(213, 0, 249, 0.85)', color: 'white', boxShadow: '0 0 20px rgba(213, 0, 249, 0.5)' }}
          >
            <svg style={{ animation: 'spin 4s linear infinite' }} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
            Settings
          </button>

          {/* Custom Match - Lobby (Bottom Right Haunted House) */}
          <button 
            className="park-label"
            onClick={() => window.location.href = '/lobby'}
            style={{ top: '80%', left: '75%', background: 'rgba(0, 230, 118, 0.85)', color: 'black', boxShadow: '0 0 20px rgba(0, 230, 118, 0.5)' }}
          >
            🎲 Custom Match
          </button>
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
