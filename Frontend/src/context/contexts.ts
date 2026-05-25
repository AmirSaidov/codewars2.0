// context/ThemeContext.tsx
import { createContext, useContext } from 'react';

export type Theme = 'stalker' | 'cyberpunk' | 'hacker' | 'minimal';

export interface ThemeContextType {
  theme: Theme;
  setTheme: (t: Theme) => void;
}

export const ThemeContext = createContext<ThemeContextType>({
  theme: 'hacker',
  setTheme: () => {},
});

export const useTheme = () => useContext(ThemeContext);

// ===== context/AuthContext.tsx =====
export interface User {
  id: string;
  username: string;
  email: string;
  avatar?: string;
  token: string;
}

export interface AuthContextType {
  user: User | null;
  login: (u: User) => void;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextType>({
  user: null,
  login: () => {},
  logout: () => {},
});

export const useAuth = () => useContext(AuthContext);

// ===== context/WebSocketContext.tsx =====
export interface WSContextType {
  ws: WebSocket | null;
  setWs: (ws: WebSocket | null) => void;
  messages: any[];
  addMessage: (m: any) => void;
}

export const WebSocketContext = createContext<WSContextType>({
  ws: null,
  setWs: () => {},
  messages: [],
  addMessage: () => {},
});

export const useWebSocket = () => useContext(WebSocketContext);
