// pages/BattleArenaPage.tsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { Page } from '../App';
import type { User } from '../context/contexts';
import { submissionsApi, createRoomWS } from '../api';
import type { WSEvent, Task, RoomPlayer, Submission } from '../api';

interface Props {
  navigate: (p: Page, roomId?: string) => void;
  user: User | null;
  roomId: string | null;
}

const MOCK_TASK: Task = {
  id: 't1',
  title: 'Two Sum',
  description: `Given an array of integers \`nums\` and an integer \`target\`, return indices of the two numbers such that they add up to target.\n\nYou may assume that each input would have exactly one solution, and you may not use the same element twice.\n\nYou can return the answer in any order.`,
  input_format: 'First line: space-separated integers\nSecond line: target integer',
  output_format: 'Two space-separated integers (0-indexed positions)',
  examples: [
    { input: '[2,7,11,15]\n9', output: '[0,1]', explanation: 'nums[0] + nums[1] = 2 + 7 = 9' },
    { input: '[3,2,4]\n6', output: '[1,2]' },
  ],
  visible_tests: [
    { input: '[2,7,11,15]\n9', output: '[0,1]' },
    { input: '[3,2,4]\n6', output: '[1,2]' },
  ],
  difficulty: 'easy',
  time_limit: 2,
  memory_limit: 256,
};

const MOCK_PLAYERS: (RoomPlayer & { submit_time?: number })[] = [
  { id: 'p1', username: 'ghost_sniper', is_ready: true, is_admin: true, is_eliminated: false, score: 0, current_round: 1, submit_time: 45 },
  { id: 'p2', username: 'dark_coder', is_ready: true, is_admin: false, is_eliminated: false, score: 0, current_round: 1 },
  { id: 'p3', username: 'void_runner', is_ready: true, is_admin: false, is_eliminated: true, score: 0, current_round: 1 },
  { id: 'p4', username: 'neon_blade', is_ready: true, is_admin: false, is_eliminated: false, score: 0, current_round: 1 },
];

const DEFAULT_CODE = `def solution(nums, target):
    # Write your solution here
    seen = {}
    for i, num in enumerate(nums):
        complement = target - num
        if complement in seen:
            return [seen[complement], i]
        seen[num] = i
    return []

# Read input
import sys
data = sys.stdin.read().split()
# Parse and call solution
`;

