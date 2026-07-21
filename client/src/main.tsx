import React, { useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import Club from './Club.tsx'
import './index.css'

const Router = () => {
  const path = window.location.pathname;

  useEffect(() => {
    if (path === '/') {
      window.location.replace('/lobby');
    }
  }, [path]);

  if (path === '/') return null;
  if (path.startsWith('/lobby')) return <App />;
  if (path.startsWith('/club')) return <Club />;

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', color: 'white', backgroundColor: '#111' }}>
      <h1>404 Not Found</h1>
    </div>
  );
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Router />
  </React.StrictMode>,
)
