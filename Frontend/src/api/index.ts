// api/index.ts — Code Zone API Service Layer

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';
const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8000/ws';

// ─── Auth helpers ─────────────────────────────────────────────
const getToken = (): string | null => localStorage.getItem('cz_token');

const headers = (extra: Record<string, string> = {}): HeadersInit => ({
  'Content-Type': 'application/json',
  ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
  ...extra,
});

const req = async <T>(path: string, options: RequestInit = {}): Promise<T> => {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { ...headers(), ...((options.headers as any) || {}) },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Network error' }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
};

// ─── Types ───────────────────────────────────────────────────
export interface LoginPayload { username: string; password: string; }
export interface RegisterPayload { username: string; email: string; password: string; }
export interface AuthResponse { access: string; refresh: string; user: UserProfile; }
export interface UserProfile { id: string; username: string; email: string; wins: number; total_matches: number; }

export interface Room {
  id: string; name: string; host_id: string;
  max_players: number; current_players: number;
  is_private: boolean; rounds: number;
  difficulty: 'easy' | 'medium' | 'hard';
  status: 'waiting' | 'in_progress' | 'finished';
  created_at: string;
}

export interface RoomPlayer {
  id: string; username: string; is_ready: boolean;
  is_admin: boolean; is_eliminated: boolean;
  score: number; current_round: number;
}

export interface RoomDetail extends Room {
  players: RoomPlayer[];
  current_round: number;
  task?: Task;
}

export interface Task {
  id: string; title: string; description: string;
  input_format: string; output_format: string;
  examples: { input: string; output: string; explanation?: string }[];
  difficulty: 'easy' | 'medium' | 'hard';
  time_limit: number; memory_limit: number;
  visible_tests: { input: string; output: string }[];
}

export interface Submission {
  id: string; player_id: string; room_id: string;
  round_number: number; code: string; language: string;
  status: 'pending' | 'accepted' | 'wrong_answer' | 'runtime_error' | 'time_limit_exceeded' | 'compilation_error';
  execution_time?: number; memory_used?: number;
  test_results?: { passed: boolean; input: string; expected: string; got?: string }[];
  submitted_at: string;
}

export interface MatchResult {
  room_id: string; winner: RoomPlayer;
  players: (RoomPlayer & { final_rank: number; solved_rounds: number })[];
  duration_seconds: number; finished_at: string;
}

export interface CreateRoomPayload {
  name: string; max_players: number;
  is_private: boolean; password?: string;
  rounds: number; difficulty: 'easy' | 'medium' | 'hard';
}

// ─── Auth API ─────────────────────────────────────────────────
export const authApi = {
  login: (data: LoginPayload) =>
    req<AuthResponse>('/auth/login/', { method: 'POST', body: JSON.stringify(data) }),

  register: (data: RegisterPayload) =>
    req<AuthResponse>('/auth/register/', { method: 'POST', body: JSON.stringify(data) }),

  refresh: (refresh: string) =>
    req<{ access: string }>('/auth/refresh/', { method: 'POST', body: JSON.stringify({ refresh }) }),

  me: () => req<UserProfile>('/auth/me/'),
};

// ─── Rooms API ────────────────────────────────────────────────
export const roomsApi = {
  list: (params?: { page?: number; difficulty?: string }) => {
    const qs = new URLSearchParams(params as any).toString();
    return req<{ results: Room[]; count: number }>(`/rooms/?${qs}`);
  },

  create: (data: CreateRoomPayload) =>
    req<Room>('/rooms/', { method: 'POST', body: JSON.stringify(data) }),

  get: (id: string) => req<RoomDetail>(`/rooms/${id}/`),

  join: (id: string, password?: string) =>
    req<{ success: boolean }>(`/rooms/${id}/join/`, {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),

  leave: (id: string) =>
    req<{ success: boolean }>(`/rooms/${id}/leave/`, { method: 'POST' }),

  setReady: (id: string, ready: boolean) =>
    req<{ success: boolean }>(`/rooms/${id}/ready/`, {
      method: 'POST',
      body: JSON.stringify({ ready }),
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
    req<{ success: boolean }>(`/rooms/${roomId}/admin/task/`, {
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
    return req<{ results: Task[]; count: number }>(`/tasks/?${qs}`);
  },

  get: (id: string) => req<Task>(`/tasks/${id}/`),

  create: (data: Omit<Task, 'id'>) =>
    req<Task>('/tasks/', { method: 'POST', body: JSON.stringify(data) }),
};

// ─── Submissions API ──────────────────────────────────────────
export const submissionsApi = {
  submit: (roomId: string, code: string, language: string = 'python3') =>
    req<Submission>(`/rooms/${roomId}/submit/`, {
      method: 'POST',
      body: JSON.stringify({ code, language }),
    }),

  get: (id: string) => req<Submission>(`/submissions/${id}/`),

  mySubmissions: (roomId: string) =>
    req<Submission[]>(`/rooms/${roomId}/my_submissions/`),
};

// ─── Match Results API ────────────────────────────────────────
export const matchApi = {
  getResult: (roomId: string) => req<MatchResult>(`/rooms/${roomId}/result/`),
};

// ─── WebSocket Factory ────────────────────────────────────────
export const createRoomWS = (roomId: string, token: string): WebSocket => {
  return new WebSocket(`${WS_URL}/room/${roomId}/?token=${token}`);
};

// ─── WS Event Types ───────────────────────────────────────────
export type WSEventType =
  | 'player_joined'
  | 'player_left'
  | 'player_ready'
  | 'match_started'
  | 'round_started'
  | 'leaderboard_updated'
  | 'player_eliminated'
  | 'solution_accepted'
  | 'solution_rejected'
  | 'match_finished'
  | 'chat_message'
  | 'error';

export interface WSEvent {
  type: WSEventType;
  payload: any;
  timestamp: string;
}
