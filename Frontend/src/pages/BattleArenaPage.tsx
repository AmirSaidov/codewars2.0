// pages/BattleArenaPage.tsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { Page } from '../App';
import type { User } from '../context/contexts';
import { submissionsApi, roomsApi, matchesApi, matchApi } from '../api';
import type { WSEvent, Task, Submission, LeaderboardEntry, Match } from '../api';
import { Zap } from 'lucide-react';
import { useRoomWebSocket } from '../hooks/useRoomWebSocket';

interface Props {
  navigate: (p: Page, roomId?: string | number) => void;
  user: User | null;
  roomId: string | null;
}



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

const useCountdownSeconds = (params: {
  durationSeconds: number;
  startedAtISO: string | null | undefined;
}) => {
  const { durationSeconds, startedAtISO } = params;
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const startedMs = startedAtISO ? Date.parse(startedAtISO) : NaN;
  if (!Number.isFinite(startedMs)) return null;

  const elapsedSeconds = Math.floor((nowMs - startedMs) / 1000);
  return Math.max(0, durationSeconds - elapsedSeconds);
};

const formatTime = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
};

const formatMs = (seconds: number | null | undefined) => {
  if (typeof seconds !== 'number') return '—';
  return `${Math.round(seconds * 1000)}ms`;
};

