// pages/DashboardPage.tsx
import React, { useState, useEffect } from 'react';
import type { Page } from '../App';
import type { User } from '../context/contexts';
import { roomsApi } from '../api';
import type { Room, CreateRoomPayload } from '../api';

interface Props {
  navigate: (p: Page, roomId?: string) => void;
  user: User | null;
  onLogout: () => void;
}

const MOCK_ROOMS: Room[] = [
  { id: 'r1', name: 'STALKER BOOTCAMP', host_id: 'u1', max_players: 8, current_players: 5, is_private: false, rounds: 3, difficulty: 'medium', status: 'waiting', created_at: new Date().toISOString() },
  { id: 'r2', name: 'PYTHON ELITE', host_id: 'u2', max_players: 6, current_players: 6, is_private: false, rounds: 5, difficulty: 'hard', status: 'in_progress', created_at: new Date().toISOString() },
  { id: 'r3', name: 'NEWBIE ARENA', host_id: 'u3', max_players: 10, current_players: 2, is_private: false, rounds: 2, difficulty: 'easy', status: 'waiting', created_at: new Date().toISOString() },
  { id: 'r4', name: 'NIGHT RAID', host_id: 'u4', max_players: 4, current_players: 1, is_private: true, rounds: 4, difficulty: 'hard', status: 'waiting', created_at: new Date().toISOString() },
];

const DashboardPage: React.FC<Props> = ({ navigate, user, onLogout }) => {
  const [rooms, setRooms] = useState<Room[]>(MOCK_ROOMS);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [filter, setFilter] = useState<'all' | 'easy' | 'medium' | 'hard'>('all');

  const [createForm, setCreateForm] = useState<CreateRoomPayload>({
    name: '', max_players: 8, is_private: false, password: '',
    rounds: 3, difficulty: 'medium',
  });

  const fetchRooms = async () => {
    setLoading(true);
    try {
      const res = await roomsApi.list();
      setRooms(res.results);
    } catch {
      // use mock in dev
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchRooms(); }, []);

  const handleCreate = async () => {
    if (!createForm.name.trim()) return;
    try {
      const room = await roomsApi.create(createForm);
      navigate('lobby', room.id);
    } catch {
      // mock nav
      navigate('lobby', 'new-room-' + Date.now());
    }
    setShowCreate(false);
  };

  const handleJoin = async (room: Room) => {
    try {
      await roomsApi.join(room.id);
    } catch {}
    navigate('lobby', room.id);
  };

  const filtered = rooms.filter(r => filter === 'all' || r.difficulty === filter);

  const diffColor = (d: string) => d === 'easy' ? 'var(--success)' : d === 'medium' ? 'var(--warn)' : 'var(--danger)';

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
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('theme-settings')}>🎨 THEMES</button>
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
            <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ CREATE ROOM</button>
          </div>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
          {(['all', 'easy', 'medium', 'hard'] as const).map(f => (
            <button
              key={f}
              className={`btn btn-sm ${filter === f ? 'btn-outline' : 'btn-ghost'}`}
              onClick={() => setFilter(f)}
            >
              {f.toUpperCase()}
            </button>
          ))}
          <span style={{ marginLeft: 'auto', color: 'var(--text-secondary)', fontFamily: 'var(--font-display)', fontSize: 11, alignSelf: 'center', letterSpacing: 2 }}>
            {filtered.length} ROOMS
          </span>
        </div>

        {/* Room list */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: 80, color: 'var(--text-secondary)', fontFamily: 'var(--font-display)', letterSpacing: 3 }}>
            SCANNING ZONE...
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filtered.map((room, i) => (
              <div key={room.id} className="card fade-in" style={{
                animationDelay: `${i * 0.05}s`,
                display: 'grid',
                gridTemplateColumns: '1fr auto auto auto auto',
                alignItems: 'center',
                gap: 24,
                opacity: room.status === 'in_progress' ? 0.7 : 1,
              }}>
                {/* Name + info */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    {room.is_private && <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>🔒</span>}
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700, letterSpacing: 2 }}>
                      {room.name}
                    </span>
                    {room.status === 'in_progress' && (
                      <span className="tag tag-danger" style={{ fontSize: 9 }}>● LIVE</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 16 }}>
                    <span style={{ fontFamily: 'var(--font-code)', fontSize: 12, color: 'var(--text-secondary)' }}>
                      {room.rounds} rounds
                    </span>
                    <span style={{ fontFamily: 'var(--font-code)', fontSize: 12, color: 'var(--text-secondary)' }}>
                      Python 3.10
                    </span>
                  </div>
                </div>

                {/* Difficulty */}
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 11, letterSpacing: 2, color: diffColor(room.difficulty), textTransform: 'uppercase' }}>
                  {room.difficulty}
                </div>

                {/* Players */}
                <div style={{ textAlign: 'center', minWidth: 60 }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
                    {room.current_players}/{room.max_players}
                  </div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 9, letterSpacing: 2, color: 'var(--text-secondary)' }}>PLAYERS</div>
                </div>

                {/* Progress bar */}
                <div style={{ width: 80 }}>
                  <div className="progress-bar">
                    <div className="progress-fill" style={{ width: `${(room.current_players / room.max_players) * 100}%` }} />
                  </div>
                </div>

                {/* Action */}
                {room.status === 'waiting' && room.current_players < room.max_players ? (
                  <button className="btn btn-outline btn-sm" onClick={() => handleJoin(room)}>
                    JOIN
                  </button>
                ) : (
                  <button className="btn btn-ghost btn-sm" disabled>
                    {room.status === 'in_progress' ? 'IN BATTLE' : 'FULL'}
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

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div className="form-group">
                <label className="label">Max Players</label>
                <select className="input" value={createForm.max_players}
                  onChange={e => setCreateForm(p => ({ ...p, max_players: +e.target.value }))}
                  style={{ background: 'var(--bg-secondary)', cursor: 'pointer' }}>
                  {[2, 4, 6, 8, 10].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="label">Rounds</label>
                <select className="input" value={createForm.rounds}
                  onChange={e => setCreateForm(p => ({ ...p, rounds: +e.target.value }))}
                  style={{ background: 'var(--bg-secondary)', cursor: 'pointer' }}>
                  {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            </div>

            <div className="form-group">
              <label className="label">Difficulty</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {(['easy', 'medium', 'hard'] as const).map(d => (
                  <button key={d} className={`btn btn-sm ${createForm.difficulty === d ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setCreateForm(p => ({ ...p, difficulty: d }))}>
                    {d.toUpperCase()}
                  </button>
                ))}
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

            <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
              <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setShowCreate(false)}>CANCEL</button>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleCreate}>DEPLOY</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DashboardPage;