const useTimer = (initial: number) => {
  const [time, setTime] = useState(initial);
  const ref = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    ref.current = setInterval(() => {
      setTime(t => {
        if (t <= 0) { clearInterval(ref.current!); return 0; }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(ref.current!);
  }, []);

  return time;
};

const formatTime = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
};

const BattleArenaPage: React.FC<Props> = ({ navigate, user, roomId }) => {
  const [code, setCode] = useState(DEFAULT_CODE);
  const [players, setPlayers] = useState(MOCK_PLAYERS);
  const [task] = useState<Task>(MOCK_TASK);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [round, setRound] = useState(1);
  const [totalRounds] = useState(3);
  const [activeTab, setActiveTab] = useState<'problem' | 'results'>('problem');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const time = useTimer(300); // 5 min

  const timerClass = time < 30 ? 'critical' : time < 60 ? 'warning' : '';

  // WebSocket
  useEffect(() => {
    if (!roomId || !user?.token) return;
    const socket = createRoomWS(roomId, user.token);
    socket.onmessage = (e) => {
      try {
        const event: WSEvent = JSON.parse(e.data);
        handleWSEvent(event);
      } catch {}
    };
    return () => socket.close();
  }, [roomId, user?.token]);

  const handleWSEvent = useCallback((event: WSEvent) => {
    switch (event.type) {
      case 'leaderboard_updated':
        setPlayers(event.payload.players);
        break;
      case 'player_eliminated':
        setPlayers(p => p.map(x => x.id === event.payload.player_id ? { ...x, is_eliminated: true } : x));
        break;
      case 'solution_accepted':
        setPlayers(p => p.map(x => x.id === event.payload.player_id
          ? { ...x, submit_time: event.payload.time_seconds } : x));
        break;
      case 'round_started':
        setRound(event.payload.round);
        setSubmission(null);
        setCode(DEFAULT_CODE);
        break;
      case 'match_finished':
        navigate('results', roomId || undefined);
        break;
    }
  }, [navigate, roomId]);

  const handleSubmit = async () => {
    if (submitting || !code.trim()) return;
    setSubmitting(true);
    setActiveTab('results');
    try {
      const result = await submissionsApi.submit(roomId!, code, 'python3');
      setSubmission(result);
    } catch {
      // mock
      setSubmission({
        id: 'sub1', player_id: user?.id || '', room_id: roomId || '',
        round_number: round, code, language: 'python3',
        status: Math.random() > 0.3 ? 'accepted' : 'wrong_answer',
        execution_time: 234, memory_used: 14,
        test_results: MOCK_TASK.visible_tests.map(t => ({ passed: Math.random() > 0.3, input: t.input, expected: t.output })),
        submitted_at: new Date().toISOString(),
      });
    } finally { setSubmitting(false); }
  };

  // Handle tab in textarea
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = e.currentTarget.selectionStart;
      const end = e.currentTarget.selectionEnd;
      const newCode = code.substring(0, start) + '    ' + code.substring(end);
      setCode(newCode);
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = textareaRef.current.selectionEnd = start + 4;
        }
      }, 0);
    }
  };

  const statusLabel = (s: Submission['status']) => {
    const map: Record<string, { label: string; cls: string }> = {
      accepted: { label: 'ACCEPTED', cls: 'status-accepted' },
      wrong_answer: { label: 'WRONG ANSWER', cls: 'status-wrong' },
      runtime_error: { label: 'RUNTIME ERROR', cls: 'status-wrong' },
      time_limit_exceeded: { label: 'TIME LIMIT', cls: 'status-tle' },
      compilation_error: { label: 'COMPILE ERROR', cls: 'status-wrong' },
      pending: { label: 'JUDGING...', cls: 'status-pending' },
    };
    return map[s] || { label: s.toUpperCase(), cls: 'status-pending' };
  };

  const sortedPlayers = [...players].sort((a, b) => {
    if (a.is_eliminated && !b.is_eliminated) return 1;
    if (!a.is_eliminated && b.is_eliminated) return -1;
    const at = (a as any).submit_time;
    const bt = (b as any).submit_time;
    if (at && bt) return at - bt;
    if (at) return -1;
    if (bt) return 1;
    return 0;
  });

  return (
    <div className="page" style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      {/* TOP BAR */}
      <div style={{
        height: 52, background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', padding: '0 16px', gap: 24, flexShrink: 0,
      }}>
        {/* Round info */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 10, letterSpacing: 3, color: 'var(--text-secondary)' }}>ROUND</span>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 900, color: 'var(--accent)' }}>{round}</span>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 10, color: 'var(--text-secondary)' }}>/ {totalRounds}</span>
        </div>

        <div style={{ width: 1, height: 24, background: 'var(--border)' }} />

        {/* Task name */}
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700, letterSpacing: 2 }}>{task.title}</span>
        <span className={`tag ${task.difficulty === 'easy' ? 'tag-success' : task.difficulty === 'medium' ? 'tag-warn' : 'tag-danger'}`} style={{ fontSize: 9 }}>
          {task.difficulty.toUpperCase()}
        </span>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Timer */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div className={`timer-display ${timerClass}`} style={{ fontSize: 28, letterSpacing: 3 }}>
            {formatTime(time)}
          </div>
        </div>

        <div style={{ width: 1, height: 24, background: 'var(--border)' }} />

        {/* User */}
        <span style={{ fontFamily: 'var(--font-code)', fontSize: 12, color: 'var(--text-secondary)' }}>
          {user?.username}
        </span>
      </div>

      {/* MAIN CONTENT */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '380px 1fr 260px', overflow: 'hidden' }}>

        {/* LEFT — Problem + Results */}
        <div style={{ borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Tabs */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            {(['problem', 'results'] as const).map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)} style={{
                flex: 1, padding: '12px', background: activeTab === tab ? 'var(--bg-card)' : 'transparent',
                border: 'none', borderBottom: activeTab === tab ? `2px solid var(--accent)` : '2px solid transparent',
                color: activeTab === tab ? 'var(--accent)' : 'var(--text-secondary)',
                fontFamily: 'var(--font-display)', fontSize: 11, letterSpacing: 2, cursor: 'pointer',
                textTransform: 'uppercase',
              }}>
                {tab}
                {tab === 'results' && submission && (
                  <span style={{ marginLeft: 6, color: submission.status === 'accepted' ? 'var(--success)' : 'var(--danger)', fontSize: 10 }}>●</span>
                )}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
            {activeTab === 'problem' && (
              <div>
                <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, letterSpacing: 2, marginBottom: 12 }}>
                  {task.title}
                </h2>
                <p style={{ color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.7, marginBottom: 20 }}>
                  {task.description}
                </p>

                <div style={{ marginBottom: 16 }}>
                  <div className="label" style={{ marginBottom: 6 }}>INPUT FORMAT</div>
                  <p style={{ fontFamily: 'var(--font-code)', fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{task.input_format}</p>
                </div>

                <div style={{ marginBottom: 20 }}>
                  <div className="label" style={{ marginBottom: 6 }}>OUTPUT FORMAT</div>
                  <p style={{ fontFamily: 'var(--font-code)', fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{task.output_format}</p>
                </div>

                <div className="label" style={{ marginBottom: 12 }}>EXAMPLES</div>
                {task.examples.map((ex, i) => (
                  <div key={i} style={{ marginBottom: 16, border: '1px solid var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
                      <div style={{ padding: '10px 12px', borderRight: '1px solid var(--border)' }}>
                        <div className="label" style={{ fontSize: 9, marginBottom: 6 }}>INPUT</div>
                        <pre style={{ fontFamily: 'var(--font-code)', fontSize: 12, color: 'var(--text-primary)', whiteSpace: 'pre-wrap', margin: 0 }}>{ex.input}</pre>
                      </div>
                      <div style={{ padding: '10px 12px' }}>
                        <div className="label" style={{ fontSize: 9, marginBottom: 6 }}>OUTPUT</div>
                        <pre style={{ fontFamily: 'var(--font-code)', fontSize: 12, color: 'var(--success)', whiteSpace: 'pre-wrap', margin: 0 }}>{ex.output}</pre>
                      </div>
                    </div>
                    {ex.explanation && (
                      <div style={{ padding: '8px 12px', background: 'var(--bg-secondary)', borderTop: '1px solid var(--border)', fontSize: 12, color: 'var(--text-secondary)' }}>
                        {ex.explanation}
                      </div>
                    )}
                  </div>
                ))}

                <div style={{ marginTop: 12, display: 'flex', gap: 16 }}>
                  <span style={{ fontFamily: 'var(--font-code)', fontSize: 11, color: 'var(--text-secondary)' }}>⏱ {task.time_limit}s</span>
                  <span style={{ fontFamily: 'var(--font-code)', fontSize: 11, color: 'var(--text-secondary)' }}>💾 {task.memory_limit}MB</span>
                </div>
              </div>
            )}

            {activeTab === 'results' && (
              <div>
                {!submission && !submitting && (
                  <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-secondary)' }}>
                    <div style={{ fontSize: 32, marginBottom: 12 }}>⌨️</div>
                    <p style={{ fontFamily: 'var(--font-display)', fontSize: 12, letterSpacing: 2 }}>SUBMIT YOUR CODE TO SEE RESULTS</p>
                  </div>
                )}
                {submitting && (
                  <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--accent)' }}>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, letterSpacing: 3 }} className="pulse">JUDGING...</div>
                  </div>
                )}
                {submission && !submitting && (
                  <div>
                    <div style={{ marginBottom: 20 }}>
                      <span className={`status-badge ${statusLabel(submission.status).cls}`}>
                        {statusLabel(submission.status).label}
                      </span>
                    </div>
                    {submission.execution_time && (
                      <div style={{ display: 'flex', gap: 20, marginBottom: 16 }}>
                        <div>
                          <div className="label">EXEC TIME</div>
                          <div style={{ fontFamily: 'var(--font-code)', color: 'var(--accent)' }}>{submission.execution_time}ms</div>
                        </div>
                        <div>
                          <div className="label">MEMORY</div>
                          <div style={{ fontFamily: 'var(--font-code)', color: 'var(--accent)' }}>{submission.memory_used}MB</div>
                        </div>
                      </div>
                    )}
                    {submission.test_results && (
                      <div>
                        <div className="label" style={{ marginBottom: 10 }}>TEST CASES</div>
                        {submission.test_results.map((t, i) => (
                          <div key={i} style={{
                            padding: '10px 12px', marginBottom: 6,
                            border: `1px solid ${t.passed ? 'var(--success)' : 'var(--danger)'}`,
                            borderRadius: 2, background: t.passed ? 'rgba(39,174,96,0.05)' : 'rgba(192,57,43,0.05)',
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: t.passed ? 0 : 8 }}>
                              <span style={{ fontFamily: 'var(--font-display)', fontSize: 11, letterSpacing: 2 }}>TEST #{i + 1}</span>
                              <span style={{ color: t.passed ? 'var(--success)' : 'var(--danger)', fontSize: 12 }}>
                                {t.passed ? '✓ PASS' : '✗ FAIL'}
                              </span>
                            </div>
                            {!t.passed && (
                              <div style={{ fontFamily: 'var(--font-code)', fontSize: 11, color: 'var(--text-secondary)', marginTop: 6 }}>
                                <div>Expected: <span style={{ color: 'var(--success)' }}>{t.expected}</span></div>
                                {t.got && <div>Got: <span style={{ color: 'var(--danger)' }}>{t.got}</span></div>}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* CENTER — Code Editor */}
        <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Editor toolbar */}
          <div style={{
            height: 40, background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', padding: '0 16px', gap: 12, flexShrink: 0,
          }}>
            <span style={{ fontFamily: 'var(--font-code)', fontSize: 12, color: 'var(--text-secondary)' }}>solution.py</span>
            <div style={{ flex: 1 }} />
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 10, letterSpacing: 2, color: 'var(--text-secondary)' }}>Python 3.10</span>
            <button className="btn btn-ghost btn-sm" onClick={() => setCode(DEFAULT_CODE)} style={{ fontSize: 10 }}>RESET</button>
          </div>

          {/* Code textarea (Monaco placeholder) */}
          <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
            <textarea
              ref={textareaRef}
              value={code}
              onChange={e => setCode(e.target.value)}
              onKeyDown={handleKeyDown}
              spellCheck={false}
              title="Code editor"
              aria-label="Code editor"
              style={{
                width: '100%', height: '100%',
                background: 'var(--bg-primary)',
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-code)', fontSize: 14, lineHeight: 1.7,
                border: 'none', outline: 'none', resize: 'none',
                padding: '16px 16px 16px 52px',
                tabSize: 4,
              }}
            />
            {/* Line numbers */}
            <div style={{
              position: 'absolute', left: 0, top: 0, bottom: 0, width: 44,
              background: 'var(--bg-secondary)', borderRight: '1px solid var(--border)',
              padding: '16px 0', pointerEvents: 'none', overflow: 'hidden',
            }}>
              {code.split('\n').map((_, i) => (
                <div key={i} style={{
                  fontFamily: 'var(--font-code)', fontSize: 14, lineHeight: 1.7,
                  color: 'var(--text-secondary)', textAlign: 'right', paddingRight: 10,
                }}>
                  {i + 1}
                </div>
              ))}
            </div>
          </div>

          {/* Submit bar */}
          <div style={{
            height: 52, background: 'var(--bg-secondary)', borderTop: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', padding: '0 16px', gap: 12, flexShrink: 0,
          }}>
            <span style={{ fontFamily: 'var(--font-code)', fontSize: 12, color: 'var(--text-secondary)' }}>
              {code.split('\n').length} lines · {code.length} chars
            </span>
            <div style={{ flex: 1 }} />
            {submission?.status === 'accepted' && (
              <span className="status-badge status-accepted">✓ ACCEPTED</span>
            )}
            <button
              className="btn btn-primary"
              onClick={handleSubmit}
              disabled={submitting || submission?.status === 'accepted'}
            >
              {submitting ? 'JUDGING...' : submission?.status === 'accepted' ? 'SUBMITTED ✓' : '⚡ SUBMIT'}
            </button>
          </div>
        </div>

        {/* RIGHT — Live Leaderboard */}
        <div style={{ borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{
            padding: '12px 16px', borderBottom: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
          }}>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 10, letterSpacing: 3, color: 'var(--text-secondary)' }}>
              LIVE RANKINGS
            </span>
            <span className="dot dot-green pulse" />
          </div>

          <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
            {sortedPlayers.map((p, i) => (
              <div key={p.id} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                marginBottom: 4, border: '1px solid var(--border)', borderRadius: 2,
                background: p.is_eliminated ? 'var(--eliminated)'
                  : p.username === user?.username ? 'var(--accent-glow)'
                  : 'var(--bg-card)',
                opacity: p.is_eliminated ? 0.5 : 1,
                borderColor: p.username === user?.username && !p.is_eliminated ? 'var(--accent)' : 'var(--border)',
                transition: 'all 0.3s',
              }}>
                <div style={{
                  width: 20, fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 700,
                  color: i === 0 ? 'var(--accent)' : 'var(--text-secondary)',
                  textAlign: 'center', flexShrink: 0,
                }}>
                  {p.is_eliminated ? '✗' : i + 1}
                </div>
                <div className="avatar" style={{ width: 24, height: 24, fontSize: 10 }}>{p.username[0]}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 700,
                    letterSpacing: 1, color: p.is_eliminated ? 'var(--text-secondary)' : 'var(--text-primary)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    textDecoration: p.is_eliminated ? 'line-through' : 'none',
                  }}>
                    {p.username}
                  </div>
                  <div style={{ fontFamily: 'var(--font-code)', fontSize: 10, color: 'var(--text-secondary)', marginTop: 1 }}>
                    {(p as any).submit_time
                      ? `${formatTime((p as any).submit_time)} ✓`
                      : p.is_eliminated ? 'ELIMINATED'
                      : 'solving...'}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Timer large display */}
          <div style={{
            padding: '20px 16px', borderTop: '1px solid var(--border)',
            background: 'var(--bg-secondary)', textAlign: 'center', flexShrink: 0,
          }}>
            <div className={`timer-display ${timerClass}`}>{formatTime(time)}</div>
            <div className="timer-label">TIME REMAINING</div>
            <div className="progress-bar" style={{ marginTop: 12 }}>
              <div className="progress-fill" style={{
                width: `${(time / 300) * 100}%`,
                background: time < 30 ? 'var(--danger)' : time < 60 ? 'var(--warn)' : 'var(--accent)',
                transition: 'width 1s linear, background 0.3s',
              }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BattleArenaPage;
