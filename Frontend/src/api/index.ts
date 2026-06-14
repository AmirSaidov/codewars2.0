// api/index.ts — Code Zone API Service Layer

const BASE_URL = import.meta.env.VITE_API_URL || '/api';
const WS_BASE_URL = (() => {
  const explicit = import.meta.env.VITE_WS_URL;
  if (explicit) return explicit;

  const apiBase = import.meta.env.VITE_API_URL;
  if (apiBase) {
    try {
      const apiUrl = new URL(apiBase, window.location.origin);
      const protocol = apiUrl.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${protocol}//${apiUrl.host}`;
    } catch {
      // fall through to the current origin
    }
  }

  if (import.meta.env.DEV) {
    return `${location.protocol === 'https:' ? 'wss' : 'ws'}://localhost:8000`;
  }

  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
})();

// ─── Auth helpers ─────────────────────────────────────────────
const joinUrl = (base: string, path: string): string => {
  const baseTrimmed = base.replace(/\/+$/, '');
  const pathNormalized = path.startsWith('/') ? path : `/${path}`;
  return `${baseTrimmed}${pathNormalized}`;
};

const getToken = (): string | null => {
  const direct = localStorage.getItem('cz_token');
  if (direct) return direct;
  try {
    const storedUser = localStorage.getItem('cz_user');
    if (!storedUser) return null;
    const parsed = JSON.parse(storedUser) as { token?: string } | null;
    const token = parsed?.token;
    if (token) {
      localStorage.setItem('cz_token', token);
      return token;
    }
  } catch {
    // ignore
  }
  return null;
};

const getRefreshToken = (): string | null => localStorage.getItem('cz_refresh');

const setAccessToken = (token: string): void => {
  localStorage.setItem('cz_token', token);
  try {
    const storedUser = localStorage.getItem('cz_user');
    if (!storedUser) return;
    const parsed = JSON.parse(storedUser) as { token?: string } | null;
    if (!parsed) return;
    localStorage.setItem('cz_user', JSON.stringify({ ...parsed, token }));
  } catch {
    // Keep the standalone token even if the legacy user blob is malformed.
  }
};

const setRefreshToken = (token: string): void => {
  localStorage.setItem('cz_refresh', token);
};

const clearAuthStorage = (): void => {
  localStorage.removeItem('cz_token');
  localStorage.removeItem('cz_refresh');
  localStorage.removeItem('cz_user');
};

const getJwtPayload = (token: string): { exp?: number } | null => {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return JSON.parse(atob(padded)) as { exp?: number };
  } catch {
    return null;
  }
};

const isJwtExpired = (token: string, skewSeconds = 30): boolean => {
  const payload = getJwtPayload(token);
  if (!payload?.exp) return false;
  return payload.exp <= Math.floor(Date.now() / 1000) + skewSeconds;
};

let refreshAccessPromise: Promise<string | null> | null = null;

const refreshAccessToken = async (): Promise<string | null> => {
  const refresh = getRefreshToken();
  if (!refresh) return null;

  if (!refreshAccessPromise) {
    refreshAccessPromise = fetch(joinUrl(BASE_URL, '/auth/refresh/'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh }),
    })
      .then(async (response) => {
        if (!response.ok) return null;
        const data = (await response.json()) as { access?: string; refresh?: string };
        if (!data.access) return null;
        setAccessToken(data.access);
        if (data.refresh) setRefreshToken(data.refresh);
        return data.access;
      })
      .catch(() => null)
      .finally(() => {
        refreshAccessPromise = null;
      });
  }

  return refreshAccessPromise;
};

export const getValidAccessToken = async (fallbackToken?: string | null): Promise<string | null> => {
  const stored = getToken();
  const fallback = fallbackToken || null;
  const current = stored && !isJwtExpired(stored, 0)
    ? stored
    : fallback && !isJwtExpired(fallback, 0)
      ? fallback
      : stored || fallback;
  if (current && current === fallback && current !== stored) {
    setAccessToken(current);
  }
  if (current && !isJwtExpired(current)) return current;

  const refreshed = await refreshAccessToken();
  if (refreshed) return refreshed;
  return current && !isJwtExpired(current, 0) ? current : null;
};

const headers = (extra: Record<string, string> = {}): HeadersInit => ({
  'Content-Type': 'application/json',
  ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
  ...extra,
});

const sanitizeErrorDetail = (detail: string): string => {
  const trimmed = (detail || '').trim();
  const lower = trimmed.toLowerCase();
  if (
    lower.includes('<!doctype html') ||
    lower.includes('<html') ||
    lower.includes('<head') ||
    lower.includes('<body')
  ) {
    return 'Server error';
  }
  const maxLen = 240;
  return trimmed.length > maxLen ? `${trimmed.slice(0, maxLen)}…` : trimmed;
};

