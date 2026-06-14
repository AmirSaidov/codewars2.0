// pages/RoomLobbyPage.tsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { Page } from '../App';
import type { User } from '../context/contexts';
import { roomsApi, createRoomWS } from '../api';
import type { Room, WSEvent, RoomChatMessage } from '../api';
import { Zap } from 'lucide-react';

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

const RoomLobbyPage: React.FC<Props> = ({ navigate, user, roomId }) => {
  const [room, setRoom] = useState<Room | null>(null);
  const [players, setPlayers] = useState<LobbyPlayer[]>([]);
  const [isReady, setIsReady] = useState(false);
  const [roomName, setRoomName] = useState('ROOM');
  const [connected, setConnected] = useState(false);
  const [chat, setChat] = useState<RoomChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [config, setConfig] = useState({ max_players: 10, round_count: 3 });
  const [roundCountDraft, setRoundCountDraft] = useState(3);
  const [savingRoundCount, setSavingRoundCount] = useState(false);
  const [startError, setStartError] = useState('');
  const [starting, setStarting] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);

  const isCreator =
    room?.creator?.id !== undefined &&
    user?.id !== null &&
    user?.id !== undefined &&
    String(room.creator.id) === String(user.id);

  const playablePlayers = players.filter((p) => !p.is_admin);
  const playableCount = playablePlayers.length;
  const allReady = playableCount > 0 && playablePlayers.every((p) => p.is_ready);
  const readyCount = playablePlayers.filter((p) => p.is_ready).length;
  const hostPlayer = players.find((p) => p.is_admin) || null;

  const refreshRoom = useCallback(async () => {
    if (!roomId) return;
    if (!String(roomId).match(/^\d+$/)) {
      navigate('dashboard');
      return;
    }
    try {
      // If user already has an active room, force them into it (prevents "join another via link").
      const active = await roomsApi.myActive().catch(() => null);
      if (active?.id && String(active.id) !== String(roomId)) {
        localStorage.setItem('cz_room_id', String(active.id));
        localStorage.setItem('cz_page', 'lobby');
        navigate('lobby', active.id);
        return;
      }

      const data = await roomsApi.get(String(roomId));
      setRoom(data);
      setRoomName(data.name);
      setConfig({ max_players: data.max_players, round_count: data.round_count });
      setRoundCountDraft(data.round_count);
      setChat(Array.isArray(data.chat_messages) ? data.chat_messages : []);

      const nextPlayers: LobbyPlayer[] = (data.players || []).map((m) => ({
        id: m.user.id,
        username: m.user.username,
        is_ready: m.is_ready,
        is_admin: m.user.id === data.creator.id,
      }));
      setPlayers(nextPlayers);
      const me = nextPlayers.find((p) => String(p.id) === String(user?.id));
      setIsReady(Boolean(me?.is_ready));
    } catch {
      // ignore
    }
  }, [roomId, user?.id]);

  const handleSaveRoundCount = async () => {
    if (!roomId || !isCreator) return;
    const nextRoundCount = Math.max(1, Math.min(10, Number(roundCountDraft) || 1));
    setSavingRoundCount(true);
    try {
      const updated = await roomsApi.updateRoundCount(String(roomId), nextRoundCount);
      setRoom(updated);
      setConfig({ max_players: updated.max_players, round_count: updated.round_count });
      setRoundCountDraft(updated.round_count);
    } catch {}
    finally {
      setSavingRoundCount(false);
    }
  };

  // Prevent spamming the backend if the WS emits frequently.
  const lastRefreshAtRef = useRef(0);
  const refreshRoomThrottled = useCallback(() => {
    const now = Date.now();
    if (now - lastRefreshAtRef.current < 800) return;
    lastRefreshAtRef.current = now;
    refreshRoom();
  }, [refreshRoom]);

  // WebSocket connection
  useEffect(() => {
    if (!roomId || !user?.token) return;
    if (!String(roomId).match(/^\d+$/)) return;

    const socket = createRoomWS(roomId, user.token);
    socketRef.current = socket;

    socket.onopen = () => {
      setConnected(true);
    };

    socket.onmessage = (e) => {
      try {
        const event: WSEvent = JSON.parse(e.data);
        handleWSEvent(event);
      } catch {}
    };

    socket.onclose = (e) => {
      setConnected(false);
      socketRef.current = null;
      if (e.code === 4401) {
        try { window.dispatchEvent(new CustomEvent('cz_auth_invalid')); } catch {}
      }
    };

    return () => socket.close();
  }, [roomId, user?.token]);

  const handleWSEvent = useCallback((event: WSEvent) => {
    const name = (event.event ?? event.type) as string | undefined;
    switch (name) {
      case 'match_started':
        if (isCreator) navigate('admin', room?.id ?? roomId ?? undefined);
        else navigate('arena', roomId || undefined);
        return;
      case 'room_disbanded':
        localStorage.removeItem('cz_room_id');
        localStorage.setItem('cz_page', 'dashboard');
        navigate('dashboard');
        return;
      case 'chat_message': {
        const payload = event.payload as RoomChatMessage | undefined;
        if (payload?.id) {
          setChat((current) => current.some((message) => message.id === payload.id) ? current : [...current, payload]);
        }
        return;
      }
      default:
        // backend WS is broadcast-only; easiest is to just refetch current room snapshot (throttled)
        refreshRoomThrottled();
        return;
    }
  }, [navigate, refreshRoomThrottled, room?.id, roomId, isCreator]);

  const handleReady = async () => {
    if (isCreator) return;
    const newReady = !isReady;
    setIsReady(newReady);
    try {
      if (newReady) await roomsApi.ready(String(roomId!));
      else await roomsApi.unready(String(roomId!));
    } catch {}
    refreshRoom();
  };

  const handleStart = async () => {
    setStartError('');
    setStarting(true);
    try {
      await roomsApi.startMatch(String(roomId!));
      await refreshRoom();
      if (isCreator) goAdmin();
      else navigate('arena', roomId || undefined);
    } catch (e: any) {
      setStartError(e?.message || 'Failed to start match');
    } finally {
      setStarting(false);
    }
  };

  const goAdmin = () => {
    const adminRoomId = room?.id ?? roomId ?? localStorage.getItem('cz_room_id');
    if (!adminRoomId) return;
    navigate('admin', adminRoomId);
  };

  const sendChat = () => {
    if (!chatInput.trim()) return;
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({
      event: 'chat_message',
      payload: { message: chatInput.trim() },
    }));
    setChatInput('');
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
    } catch {}
    localStorage.removeItem('cz_room_id');
    localStorage.setItem('cz_page', 'dashboard');
    navigate('dashboard');
  };

  useEffect(() => { refreshRoom(); }, [refreshRoom]);

  // Fallback if WS is unreliable: poll room status until match starts.
  useEffect(() => {
    if (!roomId) return;
    if (room?.status && room.status !== 'waiting') return;
    const id = setInterval(() => {
      refreshRoomThrottled();
    }, 2000);
    return () => clearInterval(id);
  }, [refreshRoomThrottled, room?.status, roomId]);

  // If WS is flaky (or on full page refresh), still move players into the running match.
  useEffect(() => {
    if (!roomId) return;
    if (room?.status === 'running') navigate('arena', roomId || undefined);
  }, [navigate, room?.status, roomId]);

  return (
    <div className="page">
      <nav className="navbar">
        <div className="container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 64 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <button className="btn btn-ghost btn-sm" onClick={handleLeave}>
              {isCreator ? 'DISBAND ROOM' : 'LEAVE'}
            </button>
            <div>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, letterSpacing: 3 }}>
                {roomName}
              </span>
              <span style={{ marginLeft: 12, fontFamily: 'var(--font-code)', fontSize: 11, color: 'var(--text-secondary)' }}>
                #{String(roomId ?? '').slice(-6).toUpperCase()}
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className={`dot ${connected ? 'dot-green' : 'dot-gray'}`} />
            <span style={{ fontFamily: 'var(--font-code)', fontSize: 11, color: 'var(--text-secondary)' }}>
              {connected ? 'CONNECTED' : 'CONNECTING...'}
            </span>
          </div>
        </div>
      </nav>

      <div className="container" style={{ paddingTop: 32, paddingBottom: 32 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 24 }}>

          {/* LEFT — Players */}
          <div>
            {/* Room config */}
            <div className="card" style={{ marginBottom: 20, display: 'flex', gap: 32, flexWrap: 'wrap' }}>
              {[
                ['MAX PLAYERS', config.max_players],
                ['ROUNDS', config.round_count],
                ['STATUS', (room?.status || 'waiting').toUpperCase()],
                ['PRIVATE', room?.is_private ? 'YES' : 'NO'],
              ].map(([label, value]) => (
                <div key={label as string}>
                  <div className="label" style={{ marginBottom: 4 }}>{label}</div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, color: 'var(--accent)' }}>
                    {value}
                  </div>
                </div>
              ))}
              {isCreator && (
                <div style={{ minWidth: 180 }}>
                  <div className="label" style={{ marginBottom: 4 }}>EDIT ROUNDS</div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      className="input"
                      type="number"
                      min={1}
                      max={10}
                      value={roundCountDraft}
                      onChange={(e) => setRoundCountDraft(Number(e.target.value))}
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
                      Admin controls only — not counted as a player slot
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Players list */}
            <div className="section-label" style={{ marginBottom: 16 }}>
              OPERATIVES — {readyCount}/{playableCount} READY
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
              {playablePlayers.map((p, i) => (
                <div key={p.id} className={`player-card ${p.is_ready ? 'ready' : ''} slide-in-left`}
                  style={{ animationDelay: `${i * 0.08}s` }}>
                  <div className="avatar">{p.username[0]}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700 }}>{p.username}</span>
                      {p.username === user?.username && <span className="tag tag-muted" style={{ fontSize: 9 }}>YOU</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {p.is_ready
                      ? <span style={{ color: 'var(--success)', fontFamily: 'var(--font-display)', fontSize: 11, letterSpacing: 2 }}>✓ READY</span>
                      : <span style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-display)', fontSize: 11, letterSpacing: 2 }}>WAITING...</span>
                    }

                  </div>
                </div>
              ))}

              {/* Empty slots */}
              {Array.from({ length: Math.max(0, config.max_players - playableCount) }).map((_, i) => (
                <div key={`empty-${i}`} style={{
                  padding: '16px', border: '1px dashed var(--border)', borderRadius: 4,
                  display: 'flex', alignItems: 'center', gap: 12, opacity: 0.4,
                }}>
                  <div style={{ width: 36, height: 36, border: '1px dashed var(--border)', borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, color: 'var(--text-secondary)' }}>+</div>
                  <span style={{ fontFamily: 'var(--font-display)', fontSize: 11, letterSpacing: 2, color: 'var(--text-secondary)' }}>SLOT OPEN</span>
                </div>
              ))}
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 12 }}>
              {!isCreator && (
                <button
                  className={`btn ${isReady ? 'btn-ghost' : 'btn-primary'}`}
                  style={{ flex: 1 }}
                  onClick={handleReady}
                >
                  {isReady ? '✓ READY — CLICK TO UNREADY' : 'MARK READY'}
                </button>
              )}

              {isCreator && (
                <button
                  className="btn btn-ghost"
                  style={{ flex: 1 }}
                  type="button"
                  onClick={goAdmin}
                >
                  ⚙ ADMIN PANEL
                </button>
              )}

              {isCreator && (
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
            </div>

            {isCreator ? (
              <p style={{ marginTop: 12, fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center' }}>
                You are the lobby host. You don&apos;t participate in the battle.
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

          {/* RIGHT — Chat + Info */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Invite code */}
            <div className="card">
              <div className="label" style={{ marginBottom: 8 }}>INVITE CODE</div>
              <div style={{
                fontFamily: 'var(--font-code)', fontSize: 20, fontWeight: 700,
                color: 'var(--accent)', letterSpacing: 6, textAlign: 'center',
                padding: '12px 0', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', margin: '8px 0',
              }}>
                {String(roomId ?? '').slice(-6).toUpperCase() || 'ABC123'}
              </div>
              <button className="btn btn-ghost btn-sm" style={{ width: '100%' }}
                onClick={() => navigator.clipboard.writeText(String(roomId ?? '').slice(-6).toUpperCase() || '')}>
                COPY CODE
              </button>
            </div>

            {/* Ready indicator */}
            <div className="card">
              <div className="label" style={{ marginBottom: 12 }}>READINESS</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {playablePlayers.map(p => (
                  <div
                    key={p.id}
                    title={p.username}
                    style={{
                    width: 24, height: 24, borderRadius: 2,
                    background: p.is_ready ? 'var(--success)' : 'var(--border)',
                    transition: 'background 0.3s',
                  }}
                  />
                ))}
              </div>
              <div className="progress-bar" style={{ marginTop: 12 }}>
                <div className="progress-fill" style={{ width: `${(readyCount / Math.max(playableCount, 1)) * 100}%`, background: 'var(--success)' }} />
              </div>
            </div>

            {/* Chat */}
            <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 240 }}>
              <div className="label" style={{ marginBottom: 12 }}>COMMS</div>
              <div style={{ flex: 1, overflow: 'auto', marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 300 }}>
                {chat.length === 0 && (
                  <div style={{ color: 'var(--text-secondary)', fontSize: 12, fontStyle: 'italic', textAlign: 'center', padding: '16px 0' }}>
                    No messages yet
                  </div>
                )}
                {chat.map((msg) => (
                  <div key={msg.id} style={{ fontSize: 13 }}>
                    <span style={{ color: 'var(--accent)', fontFamily: 'var(--font-display)', fontSize: 11 }}>{msg.user?.username || 'UNKNOWN'}: </span>
                    <span style={{ color: 'var(--text-primary)' }}>{msg.message}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="input" placeholder="Type message..."
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && sendChat()}
                  style={{ fontSize: 13, padding: '8px 12px' }} />
                <button className="btn btn-outline btn-sm" onClick={sendChat} disabled={!connected}>SEND</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RoomLobbyPage;