const BattleArenaPage: React.FC<Props> = ({ navigate, user, roomId }) => {
  const [code, setCode] = useState(DEFAULT_CODE);
  const [matchId, setMatchId] = useState<number | null>(null);
  const [roundId, setRoundId] = useState<number | null>(null);
  const [players, setPlayers] = useState<LeaderboardEntry[]>([]);
  const [task, setTask] = useState<Task>(() => ({
    id: 'loading',
    title: 'LOADING...',
    description: '',
    input_format: '',
    output_format: '',
    examples: [],
    visible_tests: [],
    difficulty: 'easy',
    time_limit: 0,
    memory_limit: 0,
  }));
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitLocked, setSubmitLocked] = useState(false);
  const [editorScrollTop, setEditorScrollTop] = useState(0);
  const scrollRafRef = useRef<number | null>(null);
  const [timeUp, setTimeUp] = useState(false);
  const timeUpTickedRef = useRef<string | null>(null);
  const [round, setRound] = useState(1);
  const [totalRounds, setTotalRounds] = useState(1);
  const [activeTab, setActiveTab] = useState<'problem' | 'results'>('problem');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [roundDurationSeconds, setRoundDurationSeconds] = useState(300);
  const [roundStartedAtISO, setRoundStartedAtISO] = useState<string | null>(null);
  const serverTime = useCountdownSeconds({ durationSeconds: roundDurationSeconds, startedAtISO: roundStartedAtISO });
  const fallbackTime = useTimer(300);
  const time = serverTime ?? fallbackTime;

  const timerClass = time < 30 ? 'critical' : time < 60 ? 'warning' : '';

  // Lobby host (creator) should not enter the arena/IDE.
  useEffect(() => {
    if (!roomId || !user?.id) return;
    roomsApi.get(String(roomId)).then((r) => {
      if (r?.creator?.id !== undefined && String(r.creator.id) === String(user.id)) {
        navigate('admin', roomId);
      }
    }).catch(() => {});
  }, [roomId, user?.id, navigate]);

  const leaveMatch = async () => {
    if (!roomId) return;
    try { await roomsApi.leave(String(roomId)); } catch {}
    localStorage.removeItem('cz_room_id');
    localStorage.setItem('cz_page', 'dashboard');
    navigate('dashboard');
  };

  const applyMatchSnapshot = useCallback((match: Match) => {
    setTotalRounds(Array.isArray(match.rounds) && match.rounds.length > 0 ? match.rounds.length : 1);
    const current = match.current_round;
    setRound(current?.number ?? 1);
    setRoundId(current?.id ?? null);
    if (current?.task) setTask(current.task);
    setRoundStartedAtISO(current?.started_at ?? null);
  }, []);

  const applyLeaderboard = useCallback((entries: LeaderboardEntry[]) => {
    setPlayers(Array.isArray(entries) ? entries : []);
  }, []);

  // Load match/round/task + leaderboard so refresh doesn't reset state
  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;
    (async () => {
      try {
        // Room status/match can race right after "start" click; retry a bit before bouncing back to lobby.
        let room = await roomsApi.get(String(roomId));
        if (cancelled) return;
        const isRoomAdmin = Boolean(user?.is_staff) || (room?.creator?.id !== undefined && user?.id !== null && String(room.creator.id) === String(user?.id));
        if (isRoomAdmin) {
          navigate('admin', roomId || undefined);
          return;
        }
        for (let attempt = 0; attempt < 5 && room?.status === 'running' && !room.current_match?.id; attempt++) {
          await new Promise((r) => setTimeout(r, 400));
          room = await roomsApi.get(String(roomId));
          if (cancelled) return;
        }

        const duration = typeof room.round_duration_seconds === 'number' ? room.round_duration_seconds : 300;
        setRoundDurationSeconds(duration);

        const runningMatchId = room.current_match?.id ?? null;
        if (!runningMatchId) {
          let result = null as Awaited<ReturnType<typeof matchApi.getResult>> | null;
          for (let attempt = 0; attempt < 5 && !result; attempt++) {
            result = await matchApi.getResult(String(roomId)).catch(() => null);
            if (!result && attempt < 4) {
              await new Promise((resolve) => setTimeout(resolve, 250));
            }
          }
          if (result) {
            navigate('results', roomId || undefined);
          } else {
            navigate('lobby', roomId || undefined);
          }
          return;
        }
        setMatchId(runningMatchId);

        const match = await matchesApi.get(runningMatchId);
        if (cancelled) return;
        applyMatchSnapshot(match);

        const leaderboard = await matchesApi.leaderboard(runningMatchId);
        if (cancelled) return;
        applyLeaderboard(leaderboard);
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, [roomId]);

  // Restore submission on refresh: one submission per task/round.
  useEffect(() => {
    if (!matchId || !roundId || !user?.id) {
      setSubmitLocked(false);
      return;
    }
    let cancelled = false;
    submissionsApi.list()
      .then((all) => {
        if (cancelled) return;
        const mine = all
          .filter(s => s.match === matchId && s.round === roundId && String(s.user?.id) === String(user.id))
          .sort((a, b) => new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime());
        if (mine.length) {
          setSubmission(mine[0]);
          setSubmitLocked(true);
        } else {
          setSubmitLocked(false);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [matchId, roundId, user?.id]);

  const handleWSEvent = useCallback((event: WSEvent) => {
    const name = (event.event ?? event.type) as string | undefined;
    switch (name) {
      case 'leaderboard_updated':
        if (Array.isArray(event.payload?.entries)) applyLeaderboard(event.payload.entries);
        break;
      case 'player_eliminated':
        // leaderboard will be rebroadcast
        break;
      case 'solution_accepted':
        // leaderboard will be rebroadcast
        break;
      case 'round_started':
        setRound(event.payload.round_number ?? event.payload.round ?? 1);
        setSubmission(null);
        setSubmitLocked(false);
        setTimeUp(false);
        setCode(DEFAULT_CODE);
        if (typeof event.payload?.round_duration_seconds === 'number') {
          setRoundDurationSeconds(event.payload.round_duration_seconds);
        }
        if (typeof event.payload?.started_at === 'string') {
          setRoundStartedAtISO(event.payload.started_at);
        }
        if (matchId) {
          matchesApi.get(matchId).then(applyMatchSnapshot).catch(() => {});
          matchesApi.leaderboard(matchId).then(applyLeaderboard).catch(() => {});
        }
        break;
      case 'match_finished':
        navigate('results', roomId || undefined);
        break;
      case 'room_disbanded':
        localStorage.removeItem('cz_room_id');
        localStorage.setItem('cz_page', 'dashboard');
        navigate('dashboard');
        break;
    }
  }, [applyLeaderboard, applyMatchSnapshot, matchId, navigate, roomId]);

  useRoomWebSocket(
    roomId,
    user?.token,
    { onMessage: handleWSEvent },
    { enabled: Boolean(roomId && matchId) },
  );

  useEffect(() => {
    if (!matchId || !roundId) return;
    if (time > 0) {
      setTimeUp(false);
      return;
    }
    setTimeUp(true);
    setActiveTab('results');
    const key = `${matchId}:${roundId}`;
    if (timeUpTickedRef.current === key) return;
    timeUpTickedRef.current = key;
    matchesApi.tick(matchId)
      .then((m) => applyMatchSnapshot(m))
      .catch(() => {});
  }, [time, matchId, roundId, applyMatchSnapshot]);

  const handleSubmit = async () => {
    if (timeUp || submitLocked || submission || submitting || !code.trim() || !matchId) return;
    setSubmitting(true);
    setActiveTab('results');
    try {
      const result = await submissionsApi.submit(matchId, roundId, code);
      setSubmission(result);
      setSubmitLocked(true);
    } finally { setSubmitting(false); }
  };

  const handleEditorScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    const next = e.currentTarget.scrollTop;
    if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
    scrollRafRef.current = requestAnimationFrame(() => setEditorScrollTop(next));
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

  const getLeaderboardUsername = (entry: LeaderboardEntry) => entry.user?.username ?? entry.username ?? 'UNKNOWN';

  const sortedPlayers = [...players].sort((a, b) => {
    if (a.eliminated && !b.eliminated) return 1;
    if (!a.eliminated && b.eliminated) return -1;
    if (a.points !== b.points) return (b.points ?? 0) - (a.points ?? 0);
    return (a.total_solution_time ?? 0) - (b.total_solution_time ?? 0);
  });
  const survivingPlayers = sortedPlayers.filter((player) => !player.eliminated).length;
  const eliminatedPlayers = sortedPlayers.length - survivingPlayers;

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
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700, letterSpacing: 2 }}>{task?.title || 'LOADING...'}</span>
        {task?.difficulty && (
          <span className={`tag ${task.difficulty === 'easy' ? 'tag-success' : task.difficulty === 'medium' ? 'tag-warn' : 'tag-danger'}`} style={{ fontSize: 9 }}>
            {task.difficulty.toUpperCase()}
          </span>
        )}

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
        <button className="btn btn-ghost btn-sm" onClick={leaveMatch} style={{ marginLeft: 12 }}>
          LEAVE MATCH
        </button>
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

                {(task.time_limit > 0 || task.memory_limit > 0) && (
                  <div style={{ marginTop: 12, display: 'flex', gap: 16 }}>
                    {task.time_limit > 0 && (
                      <span style={{ fontFamily: 'var(--font-code)', fontSize: 11, color: 'var(--text-secondary)' }}>
                        ⏱ {task.time_limit}s
                      </span>
                    )}
                    {task.memory_limit > 0 && (
                      <span style={{ fontFamily: 'var(--font-code)', fontSize: 11, color: 'var(--text-secondary)' }}>
                        💾 {task.memory_limit}MB
                      </span>
                    )}
                  </div>
                )}
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
                    {submission.status === 'pending' && (
                      <div style={{ marginBottom: 16, color: 'var(--text-secondary)', fontFamily: 'var(--font-code)', fontSize: 12 }}>
                        Waiting for the host to review this submission.
                      </div>
                    )}
                    {typeof submission.execution_time === 'number' && (
                      <div style={{ display: 'flex', gap: 20, marginBottom: 16 }}>
                        <div>
                          <div className="label">EXEC TIME</div>
                          <div style={{ fontFamily: 'var(--font-code)', color: 'var(--accent)' }}>{formatMs(submission.execution_time)}</div>
                        </div>
                        <div>
                          <div className="label">MEMORY</div>
                          <div style={{ fontFamily: 'var(--font-code)', color: 'var(--accent)' }}>—</div>
                        </div>
                      </div>
                    )}
                    {submission.test_results && submission.test_results.length > 0 && (
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
                                {typeof (t as any).expected_output === 'string' && (
                                  <div>Expected: <span style={{ color: 'var(--success)' }}>{(t as any).expected_output}</span></div>
                                )}
                                {(t as any).stdout && (
                                  <div>Stdout: <span style={{ color: 'var(--text-primary)' }}>{(t as any).stdout}</span></div>
                                )}
                                {(t as any).stderr && (
                                  <div>Stderr: <span style={{ color: 'var(--danger)' }}>{(t as any).stderr}</span></div>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {submission.status !== 'pending' && (!submission.test_results || submission.test_results.length === 0) && (
                      <div style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-code)', fontSize: 12 }}>
                        No automated test results are stored for this submission.
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
              onScroll={handleEditorScroll}
              readOnly={timeUp}
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
              <div style={{ transform: `translateY(-${editorScrollTop}px)` }}>
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
              disabled={submitting || timeUp || submitLocked || Boolean(submission)}
            >
              {submitting ? 'JUDGING...' : timeUp ? 'TIME UP' : (submitLocked || submission) ? 'SUBMITTED ✓' : (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <Zap size={16} /> SUBMIT
                </span>
              )}
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

          <div style={{ padding: 12, borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
              {[
                ['ENTERED', String(sortedPlayers.length)],
                ['SURVIVES', String(survivingPlayers)],
                ['ELIMINATED', String(eliminatedPlayers)],
                ['ROUND', `${round}/${totalRounds}`],
              ].map(([label, value]) => (
                <div key={label} className="card" style={{ padding: '10px 12px', margin: 0 }}>
                  <div className="label" style={{ fontSize: 9, marginBottom: 4 }}>{label}</div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 900, color: 'var(--accent)' }}>
                    {value}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
            {sortedPlayers.map((p, i) => (
              <div key={p.user_id} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                marginBottom: 4, border: '1px solid var(--border)', borderRadius: 2,
                background: p.eliminated ? 'var(--eliminated)'
                  : getLeaderboardUsername(p) === user?.username ? 'var(--accent-glow)'
                  : 'var(--bg-card)',
                opacity: p.eliminated ? 0.5 : 1,
                borderColor: getLeaderboardUsername(p) === user?.username && !p.eliminated ? 'var(--accent)' : 'var(--border)',
                transition: 'all 0.3s',
              }}>
                <div style={{
                  width: 20, fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 700,
                  color: i === 0 ? 'var(--accent)' : 'var(--text-secondary)',
                  textAlign: 'center', flexShrink: 0,
                }}>
                  {p.eliminated ? '✗' : i + 1}
                </div>
                <div className="avatar" style={{ width: 24, height: 24, fontSize: 10 }}>{getLeaderboardUsername(p)[0] || '?'}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 700,
                    letterSpacing: 1, color: p.eliminated ? 'var(--text-secondary)' : 'var(--text-primary)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    textDecoration: p.eliminated ? 'line-through' : 'none',
                  }}>
                    {getLeaderboardUsername(p)}
                  </div>
                  <div style={{ fontFamily: 'var(--font-code)', fontSize: 10, color: 'var(--text-secondary)', marginTop: 1 }}>
                    {p.eliminated ? 'ELIMINATED' : `${p.points} pts • ${p.solved_count} solved`}
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
                width: `${(time / Math.max(1, roundDurationSeconds)) * 100}%`,
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