const isAuthTokenEndpoint = (path: string) =>
  path.includes('/auth/login/') || path.includes('/auth/register/') || path.includes('/auth/refresh/');

const req = async <T>(path: string, options: RequestInit = {}): Promise<T> => {
  const canRefreshForRequest = !isAuthTokenEndpoint(path);

  if (canRefreshForRequest) {
    await getValidAccessToken();
  }

  const doFetch = () =>
    fetch(joinUrl(BASE_URL, path), {
      ...options,
      headers: { ...headers(), ...((options.headers as any) || {}) },
    });

  let res = await doFetch();
  if (res.status === 401 && canRefreshForRequest) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      res = await doFetch();
    }
  }

  if (!res.ok) {
    if (res.status === 401) {
      clearAuthStorage();
      try {
        window.dispatchEvent(new CustomEvent('cz_auth_invalid'));
      } catch {
        // ignore
      }
    }
    let err: any;
    try {
      err = await res.clone().json();
    } catch {
      const text = await res.text().catch(() => '');
      err = { detail: text || 'Network error' };
    }
    const detail =
      typeof (err as any)?.detail === 'string'
        ? (err as any).detail
        : typeof err === 'string'
          ? err
          : err && typeof err === 'object'
            ? Object.values(err as any)
              .flat()
              .filter(Boolean)
              .map((v) => (typeof v === 'string' ? v : JSON.stringify(v)))
              .join('; ')
            : '';
    throw new Error(sanitizeErrorDetail(detail) || `HTTP ${res.status}`);
  }
  return res.json();
};

type ListResponse<T> = { results: T[]; count: number };

const normalizeListResponse = <T>(data: any): ListResponse<T> => {
  if (Array.isArray(data)) return { results: data as T[], count: data.length };
  const results = (data as any)?.results;
  if (Array.isArray(results)) {
    const count = typeof (data as any)?.count === 'number' ? (data as any).count : results.length;
    return { results: results as T[], count };
  }
  return { results: [], count: 0 };
};

// ─── Types ───────────────────────────────────────────────────
export interface LoginPayload { email: string; password: string; }
export interface RegisterPayload { username: string; email: string; password: string; }
export interface TokenPair { access: string; refresh: string; }
export interface AuthResponse extends TokenPair { user: UserProfile; }
export interface UserProfile {
  id: number;
  username: string;
  email: string;
  first_name?: string;
  last_name?: string;
  is_staff?: boolean;
  avatar?: string;
  bio?: string;
}

export interface ProfileUpdatePayload {
  username?: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  bio?: string;
  avatar?: string;
}

export interface Room {
  id: number;
  invite_code?: string | null;
  name: string;
  creator: UserProfile;
  is_private: boolean;
  max_players: number;
  round_count: number;
  status: 'waiting' | 'running' | 'finished';
  players: RoomMembership[];
  player_count: number;
  current_match?: {
    id: number;
    status: 'waiting' | 'running' | 'finished';
    started_at: string | null;
    finished_at: string | null;
    current_round: null | {
      id: number;
      number: number;
      status: 'pending' | 'running' | 'finished';
      started_at: string | null;
      ended_at: string | null;
    };
  } | null;
  round_duration_seconds?: number;
  selected_task_ids?: number[];
  chat_messages?: RoomChatMessage[];
  created_at: string;
  updated_at: string;
}

export interface RoomMembership {
  id: number;
  user: UserProfile;
  is_ready: boolean;
  status: 'active' | 'left';
  joined_at: string | null;
  left_at: string | null;
}

export interface RoomChatMessage {
  id?: number;
  user?: UserProfile;
  user_id?: number;
  username?: string;
  message: string;
  created_at: string;
}

export type RoomTournamentPlayerStatus = 'waiting' | 'active' | 'advanced' | 'eliminated' | 'winner';

export interface RoomTournamentPlayer {
  user_id: number;
  username: string;
  status: RoomTournamentPlayerStatus;
  round_level: number;
  is_winner: boolean;
  is_eliminated: boolean;
  points?: number;
  solved_count?: number;
  total_solution_time?: number;
}

export interface RoomTournamentState {
  room_id: number;
  status: Room['status'] | 'active';
  current_round: number;
  players: RoomTournamentPlayer[];
}

export type RoomDetail = Room;

// UI-friendly player shape used by some screens (not a direct backend model)
export interface RoomPlayer {
  id: number | string;
  username: string;
  is_ready: boolean;
  is_admin: boolean;
  is_eliminated?: boolean;
  score?: number;
  current_round?: number;
}

export interface Task {
  id: string; title: string; description: string;
  input_format: string; output_format: string;
  examples: { input: string; output: string; explanation?: string }[];
  difficulty: 'easy' | 'medium' | 'hard';
  time_limit: number; memory_limit: number;
  visible_tests: { input: string; output: string }[];
  hidden_tests?: { input: string; output: string }[];
  hidden_tests_count?: number;
}

