import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Page } from '../App';
import type { User } from '../context/contexts';
import { roomsApi } from '../api';
import type { Room, RoomChatMessage, RoomTournamentPlayer, WSEvent, UserProfile } from '../api';
import TournamentMountain from '../components/TournamentMountain';
import type { TournamentPlayer, TournamentPlayerStatus, TournamentRoundLevel } from '../components/TournamentMountain';
import { Send, Shield, Zap } from 'lucide-react';
import { useRoomWebSocket } from '../hooks/useRoomWebSocket';

interface Props {
  navigate: (p: Page, roomId?: string | number) => void;
  user: User | null;
  roomId: string | null;
}

const isNumericRoomId = (value: string | number | null | undefined) => /^\d+$/.test(String(value ?? ''));

const clampRoundLevel = (value: unknown): TournamentRoundLevel => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 1) return 1;
  if (numeric >= 5) return 5;
  return numeric as TournamentRoundLevel;
};

const getPayloadObject = (payload: unknown): Record<string, unknown> =>
  payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};

const getPayloadNumber = (payload: Record<string, unknown>, key: string): number | null => {
  const value = payload[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.match(/^\d+$/)) return Number(value);
  return null;
};

const normalizeTournamentStatus = (value: unknown, fallback: TournamentPlayerStatus = 'active'): TournamentPlayerStatus => {
  if (value === 'winner') return 'winner';
  if (value === 'eliminated' || value === 'left') return 'eliminated';
  if (value === 'advanced') return 'advanced';
  if (value === 'waiting') return 'waiting';
  if (value === 'active') return 'active';
  return fallback;
};

const getMessageKey = (message: RoomChatMessage) => {
  if (message.id !== undefined && message.id !== null) return `id:${message.id}`;
  return [
    message.user_id ?? message.user?.id ?? 'unknown',
    message.username ?? message.user?.username ?? 'unknown',
    message.created_at || 'no-time',
    message.message,
  ].join('|');
};

const normalizeChatMessage = (payload: unknown): RoomChatMessage | null => {
  if (!payload || typeof payload !== 'object') return null;
  const raw = payload as {
    id?: unknown;
    user?: UserProfile;
    user_id?: unknown;
    username?: unknown;
    message?: unknown;
    created_at?: unknown;
  };
  const message = String(raw.message || '').trim();
  if (!message) return null;

  const userId =
    typeof raw.user_id === 'number'
      ? raw.user_id
      : typeof raw.user_id === 'string' && raw.user_id.match(/^\d+$/)
        ? Number(raw.user_id)
        : raw.user?.id;

  return {
    id: typeof raw.id === 'number' ? raw.id : undefined,
    user: raw.user,
    user_id: userId,
    username: typeof raw.username === 'string' ? raw.username : raw.user?.username,
    message,
    created_at: typeof raw.created_at === 'string' && raw.created_at ? raw.created_at : new Date().toISOString(),
  };
};

const sortMessages = (messages: RoomChatMessage[]) =>
  [...messages].sort((a, b) => {
    const aTime = Date.parse(a.created_at || '') || 0;
    const bTime = Date.parse(b.created_at || '') || 0;
    if (aTime !== bTime) return aTime - bTime;
    return (a.id ?? 0) - (b.id ?? 0);
  });

const formatMessageTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--:--';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const getSenderName = (message: RoomChatMessage) =>
  message.username || message.user?.username || 'UNKNOWN';

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

