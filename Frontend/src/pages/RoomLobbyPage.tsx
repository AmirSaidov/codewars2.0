// pages/RoomLobbyPage.tsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { Page } from '../App';
import type { User } from '../context/contexts';
import { roomsApi } from '../api';
import type { Room, WSEvent, RoomChatMessage, UserProfile } from '../api';
import { Check, Copy, Send, Settings, Zap } from 'lucide-react';
import { useRoomWebSocket } from '../hooks/useRoomWebSocket';

interface Props {
  navigate: (p: Page, roomId?: string | number) => void;
  user: User | null;
  roomId: string | null;
}

type LobbyPlayer = {
  id: number;
  username: string;
  is_ready: boolean;
  is_admin: boolean;
};

type CopyState = 'idle' | 'copied' | 'failed';

const isNumericRoomId = (value: string | number | null | undefined) => String(value ?? '').match(/^\d+$/);

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

const copyTextToClipboard = async (text: string) => {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const copied = document.execCommand('copy');
  document.body.removeChild(textarea);
  if (!copied) throw new Error('Copy failed');
};

const RoomLobbyPage: React.FC<Props> = ({ navigate, user, roomId }) => {
  const [room, setRoom] = useState<Room | null>(null);
  const [players, setPlayers] = useState<LobbyPlayer[]>([]);
  const [isReady, setIsReady] = useState(false);
  const [roomName, setRoomName] = useState('ROOM');
  const [chat, setChat] = useState<RoomChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [config, setConfig] = useState({ max_players: 10, round_count: 3 });
  const [roundCountDraft, setRoundCountDraft] = useState(3);
  const [savingRoundCount, setSavingRoundCount] = useState(false);
  const [startError, setStartError] = useState('');
  const [starting, setStarting] = useState(false);
  const [roomLoading, setRoomLoading] = useState(true);
  const [roomError, setRoomError] = useState('');
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState('');
  const [chatError, setChatError] = useState('');
  const [copyState, setCopyState] = useState<CopyState>('idle');

  const hasLoadedRoomRef = useRef(false);
  const lastRefreshAtRef = useRef(0);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const isCreator =
    room?.creator?.id !== undefined &&
    user?.id !== null &&
    user?.id !== undefined &&
    String(room.creator.id) === String(user.id);

  const roomStatus = String(room?.status || 'waiting');
  const isWaiting = roomStatus === 'waiting';
  const isRunning = roomStatus === 'running' || roomStatus === 'active';
  const isFinished = roomStatus === 'finished';
  const statusLabel = isRunning ? 'ACTIVE' : isFinished ? 'FINISHED' : 'WAITING';
  const playablePlayers = players.filter((p) => !p.is_admin);
  const playableCount = playablePlayers.length;
  const readyCount = playablePlayers.filter((p) => p.is_ready).length;
  const allReady = playableCount > 0 && readyCount === playableCount;
  const readinessPercent = playableCount > 0 ? Math.round((readyCount / playableCount) * 100) : 0;
  const hostPlayer = players.find((p) => p.is_admin) || null;
  const inviteCode = String(room?.invite_code || room?.id || roomId || '').trim().toUpperCase();
  const displayedInviteCode = inviteCode || 'NO CODE';
  const canCopyInviteCode = Boolean(inviteCode);

  const mergeChatMessages = useCallback((incoming: unknown[]) => {
    const normalized = incoming
      .map(normalizeChatMessage)
      .filter((message): message is RoomChatMessage => Boolean(message));

    if (normalized.length === 0) return;

    setChat((current) => {
      const byKey = new Map<string, RoomChatMessage>();
      [...current, ...normalized].forEach((message) => {
        byKey.set(getMessageKey(message), message);
      });
      return sortMessages(Array.from(byKey.values()));
    });
  }, []);

  const refreshRoom = useCallback(async () => {
    if (!roomId) return;
    if (!isNumericRoomId(roomId)) {
      navigate('dashboard');
      return;
    }

    if (!hasLoadedRoomRef.current) setRoomLoading(true);
    try {
      const active = await roomsApi.myActive().catch(() => null);
      if (active?.id && String(active.id) !== String(roomId)) {
        localStorage.setItem('cz_room_id', String(active.id));
        localStorage.setItem('cz_page', 'lobby');
        navigate('lobby', active.id);
        return;
      }

      const data = await roomsApi.get(String(roomId));
      setRoom(data);
      setRoomName(data.name || 'ROOM');
      setConfig({ max_players: data.max_players, round_count: data.round_count });
      setRoundCountDraft(data.round_count);
      setRoomError('');

      if (Array.isArray(data.chat_messages)) {
        mergeChatMessages(data.chat_messages);
      }

      const nextPlayers: LobbyPlayer[] = (data.players || []).map((membership) => ({
        id: Number(membership.user.id),
        username: membership.user.username,
        is_ready: membership.is_ready,
        is_admin: String(membership.user.id) === String(data.creator.id),
      }));
      setPlayers(nextPlayers);
      const me = nextPlayers.find((player) => String(player.id) === String(user?.id));
      setIsReady(Boolean(me?.is_ready));
      hasLoadedRoomRef.current = true;
    } catch (error: unknown) {
      setRoomError(getErrorMessage(error, 'Failed to load room'));
    } finally {
      setRoomLoading(false);
    }
  }, [mergeChatMessages, navigate, roomId, user?.id]);

  const loadMessages = useCallback(async () => {
    if (!roomId || !isNumericRoomId(roomId)) return;
    setMessagesLoading(true);
    setMessagesError('');
    try {
      const messages = await roomsApi.messages(String(roomId));
      mergeChatMessages(messages);
    } catch (error: unknown) {
      setMessagesError(getErrorMessage(error, 'Failed to load message history'));
    } finally {
      setMessagesLoading(false);
    }
  }, [mergeChatMessages, roomId]);

  const refreshRoomThrottled = useCallback(() => {
    const now = Date.now();
    if (now - lastRefreshAtRef.current < 800) return;
    lastRefreshAtRef.current = now;
    refreshRoom();
  }, [refreshRoom]);

  const handleWSEvent = useCallback((event: WSEvent) => {
    const name = (event.event ?? event.type) as string | undefined;
    switch (name) {
      case 'match_started':
        refreshRoomThrottled();
        if (isCreator) navigate('tournament', room?.id ?? roomId ?? undefined);
        else navigate('arena', roomId || undefined);
        return;
      case 'round_started':
      case 'player_eliminated':
      case 'player_advanced':
      case 'leaderboard_updated':
        refreshRoomThrottled();
        return;
      case 'match_finished':
        refreshRoomThrottled();
        return;
      case 'room_disbanded':
        localStorage.removeItem('cz_room_id');
        localStorage.setItem('cz_page', 'dashboard');
        navigate('dashboard');
        return;
      case 'chat_message': {
        mergeChatMessages([event.payload]);
        return;
      }
      case 'connection_established':
        return;
      case 'error':
        setChatError(String(event.payload?.detail || 'Realtime error'));
        return;
      default:
        refreshRoomThrottled();
    }
  }, [isCreator, mergeChatMessages, navigate, refreshRoomThrottled, room?.id, roomId]);

  const { status: connectionStatus, sendJson: sendRoomWSJson } = useRoomWebSocket(
    roomId,
    user?.token,
    {
      onMessage: handleWSEvent,
      onOpen: () => setChatError(''),
      onAuthInvalid: () => setChatError('Realtime auth failed. Refreshing session...'),
      onForbidden: () => setChatError('Realtime room access denied.'),
      onMalformedMessage: () => setChatError('Invalid realtime message'),
    },
  );
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

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void refreshRoom();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [refreshRoom]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadMessages();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [loadMessages]);

  useEffect(() => {
    if (copyState === 'idle') return;
    const timeoutId = window.setTimeout(() => setCopyState('idle'), 1600);
    return () => window.clearTimeout(timeoutId);
  }, [copyState]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: 'end' });
  }, [chat.length]);

  useEffect(() => {
    if (!roomId) return;
    if (room?.status && room.status !== 'waiting') return;
    const intervalId = window.setInterval(refreshRoomThrottled, 2000);
    return () => window.clearInterval(intervalId);
  }, [refreshRoomThrottled, room?.status, roomId]);

  const handleCopyInviteCode = async () => {
    if (!canCopyInviteCode) return;
    try {
      await copyTextToClipboard(inviteCode);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  };

  const handleSaveRoundCount = async () => {
    if (!roomId || !isCreator || !isWaiting) return;
    const nextRoundCount = Math.max(1, Math.min(10, Number(roundCountDraft) || 1));
    setSavingRoundCount(true);
    try {
      const updated = await roomsApi.updateRoundCount(String(roomId), nextRoundCount);
      setRoom(updated);
      setConfig({ max_players: updated.max_players, round_count: updated.round_count });
      setRoundCountDraft(updated.round_count);
      setRoomError('');
    } catch (error: unknown) {
      setRoomError(getErrorMessage(error, 'Failed to save room settings'));
    } finally {
      setSavingRoundCount(false);
    }
  };

  const handleReady = async () => {
    if (isCreator || !isWaiting) return;
    const newReady = !isReady;
    setIsReady(newReady);
    try {
      if (newReady) await roomsApi.ready(String(roomId!));
      else await roomsApi.unready(String(roomId!));
      setRoomError('');
    } catch (error: unknown) {
      setIsReady(!newReady);
      setRoomError(getErrorMessage(error, 'Failed to update readiness'));
    }
    refreshRoom();
  };

  const goAdmin = () => {
    const adminRoomId = room?.id ?? roomId ?? localStorage.getItem('cz_room_id');
    if (!adminRoomId) return;
    navigate('admin', adminRoomId);
  };

  const handleStart = async () => {
    if (!isWaiting) return;
    setStartError('');
    setStarting(true);
    try {
      await roomsApi.startMatch(String(roomId!));
      await refreshRoom();
      if (isCreator) navigate('tournament', roomId || undefined);
      else navigate('arena', roomId || undefined);
    } catch (error: unknown) {
      setStartError(getErrorMessage(error, 'Failed to start match'));
    } finally {
      setStarting(false);
    }
  };

  const sendChat = () => {
    const message = chatInput.trim();
    if (!message) return;

    if (connectionStatus !== 'connected') {
      setChatError('Chat is disconnected. Reconnecting...');
      return;
    }

    try {
      if (import.meta.env.DEV) {
        console.debug('[room-ws] send', { roomId, event: 'chat_message' });
      }
      const sent = sendRoomWSJson({
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
    } catch {
      setChatError('Failed to send message');
    }
  };

  const handleLeave = async () => {
    try {
      if (isCreator) {
        const confirmed = window.confirm('Disband this room for everyone?');
        if (!confirmed) return;
        await roomsApi.disband(roomId!);
      } else {
        await roomsApi.leave(roomId!);
      }
    } catch {
      // Keep existing navigation behavior for legacy 204 responses from req<void>.
    }
    localStorage.removeItem('cz_room_id');
    localStorage.setItem('cz_page', 'dashboard');
    navigate('dashboard');
  };

  return (
    <div className="page">
      <nav className="navbar">
        <div className="container room-lobby-topbar">
          <div className="room-lobby-titlebar">
            <button className="btn btn-ghost btn-sm" onClick={handleLeave}>
              {isCreator ? 'DISBAND ROOM' : 'LEAVE'}
            </button>
            <div>
              <span className="room-lobby-room-name">{roomName}</span>
              <span className="room-lobby-room-id">#{String(roomId ?? '').slice(-6).toUpperCase()}</span>
            </div>
          </div>
          <div className="room-lobby-connection">
            <div className={`dot ${connectionDotClass}`} />
            <span>{connectionLabel}</span>
          </div>
        </div>
      </nav>

      <div className="container room-lobby-shell" style={{ paddingTop: 32, paddingBottom: 32 }}>
        <div className="room-lobby-layout">
          <div className="room-lobby-main">
            {roomLoading && (
              <div className="room-lobby-state">LOADING ROOM...</div>
            )}

            {roomError && (
              <div className="card" style={{ marginBottom: 20, borderColor: 'var(--danger)' }}>
                <div className="label" style={{ marginBottom: 6, color: 'var(--danger)' }}>ROOM ERROR</div>
                <div style={{ fontFamily: 'var(--font-code)', fontSize: 12, color: 'var(--text-secondary)' }}>
                  {roomError}
                </div>
              </div>
            )}

            <div className="card" style={{ marginBottom: 20, display: 'flex', gap: 32, flexWrap: 'wrap' }}>
              {[
                ['MAX PLAYERS', config.max_players],
                ['ROUNDS', config.round_count],
                ['STATUS', statusLabel],
                ['PRIVATE', room?.is_private ? 'YES' : 'NO'],
              ].map(([label, value]) => (
                <div key={label as string}>
                  <div className="label" style={{ marginBottom: 4 }}>{label}</div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, color: 'var(--accent)' }}>
                    {value}
                  </div>
                </div>
              ))}
              {isCreator && isWaiting && (
                <div style={{ minWidth: 180 }}>
                  <div className="label" style={{ marginBottom: 4 }}>EDIT ROUNDS</div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      className="input"
                      type="number"
                      min={1}
                      max={10}
                      value={roundCountDraft}
                      onChange={(event) => setRoundCountDraft(Number(event.target.value))}
                      style={{ width: 100 }}
                    />
                    <button
                      className="btn btn-outline btn-sm"
                      onClick={handleSaveRoundCount}
                      disabled={savingRoundCount}
                    >
                      {savingRoundCount ? 'SAVING...' : 'SAVE'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {hostPlayer && (
              <div className="card" style={{ marginBottom: 20, borderColor: 'var(--border-accent)', boxShadow: '0 0 18px var(--accent-glow)' }}>
                <div className="label" style={{ marginBottom: 6 }}>LOBBY HOST</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div className="avatar">{hostPlayer.username[0]}</div>
                  <div>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
                      {hostPlayer.username}
                    </div>
                    <div style={{ fontFamily: 'var(--font-code)', fontSize: 11, color: 'var(--text-secondary)' }}>
                      Admin controls only - not counted as a player slot
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="section-label" style={{ marginBottom: 16 }}>
              OPERATIVES - {readyCount}/{playableCount} READY
            </div>

            <div className="room-lobby-player-list">
              {playablePlayers.length === 0 && (
                <div className="room-lobby-player-row open">
                  <div className="avatar">+</div>
                  <div className="room-lobby-player-info">
                    <span>SLOT OPEN</span>
                    <small>Waiting for operatives</small>
                  </div>
                </div>
              )}

              {playablePlayers.map((player) => (
                <div key={player.id} className="room-lobby-player-row">
                  <div className="avatar">{player.username[0]}</div>
                  <div className="room-lobby-player-info">
                    <span>{player.username}</span>
                    <small>{isWaiting ? (player.is_ready ? 'READY' : 'WAITING') : statusLabel}</small>
                  </div>
                  <div className={`room-lobby-player-state ${player.is_ready ? 'ready' : ''}`}>
                    {isWaiting ? (player.is_ready ? 'READY' : 'WAITING...') : statusLabel}
                  </div>
                </div>
              ))}

              {isWaiting && playablePlayers.length > 0 && playablePlayers.length < config.max_players && (
                <div className="room-lobby-player-row open">
                  <div className="avatar">+</div>
                  <div className="room-lobby-player-info">
                    <span>SLOT OPEN</span>
                    <small>{config.max_players - playablePlayers.length} available</small>
                  </div>
                </div>
              )}
            </div>

            <div className="room-lobby-actions">
              {isWaiting && !isCreator && (
                <button
                  className={`btn ${isReady ? 'btn-ghost' : 'btn-primary'}`}
                  style={{ flex: 1 }}
                  onClick={handleReady}
                >
                  {isReady ? 'READY - CLICK TO UNREADY' : 'MARK READY'}
                </button>
              )}

              {isCreator && (
                <button
                  className="btn btn-ghost"
                  style={{ flex: 1 }}
                  type="button"
                  onClick={goAdmin}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <Settings size={14} />
                    ADMIN PANEL
                  </span>
                </button>
              )}

              {isWaiting && isCreator && (
                <button
                  className="btn btn-outline"
                  style={{ flex: 1 }}
                  onClick={handleStart}
                  disabled={starting || playableCount < 1}
                  title={playableCount < 1 ? 'Need at least 1 player' : ''}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <Zap size={14} />
                    {starting ? 'STARTING...' : (allReady ? 'LAUNCH BATTLE' : `FORCE START (${readyCount}/${Math.max(playableCount, 1)})`)}
                  </span>
                </button>
              )}

              {isRunning && (
                <>
                  <button
                    className="btn btn-primary"
                    style={{ flex: 1 }}
                    type="button"
                    onClick={() => navigate('arena', roomId || undefined)}
                  >
                    GO TO ARENA
                  </button>
                  <button
                    className="btn btn-outline"
                    style={{ flex: 1 }}
                    type="button"
                    onClick={() => navigate('tournament', roomId || undefined)}
                  >
                    VIEW TOURNAMENT
                  </button>
                </>
              )}

              {isFinished && (
                <button
                  className="btn btn-primary"
                  style={{ flex: 1 }}
                  type="button"
                  onClick={() => navigate('results', roomId || undefined)}
                >
                  VIEW RESULTS
                </button>
              )}
            </div>

            {isCreator ? (
              <p style={{ marginTop: 12, fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center' }}>
                You are the lobby host. You don&apos;t participate in the battle.
              </p>
            ) : isRunning ? (
              <p style={{ marginTop: 12, fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center' }}>
                Match is active. Enter the arena or watch the tournament mountain.
              </p>
            ) : isFinished ? (
              <p style={{ marginTop: 12, fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center' }}>
                Match finished. Results are ready.
              </p>
            ) : (
              <p style={{ marginTop: 12, fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center' }}>
                Waiting for host to start the match...
              </p>
            )}

            {startError && (
              <div className="card" style={{ marginTop: 12, borderColor: 'var(--danger)' }}>
                <div className="label" style={{ marginBottom: 6, color: 'var(--danger)' }}>START ERROR</div>
                <div style={{ fontFamily: 'var(--font-code)', fontSize: 12, color: 'var(--text-secondary)' }}>
                  {startError}
                </div>
              </div>
            )}
          </div>

          <aside className="room-lobby-side">
            <div className="card">
              <div className="label" style={{ marginBottom: 8 }}>INVITE CODE</div>
              <div className="room-lobby-invite-code">
                {displayedInviteCode}
              </div>
              <button
                className="btn btn-ghost btn-sm"
                style={{ width: '100%', justifyContent: 'center' }}
                onClick={handleCopyInviteCode}
                disabled={!canCopyInviteCode}
              >
                {copyState === 'copied' ? <Check size={13} /> : <Copy size={13} />}
                {copyState === 'copied' ? 'COPIED' : copyState === 'failed' ? 'COPY FAILED' : 'COPY CODE'}
              </button>
            </div>

            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 12 }}>
                <div className="label" style={{ marginBottom: 0 }}>READINESS</div>
                <div className="room-lobby-ready-count">{readyCount}/{playableCount} READY</div>
              </div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', minHeight: 24 }}>
                {playablePlayers.length === 0 ? (
                  <div className="room-lobby-muted">0/0 READY</div>
                ) : (
                  playablePlayers.map((player) => (
                    <div
                      key={player.id}
                      title={`${player.username} - ${player.is_ready ? 'ready' : 'waiting'}`}
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: 2,
                        background: player.is_ready ? 'var(--success)' : 'var(--border)',
                        transition: 'background 0.3s',
                      }}
                    />
                  ))
                )}
              </div>
              <div className="progress-bar" style={{ marginTop: 12 }}>
                <div className="progress-fill" style={{ width: `${readinessPercent}%`, background: 'var(--success)' }} />
              </div>
            </div>

            <div className="card room-lobby-chat-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 12 }}>
                <div className="label" style={{ marginBottom: 0 }}>COMMS</div>
                <div className={`room-lobby-chat-status ${connectionStatus}`}>
                  {connectionLabel}
                </div>
              </div>

              <div className="room-lobby-chat-list">
                {messagesLoading && chat.length === 0 && (
                  <div className="room-lobby-empty">Loading messages...</div>
                )}

                {!messagesLoading && chat.length === 0 && (
                  <div className="room-lobby-empty">No messages yet</div>
                )}

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

              {messagesError && <div className="form-error" style={{ marginBottom: 8 }}>{messagesError}</div>}
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
          </aside>
        </div>
      </div>
    </div>
  );
};

export default RoomLobbyPage;
