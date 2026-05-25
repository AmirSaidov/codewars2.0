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

  const navigate = (p: Page, rid?: string) => {
    if (rid) setRoomId(rid);
    setPage(p);
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
    navigate('landing');
  };

  useEffect(() => {
    const stored = localStorage.getItem('cz_user');
    if (stored) setUser(JSON.parse(stored));
    const storedTheme = localStorage.getItem('cz_theme') as Theme;
    if (storedTheme) setTheme(storedTheme);
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
      case 'results': return <MatchResultsPage navigate={navigate} roomId={roomId} />;
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
