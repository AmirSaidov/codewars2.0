// pages/AdminPanelPage.tsx
import React, { useState, useEffect, useCallback } from 'react';
import type { Page } from '../App';
import type { User } from '../context/contexts';
import { adminApi, tasksApi, roomsApi, matchesApi, submissionsApi, matchApi } from '../api';
import type { Submission, Task, LeaderboardEntry, MatchResult, Room, Match, WSEvent } from '../api';
import { Award, Crown } from 'lucide-react';
import { useRoomWebSocket } from '../hooks/useRoomWebSocket';

interface Props {
  navigate: (p: Page, roomId?: string | number) => void;
  user: User | null;
  roomId: string | null;
}

const normalizeRoomId = (value: unknown) => {
  const text = String(value ?? '').trim();
  return /^\d+$/.test(text) ? text : null;
};

const getRoomIdFromLocation = () => {
  const queryRoomId = normalizeRoomId(new URLSearchParams(window.location.search).get('roomId'));
  if (queryRoomId) return queryRoomId;

  const roomPathMatch = window.location.pathname.match(/\/rooms\/(\d+)/);
  return normalizeRoomId(roomPathMatch?.[1]);
};

export const AdminPanelPage: React.FC<Props> = ({ navigate, user: _user, roomId }) => {
  const [room, setRoom] = useState<Room | null>(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState<number[]>([]);
  const [matchId, setMatchId] = useState<number | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [players, setPlayers] = useState<LeaderboardEntry[]>([]);
  const [finishedResult, setFinishedResult] = useState<MatchResult | null>(null);
  const [selectedSub, setSelectedSub] = useState<Submission | null>(null);
  const [selectedBracketUserId, setSelectedBracketUserId] = useState<number | null>(null);
  const [tab, setTab] = useState<'submissions' | 'players' | 'tasks'>('submissions');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [matchData, setMatchData] = useState<Match | null>(null);
  const [showCreateTask, setShowCreateTask] = useState(false);
  const [taskForm, setTaskForm] = useState({
    title: '',
    description: '',
    input_format: '',
    output_format: '',
    difficulty: 'easy' as Task['difficulty'],
    time_limit: 2,
    memory_limit: 128,
    examples_json: '[]',
  });
  const [taskCreateError, setTaskCreateError] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const isAdmin =
    room?.creator?.id !== undefined &&
    _user?.id !== null &&
    _user?.id !== undefined &&
    String(room.creator.id) === String(_user.id);

  useEffect(() => {
    if (!isAdmin) return;
    tasksApi.list().then(r => setTasks(r.results)).catch(() => {});
  }, [isAdmin]);

  const refreshTasks = async () => {
    try {
      const r = await tasksApi.list();
      setTasks(r.results);
    } catch {
      // ignore
    }
  };

  const refresh = useCallback(async (opts?: { silent?: boolean }) => {
    if (!roomId) return;
    const silent = Boolean(opts?.silent);
    if (!silent) {
      setError('');
      setLoading(true);
    }
    try {
      const nextRoom = await roomsApi.get(String(roomId));
      setRoom(nextRoom);
      setSelectedTaskIds(Array.isArray(nextRoom.selected_task_ids) ? nextRoom.selected_task_ids : []);

      const nextMatchId = nextRoom.current_match?.id ?? null;
      setMatchId(nextMatchId);

      const nextIsAdmin =
        nextRoom?.creator?.id !== undefined &&
        _user?.id !== null &&
        _user?.id !== undefined &&
        String(nextRoom.creator.id) === String(_user.id);
      if (!nextIsAdmin) {
        setPlayers([]);
        setSubmissions([]);
        setMatchData(null);
        setSelectedSub(null);
        // If a non-creator lands on /admin (e.g. stale localStorage), send them back.
        navigate(nextRoom?.status === 'running' ? 'arena' : 'lobby', String(roomId));
        return;
      }

      if (!nextMatchId) {
        setPlayers([]);
        setSubmissions([]);
        setMatchData(null);
        setSelectedSub(null);
        setSelectedBracketUserId(null);
        let result = null as Awaited<ReturnType<typeof matchApi.getResult>> | null;
        for (let attempt = 0; attempt < 5 && !result; attempt++) {
          result = await matchApi.getResult(String(roomId)).catch(() => null);
          if (!result && attempt < 4) {
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
        }
        setFinishedResult(result);
        return;
      }

      const [lb, subs, match] = await Promise.all([
        matchesApi.leaderboard(nextMatchId).catch(() => [] as LeaderboardEntry[]),
        submissionsApi.list().catch(() => [] as Submission[]),
        matchesApi.get(nextMatchId).catch(() => null),
      ]);
      setFinishedResult(null);
      setPlayers(lb);
      setSubmissions(subs.filter(s => s.match === nextMatchId));
      setMatchData(match);
      if (silent) setError('');
    } catch (e: any) {
      if (!silent) setError(e?.message || 'Failed to load admin data');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [roomId, _user?.id, navigate]);

  const handleWSEvent = useCallback((event: WSEvent) => {
    const name = (event.event ?? event.type) as string | undefined;

    if (name === 'leaderboard_updated') {
      if (Array.isArray(event.payload?.entries)) setPlayers(event.payload.entries);
      if (matchId) {
        matchesApi.get(matchId).then(setMatchData).catch(() => {});
      }
      return;
    }

    if (name === 'round_started' || name === 'player_eliminated' || name === 'solution_accepted' || name === 'solution_rejected') {
      refresh({ silent: true });
      return;
    }

    if (name === 'match_finished') {
      refresh({ silent: true });
      navigate('results', roomId || undefined);
      return;
    }

    if (name === 'room_disbanded') {
      localStorage.removeItem('cz_room_id');
      localStorage.setItem('cz_page', 'dashboard');
      navigate('dashboard');
    }
  }, [matchId, navigate, refresh, roomId]);

  useRoomWebSocket(
    roomId,
    _user?.token,
    {
      onMessage: handleWSEvent,
      onForbidden: () => setError('Realtime room access denied.'),
    },
    { enabled: Boolean(roomId && matchId) },
  );

  useEffect(() => {
    if (!roomId) return;
    refresh();
    const id = setInterval(() => refresh({ silent: true }), 3000);
    return () => clearInterval(id);
  }, [roomId]);

  useEffect(() => {
    if (!matchId) {
      setMatchData(null);
      return;
    }
    matchesApi.get(matchId).then(setMatchData).catch(() => {});
  }, [matchId]);

  const handleAccept = async (sub: Submission) => {
    try {
      const updated = await submissionsApi.accept(sub.id);
      setSubmissions(s => s.map(x => x.id === sub.id ? updated : x));
      await refresh();
    } catch (e: any) {
      setError(e?.message || 'Failed to accept submission');
    }
    setSelectedSub(null);
  };

  const handleReject = async (sub: Submission) => {
    try {
      const updated = await submissionsApi.reject(sub.id);
      setSubmissions(s => s.map(x => x.id === sub.id ? updated : x));
      await refresh();
    } catch (e: any) {
      setError(e?.message || 'Failed to reject submission');
    }
    setSelectedSub(null);
  };

  const resolveLobbyRoomId = () =>
    normalizeRoomId(roomId) ??
    normalizeRoomId(room?.id) ??
    normalizeRoomId(matchData?.room) ??
    getRoomIdFromLocation() ??
    normalizeRoomId(localStorage.getItem('cz_room_id'));

  const handleLobbyClick = (e?: React.MouseEvent<HTMLButtonElement>) => {
    e?.preventDefault();
    console.log('LOBBY CLICK');
    const targetRoomId = resolveLobbyRoomId();
    if (!targetRoomId) {
      console.warn('Room ID not found, redirecting to dashboard');
      console.log('[admin-nav] destination', { page: 'dashboard' });
      navigate('dashboard');
      return;
    }
    console.log('[admin-nav] destination', { page: 'lobby', roomId: targetRoomId });
    navigate('lobby', targetRoomId);
  };

  if (room && !isAdmin) {
    return (
      <div className="page" style={{ minHeight: '100vh', padding: 24 }}>
        <div style={{ maxWidth: 760, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={handleLobbyClick}>← LOBBY</button>
          </div>
          <div className="card" style={{ borderColor: 'var(--danger)' }}>
            <div className="label" style={{ color: 'var(--danger)', marginBottom: 6 }}>NO ACCESS</div>
            <div style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-code)', fontSize: 12 }}>
              Only the room creator can use admin tools.
            </div>
          </div>
        </div>
      </div>
    );
  }

  const handleAdvance = async (playerId: string | number) => {
    try {
      await adminApi.advancePlayer(roomId!, String(playerId));
      await refresh();
    } catch (e: any) {
      setError(e?.message || 'Failed to advance player');
    }
  };

  const handleKick = async (playerId: number) => {
    try {
      await adminApi.kickPlayer(roomId!, String(playerId));
      await refresh();
    } catch (e: any) {
      setError(e?.message || 'Failed to kick player');
    }
  };

  const handleStop = async () => {
    try {
      await adminApi.stopMatch(roomId!);
      await refresh();
    } catch (e: any) {
      setError(e?.message || 'Failed to stop match');
    }
  };

  const handleRestartRound = async () => {
    try {
      await adminApi.restartRound(roomId!);
      await refresh();
    } catch (e: any) {
      setError(e?.message || 'Failed to restart round');
    }
  };

  const handleToggleTask = async (taskId: number) => {
    try {
      const res = await adminApi.selectTask(roomId!, String(taskId));
      if (Array.isArray((res as any)?.task_ids)) setSelectedTaskIds((res as any).task_ids);
      else await refresh();
    } catch (e: any) {
      setError(e?.message || 'Failed to update tasks');
    }
  };

  const handleCreateTask = async () => {
    setTaskCreateError('');
    const parseJson = (label: string, raw: string) => {
      try {
        const parsed = JSON.parse(raw || '[]');
        if (!Array.isArray(parsed)) throw new Error(`${label} must be an array`);
        return parsed;
      } catch (e: any) {
        throw new Error(e?.message || `Invalid JSON in ${label}`);
      }
    };

    try {
      const examples = parseJson('examples', taskForm.examples_json);

      await tasksApi.create({
        title: taskForm.title.trim(),
        description: taskForm.description,
        input_format: taskForm.input_format,
        output_format: taskForm.output_format,
        examples,
        difficulty: taskForm.difficulty,
        time_limit: Number(taskForm.time_limit) || 2,
        memory_limit: Number(taskForm.memory_limit) || 128,
      } as any);

      setShowCreateTask(false);
      setTaskForm({
        title: '',
        description: '',
        input_format: '',
        output_format: '',
        difficulty: 'easy',
        time_limit: 2,
        memory_limit: 128,
        examples_json: '[]',
      });
      await refreshTasks();
    } catch (e: any) {
      setTaskCreateError(e?.message || 'Failed to create task');
    }
  };

  const statusColor = (s: string) =>
    s === 'accepted' ? 'var(--success)' :
    s === 'pending' ? 'var(--text-secondary)' :
    s === 'time_limit_exceeded' ? 'var(--warn)' : 'var(--danger)';

  const roundBadgeColor = (status: string) =>
    status === 'running' ? 'var(--accent)' :
    status === 'finished' ? 'var(--success)' : 'var(--text-secondary)';

  const getEntryUsername = (entry: LeaderboardEntry | any) => entry.user?.username ?? entry.username ?? 'UNKNOWN';

  const getRoundPlayers = (round: any) => (
    Array.isArray(round?.players)
      ? round.players.filter((entry: any) => String(entry.user?.id ?? '') !== String(room?.creator?.id ?? ''))
      : []
  );

  const selectedPlayer = selectedBracketUserId
    ? (players.find((p) => String(p.user_id) === String(selectedBracketUserId)) ?? null)
    : null;

  const selectedPlayerSubmission = selectedBracketUserId
    ? [...submissions]
      .filter((submission) => String(submission.user?.id ?? '') === String(selectedBracketUserId))
      .sort((a, b) => new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime())[0] ?? null
    : null;

  useEffect(() => {
    if (!selectedBracketUserId && players.length) {
      setSelectedBracketUserId(players[0].user_id);
    }
  }, [players, selectedBracketUserId]);

  const selectBracketPlayer = (playerId: number) => {
    setSelectedBracketUserId(playerId);
    const latestSubmission = [...submissions]
      .filter((submission) => String(submission.user?.id ?? '') === String(playerId))
      .sort((a, b) => new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime())[0] ?? null;
    if (latestSubmission) setSelectedSub(latestSubmission);
  };

  const goResults = () => {
    if (!roomId) return;
    navigate('results', String(roomId));
  };

  return (
    <div className="page">
      <nav className="navbar">
        <div className="container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 64 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={handleLobbyClick}>← LOBBY</button>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700, letterSpacing: 3, color: 'var(--accent)' }}>
              ADMIN PANEL
            </span>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <button className="btn btn-danger btn-sm" onClick={handleStop} disabled={!matchId}>
              ■ END MATCH
            </button>
            <button className="btn btn-outline btn-sm" onClick={handleRestartRound} disabled={!matchId}>
              ↺ RESTART ROUND
            </button>
          </div>
        </div>
      </nav>

      <div className="container" style={{ paddingTop: 32, paddingBottom: 32 }}>
        {error && (
          <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: 16 }}>
            <div className="label" style={{ color: 'var(--danger)', marginBottom: 6 }}>ADMIN ERROR</div>
            <div style={{ fontFamily: 'var(--font-code)', fontSize: 12, color: 'var(--text-secondary)' }}>{error}</div>
          </div>
        )}

        {loading && (
          <div style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-display)', letterSpacing: 2, marginBottom: 16 }}>
            LOADING...
          </div>
        )}

        {!matchId && tab !== 'tasks' && (
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="label" style={{ marginBottom: 6 }}>NO RUNNING MATCH</div>
            <div style={{ fontFamily: 'var(--font-code)', fontSize: 12, color: 'var(--text-secondary)' }}>
              Start a match from the lobby to see submissions/leaderboard.
            </div>
          </div>
        )}

        {!matchId && finishedResult && (
          <div className="card card-glow" style={{ marginBottom: 16 }}>
            <div className="section-label" style={{ marginBottom: 12 }}>LAST MATCH FINISHED</div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 900, color: 'var(--accent)', letterSpacing: 2 }}>
                  {finishedResult.winner?.username || 'UNKNOWN'} WON
                </div>
                <div style={{ fontFamily: 'var(--font-code)', fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                  {finishedResult.players.length} players • {Math.floor(finishedResult.duration_seconds / 60)}m {finishedResult.duration_seconds % 60}s
                </div>
              </div>
              <button type="button" className="btn btn-outline btn-sm" onClick={goResults}>
                VIEW RESULTS
              </button>
            </div>
          </div>
        )}
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
                      <div className="avatar">{(sub.user?.username || '?')[0]}</div>
                      <span style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700 }}>{sub.user?.username || 'UNKNOWN'}</span>
                    </div>
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: 10, letterSpacing: 2, color: statusColor(sub.status), textTransform: 'uppercase' }}>
                      {sub.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 16 }}>
                    {typeof sub.execution_time === 'number' && <span style={{ fontFamily: 'var(--font-code)', fontSize: 11, color: 'var(--text-secondary)' }}>{Math.round(sub.execution_time * 1000)}ms</span>}
                    <span style={{ fontFamily: 'var(--font-code)', fontSize: 11, color: 'var(--text-secondary)' }}>Round #{sub.round}</span>
                    <span style={{ fontFamily: 'var(--font-code)', fontSize: 11, color: 'var(--text-secondary)' }}>{new Date(sub.submitted_at).toLocaleTimeString()}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Code viewer */}
            <div>
              {selectedSub ? (
                <div>
                  <div className="section-label" style={{ marginBottom: 16 }}>CODE REVIEW — {selectedSub.user?.username || 'UNKNOWN'}</div>
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
                    <button className="btn btn-outline btn-sm" onClick={() => handleAdvance(selectedSub.user?.id)}>
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

            {matchData && (
              <div className="card" style={{ marginBottom: 20, borderColor: 'rgba(0, 245, 255, 0.28)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
                  <div>
                    <div className="label" style={{ marginBottom: 6 }}>LIVE BRACKET</div>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, letterSpacing: 2, color: 'var(--text-primary)' }}>
                      KING OF THE HILL
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <span className="tag tag-accent">MATCH #{matchData.id}</span>
                    <span className="tag" style={{ color: roundBadgeColor(matchData.status), borderColor: 'currentColor' }}>
                      {matchData.status.toUpperCase()}
                    </span>
                    {matchData.winner && <span className="tag tag-success">WINNER: {matchData.winner.username}</span>}
                  </div>
                </div>

                <div style={{ display: 'grid', gridAutoFlow: 'column', gridAutoColumns: 'minmax(240px, 1fr)', gap: 12, overflowX: 'auto', paddingBottom: 4 }}>
                  {(matchData.rounds || []).map((round: any) => {
                    const roundPlayers = getRoundPlayers(round);
                    const selectedInRound = selectedBracketUserId
                      ? roundPlayers.find((entry: any) => String(entry.user?.id ?? '') === String(selectedBracketUserId))
                      : null;
                    return (
                      <div
                        key={round.id}
                        className="card"
                        style={{
                          minHeight: 280,
                          borderColor: round.status === 'running' ? 'rgba(0, 245, 255, 0.45)' : 'var(--border)',
                          background: round.status === 'running' ? 'rgba(6, 18, 32, 0.9)' : 'var(--bg-secondary)',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'start', justifyContent: 'space-between', gap: 10, marginBottom: 14 }}>
                          <div>
                            <div className="label" style={{ marginBottom: 6 }}>ROUND {round.number}</div>
                            <div style={{ fontFamily: 'var(--font-display)', fontSize: 12, letterSpacing: 1.5 }}>
                              {round.task?.title || 'UNKNOWN TASK'}
                            </div>
                          </div>
                          <span className="tag" style={{ color: roundBadgeColor(round.status), borderColor: 'currentColor' }}>
                            {round.status.toUpperCase()}
                          </span>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          {roundPlayers.length ? roundPlayers.map((entry: any) => {
                            const username = getEntryUsername(entry);
                            const status = entry.status;
                            const stateColor =
                              status === 'solved' ? 'var(--success)' :
                              status === 'passed' ? 'var(--accent)' :
                              status === 'eliminated' ? 'var(--danger)' : 'var(--text-secondary)';
                            const stateLabel =
                              status === 'solved' ? 'ADVANCING' :
                              status === 'passed' ? 'FORCED FORWARD' :
                              status === 'eliminated' ? 'OUT' : 'WAITING';

                            return (
                              <button
                                key={entry.id}
                                type="button"
                                onClick={() => selectBracketPlayer(Number(entry.user?.id))}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 10,
                                  width: '100%',
                                  textAlign: 'left',
                                  background: String(entry.user?.id ?? '') === String(selectedBracketUserId ?? '') ? 'rgba(0, 245, 255, 0.08)' : 'transparent',
                                  border: String(entry.user?.id ?? '') === String(selectedBracketUserId ?? '') ? '1px solid rgba(0, 245, 255, 0.5)' : '1px solid transparent',
                                  borderRadius: 4,
                                  padding: 8,
                                  cursor: 'pointer',
                                  opacity: status === 'eliminated' ? 0.42 : 1,
                                }}
                              >
                                <div className="avatar">{username[0] || '?'}</div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                    <span style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                      {username}
                                    </span>
                                    <span className="tag" style={{ color: stateColor, borderColor: 'currentColor', fontSize: 9 }}>
                                      {stateLabel}
                                    </span>
                                  </div>
                                  <div style={{ fontFamily: 'var(--font-code)', fontSize: 10, color: 'var(--text-secondary)', marginTop: 2 }}>
                                    {typeof entry.time_spent === 'number' ? `${Math.round(entry.time_spent * 1000)}ms` : '—'}
                                  </div>
                                </div>
                              </button>
                            );
                          }) : (
                            <div style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-code)', fontSize: 12 }}>
                              Waiting for players to advance...
                            </div>
                          )}
                        </div>

                        {selectedInRound && (
                          <div style={{
                            marginTop: 12,
                            paddingTop: 12,
                            borderTop: '1px solid var(--border)',
                            fontFamily: 'var(--font-code)',
                            fontSize: 11,
                            color: 'var(--text-secondary)',
                          }}>
                            Selected here: <span style={{ color: 'var(--text-primary)' }}>{getEntryUsername(selectedInRound)}</span>
                          </div>
                        )}
                        {selectedPlayer && (
                          <div className="card" style={{ borderColor: 'rgba(0, 245, 255, 0.28)', marginTop: 16 }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
                              <div>
                                <div className="label" style={{ marginBottom: 6 }}>INSPECTED PLAYER</div>
                                <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 900, letterSpacing: 2 }}>
                                  {getEntryUsername(selectedPlayer)}
                                </div>
                              </div>
                              <span className={`tag ${selectedPlayer.eliminated ? 'tag-danger' : 'tag-success'}`}>
                                {selectedPlayer.eliminated ? 'ELIMINATED' : 'ACTIVE'}
                              </span>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12, marginBottom: 12 }}>
                              {[
                                ['PTS', String(selectedPlayer.points)],
                                ['SOLVED', String(selectedPlayer.solved_count)],
                                ['TIME', `${Math.round(selectedPlayer.total_solution_time * 1000)}ms`],
                                ['STATUS', selectedPlayer.player_status.toUpperCase()],
                              ].map(([label, value]) => (
                                <div key={label} className="card" style={{ margin: 0, padding: '10px 12px' }}>
                                  <div className="label" style={{ fontSize: 9, marginBottom: 4 }}>{label}</div>
                                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 900, color: 'var(--accent)' }}>{value}</div>
                                </div>
                              ))}
                            </div>

                            {selectedPlayerSubmission ? (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                  <span className="tag tag-accent">ROUND #{selectedPlayerSubmission.round}</span>
                                  <span className={`tag ${selectedPlayerSubmission.status === 'accepted' ? 'tag-success' : 'tag-danger'}`}>
                                    {selectedPlayerSubmission.status.replace(/_/g, ' ').toUpperCase()}
                                  </span>
                                  {typeof selectedPlayerSubmission.execution_time === 'number' && (
                                    <span className="tag">EXEC {Math.round(selectedPlayerSubmission.execution_time * 1000)}ms</span>
                                  )}
                                </div>
                                <div style={{
                                  background: 'var(--bg-secondary)',
                                  border: '1px solid var(--border)',
                                  borderRadius: 2,
                                  padding: 14,
                                  fontFamily: 'var(--font-code)',
                                  fontSize: 12,
                                  whiteSpace: 'pre-wrap',
                                  color: 'var(--text-primary)',
                                  maxHeight: 180,
                                  overflow: 'auto',
                                }}>
                                  {selectedPlayerSubmission.code}
                                </div>
                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                  <button type="button" className="btn btn-primary btn-sm" onClick={() => handleAccept(selectedPlayerSubmission)}>
                                    ACCEPT
                                  </button>
                                  <button type="button" className="btn btn-danger btn-sm" onClick={() => handleReject(selectedPlayerSubmission)}>
                                    REJECT
                                  </button>
                                  <button type="button" className="btn btn-outline btn-sm" onClick={() => handleAdvance(selectedPlayerSubmission.user?.id)}>
                                    ADVANCE
                                  </button>
                                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelectedSub(selectedPlayerSubmission)}>
                                    OPEN REVIEW
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-code)', fontSize: 12 }}>
                                Click a node in the bracket to inspect the player and their latest submission.
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {matchId ? players.map(p => {
                const username = p.user?.username ?? p.username ?? 'UNKNOWN';
                const playerKey = p.user_id ?? p.user?.id ?? p.id ?? username;
                return (
                <div key={playerKey} className="card" style={{ display: 'flex', alignItems: 'center', gap: 16, opacity: p.eliminated ? 0.5 : 1 }}>
                  <div className="avatar">{username[0] || '?'}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700 }}>{username}</span>
                      {p.eliminated && <span className="tag tag-danger" style={{ fontSize: 9 }}>ELIMINATED</span>}
                    </div>
                    <span style={{ fontFamily: 'var(--font-code)', fontSize: 11, color: 'var(--text-secondary)' }}>
                      {p.points} pts • {p.solved_count} solved
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {!p.eliminated && (
                      <>
                        <button className="btn btn-outline btn-sm" onClick={() => handleAdvance(p.user_id)}>ADVANCE</button>
                        <button className="btn btn-danger btn-sm" onClick={() => handleKick(p.user_id)}>KICK</button>
                      </>
                    )}
                  </div>
                </div>
              );
              }) : (room?.players || []).map((m: any) => (
                <div key={m.user.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <div className="avatar">{m.user.username[0]}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700 }}>{m.user.username}</span>
                      {m.user.id === room?.creator?.id && <span className="tag tag-accent" style={{ fontSize: 9 }}>ADMIN</span>}
                      {m.is_ready && <span className="tag tag-success" style={{ fontSize: 9 }}>READY</span>}
                    </div>
                    <span style={{ fontFamily: 'var(--font-code)', fontSize: 11, color: 'var(--text-secondary)' }}>
                      waiting in lobby
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {m.user.id !== room?.creator?.id && (
                      <button className="btn btn-danger btn-sm" onClick={() => handleKick(m.user.id)}>KICK</button>
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
              <button className="btn btn-primary btn-sm" onClick={() => setShowCreateTask(true)}>+ CREATE TASK</button>
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
                      {selectedTaskIds.includes(Number(t.id)) && (
                        <span className="tag tag-accent" style={{ fontSize: 9, marginLeft: 10 }}>SELECTED</span>
                      )}
                    </div>
                    <span className={`tag ${t.difficulty === 'easy' ? 'tag-success' : t.difficulty === 'medium' ? 'tag-warn' : 'tag-danger'}`}>
                      {t.difficulty}
                    </span>
                    <button className="btn btn-outline btn-sm" onClick={() => handleToggleTask(Number(t.id))}>
                      {selectedTaskIds.includes(Number(t.id)) ? 'UNSELECT' : 'SELECT'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {showCreateTask && (
          <div className="modal-overlay">
            <div className="modal" style={{ maxWidth: 820 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 900, letterSpacing: 2 }}>CREATE TASK</div>
                <button className="btn btn-ghost btn-sm" onClick={() => setShowCreateTask(false)}>✕</button>
              </div>

              {taskCreateError && (
                <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: 12 }}>
                  <div className="label" style={{ color: 'var(--danger)', marginBottom: 6 }}>TASK ERROR</div>
                  <div style={{ fontFamily: 'var(--font-code)', fontSize: 12, color: 'var(--text-secondary)' }}>{taskCreateError}</div>
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <div className="label">TITLE</div>
                  <input className="input" value={taskForm.title} onChange={(e) => setTaskForm(f => ({ ...f, title: e.target.value }))} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
                  <div>
                    <div className="label">DIFFICULTY</div>
                    <select className="input" value={taskForm.difficulty} onChange={(e) => setTaskForm(f => ({ ...f, difficulty: e.target.value as any }))}>
                      <option value="easy">easy</option>
                      <option value="medium">medium</option>
                      <option value="hard">hard</option>
                    </select>
                  </div>
                </div>
              </div>

              <div style={{ marginTop: 12 }}>
                <div className="label">DESCRIPTION</div>
                <textarea className="input" style={{ minHeight: 120 }} value={taskForm.description} onChange={(e) => setTaskForm(f => ({ ...f, description: e.target.value }))}></textarea>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
                <div>
                  <div className="label">INPUT FORMAT</div>
                  <textarea className="input" style={{ minHeight: 80 }} value={taskForm.input_format} onChange={(e) => setTaskForm(f => ({ ...f, input_format: e.target.value }))}></textarea>
                </div>
                <div>
                  <div className="label">OUTPUT FORMAT</div>
                  <textarea className="input" style={{ minHeight: 80 }} value={taskForm.output_format} onChange={(e) => setTaskForm(f => ({ ...f, output_format: e.target.value }))}></textarea>
                </div>
              </div>

              <div style={{ marginTop: 12 }}>
                <div>
                  <div className="label">EXAMPLES (JSON array)</div>
                  <textarea className="input" style={{ minHeight: 110, fontFamily: 'var(--font-code)' }} value={taskForm.examples_json} onChange={(e) => setTaskForm(f => ({ ...f, examples_json: e.target.value }))}></textarea>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 12, marginTop: 14 }}>
                <button className="btn btn-ghost" onClick={() => setShowCreateTask(false)} style={{ flex: 1 }}>CANCEL</button>
                <button className="btn btn-primary" onClick={handleCreateTask} style={{ flex: 1 }} disabled={!taskForm.title.trim()}>CREATE</button>
              </div>
            </div>
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
  user: User | null;
  roomId: string | null;
}

export const MatchResultsPage: React.FC<ResultsProps> = ({ navigate, user, roomId }) => {
  const [result, setResult] = useState<MatchResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      let nextResult: MatchResult | null = null;
      for (let attempt = 0; attempt < 5 && !nextResult; attempt++) {
        nextResult = await matchApi.getResult(String(roomId)).catch(() => null);
        if (!nextResult && attempt < 4) {
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
      if (!cancelled) setResult(nextResult);
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [roomId]);

  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;
    roomsApi.get(String(roomId))
      .then((r) => {
        if (cancelled) return;
        const nextIsAdmin =
          r?.creator?.id !== undefined &&
          user?.id !== null &&
          user?.id !== undefined &&
          String(r.creator.id) === String(user.id);
        setIsAdmin(nextIsAdmin);
      })
      .catch(() => setIsAdmin(false));
    return () => { cancelled = true; };
  }, [roomId, user?.id]);

  const goLobby = (e?: React.MouseEvent) => {
    e?.preventDefault();
    if (!roomId) return;
    navigate('lobby', String(roomId));
  };

  const goHome = (e?: React.MouseEvent) => {
    e?.preventDefault();
    navigate('dashboard');
  };

  const goAdmin = (e?: React.MouseEvent) => {
    e?.preventDefault();
    const adminRoomId = roomId ?? String(result?.room_id ?? '');
    if (!adminRoomId) return;
    navigate('admin', adminRoomId);
  };

  const rankIcon = (r: number) => r === 1 ? <Crown size={22} /> : r === 2 ? <Award size={22} /> : r === 3 ? <Award size={22} /> : `#${r}`;

  if (loading) {
    return (
      <div className="page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: 24 }}>
        <div style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-display)', letterSpacing: 3 }}>
          LOADING RESULTS...
        </div>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: 24 }}>
        <div style={{ width: '100%', maxWidth: 600 }} className="fade-in">
          <div className="card" style={{ textAlign: 'center' }}>
            <div className="section-label" style={{ marginBottom: 10 }}>NO RESULTS</div>
            <div style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-code)', fontSize: 12 }}>
              No finished match found for this room yet.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={goHome}>HOME</button>
            {isAdmin && <button className="btn btn-outline" style={{ flex: 1 }} onClick={goAdmin}>ADMIN PANEL</button>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 600 }} className="fade-in">
        {/* Winner */}
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <div style={{ marginBottom: 16, color: 'var(--accent)' }}><Crown size={64} /></div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 11, letterSpacing: 4, color: 'var(--text-secondary)', marginBottom: 8 }}>
            CHAMPION
          </div>
          <div style={{
            fontFamily: 'var(--font-display)', fontSize: 42, fontWeight: 900,
            color: 'var(--accent)', letterSpacing: 4,
            textShadow: '0 0 40px var(--accent-glow)',
          }}>
            {(result.winner?.username || 'UNKNOWN').toUpperCase()}
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
          <button type="button" className="btn btn-outline" style={{ flex: 1 }} onClick={goLobby}>
            PLAY AGAIN
          </button>
          <button type="button" className="btn btn-primary" style={{ flex: 1 }} onClick={goHome}>HOME</button>
          {(isAdmin || Boolean(roomId && user?.id)) && <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={goAdmin}>ADMIN PANEL</button>}
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
