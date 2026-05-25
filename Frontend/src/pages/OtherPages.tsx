// pages/AdminPanelPage.tsx
import React, { useState, useEffect } from 'react';
import type { Page } from '../App';
import type { User } from '../context/contexts';
import { adminApi, tasksApi } from '../api';
import type { Submission, RoomPlayer, Task } from '../api';

interface Props {
  navigate: (p: Page, roomId?: string) => void;
  user: User | null;
  roomId: string | null;
}

const MOCK_SUBMISSIONS: (Submission & { username: string })[] = [
  {
    id: 's1', player_id: 'p2', room_id: 'r1', round_number: 1,
    code: `def solution(nums, target):\n    seen = {}\n    for i, num in enumerate(nums):\n        complement = target - num\n        if complement in seen:\n            return [seen[complement], i]\n        seen[num] = i\n    return []`,
    language: 'python3', status: 'accepted', execution_time: 145, memory_used: 12,
    submitted_at: new Date().toISOString(), username: 'dark_coder',
    test_results: [{ passed: true, input: '[2,7,11,15]\n9', expected: '[0,1]' }],
  },
  {
    id: 's2', player_id: 'p4', room_id: 'r1', round_number: 1,
    code: `def solution(nums, target):\n    for i in range(len(nums)):\n        for j in range(i+1, len(nums)):\n            if nums[i] + nums[j] == target:\n                return [i, j]`,
    language: 'python3', status: 'time_limit_exceeded', execution_time: 3200, memory_used: 14,
    submitted_at: new Date().toISOString(), username: 'neon_blade',
    test_results: [{ passed: false, input: '[large array]', expected: '[0,1]', got: 'TLE' }],
  },
];

const MOCK_PLAYERS: RoomPlayer[] = [
  { id: 'p1', username: 'ghost_sniper', is_ready: true, is_admin: true, is_eliminated: false, score: 0, current_round: 1 },
  { id: 'p2', username: 'dark_coder', is_ready: true, is_admin: false, is_eliminated: false, score: 0, current_round: 1 },
  { id: 'p3', username: 'void_runner', is_ready: true, is_admin: false, is_eliminated: true, score: 0, current_round: 1 },
  { id: 'p4', username: 'neon_blade', is_ready: true, is_admin: false, is_eliminated: false, score: 0, current_round: 1 },
];

