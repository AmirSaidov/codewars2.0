import React, { useEffect, useState } from 'react';
import { ThemeContext, AuthContext, WebSocketContext } from './context/contexts';
import type { Theme, User } from './context/contexts';
import LandingPage from './pages/LandingPage';
import { LoginPage, RegisterPage } from './pages/AuthPages';
import DashboardPage from './pages/DashboardPage';
import RoomLobbyPage from './pages/RoomLobbyPage';
import BattleArenaPage from './pages/BattleArenaPage';
import TournamentPage from './pages/TournamentPage';
import { AdminPanelPage, MatchResultsPage, ThemeSettingsPage } from './pages/OtherPages';
import ProfilePage from './pages/ProfilePage';
import { authApi, getValidAccessToken } from './api';

export type Page =
  | 'landing'
  | 'login'
  | 'register'
  | 'dashboard'
  | 'lobby'
  | 'arena'
  | 'tournament'
  | 'admin'
  | 'results'
  | 'profile'
  | 'theme-settings';

type RouteState = { page: Page; roomId?: string | null };

const protectedPages: Page[] = ['dashboard', 'lobby', 'arena', 'tournament', 'admin', 'results', 'profile'];
const roomPages: Page[] = ['lobby', 'arena', 'tournament', 'admin', 'results'];

const normalizeRoomId = (value: unknown) => {
  const text = String(value ?? '').trim();
  return /^\d+$/.test(text) ? text : null;
};

const parseRoute = (): RouteState | null => {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  const roomMatch = path.match(/^\/rooms\/(\d+)(?:\/(arena|tournament|admin|results))?$/);
  if (roomMatch) {
    const pageBySegment: Record<string, Page> = {
      arena: 'arena',
      tournament: 'tournament',
      admin: 'admin',
      results: 'results',
    };
    return {
      page: pageBySegment[roomMatch[2] || ''] || 'lobby',
      roomId: roomMatch[1],
    };
  }

  const staticRoutes: Record<string, Page> = {
    '/': 'landing',
    '/login': 'login',
    '/register': 'register',
    '/dashboard': 'dashboard',
    '/profile': 'profile',
    '/theme-settings': 'theme-settings',
  };
  return staticRoutes[path] ? { page: staticRoutes[path] } : null;
};

const pathForPage = (page: Page, roomId?: string | null) => {
  const normalizedRoomId = normalizeRoomId(roomId);
  if (page === 'lobby' && normalizedRoomId) return `/rooms/${normalizedRoomId}`;
  if (page === 'arena' && normalizedRoomId) return `/rooms/${normalizedRoomId}/arena`;
  if (page === 'tournament' && normalizedRoomId) return `/rooms/${normalizedRoomId}/tournament`;
  if (page === 'admin' && normalizedRoomId) return `/rooms/${normalizedRoomId}/admin`;
  if (page === 'results' && normalizedRoomId) return `/rooms/${normalizedRoomId}/results`;
  if (page === 'login') return '/login';
  if (page === 'register') return '/register';
  if (page === 'dashboard') return '/dashboard';
  if (page === 'profile') return '/profile';
  if (page === 'theme-settings') return '/theme-settings';
  return '/';
};