export interface Submission {
  id: number;
  user: UserProfile;
  match: number;
  round: number;
  task: number;
  code: string;
  status: 'pending' | 'accepted' | 'wrong_answer' | 'runtime_error' | 'time_limit_exceeded' | 'compilation_error';
  execution_time: number;
  test_results: {
    name?: string;
    hidden?: boolean;
    status?: string;
    passed: boolean;
    execution_time?: number;
    input?: string | null;
    expected_output?: string | null;
    stdout?: string;
    stderr?: string;
  }[];
  submitted_at: string;
  moderated_by?: UserProfile | null;
  moderated_at?: string | null;
  manual_decision?: string | null;
}

export interface MatchResult {
  room_id: number;
  winner: { id: number; username: string } | null;
  players: { id: number; username: string; final_rank: number; solved_rounds: number; is_eliminated: boolean }[];
  duration_seconds: number; finished_at: string;
}

export interface LeaderboardEntry {
  user_id: number;
  username?: string;
  user?: UserProfile;
  id?: number;
  points: number;
  solved_count: number;
  total_solution_time: number;
  player_status: string;
  eliminated: boolean;
  last_submission_status: string;
}

export interface Match {
  id: number;
  room: number;
  status: 'waiting' | 'running' | 'finished';
  current_round: null | {
    id: number;
    number: number;
    status: 'pending' | 'running' | 'finished';
    task: Task;
    started_at: string | null;
    ended_at: string | null;
    players: {
      id: number;
      user: UserProfile;
      status: string;
      solved_at: string | null;
      time_spent: number;
    }[];
  };
  rounds: any[];
  participants: any[];
  winner: UserProfile | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface CreateRoomPayload {
  name: string;
  max_players: number;
  round_count: number;
  is_private: boolean;
  password?: string;
}

// ─── Auth API ─────────────────────────────────────────────────
export const authApi = {
  login: async (data: LoginPayload): Promise<AuthResponse> => {
    const tokens = await req<TokenPair>('/auth/login/', { method: 'POST', body: JSON.stringify(data) });
    localStorage.setItem('cz_token', tokens.access);
    localStorage.setItem('cz_refresh', tokens.refresh);
    const user = await req<UserProfile>('/auth/me/');
    return { ...tokens, user };
  },

  register: async (data: RegisterPayload): Promise<AuthResponse> => {
    const res = await req<AuthResponse>('/auth/register/', { method: 'POST', body: JSON.stringify(data) });
    localStorage.setItem('cz_token', res.access);
    localStorage.setItem('cz_refresh', res.refresh);
    return res;
  },

  refresh: async (refresh: string) => {
    setRefreshToken(refresh);
    const access = await refreshAccessToken();
    if (!access) throw new Error('Unable to refresh session');
    return { access };
  },

  me: () => req<UserProfile>('/auth/me/'),
  updateMe: (data: ProfileUpdatePayload) =>
    req<UserProfile>('/auth/me/', { method: 'PATCH', body: JSON.stringify(data) }),
};

// ─── Rooms API ────────────────────────────────────────────────
export const roomsApi = {
  list: (params?: { page?: number; difficulty?: string }) => {
    const qs = new URLSearchParams(params as any).toString();
    return req<any>(`/rooms/?${qs}`).then(normalizeListResponse<Room>);
  },

  create: (data: CreateRoomPayload) =>
    req<Room>('/rooms/', { method: 'POST', body: JSON.stringify(data) }),

  get: (id: string) => req<RoomDetail>(`/rooms/${id}/`),

  messages: (id: string) => req<RoomChatMessage[]>(`/rooms/${id}/messages/`),

  tournament: (id: string) => req<RoomTournamentState>(`/rooms/${id}/tournament/`),

  myActive: () => req<RoomDetail | null>('/rooms/my-active/'),

  join: (id: string, password?: string) =>
    req<RoomDetail>(`/rooms/${id}/join/`, {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),

  leave: (id: string) =>
    req<void>(`/rooms/${id}/leave/`, { method: 'POST' }),

  disband: (id: string) =>
    req<void>(`/rooms/${id}/disband/`, { method: 'POST' }),

  ready: (id: string) => req<RoomDetail>(`/rooms/${id}/ready/`, { method: 'POST' }),
  unready: (id: string) => req<RoomDetail>(`/rooms/${id}/unready/`, { method: 'POST' }),

  updateRoundCount: (id: string, roundCount: number) =>
    req<RoomDetail>(`/rooms/${id}/admin/config/`, {
      method: 'POST',
      body: JSON.stringify({ round_count: roundCount }),
    }),

  startMatch: (id: string, taskIds?: number[]) =>
    req<any>(`/rooms/${id}/start-match/`, {
      method: 'POST',
      body: JSON.stringify(taskIds ? { task_ids: taskIds } : {}),
    }),
};

// ─── Admin (Room Host) API ────────────────────────────────────
export const adminApi = {
  startMatch: (roomId: string) =>
    req<{ success: boolean }>(`/rooms/${roomId}/admin/start/`, { method: 'POST' }),

  stopMatch: (roomId: string) =>
    req<{ success: boolean }>(`/rooms/${roomId}/admin/stop/`, { method: 'POST' }),

  restartRound: (roomId: string) =>
    req<{ success: boolean }>(`/rooms/${roomId}/admin/restart_round/`, { method: 'POST' }),

  kickPlayer: (roomId: string, playerId: string) =>
    req<{ success: boolean }>(`/rooms/${roomId}/admin/kick/`, {
      method: 'POST',
      body: JSON.stringify({ player_id: playerId }),
    }),

  selectTask: (roomId: string, taskId: string) =>
    req<{ success: boolean; task_ids?: number[] }>(`/rooms/${roomId}/admin/task/`, {
      method: 'POST',
      body: JSON.stringify({ task_id: taskId }),
    }),

  acceptSubmission: (roomId: string, submissionId: string) =>
    req<{ success: boolean }>(`/rooms/${roomId}/admin/submissions/${submissionId}/accept/`, { method: 'POST' }),

  rejectSubmission: (roomId: string, submissionId: string) =>
    req<{ success: boolean }>(`/rooms/${roomId}/admin/submissions/${submissionId}/reject/`, { method: 'POST' }),

  advancePlayer: (roomId: string, playerId: string) =>
    req<{ success: boolean }>(`/rooms/${roomId}/admin/advance/`, {
      method: 'POST',
      body: JSON.stringify({ player_id: playerId }),
    }),

  getAllSubmissions: (roomId: string, round?: number) =>
    req<Submission[]>(`/rooms/${roomId}/admin/submissions/?round=${round ?? ''}`),
};

// ─── Tasks API ────────────────────────────────────────────────
export const tasksApi = {
  list: (params?: { difficulty?: string; page?: number }) => {
    const qs = new URLSearchParams(params as any).toString();
    return req<any>(`/tasks/?${qs}`).then(normalizeListResponse<Task>);
  },

  get: (id: string) => req<Task>(`/tasks/${id}/`),

  create: (data: Omit<Task, 'id'>) =>
    req<Task>('/tasks/', { method: 'POST', body: JSON.stringify(data) }),
};

// ─── Submissions API ──────────────────────────────────────────
export const submissionsApi = {
  submit: (matchId: number, roundId: number | null, code: string) =>
    req<Submission>('/submissions/', {
      method: 'POST',
      body: JSON.stringify({
        match_id: matchId,
        ...(roundId ? { round_id: roundId } : {}),
        code,
      }),
    }),

  list: () => req<Submission[]>('/submissions/'),

  get: (id: string) => req<Submission>(`/submissions/${id}/`),

  accept: (id: number) => req<Submission>(`/submissions/${id}/accept/`, { method: 'POST' }),
  reject: (id: number) => req<Submission>(`/submissions/${id}/reject/`, { method: 'POST' }),
};

// ─── Match Results API ────────────────────────────────────────
export const matchApi = {
  getResult: (roomId: string) => req<MatchResult>(`/rooms/${roomId}/result/`),
};

export const matchesApi = {
  get: (matchId: number) => req<Match>(`/matches/${matchId}/`),
  currentRound: (matchId: number) => req<Match['current_round']>(`/matches/${matchId}/current-round/`),
  leaderboard: (matchId: number) => req<LeaderboardEntry[]>(`/matches/${matchId}/leaderboard/`),
  tick: (matchId: number) => req<Match>(`/matches/${matchId}/tick/`, { method: 'POST' }),
};

// ─── WebSocket Factory ────────────────────────────────────────
export const createRoomWS = (roomId: string, token: string): WebSocket => {
  const url = `${WS_BASE_URL}/ws/rooms/${encodeURIComponent(roomId)}/?token=${encodeURIComponent(token)}`;
  return new WebSocket(url);
};

// ─── WS Event Types ───────────────────────────────────────────
export type WSEventType =
  | 'player_joined'
  | 'player_left'
  | 'player_ready'
  | 'match_started'
  | 'round_started'
  | 'leaderboard_updated'
  | 'player_advanced'
  | 'player_eliminated'
  | 'solution_accepted'
  | 'solution_rejected'
  | 'match_finished'
  | 'room_disbanded'
  | 'connection_established'
  | 'chat_message'
  | 'error';

export interface WSEvent {
  event?: WSEventType | string;
  type?: WSEventType | string;
  payload: any;
  timestamp?: string;
}
