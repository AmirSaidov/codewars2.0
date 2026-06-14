// pages/DashboardPage.tsx
import React, { useState, useEffect } from 'react';
import type { Page } from '../App';
import type { User } from '../context/contexts';
import { roomsApi } from '../api';
import type { Room, CreateRoomPayload } from '../api';
import { Lock, Palette } from 'lucide-react';

interface Props {
  navigate: (p: Page, roomId?: string | number) => void;
  user: User | null;
  onLogout: () => void;
}

const DashboardPage: React.FC<Props> = ({ navigate, user, onLogout }) => {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showJoinCode, setShowJoinCode] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [joinCodePassword, setJoinCodePassword] = useState('');
  const [joinCodeError, setJoinCodeError] = useState('');
  const [joinTarget, setJoinTarget] = useState<Room | null>(null);
  const [joinPassword, setJoinPassword] = useState('');
  const [joinError, setJoinError] = useState('');
  const [createError, setCreateError] = useState('');
  const [globalError, setGlobalError] = useState('');
  const [checkingActive, setCheckingActive] = useState(true);

  const [createForm, setCreateForm] = useState<CreateRoomPayload>({
    name: '', max_players: 8, round_count: 3, is_private: false, password: '',
  });

  const fetchRooms = async () => {
    setLoading(true);
    setGlobalError('');
    try {
      const res = await roomsApi.list();
      setRooms(res.results);
    } catch {
      setRooms([]);
    } finally { setLoading(false); }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setCheckingActive(true);
      try {
        const active = await roomsApi.myActive();
        if (cancelled) return;
        if (active?.id) {
          localStorage.setItem('cz_room_id', String(active.id));
          localStorage.setItem('cz_page', 'lobby');
          navigate('lobby', active.id);
          return;
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setCheckingActive(false);
      }
      if (!cancelled) fetchRooms();
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!user?.token) onLogout();
  }, [user?.token, onLogout]);

  const handleCreate = async () => {
    if (!createForm.name.trim()) return;
    setCreateError('');
    setGlobalError('');
    try {
      const room = await roomsApi.create(createForm);
      localStorage.setItem('cz_room_id', String(room.id));
      localStorage.setItem('cz_page', 'lobby');
      navigate('lobby', room.id);
      setShowCreate(false);
    } catch (e: any) {
      setCreateError(e?.message || 'Failed to create room. Check fields and try again.');
    }
  };

  const handleJoin = async (room: Room) => {
    try {
      setGlobalError('');
      if (room.is_private) {
        setJoinTarget(room);
        setJoinPassword('');
        setJoinError('');
        return;
      }
      if (import.meta.env.DEV) console.log('[join] public start', room.id);
      await roomsApi.join(String(room.id));
      if (import.meta.env.DEV) console.log('[join] public ok', room.id);
      navigate('lobby', room.id);
    } catch (e: any) {
      const message = e?.message || 'Failed to join room';
      setGlobalError(message);
      if (import.meta.env.DEV) console.log('[join] public err', room.id, e);

      // If backend says password is invalid/required, offer the password modal even if `is_private`
      // was missing/wrong in the list response.
      if (typeof message === 'string' && message.toLowerCase().includes('password')) {
        setJoinTarget(room);
        setJoinPassword('');
        setJoinError(message);
      }
    }
  };

  const submitJoinPrivate = async () => {
    if (!joinTarget) return;
    setJoinError('');
    if (!joinPassword.trim()) {
      setJoinError('Password is required');
      return;
    }
    try {
      const targetId = joinTarget.id;
      if (import.meta.env.DEV) console.log('[join] private start', targetId);
      await roomsApi.join(String(targetId), joinPassword.trim());
      if (import.meta.env.DEV) console.log('[join] private ok', targetId);
      // ensure lobby has roomId immediately even if state batching happens
      localStorage.setItem('cz_room_id', String(targetId));
      localStorage.setItem('cz_page', 'lobby');
      navigate('lobby', targetId);
      setJoinTarget(null);
      setJoinPassword('');
    } catch (e: any) {
      setJoinError(e?.message || 'Failed to join room');
      if (import.meta.env.DEV) console.log('[join] private err', joinTarget?.id, e);
    }
  };

  const submitJoinByCode = async () => {
    const code = joinCode.trim();
    if (!code.match(/^\d+$/)) {
      setJoinCodeError('Enter a valid invite code');
      return;
    }
    setJoinCodeError('');
    setGlobalError('');
    try {
      await roomsApi.join(code, joinCodePassword.trim() || undefined);
      localStorage.setItem('cz_room_id', String(code));
      localStorage.setItem('cz_page', 'lobby');
      navigate('lobby', code);
      setShowJoinCode(false);
      setJoinCode('');
      setJoinCodePassword('');
    } catch (e: any) {
      setJoinCodeError(e?.message || 'Failed to join room');
    }
  };

  const safeRooms = Array.isArray(rooms) ? rooms : [];
  const filtered = safeRooms;

  return (
    <div className="page">
      {/* NAVBAR */}
      <nav className="navbar">
        <div className="container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 64 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 28, height: 28, background: 'var(--accent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 900, color: 'var(--bg-primary)',
              clipPath: 'polygon(0 0, 100% 0, 100% 75%, 75% 100%, 0 100%)',
            }}>CZ</div>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700, letterSpacing: 3 }}>COMMAND CENTER</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div className="dot dot-green" />
              <span style={{ fontFamily: 'var(--font-code)', fontSize: 13, color: 'var(--text-primary)' }}>
                {user?.username || 'OPERATIVE'}
              </span>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('theme-settings')}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Palette size={14} /> THEMES
              </span>
            </button>
            <button className="btn btn-ghost btn-sm" onClick={onLogout}>LOGOUT</button>
          </div>
        </div>
      </nav>

      <div className="container" style={{ paddingTop: 40, paddingBottom: 40 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32 }}>
          <div>
            <div className="section-label" style={{ marginBottom: 8 }}>ACTIVE BATTLEFIELDS</div>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 900, letterSpacing: 4 }}>
              ROOMS
            </h1>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <button className="btn btn-ghost btn-sm" onClick={fetchRooms}>↻ REFRESH</button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setJoinCode('');
                setJoinCodePassword('');
                setJoinCodeError('');
                setShowJoinCode(true);
              }}
            >
              JOIN BY CODE
            </button>
            <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ CREATE ROOM</button>
          </div>
        </div>

        <div style={{ display: 'flex', marginBottom: 24 }}>
          <span style={{ marginLeft: 'auto', color: 'var(--text-secondary)', fontFamily: 'var(--font-display)', fontSize: 11, alignSelf: 'center', letterSpacing: 2 }}>
            {filtered.length} ROOMS
          </span>
        </div>

        {/* Room list */}
        {(checkingActive || loading) ? (
          <div style={{ textAlign: 'center', padding: 80, color: 'var(--text-secondary)', fontFamily: 'var(--font-display)', letterSpacing: 3 }}>
            SCANNING ZONE...
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filtered.map((room, i) => (
              <div key={room.id} className="card fade-in" style={{
                animationDelay: `${i * 0.05}s`,
                display: 'grid',
                gridTemplateColumns: '1fr auto auto auto',
                alignItems: 'center',
                gap: 24,
                opacity: room.status === 'running' ? 0.7 : 1,
              }}>
                {/* Name + info */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    {room.is_private && (
                      <span style={{ color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center' }}>
                        <Lock size={14} />
                      </span>
                    )}
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700, letterSpacing: 2 }}>
                      {room.name}
                    </span>
                    {room.status === 'running' && (
                      <span className="tag tag-danger" style={{ fontSize: 9 }}>● LIVE</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 16 }}>
                    <span style={{ fontFamily: 'var(--font-code)', fontSize: 12, color: 'var(--text-secondary)' }}>
                      host: {room.creator?.username || 'admin'}
                    </span>
                    <span style={{ fontFamily: 'var(--font-code)', fontSize: 12, color: 'var(--text-secondary)' }}>
                      status: {room.status}
                    </span>
                  </div>
                </div>

                {/* Players */}
                <div style={{ textAlign: 'center', minWidth: 60 }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
                    {room.player_count}/{room.max_players}
                  </div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 9, letterSpacing: 2, color: 'var(--text-secondary)' }}>PLAYERS</div>
                </div>

                {/* Progress bar */}
                <div style={{ width: 80 }}>
                  <div className="progress-bar">
                    <div className="progress-fill" style={{ width: `${(room.player_count / room.max_players) * 100}%` }} />
                  </div>
                </div>

                {/* Action */}
                {room.status === 'waiting' && room.player_count < room.max_players ? (
                  <button className="btn btn-outline btn-sm" onClick={() => handleJoin(room)}>
                    JOIN
                  </button>
                ) : (
                  <button className="btn btn-ghost btn-sm" disabled>
                    {room.status === 'running' ? 'IN BATTLE' : 'FULL'}
                  </button>
                )}
              </div>
            ))}
            {filtered.length === 0 && (
              <div style={{ textAlign: 'center', padding: 64, color: 'var(--text-secondary)', fontFamily: 'var(--font-display)', letterSpacing: 3 }}>
                NO ACTIVE ZONES — CREATE ONE
              </div>
            )}
          </div>
        )}

        {globalError && (
          <div className="card" style={{ marginTop: 16, borderColor: 'var(--danger)', color: 'var(--text-primary)' }}>
            <div style={{ fontFamily: 'var(--font-display)', letterSpacing: 2, fontSize: 11, color: 'var(--danger)' }}>ERROR</div>
            <div style={{ marginTop: 8, color: 'var(--text-secondary)', fontFamily: 'var(--font-code)', fontSize: 12 }}>
              {globalError}
            </div>
          </div>
        )}
      </div>

      {/* CREATE ROOM MODAL */}
      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 18, letterSpacing: 4, marginBottom: 24 }}>ESTABLISH ZONE</h2>

            <div className="form-group">
              <label className="label">Room Name</label>
              <input className="input" placeholder="OPERATION NIGHTFALL" value={createForm.name}
                onChange={e => setCreateForm(p => ({ ...p, name: e.target.value }))} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 16 }}>
              <div className="form-group">
                <label className="label" htmlFor="maxPlayers">Max Players</label>
                <select id="maxPlayers" className="input" value={createForm.max_players}
                  onChange={e => setCreateForm(p => ({ ...p, max_players: +e.target.value }))}
                  style={{ background: 'var(--bg-secondary)', cursor: 'pointer' }}>
                  {[2, 4, 6, 8, 10].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="label" htmlFor="roundCount">Rounds</label>
                <select id="roundCount" className="input" value={createForm.round_count}
                  onChange={e => setCreateForm(p => ({ ...p, round_count: +e.target.value }))}
                  style={{ background: 'var(--bg-secondary)', cursor: 'pointer' }}>
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            </div>

            <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <input type="checkbox" id="private" checked={createForm.is_private}
                onChange={e => setCreateForm(p => ({ ...p, is_private: e.target.checked }))}
                style={{ width: 16, height: 16, cursor: 'pointer' }} />
              <label htmlFor="private" className="label" style={{ margin: 0, cursor: 'pointer' }}>PRIVATE ROOM</label>
            </div>

            {createForm.is_private && (
              <div className="form-group">
                <label className="label">Password</label>
                <input className="input" type="password" placeholder="Access code"
                  value={createForm.password}
                  onChange={e => setCreateForm(p => ({ ...p, password: e.target.value }))} />
              </div>
            )}

            {createError && <div className="form-error" style={{ marginBottom: 16 }}>{createError}</div>}

            <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
              <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setShowCreate(false)}>CANCEL</button>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleCreate}>DEPLOY</button>
            </div>
          </div>
        </div>
      )}

      {/* JOIN BY CODE MODAL */}
      {showJoinCode && (
        <div className="modal-overlay" onClick={() => setShowJoinCode(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 18, letterSpacing: 4, marginBottom: 24 }}>
              ENTER INVITE CODE
            </h2>

            <div className="form-group">
              <label className="label">Invite Code</label>
              <input
                className="input"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submitJoinByCode()}
                placeholder="e.g. 10"
                inputMode="numeric"
              />
            </div>

            <div className="form-group">
              <label className="label">Password (optional)</label>
              <input
                className="input"
                type="password"
                value={joinCodePassword}
                onChange={(e) => setJoinCodePassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submitJoinByCode()}
                placeholder="if room is private"
              />
            </div>

            {joinCodeError && <div className="form-error" style={{ marginBottom: 16 }}>{joinCodeError}</div>}
            <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
              <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setShowJoinCode(false)}>CANCEL</button>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={submitJoinByCode}>JOIN</button>
            </div>
          </div>
        </div>
      )}

      {/* JOIN PRIVATE ROOM MODAL */}
      {joinTarget && (
        <div className="modal-overlay" onClick={() => setJoinTarget(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 18, letterSpacing: 4, marginBottom: 24 }}>
              ENTER ACCESS CODE
            </h2>
            <div style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-code)', fontSize: 12, marginBottom: 12 }}>
              {joinTarget.name}
            </div>
            <div className="form-group">
              <label className="label">Password</label>
              <input
                className="input"
                type="password"
                value={joinPassword}
                onChange={e => setJoinPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && submitJoinPrivate()}
                placeholder="room password"
              />
            </div>
            {joinError && <div className="form-error" style={{ marginBottom: 16 }}>{joinError}</div>}
            <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
              <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setJoinTarget(null)}>CANCEL</button>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={submitJoinPrivate}>JOIN</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DashboardPage;