export const AdminPanelPage: React.FC<Props> = ({ navigate, user: _user, roomId }) => {
  const [submissions, setSubmissions] = useState(MOCK_SUBMISSIONS);
  const [players] = useState(MOCK_PLAYERS);
  const [selectedSub, setSelectedSub] = useState<typeof MOCK_SUBMISSIONS[0] | null>(null);
  const [tab, setTab] = useState<'submissions' | 'players' | 'tasks'>('submissions');
  const [tasks, setTasks] = useState<Task[]>([]);

  useEffect(() => {
    tasksApi.list().then(r => setTasks(r.results)).catch(() => {});
  }, []);

  const handleAccept = async (sub: typeof MOCK_SUBMISSIONS[0]) => {
    try { await adminApi.acceptSubmission(roomId!, sub.id); } catch {}
    setSubmissions(s => s.map(x => x.id === sub.id ? { ...x, status: 'accepted' } : x));
    setSelectedSub(null);
  };

  const handleReject = async (sub: typeof MOCK_SUBMISSIONS[0]) => {
    try { await adminApi.rejectSubmission(roomId!, sub.id); } catch {}
    setSubmissions(s => s.map(x => x.id === sub.id ? { ...x, status: 'wrong_answer' } : x));
    setSelectedSub(null);
  };

  const handleAdvance = async (playerId: string) => {
    try { await adminApi.advancePlayer(roomId!, playerId); } catch {}
  };

  const statusColor = (s: string) =>
    s === 'accepted' ? 'var(--success)' :
    s === 'time_limit_exceeded' ? 'var(--warn)' : 'var(--danger)';

  return (
    <div className="page">
      <nav className="navbar">
        <div className="container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 64 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('lobby', roomId || undefined)}>← LOBBY</button>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700, letterSpacing: 3, color: 'var(--accent)' }}>
              ADMIN PANEL
            </span>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <button className="btn btn-danger btn-sm" onClick={() => adminApi.stopMatch(roomId!).catch(() => {})}>
              ■ END MATCH
            </button>
            <button className="btn btn-outline btn-sm" onClick={() => adminApi.restartRound(roomId!).catch(() => {})}>
              ↺ RESTART ROUND
            </button>
          </div>
        </div>
      </nav>

      <div className="container" style={{ paddingTop: 32, paddingBottom: 32 }}>
        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)', marginBottom: 28 }}>
          {(['submissions', 'players', 'tasks'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '12px 24px', background: 'none', border: 'none',
              borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
              color: tab === t ? 'var(--accent)' : 'var(--text-secondary)',
              fontFamily: 'var(--font-display)', fontSize: 11, letterSpacing: 2, cursor: 'pointer',
              textTransform: 'uppercase',
            }}>
              {t}
              {t === 'submissions' && (
                <span style={{ marginLeft: 8, background: 'var(--accent)', color: 'var(--bg-primary)', borderRadius: 2, padding: '1px 6px', fontSize: 10 }}>
                  {submissions.filter(s => s.status !== 'accepted').length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* SUBMISSIONS TAB */}
        {tab === 'submissions' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
            <div>
              <div className="section-label" style={{ marginBottom: 16 }}>ALL SUBMISSIONS</div>
              {submissions.map(sub => (
                <div key={sub.id}
                  className={`card ${selectedSub?.id === sub.id ? 'card-glow' : ''}`}
                  style={{ marginBottom: 8, cursor: 'pointer' }}
                  onClick={() => setSelectedSub(sub)}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div className="avatar">{sub.username[0]}</div>
                      <span style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700 }}>{sub.username}</span>
                    </div>
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: 10, letterSpacing: 2, color: statusColor(sub.status), textTransform: 'uppercase' }}>
                      {sub.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 16 }}>
                    {sub.execution_time && <span style={{ fontFamily: 'var(--font-code)', fontSize: 11, color: 'var(--text-secondary)' }}>{sub.execution_time}ms</span>}
                    <span style={{ fontFamily: 'var(--font-code)', fontSize: 11, color: 'var(--text-secondary)' }}>Round {sub.round_number}</span>
                    <span style={{ fontFamily: 'var(--font-code)', fontSize: 11, color: 'var(--text-secondary)' }}>{new Date(sub.submitted_at).toLocaleTimeString()}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Code viewer */}
            <div>
              {selectedSub ? (
                <div>
                  <div className="section-label" style={{ marginBottom: 16 }}>CODE REVIEW — {selectedSub.username}</div>
                  <div style={{
                    background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 2,
                    padding: 16, marginBottom: 16, fontFamily: 'var(--font-code)', fontSize: 13,
                    lineHeight: 1.7, overflow: 'auto', maxHeight: 360, whiteSpace: 'pre',
                    color: 'var(--text-primary)',
                  }}>
                    {selectedSub.code}
                  </div>

                  {selectedSub.test_results && (
                    <div style={{ marginBottom: 16 }}>
                      <div className="label" style={{ marginBottom: 8 }}>TEST RESULTS</div>
                      {selectedSub.test_results.map((t, i) => (
                        <div key={i} style={{
                          padding: '8px 12px', marginBottom: 4, borderRadius: 2,
                          border: `1px solid ${t.passed ? 'var(--success)' : 'var(--danger)'}`,
                          display: 'flex', justifyContent: 'space-between',
                          fontSize: 12, fontFamily: 'var(--font-code)',
                        }}>
                          <span style={{ color: 'var(--text-secondary)' }}>Test #{i + 1}</span>
                          <span style={{ color: t.passed ? 'var(--success)' : 'var(--danger)' }}>{t.passed ? '✓ PASS' : '✗ FAIL'}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => handleAccept(selectedSub)}>
                      ✓ ACCEPT
                    </button>
                    <button className="btn btn-danger" style={{ flex: 1 }} onClick={() => handleReject(selectedSub)}>
                      ✗ REJECT
                    </button>
                    <button className="btn btn-outline btn-sm" onClick={() => handleAdvance(selectedSub.player_id)}>
                      ADVANCE
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-secondary)' }}>
                  <div style={{ fontSize: 32, marginBottom: 12 }}>👆</div>
                  <p style={{ fontFamily: 'var(--font-display)', fontSize: 12, letterSpacing: 2 }}>SELECT A SUBMISSION TO REVIEW</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* PLAYERS TAB */}
        {tab === 'players' && (
          <div>
            <div className="section-label" style={{ marginBottom: 16 }}>PLAYER MANAGEMENT</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {players.map(p => (
                <div key={p.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 16, opacity: p.is_eliminated ? 0.5 : 1 }}>
                  <div className="avatar">{p.username[0]}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700 }}>{p.username}</span>
                      {p.is_admin && <span className="tag tag-accent" style={{ fontSize: 9 }}>ADMIN</span>}
                      {p.is_eliminated && <span className="tag tag-danger" style={{ fontSize: 9 }}>ELIMINATED</span>}
                    </div>
                    <span style={{ fontFamily: 'var(--font-code)', fontSize: 11, color: 'var(--text-secondary)' }}>
                      Round {p.current_round}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {!p.is_admin && !p.is_eliminated && (
                      <>
                        <button className="btn btn-outline btn-sm" onClick={() => handleAdvance(p.id)}>ADVANCE</button>
                        <button className="btn btn-danger btn-sm" onClick={() => adminApi.kickPlayer(roomId!, p.id).catch(() => {})}>KICK</button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TASKS TAB */}
        {tab === 'tasks' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <div className="section-label">TASK LIBRARY</div>
              <button className="btn btn-primary btn-sm">+ CREATE TASK</button>
            </div>
            {tasks.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-secondary)' }}>
                <p style={{ fontFamily: 'var(--font-display)', fontSize: 12, letterSpacing: 2 }}>CONNECT TO BACKEND TO LOAD TASKS</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {tasks.map(t => (
                  <div key={t.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <div style={{ flex: 1 }}>
                      <span style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700 }}>{t.title}</span>
                    </div>
                    <span className={`tag ${t.difficulty === 'easy' ? 'tag-success' : t.difficulty === 'medium' ? 'tag-warn' : 'tag-danger'}`}>
                      {t.difficulty}
                    </span>
                    <button className="btn btn-outline btn-sm" onClick={() => adminApi.selectTask(roomId!, t.id).catch(() => {})}>
                      SELECT
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminPanelPage;

// ─────────────────────────────────────────────────────────────────
// pages/MatchResultsPage.tsx
// ─────────────────────────────────────────────────────────────────
interface ResultsProps {
  navigate: (p: any, roomId?: string) => void;
  roomId: string | null;
}

const MOCK_RESULT = {
  winner: { username: 'ghost_sniper', id: 'p1' },
  players: [
    { id: 'p1', username: 'ghost_sniper', final_rank: 1, solved_rounds: 3, is_eliminated: false },
    { id: 'p2', username: 'dark_coder', final_rank: 2, solved_rounds: 2, is_eliminated: true },
    { id: 'p4', username: 'neon_blade', final_rank: 3, solved_rounds: 1, is_eliminated: true },
    { id: 'p3', username: 'void_runner', final_rank: 4, solved_rounds: 0, is_eliminated: true },
  ],
  duration_seconds: 847,
};

export const MatchResultsPage: React.FC<ResultsProps> = ({ navigate, roomId }) => {
  const [result] = useState(MOCK_RESULT);

  const rankIcon = (r: number) => r === 1 ? '🏆' : r === 2 ? '🥈' : r === 3 ? '🥉' : `#${r}`;

  return (
    <div className="page" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 600 }} className="fade-in">
        {/* Winner */}
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <div style={{ fontSize: 64, marginBottom: 16 }}>🏆</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 11, letterSpacing: 4, color: 'var(--text-secondary)', marginBottom: 8 }}>
            CHAMPION
          </div>
          <div style={{
            fontFamily: 'var(--font-display)', fontSize: 42, fontWeight: 900,
            color: 'var(--accent)', letterSpacing: 4,
            textShadow: '0 0 40px var(--accent-glow)',
          }}>
            {result.winner.username.toUpperCase()}
          </div>
          <div style={{ marginTop: 12, fontFamily: 'var(--font-code)', fontSize: 13, color: 'var(--text-secondary)' }}>
            Match duration: {Math.floor(result.duration_seconds / 60)}m {result.duration_seconds % 60}s
          </div>
        </div>

        {/* Rankings */}
        <div className="card card-glow" style={{ marginBottom: 24 }}>
          <div className="section-label" style={{ marginBottom: 16 }}>FINAL STANDINGS</div>
          {result.players.map((p, i) => (
            <div key={p.id} style={{
              display: 'flex', alignItems: 'center', gap: 16,
              padding: '14px 0',
              borderBottom: i < result.players.length - 1 ? '1px solid var(--border)' : 'none',
            }}>
              <div style={{
                width: 32, fontFamily: 'var(--font-display)', fontSize: 18,
                textAlign: 'center', flexShrink: 0,
              }}>
                {rankIcon(p.final_rank)}
              </div>
              <div className="avatar">{p.username[0]}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700, letterSpacing: 2 }}>
                  {p.username}
                </div>
                <div style={{ fontFamily: 'var(--font-code)', fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                  {p.solved_rounds} round{p.solved_rounds !== 1 ? 's' : ''} solved
                </div>
              </div>
              {p.is_eliminated && <span className="tag tag-danger" style={{ fontSize: 9 }}>ELIMINATED</span>}
              {!p.is_eliminated && <span className="tag tag-success" style={{ fontSize: 9 }}>WINNER</span>}
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => navigate('lobby', roomId || undefined)}>
            PLAY AGAIN
          </button>
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => navigate('dashboard')}>
            COMMAND CENTER
          </button>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────
// pages/ThemeSettingsPage.tsx
// ─────────────────────────────────────────────────────────────────
import { useTheme } from '../context/contexts';
import type { Theme } from '../context/contexts';

interface ThemeProps {
  navigate: (p: any) => void;
}

const THEMES: { id: Theme; name: string; desc: string; preview: { bg: string; accent: string; text: string } }[] = [
  {
    id: 'stalker', name: 'STALKER', desc: 'Dark survival style with tactical orange accents and scan lines',
    preview: { bg: '#0a0b0d', accent: '#e87c2a', text: '#d4c9b0' },
  },
  {
    id: 'cyberpunk', name: 'CYBERPUNK', desc: 'Neon UI with purple/cyan colors and glow effects',
    preview: { bg: '#08050f', accent: '#00f5ff', text: '#e0d0ff' },
  },
  {
    id: 'hacker', name: 'HACKER TERMINAL', desc: 'Green terminal style with hacker atmosphere',
    preview: { bg: '#000800', accent: '#00ff41', text: '#00cc33' },
  },
  {
    id: 'minimal', name: 'MINIMAL', desc: 'Clean Apple-style UI with white/black minimalism',
    preview: { bg: '#fafafa', accent: '#1a1a1a', text: '#111111' },
  },
];

export const ThemeSettingsPage: React.FC<ThemeProps> = ({ navigate }) => {
  const { theme, setTheme } = useTheme();

  return (
    <div className="page">
      <nav className="navbar">
        <div className="container" style={{ display: 'flex', alignItems: 'center', height: 64, gap: 16 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('dashboard')}>← BACK</button>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700, letterSpacing: 3 }}>VISUAL THEMES</span>
        </div>
      </nav>

      <div className="container" style={{ paddingTop: 48, paddingBottom: 48 }}>
        <div className="section-label" style={{ marginBottom: 32 }}>SELECT YOUR INTERFACE THEME</div>
        <div className="grid-2" style={{ gap: 20 }}>
          {THEMES.map(t => (
            <div
              key={t.id}
              onClick={() => setTheme(t.id)}
              style={{
                border: `2px solid ${theme === t.id ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: 4, overflow: 'hidden', cursor: 'pointer',
                transition: 'all 0.2s',
                boxShadow: theme === t.id ? '0 0 20px var(--accent-glow)' : 'none',
              }}>
              {/* Theme preview */}
              <div style={{ background: t.preview.bg, padding: 20, height: 120, position: 'relative' }}>
                {/* Mini UI elements */}
                <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                  <div style={{ height: 6, width: 60, background: t.preview.accent, borderRadius: 1, opacity: 0.8 }} />
                  <div style={{ height: 6, width: 40, background: t.preview.text, borderRadius: 1, opacity: 0.3 }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {[80, 60, 90].map((w, i) => (
                    <div key={i} style={{ height: 4, width: `${w}%`, background: t.preview.text, borderRadius: 1, opacity: 0.2 }} />
                  ))}
                </div>
                <div style={{
                  position: 'absolute', bottom: 12, right: 16,
                  background: t.preview.accent, borderRadius: 2,
                  padding: '4px 12px',
                  fontFamily: 'monospace', fontSize: 10, fontWeight: 700,
                  color: t.preview.bg,
                }}>
                  BTN
                </div>
                {theme === t.id && (
                  <div style={{
                    position: 'absolute', top: 8, right: 8,
                    background: t.preview.accent, borderRadius: 2,
                    width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, color: t.preview.bg, fontWeight: 900,
                  }}>✓</div>
                )}
              </div>

              <div style={{ padding: '16px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700, letterSpacing: 2 }}>{t.name}</span>
                  {theme === t.id && <span className="tag tag-accent" style={{ fontSize: 9 }}>ACTIVE</span>}
                </div>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{t.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