const TournamentPage: React.FC<Props> = ({ navigate, user, roomId }) => {
  const [room, setRoom] = useState<Room | null>(null);
  const [players, setPlayers] = useState<RoomTournamentPlayer[]>([]);
  const [currentRound, setCurrentRound] = useState<TournamentRoundLevel>(1);
  const [matchStatus, setMatchStatus] = useState<Room['status'] | 'active'>('waiting');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [chat, setChat] = useState<RoomChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatError, setChatError] = useState('');
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const isAdmin =
    room?.creator?.id !== undefined &&
    user?.id !== null &&
    user?.id !== undefined &&
    String(room.creator.id) === String(user.id);

  const mergeChatMessages = useCallback((incoming: unknown[]) => {
    const normalized = incoming
      .map(normalizeChatMessage)
      .filter((message): message is RoomChatMessage => Boolean(message));
    if (normalized.length === 0) return;

    setChat((current) => {
      const byKey = new Map<string, RoomChatMessage>();
      [...current, ...normalized].forEach((message) => byKey.set(getMessageKey(message), message));
      return sortMessages(Array.from(byKey.values()));
    });
  }, []);

  const upsertTournamentPlayer = useCallback((
    userId: number,
    updater: (current: RoomTournamentPlayer | undefined) => RoomTournamentPlayer,
  ) => {
    setPlayers((current) => {
      const existing = current.find((player) => player.user_id === userId);
      const nextPlayer = updater(existing);
      if (existing) {
        return current.map((player) => (player.user_id === userId ? { ...player, ...nextPlayer } : player));
      }
      return [...current, nextPlayer];
    });
  }, []);

  const loadTournament = useCallback(async () => {
    if (!roomId || !isNumericRoomId(roomId)) {
      navigate('dashboard');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const [tournament, roomDetail, messages] = await Promise.all([
        roomsApi.tournament(String(roomId)),
        roomsApi.get(String(roomId)).catch(() => null),
        roomsApi.messages(String(roomId)).catch(() => [] as RoomChatMessage[]),
      ]);
      setPlayers(Array.isArray(tournament.players) ? tournament.players : []);
      setCurrentRound(clampRoundLevel(tournament.current_round));
      setMatchStatus(tournament.status);
      setRoom(roomDetail);
      mergeChatMessages(messages);
    } catch (loadError: unknown) {
      setError(getErrorMessage(loadError, 'Failed to load tournament'));
    } finally {
      setLoading(false);
    }
  }, [mergeChatMessages, navigate, roomId]);

  useEffect(() => {
    void loadTournament();
  }, [loadTournament]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: 'end' });
  }, [chat.length]);

  const applyPlayerAdvanced = useCallback((payload: unknown) => {
    const data = getPayloadObject(payload);
    const userId = getPayloadNumber(data, 'user_id');
    if (!userId) return;

    upsertTournamentPlayer(userId, (current) => {
      const nextLevel = clampRoundLevel(getPayloadNumber(data, 'round_level') ?? ((current?.round_level ?? currentRound) + 1));
      return {
        user_id: userId,
        username: String(data.username || current?.username || `Player ${userId}`),
        status: 'advanced',
        round_level: nextLevel,
        is_winner: false,
        is_eliminated: false,
        points: current?.points,
        solved_count: current?.solved_count,
        total_solution_time: current?.total_solution_time,
      };
    });
  }, [currentRound, upsertTournamentPlayer]);

  const applyPlayerEliminated = useCallback((payload: unknown) => {
    const data = getPayloadObject(payload);
    const userId = getPayloadNumber(data, 'user_id');
    if (!userId) return;

    upsertTournamentPlayer(userId, (current) => ({
      user_id: userId,
      username: String(data.username || current?.username || `Player ${userId}`),
      status: 'eliminated',
      round_level: clampRoundLevel(getPayloadNumber(data, 'round_level') ?? current?.round_level ?? currentRound),
      is_winner: false,
      is_eliminated: true,
      points: current?.points,
      solved_count: current?.solved_count,
      total_solution_time: current?.total_solution_time,
    }));
  }, [currentRound, upsertTournamentPlayer]);

  const applyLeaderboard = useCallback((payload: unknown) => {
    const data = getPayloadObject(payload);
    const entries = Array.isArray(data.entries) ? data.entries : [];
    if (entries.length === 0) return;

    setPlayers((current) => {
      const byId = new Map(current.map((player) => [player.user_id, player]));
      entries.forEach((entry) => {
        const item = getPayloadObject(entry);
        const userId = getPayloadNumber(item, 'user_id');
        if (!userId) return;

        const existing = byId.get(userId);
        const solvedCount = getPayloadNumber(item, 'solved_count') ?? existing?.solved_count ?? 0;
        const eliminated = item.eliminated === true || item.player_status === 'eliminated';
        const winner = item.player_status === 'winner';
        const level = winner
          ? 5
          : eliminated
            ? clampRoundLevel(existing?.round_level ?? solvedCount + 1)
            : clampRoundLevel(Math.max(existing?.round_level ?? 1, solvedCount + 1));

        byId.set(userId, {
          user_id: userId,
          username: String(item.username || existing?.username || `Player ${userId}`),
          status: winner ? 'winner' : eliminated ? 'eliminated' : solvedCount > 0 ? 'advanced' : 'active',
          round_level: level,
          is_winner: winner,
          is_eliminated: eliminated,
          points: getPayloadNumber(item, 'points') ?? existing?.points ?? 0,
          solved_count: solvedCount,
          total_solution_time: getPayloadNumber(item, 'total_solution_time') ?? existing?.total_solution_time ?? 0,
        });
      });
      return Array.from(byId.values());
    });
  }, []);

  const applyRoundStarted = useCallback((payload: unknown) => {
    const data = getPayloadObject(payload);
    const nextRound = clampRoundLevel(getPayloadNumber(data, 'round_number') ?? getPayloadNumber(data, 'round') ?? 1);
    setCurrentRound(nextRound);
    setMatchStatus('running');
    setPlayers((current) => current.map((player) => {
      if (player.status === 'winner' || player.status === 'eliminated') return player;
      return {
        ...player,
        status: player.status === 'advanced' && clampRoundLevel(player.round_level) <= nextRound ? 'active' : player.status,
        round_level: clampRoundLevel(Math.max(player.round_level, nextRound)),
      };
    }));
  }, []);

  const applyMatchFinished = useCallback((payload: unknown) => {
    const data = getPayloadObject(payload);
    const winnerId = getPayloadNumber(data, 'winner_id') ?? getPayloadNumber(data, 'user_id');
    setCurrentRound(5);
    setMatchStatus('finished');
    if (!winnerId) return;

    setPlayers((current) => current.map((player) => (
      player.user_id === winnerId
        ? { ...player, username: String(data.username || player.username), status: 'winner', round_level: 5, is_winner: true, is_eliminated: false }
        : { ...player, status: 'eliminated', is_winner: false, is_eliminated: true }
    )));
  }, []);

  const handleWSEvent = useCallback((event: WSEvent) => {
    const name = (event.event ?? event.type) as string | undefined;
    switch (name) {
      case 'match_started':
        setMatchStatus('running');
        applyRoundStarted(event.payload?.current_round || event.payload);
        return;
      case 'round_started':
        applyRoundStarted(event.payload);
        return;
      case 'player_advanced':
        applyPlayerAdvanced(event.payload);
        return;
      case 'player_eliminated':
        applyPlayerEliminated(event.payload);
        return;
      case 'leaderboard_updated':
        applyLeaderboard(event.payload);
        return;
      case 'match_finished':
        applyMatchFinished(event.payload);
        return;
      case 'chat_message':
        mergeChatMessages([event.payload]);
        return;
      case 'room_disbanded':
        localStorage.removeItem('cz_room_id');
        localStorage.setItem('cz_page', 'dashboard');
        navigate('dashboard');
        return;
      case 'error':
        setChatError(String(event.payload?.detail || 'Realtime error'));
        return;
      default:
        return;
    }
  }, [
    applyLeaderboard,
    applyMatchFinished,
    applyPlayerAdvanced,
    applyPlayerEliminated,
    applyRoundStarted,
    mergeChatMessages,
    navigate,
  ]);

  const { status: connectionStatus, sendJson } = useRoomWebSocket(
    roomId,
    user?.token,
    {
      onMessage: handleWSEvent,
      onOpen: () => setChatError(''),
      onForbidden: () => setChatError('Realtime room access denied.'),
      onAuthInvalid: () => setChatError('Realtime auth failed. Refreshing session...'),
    },
  );

  const mountainPlayers: TournamentPlayer[] = useMemo(() => (
    players.map((player) => ({
      id: player.user_id,
      username: player.username,
      status: player.is_winner
        ? 'winner'
        : player.is_eliminated
          ? 'eliminated'
          : normalizeTournamentStatus(player.status),
      round_level: clampRoundLevel(player.round_level),
    }))
  ), [players]);

  const sortedLeaderboard = useMemo(() => (
    [...players].sort((a, b) => {
      if (a.is_winner && !b.is_winner) return -1;
      if (!a.is_winner && b.is_winner) return 1;
      if (a.is_eliminated && !b.is_eliminated) return 1;
      if (!a.is_eliminated && b.is_eliminated) return -1;
      if ((a.points ?? 0) !== (b.points ?? 0)) return (b.points ?? 0) - (a.points ?? 0);
      return (a.total_solution_time ?? 0) - (b.total_solution_time ?? 0);
    })
  ), [players]);

  const connectionLabel =
    connectionStatus === 'connected'
      ? 'CONNECTED'
      : connectionStatus === 'connecting'
        ? 'CONNECTING'
        : 'DISCONNECTED';
  const connectionDotClass =
    connectionStatus === 'connected'
      ? 'dot-green'
      : connectionStatus === 'connecting'
        ? 'dot-orange pulse'
        : 'dot-red';
  const statusLabel = matchStatus === 'running' || matchStatus === 'active' ? 'ACTIVE' : String(matchStatus).toUpperCase();

  const sendChat = () => {
    const message = chatInput.trim();
    if (!message) return;
    if (connectionStatus !== 'connected') {
      setChatError('Chat is disconnected. Reconnecting...');
      return;
    }

    const sent = sendJson({
      event: 'chat_message',
      type: 'chat_message',
      action: 'chat_message',
      payload: { message },
    });
    if (!sent) {
      setChatError('Chat is disconnected. Reconnecting...');
      return;
    }
    setChatInput('');
    setChatError('');
  };

  return (
    <div className="page tournament-page">
      <nav className="navbar">
        <div className="container tournament-page-topbar">
          <div className="room-lobby-titlebar">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('arena', roomId || undefined)}>
              ← BACK TO ARENA
            </button>
            {isAdmin && (
              <button type="button" className="btn btn-outline btn-sm" onClick={() => navigate('admin', roomId || undefined)}>
                <Shield size={13} />
                ADMIN PANEL
              </button>
            )}
            <div>
              <span className="room-lobby-room-name">{room?.name || 'TOURNAMENT'}</span>
              <span className="room-lobby-room-id">#{String(roomId ?? '').slice(-6).toUpperCase()}</span>
            </div>
          </div>
          <div className="room-lobby-connection">
            <div className={`dot ${connectionDotClass}`} />
            <span>{connectionLabel}</span>
          </div>
        </div>
      </nav>

      <div className="container tournament-page-shell">
        <main className="tournament-page-main">
          <div className="tournament-page-meta">
            <div>
              <div className="label" style={{ marginBottom: 4 }}>MATCH STATUS</div>
              <div className="tournament-page-status">{statusLabel}</div>
            </div>
            <div>
              <div className="label" style={{ marginBottom: 4 }}>CURRENT ROUND</div>
              <div className="tournament-page-status">ROUND {currentRound}</div>
            </div>
          </div>

          {loading && <div className="room-lobby-state">LOADING TOURNAMENT...</div>}
          {error && (
            <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: 16 }}>
              <div className="label" style={{ color: 'var(--danger)', marginBottom: 6 }}>TOURNAMENT ERROR</div>
              <div style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-code)', fontSize: 12 }}>{error}</div>
            </div>
          )}

          <div className="tournament-page-mountain">
            <TournamentMountain
              players={mountainPlayers}
              currentRound={currentRound}
              maxPlayers={Math.max(10, mountainPlayers.length)}
            />
          </div>
        </main>

        <aside className="tournament-page-side">
          <div className="card tournament-page-panel">
            <div className="label" style={{ marginBottom: 12 }}>LEADERBOARD</div>
            <div className="tournament-leaderboard-list">
              {sortedLeaderboard.length === 0 && <div className="room-lobby-empty">No players yet</div>}
              {sortedLeaderboard.map((player, index) => (
                <div key={player.user_id} className={`tournament-leaderboard-row ${player.is_eliminated ? 'eliminated' : ''}`}>
                  <div className="tournament-leaderboard-rank">{String(index + 1).padStart(2, '0')}</div>
                  <div className="tournament-leaderboard-player">
                    <span>{player.username}</span>
                    <small>
                      {player.is_winner ? 'WINNER' : player.is_eliminated ? 'ELIMINATED' : `ROUND ${clampRoundLevel(player.round_level)}`}
                    </small>
                  </div>
                  <div className="tournament-leaderboard-score">{player.points ?? 0}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="card tournament-page-panel tournament-page-chat">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 12 }}>
              <div className="label" style={{ marginBottom: 0 }}>COMMS</div>
              <div className={`room-lobby-chat-status ${connectionStatus}`}>{connectionLabel}</div>
            </div>
            <div className="room-lobby-chat-list">
              {chat.length === 0 && <div className="room-lobby-empty">No messages yet</div>}
              {chat.map((message) => (
                <div key={getMessageKey(message)} className="room-lobby-message">
                  <div className="room-lobby-message-meta">
                    <span>{getSenderName(message)}</span>
                    <time>{formatMessageTime(message.created_at)}</time>
                  </div>
                  <div className="room-lobby-message-text">{message.message}</div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            {chatError && <div className="form-error" style={{ marginBottom: 8 }}>{chatError}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="input"
                placeholder={connectionStatus === 'connected' ? 'Type message...' : 'Chat disconnected'}
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    sendChat();
                  }
                }}
                disabled={connectionStatus !== 'connected'}
                style={{ fontSize: 13, padding: '8px 12px' }}
              />
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={sendChat}
                disabled={connectionStatus !== 'connected' || !chatInput.trim()}
                style={{ justifyContent: 'center' }}
              >
                <Send size={13} />
                SEND
              </button>
            </div>
          </div>

          <button type="button" className="btn btn-primary" onClick={() => navigate('arena', roomId || undefined)}>
            <Zap size={14} />
            BACK TO ARENA
          </button>
        </aside>
      </div>
    </div>
  );
};

export default TournamentPage;