const App: React.FC = () => {
  const [theme, setTheme] = useState<Theme>('hacker');
  const [user, setUser] = useState<User | null>(null);
  const [page, setPage] = useState<Page>('landing');
  const [roomId, setRoomId] = useState<string | null>(null);
  const [wsMessages, setWsMessages] = useState<any[]>([]);
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const applyRouteState = (p: Page, rid?: string | number | null) => {
    const normalizedRoomId = normalizeRoomId(rid);
    if (normalizedRoomId) {
      setRoomId(normalizedRoomId);
      localStorage.setItem('cz_room_id', normalizedRoomId);
    }
    setPage(p);
    localStorage.setItem('cz_page', p);
    return normalizedRoomId;
  };

  const navigate = (p: Page, rid?: string | number) => {
    const normalizedRoomId = applyRouteState(p, rid ?? (roomPages.includes(p) ? roomId : null));
    const destination = pathForPage(p, normalizedRoomId ?? (roomPages.includes(p) ? roomId : null));
    if (window.location.pathname !== destination) {
      window.history.pushState({ page: p, roomId: normalizedRoomId }, '', destination);
    }
    if (import.meta.env.DEV) {
      console.log('[nav]', { page: p, roomId: rid });
    }
  };

  const login = (u: User) => {
    setUser(u);
    if (u.token) localStorage.setItem('cz_token', u.token);
    localStorage.removeItem('cz_user');
    navigate('dashboard');
  };

  const updateUser = (u: User) => {
    setUser(u);
    if (u.token) localStorage.setItem('cz_token', u.token);
    localStorage.removeItem('cz_user');
  };

  const clearSession = () => {
    setUser(null);
    localStorage.removeItem('cz_user');
    localStorage.removeItem('cz_token');
    localStorage.removeItem('cz_refresh');
  };

  const logout = () => {
    clearSession();
    navigate('landing');
  };

  useEffect(() => {
    const handler = () => {
      clearSession();
      navigate('login');
    };
    window.addEventListener('cz_auth_invalid', handler as any);
    return () => window.removeEventListener('cz_auth_invalid', handler as any);
  }, []);

  useEffect(() => {
    const legacyStoredUser = localStorage.getItem('cz_user');
    if (legacyStoredUser && !localStorage.getItem('cz_token')) {
      try {
        const parsed = JSON.parse(legacyStoredUser) as User;
        if (parsed?.token) {
          localStorage.setItem('cz_token', parsed.token);
        }
      } catch {
        // ignore malformed legacy auth data
      }
    }
    localStorage.removeItem('cz_user');

    const existingToken = localStorage.getItem('cz_token');
    if (existingToken) {
      setUser({
        id: '',
        username: '',
        email: '',
        token: existingToken,
      });
      void getValidAccessToken(existingToken)
        .then(async (token) => {
          if (!token) {
            clearSession();
            setPage('login');
            return;
          }
          const me = await authApi.me();
          setUser({ ...me, token });
        })
        .catch(() => {
          clearSession();
          setPage('login');
        })
        .finally(() => setAuthReady(true));
    } else {
      setAuthReady(true);
    }

    const storedTheme = localStorage.getItem('cz_theme') as Theme;
    if (storedTheme) setTheme(storedTheme);

    const storedRoomId = localStorage.getItem('cz_room_id');
    const normalizedStoredRoomId = storedRoomId && String(storedRoomId).match(/^\d+$/) ? storedRoomId : null;
    if (normalizedStoredRoomId) setRoomId(normalizedStoredRoomId);
    else if (storedRoomId) localStorage.removeItem('cz_room_id');

    const routeState = parseRoute();
    if (routeState) {
      const targetRoomId = normalizeRoomId(routeState.roomId) ?? normalizedStoredRoomId;
      if (protectedPages.includes(routeState.page) && !existingToken) {
        setPage('login');
      } else if (roomPages.includes(routeState.page) && !targetRoomId) {
        setPage('dashboard');
      } else {
        applyRouteState(routeState.page, targetRoomId);
      }
      return;
    }

    const storedPage = localStorage.getItem('cz_page') as Page | null;
    if (storedPage) {
      if (protectedPages.includes(storedPage) && !existingToken) {
        setPage('landing');
      } else if (roomPages.includes(storedPage) && !normalizedStoredRoomId) {
        setPage('dashboard');
      } else {
        setPage(storedPage);
      }
    } else if (existingToken) {
      setPage('dashboard');
    }
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      const routeState = parseRoute();
      if (!routeState) {
        setPage(user ? 'dashboard' : 'landing');
        return;
      }

      const targetRoomId = normalizeRoomId(routeState.roomId) ?? roomId;
      if (protectedPages.includes(routeState.page) && !user) {
        setPage('login');
        return;
      }
      if (roomPages.includes(routeState.page) && !targetRoomId) {
        setPage('dashboard');
        return;
      }
      applyRouteState(routeState.page, targetRoomId);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [roomId, user]);

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
      case 'profile': return <ProfilePage navigate={navigate} />;
      case 'lobby': return <RoomLobbyPage navigate={navigate} user={user} roomId={roomId} />;
      case 'arena': return <BattleArenaPage navigate={navigate} user={user} roomId={roomId} />;
      case 'tournament': return <TournamentPage navigate={navigate} user={user} roomId={roomId} />;
      case 'admin': return <AdminPanelPage navigate={navigate} user={user} roomId={roomId} />;
      case 'results': return <MatchResultsPage navigate={navigate} user={user} roomId={roomId} />;
      case 'theme-settings': return <ThemeSettingsPage navigate={navigate} />;
      default: return <LandingPage navigate={navigate} />;
    }
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme: changeTheme }}>
      <AuthContext.Provider value={{ user, login, updateUser, logout }}>
        <WebSocketContext.Provider value={{ ws, setWs, messages: wsMessages, addMessage: (m) => setWsMessages(p => [...p, m]) }}>
          <div data-theme={theme} className="app-root">
            {authReady ? renderPage() : null}
          </div>
        </WebSocketContext.Provider>
      </AuthContext.Provider>
    </ThemeContext.Provider>
  );
};

export default App;
