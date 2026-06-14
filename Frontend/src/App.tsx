import React, { useEffect, useState } from 'react';
import { ThemeContext, AuthContext, WebSocketContext } from './context/contexts';
import type { Theme, User } from './context/contexts';
import LandingPage from './pages/LandingPage';
import { LoginPage, RegisterPage } from './pages/AuthPages';
import DashboardPage from './pages/DashboardPage';
import RoomLobbyPage from './pages/RoomLobbyPage';
import BattleArenaPage from './pages/BattleArenaPage';
import { AdminPanelPage, MatchResultsPage, ThemeSettingsPage } from './pages/OtherPages';

export type Page =
  | 'landing'
  | 'login'
  | 'register'
  | 'dashboard'
  | 'lobby'
  | 'arena'
  | 'admin'
  | 'results'
  | 'theme-settings';

const App: React.FC = () => {
  const [theme, setTheme] = useState<Theme>('hacker');
  const [user, setUser] = useState<User | null>(null);
  const [page, setPage] = useState<Page>('landing');
  const [roomId, setRoomId] = useState<string | null>(null);
  const [wsMessages, setWsMessages] = useState<any[]>([]);
  const [ws, setWs] = useState<WebSocket | null>(null);

  const navigate = (p: Page, rid?: string | number) => {
    if (rid !== undefined && rid !== null) {
      const normalizedRoomId = String(rid);
      setRoomId(normalizedRoomId);
      localStorage.setItem('cz_room_id', normalizedRoomId);
    }
    setPage(p);
    localStorage.setItem('cz_page', p);
    if (import.meta.env.DEV) {
      console.log('[nav]', { page: p, roomId: rid });
    }
  };

  const login = (u: User) => {
    setUser(u);
    localStorage.setItem('cz_user', JSON.stringify(u));
    navigate('dashboard');
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('cz_user');
    localStorage.removeItem('cz_token');
    localStorage.removeItem('cz_refresh');
    navigate('landing');
  };

  useEffect(() => {
    const handler = () => logout();
    window.addEventListener('cz_auth_invalid', handler as any);
    return () => window.removeEventListener('cz_auth_invalid', handler as any);
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem('cz_user');
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as User;
        setUser(parsed);
        if (!localStorage.getItem('cz_token') && parsed?.token) {
          localStorage.setItem('cz_token', parsed.token);
        }
      } catch {
        localStorage.removeItem('cz_user');
      }
    }
    const storedTheme = localStorage.getItem('cz_theme') as Theme;
    if (storedTheme) setTheme(storedTheme);

    const storedRoomId = localStorage.getItem('cz_room_id');
    const normalizedStoredRoomId = storedRoomId && String(storedRoomId).match(/^\d+$/) ? storedRoomId : null;
    if (normalizedStoredRoomId) setRoomId(normalizedStoredRoomId);
    else if (storedRoomId) localStorage.removeItem('cz_room_id');

    const storedPage = localStorage.getItem('cz_page') as Page | null;
    if (storedPage) {
      const needsAuth: Page[] = ['dashboard', 'lobby', 'arena', 'admin', 'results'];
      const needsRoom: Page[] = ['lobby', 'arena', 'admin', 'results'];

      if (needsAuth.includes(storedPage) && !stored) {
        setPage('landing');
      } else if (needsRoom.includes(storedPage) && !normalizedStoredRoomId) {
        setPage('dashboard');
      } else {
        setPage(storedPage);
      }
    } else if (stored) {
      setPage('dashboard');
    }
  }, []);

  const changeTheme = (t: Theme) => {
    setTheme(t);
    localStorage.setItem('cz_theme', t);
  };

  const renderPage = () => {
    switch (page) {
      case 'landing': return <LandingPage navigate={navigate} />;
      case 'login': return <LoginPage navigate={navigate} onLogin={login} />;
      case 'register': return <RegisterPage navigate={navigate} onLogin={login} />;
      case 'dashboard': return <DashboardPage navigate={navigate} user={user} onLogout={logout} />;
      case 'lobby': return <RoomLobbyPage navigate={navigate} user={user} roomId={roomId} />;
      case 'arena': return <BattleArenaPage navigate={navigate} user={user} roomId={roomId} />;
      case 'admin': return <AdminPanelPage navigate={navigate} user={user} roomId={roomId} />;
      case 'results': return <MatchResultsPage navigate={navigate} user={user} roomId={roomId} />;
      case 'theme-settings': return <ThemeSettingsPage navigate={navigate} />;
      default: return <LandingPage navigate={navigate} />;
    }
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme: changeTheme }}>
      <AuthContext.Provider value={{ user, login, logout }}>
        <WebSocketContext.Provider value={{ ws, setWs, messages: wsMessages, addMessage: (m) => setWsMessages(p => [...p, m]) }}>
          <div data-theme={theme} className="app-root">
            {renderPage()}
          </div>
        </WebSocketContext.Provider>
      </AuthContext.Provider>
    </ThemeContext.Provider>
  );
};

export default App;
