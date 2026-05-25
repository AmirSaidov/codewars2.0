// pages/RoomLobbyPage.tsx
import React, { useState, useEffect, useCallback } from 'react';
import type { Page } from '../App';
import type { User } from '../context/contexts';
import { roomsApi, adminApi, createRoomWS } from '../api';
import type { RoomPlayer, WSEvent } from '../api';

interface Props {
  navigate: (p: Page, roomId?: string) => void;
  user: User | null;
  roomId: string | null;
}

const MOCK_PLAYERS: RoomPlayer[] = [
  { id: 'p1', username: 'ghost_sniper', is_ready: true, is_admin: true, is_eliminated: false, score: 0, current_round: 0 },
  { id: 'p2', username: 'dark_coder', is_ready: true, is_admin: false, is_eliminated: false, score: 0, current_round: 0 },
  { id: 'p3', username: 'void_runner', is_ready: false, is_admin: false, is_eliminated: false, score: 0, current_round: 0 },
  { id: 'p4', username: 'neon_blade', is_ready: false, is_admin: false, is_eliminated: false, score: 0, current_round: 0 },
];

const RoomLobbyPage: React.FC<Props> = ({ navigate, user, roomId }) => {
  const [players, setPlayers] = useState<RoomPlayer[]>(MOCK_PLAYERS);
  const [isReady, setIsReady] = useState(false);
  const [roomName] = useState('STALKER BOOTCAMP');
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [chat, setChat] = useState<{ user: string; msg: string }[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [config] = useState({ max_players: 8, rounds: 3, difficulty: 'medium' });

  const isAdmin = user?.id === players.find(p => p.is_admin)?.id || players[0]?.username === user?.username;
  const allReady = players.every(p => p.is_ready);
  const readyCount = players.filter(p => p.is_ready).length;

  // WebSocket connection
  useEffect(() => {
    if (!roomId || !user?.token) return;

    const socket = createRoomWS(roomId, user.token);

    socket.onopen = () => {
      setConnected(true);
      setWs(socket);
    };

    socket.onmessage = (e) => {
      try {
        const event: WSEvent = JSON.parse(e.data);
        handleWSEvent(event);
      } catch {}
    };

    socket.onclose = () => {
      setConnected(false);
      setWs(null);
    };

    return () => socket.close();
  }, [roomId, user?.token]);

  const handleWSEvent = useCallback((event: WSEvent) => {
    switch (event.type) {
      case 'player_joined':
        setPlayers(p => [...p.filter(x => x.id !== event.payload.player.id), event.payload.player]);
        break;
      case 'player_left':
        setPlayers(p => p.filter(x => x.id !== event.payload.player_id));
        break;
      case 'player_ready':
        setPlayers(p => p.map(x => x.id === event.payload.player_id ? { ...x, is_ready: event.payload.ready } : x));
        break;
      case 'match_started':
        navigate('arena', roomId || undefined);
        break;
      case 'chat_message':
        setChat(c => [...c, { user: event.payload.username, msg: event.payload.message }]);
        break;
    }
  }, [navigate, roomId]);

  const sendWS = (type: string, payload: any) => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, payload }));
    }
  };

  const handleReady = async () => {
    const newReady = !isReady;
    setIsReady(newReady);
    setPlayers(p => p.map(x => x.username === user?.username ? { ...x, is_ready: newReady } : x));
    try {
      await roomsApi.setReady(roomId!, newReady);
    } catch {}
    sendWS('player_ready', { ready: newReady });
  };

  const handleStart = async () => {
    try {
      await adminApi.startMatch(roomId!);
    } catch {}
    navigate('arena', roomId || undefined);
  };

  const sendChat = () => {
    if (!chatInput.trim()) return;
    setChat(c => [...c, { user: user?.username || 'YOU', msg: chatInput }]);
    sendWS('chat_message', { message: chatInput });
    setChatInput('');
  };

  const handleLeave = async () => {
    try { await roomsApi.leave(roomId!); } catch {}
    navigate('dashboard');
  };

  return (
    <div className="page">
      <nav className="navbar">
        <div className="container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 64 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <button className="btn btn-ghost btn-sm" onClick={handleLeave}>← LEAVE</button>
            <div>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, letterSpacing: 3 }}>
                {roomName}
              </span>
              <span style={{ marginLeft: 12, fontFamily: 'var(--font-code)', fontSize: 11, color: 'var(--text-secondary)' }}>
                #{roomId?.slice(-6).toUpperCase()}
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
                ['ROUNDS', config.rounds],
                ['DIFFICULTY', config.difficulty.toUpperCase()],
                ['MAX PLAYERS', config.max_players],
                ['LANGUAGE', 'PYTHON 3.10'],
              ].map(([label, value]) => (
                <div key={label as string}>
                  <div className="label" style={{ marginBottom: 4 }}>{label}</div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, color: 'var(--accent)' }}>
                    {value}
                  </div>
                </div>
              ))}
            </div>

            {/* Players list */}
            <div className="section-label" style={{ marginBottom: 16 }}>
              OPERATIVES — {readyCount}/{players.length} READY
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
              {players.map((p, i) => (
                <div key={p.id} className={`player-card ${p.is_ready ? 'ready' : ''} slide-in-left`}
                  style={{ animationDelay: `${i * 0.08}s` }}>
                  <div className="avatar">{p.username[0]}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700 }}>{p.username}</span>
                      {p.is_admin && <span className="tag tag-accent" style={{ fontSize: 9 }}>ADMIN</span>}
                      {p.username === user?.username && <span className="tag tag-muted" style={{ fontSize: 9 }}>YOU</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {p.is_ready
                      ? <span style={{ color: 'var(--success)', fontFamily: 'var(--font-display)', fontSize: 11, letterSpacing: 2 }}>✓ READY</span>
                      : <span style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-display)', fontSize: 11, letterSpacing: 2 }}>WAITING...</span>
                    }
                    {isAdmin && !p.is_admin && (
                      <button className="btn btn-ghost btn-sm"
                        onClick={() => adminApi.kickPlayer(roomId!, p.id).catch(() => {})}>KICK</button>
                    )}
                  </div>
                </div>
              ))}

              {/* Empty slots */}
              {Array.from({ length: Math.max(0, config.max_players - players.length) }).map((_, i) => (
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
              <button
                className={`btn ${isReady ? 'btn-ghost' : 'btn-primary'}`}
                style={{ flex: 1 }}
                onClick={handleReady}
              >
                {isReady ? '✓ READY — CLICK TO UNREADY' : 'MARK READY'}
              </button>
              {isAdmin && (
                <button
                  className="btn btn-outline"
                  style={{ flex: 1 }}
                  onClick={handleStart}
                  disabled={players.length < 2}
                  title={players.length < 2 ? 'Need at least 2 players' : ''}
                >
                  {allReady ? '⚡ LAUNCH BATTLE' : `FORCE START (${readyCount}/${players.length})`}
                </button>
              )}
              {isAdmin && (
                <button className="btn btn-ghost btn-sm" onClick={() => navigate('admin', roomId || undefined)}>
                  ⚙ ADMIN
                </button>
              )}
            </div>

            {!isAdmin && (
              <p style={{ marginTop: 12, fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center' }}>
                Waiting for admin to start the match...
              </p>
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
                {roomId?.slice(-6).toUpperCase() || 'ABC123'}
              </div>
              <button className="btn btn-ghost btn-sm" style={{ width: '100%' }}
                onClick={() => navigator.clipboard.writeText(roomId?.slice(-6).toUpperCase() || '')}>
                COPY CODE
              </button>
            </div>

            {/* Ready indicator */}
            <div className="card">
              <div className="label" style={{ marginBottom: 12 }}>READINESS</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {players.map(p => (
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
                <div className="progress-fill" style={{ width: `${(readyCount / Math.max(players.length, 1)) * 100}%`, background: 'var(--success)' }} />
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
                {chat.map((msg, i) => (
                  <div key={i} style={{ fontSize: 13 }}>
                    <span style={{ color: 'var(--accent)', fontFamily: 'var(--font-display)', fontSize: 11 }}>{msg.user}: </span>
                    <span style={{ color: 'var(--text-primary)' }}>{msg.msg}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="input" placeholder="Type message..."
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && sendChat()}
                  style={{ fontSize: 13, padding: '8px 12px' }} />
                <button className="btn btn-outline btn-sm" onClick={sendChat}>SEND</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RoomLobbyPage;
