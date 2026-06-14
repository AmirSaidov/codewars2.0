import type { FC } from 'react';
import { motion } from 'framer-motion';
import { Crown, Trophy, X } from 'lucide-react';

export type TournamentPlayerStatus = 'waiting' | 'active' | 'advanced' | 'eliminated' | 'winner';
export type TournamentRoundLevel = 1 | 2 | 3 | 4 | 5;

export interface TournamentPlayer {
  id: number;
  username: string;
  avatar?: string;
  status: TournamentPlayerStatus;
  round_level: TournamentRoundLevel;
}

interface TournamentMountainProps {
  players: TournamentPlayer[];
  currentRound: TournamentRoundLevel;
  maxPlayers?: number;
}

type Point = { x: number; y: number };
type PlayerGeometry = {
  point: Point;
  level: TournamentRoundLevel;
  laneIndex: number;
};

const VIEWBOX_WIDTH = 1600;
const VIEWBOX_HEIGHT = 940;
const CENTER_X = VIEWBOX_WIDTH / 2;
const NODE_CONNECT_OFFSET = 42;
const STAGE_LABEL_X = 72;
const STAGE_COUNT_X = VIEWBOX_WIDTH - 72;

const LEVEL_Y: Record<TournamentRoundLevel, number> = {
  1: 830,
  2: 650,
  3: 470,
  4: 288,
  5: 116,
};

const LEVEL_WIDTH_FACTOR: Record<TournamentRoundLevel, number> = {
  1: 1,
  2: 0.72,
  3: 0.47,
  4: 0.23,
  5: 0,
};

const LEVEL_COUNT_LABELS: Record<TournamentRoundLevel, string> = {
  1: 'ENTRY',
  2: 'ASCENT',
  3: 'RIDGE',
  4: 'PEAK',
  5: '1/1',
};

const LEVEL_LABELS: Record<TournamentRoundLevel, string> = {
  1: 'START',
  2: 'ROUND 2',
  3: 'ROUND 3',
  4: 'FINAL GATE',
  5: 'FINISH',
};

const LEVEL_ORDER: TournamentRoundLevel[] = [5, 4, 3, 2, 1];

const clampLevel = (level: number): TournamentRoundLevel => {
  if (level <= 1) return 1;
  if (level >= 5) return 5;
  return level as TournamentRoundLevel;
};

const getInitial = (username: string) => (username.trim()[0] || '?').toUpperCase();

const getLaneX = (laneIndex: number, laneCount: number) => {
  if (laneCount <= 1) return CENTER_X;
  const usableWidth = VIEWBOX_WIDTH - 260;
  const ratio = laneIndex / (laneCount - 1);
  return CENTER_X - usableWidth / 2 + ratio * usableWidth;
};

const getLanePoint = (laneIndex: number, laneCount: number, level: TournamentRoundLevel): Point => {
  const bottomX = getLaneX(laneIndex, laneCount);
  return {
    x: CENTER_X + (bottomX - CENTER_X) * LEVEL_WIDTH_FACTOR[level],
    y: LEVEL_Y[level],
  };
};

const getStepPath = (from: Point, to: Point, compact = false) => {
  const startY = from.y - NODE_CONNECT_OFFSET;
  const endY = to.y + NODE_CONNECT_OFFSET;
  const midY = startY - (startY - endY) * (compact ? 0.44 : 0.52);
  return [
    `M ${from.x.toFixed(1)} ${startY.toFixed(1)}`,
    `L ${from.x.toFixed(1)} ${midY.toFixed(1)}`,
    `L ${to.x.toFixed(1)} ${midY.toFixed(1)}`,
    `L ${to.x.toFixed(1)} ${endY.toFixed(1)}`,
  ].join(' ');
};

const getNetworkSegments = (laneCount: number) => {
  const segments: { key: string; path: string }[] = [];

  for (let laneIndex = 0; laneIndex < laneCount; laneIndex += 1) {
    for (let level = 1; level < 5; level += 1) {
      const fromLevel = level as TournamentRoundLevel;
      const toLevel = (level + 1) as TournamentRoundLevel;
      const from = getLanePoint(laneIndex, laneCount, fromLevel);
      const to = getLanePoint(laneIndex, laneCount, toLevel);
      segments.push({
        key: `${laneIndex}-${fromLevel}-${toLevel}`,
        path: getStepPath(from, to, toLevel === 5),
      });
    }
  }

  return segments;
};

const getPlayerRoutePaths = (laneIndex: number, laneCount: number, level: TournamentRoundLevel) => {
  const paths: string[] = [];

  for (let current = 1; current < level; current += 1) {
    const fromLevel = current as TournamentRoundLevel;
    const toLevel = (current + 1) as TournamentRoundLevel;
    const from = getLanePoint(laneIndex, laneCount, fromLevel);
    const to = getLanePoint(laneIndex, laneCount, toLevel);
    paths.push(getStepPath(from, to, toLevel === 5));
  }

  return paths;
};

const statusLabel: Record<TournamentPlayerStatus, string> = {
  waiting: 'Waiting',
  active: 'Active',
  advanced: 'Advanced',
  eliminated: 'Eliminated',
  winner: 'Winner',
};

const getPlayerGeometry = (laneIndex: number, laneCount: number, player: TournamentPlayer): PlayerGeometry => {
  const level = player.status === 'winner' ? 5 : clampLevel(player.round_level);
  return {
    laneIndex,
    level,
    point: getLanePoint(laneIndex, laneCount, level),
  };
};

const TournamentMountain: FC<TournamentMountainProps> = ({ players, currentRound, maxPlayers }) => {
  const visiblePlayers = players.slice(0, 10);
  const entryCount = visiblePlayers.length;
  const laneCount = Math.max(1, Math.min(10, entryCount || maxPlayers || 1));
  const networkSegments = getNetworkSegments(laneCount);
  const winner = visiblePlayers.find((player) => player.status === 'winner');
  const aliveCount = visiblePlayers.filter((player) => player.status !== 'eliminated').length;

  const activeRoutes = visiblePlayers.flatMap((player, index) => {
    const { level } = getPlayerGeometry(index, laneCount, player);
    if (level <= 1) return [];

    const routeClass = player.status === 'eliminated' ? 'eliminated' : 'active';
    return getPlayerRoutePaths(index, laneCount, level).map((path, pathIndex) => ({
      key: `${routeClass}-${player.id}-${pathIndex}`,
      path,
      routeClass,
    }));
  });

  return (
    <div className="card tournament-mountain-card">
      <div className="tournament-mountain-head">
        <div>
          <div className="label" style={{ marginBottom: 4 }}>TOURNAMENT MOUNTAIN</div>
          <div className="tournament-mountain-title">
            <span>{entryCount} ENTER</span>
            <span>{winner ? `${winner.username} SURVIVES` : `${Math.max(aliveCount, 0)} CLIMBING`}</span>
          </div>
        </div>
        <div className="tournament-mountain-round">
          <span>ROUND</span>
          <strong>{currentRound}</strong>
        </div>
      </div>

      <div className="tournament-mountain-board" aria-label="Tournament mountain">
        <svg
          className="tournament-mountain-lines"
          viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <text className="tournament-mountain-finish-label" x={CENTER_X} y="58">
            FINISH
          </text>
          <line className="tournament-mountain-finish-line" x1="620" x2="980" y1="82" y2="82" />

          {LEVEL_ORDER.map((level) => (
            <g key={level}>
              <line
                className="tournament-mountain-zone-line"
                x1="110"
                x2="1490"
                y1={LEVEL_Y[level]}
                y2={LEVEL_Y[level]}
              />
              <text className="tournament-mountain-stage-label" x={STAGE_LABEL_X} y={LEVEL_Y[level] - 48}>
                {LEVEL_LABELS[level]}
              </text>
              <text className="tournament-mountain-stage-count" x={STAGE_COUNT_X} y={LEVEL_Y[level] - 48}>
                {level === 1 ? `${entryCount}/${Math.max(entryCount, 1)}` : LEVEL_COUNT_LABELS[level]}
              </text>
            </g>
          ))}

          {networkSegments.map((segment) => (
            <path
              key={`network-${segment.key}`}
              className="tournament-mountain-route inactive"
              d={segment.path}
            />
          ))}

          {activeRoutes.map((route) => (
            <path
              key={route.key}
              className={`tournament-mountain-route ${route.routeClass}`}
              d={route.path}
            />
          ))}
        </svg>

        {visiblePlayers.map((player, index) => {
          const { point } = getPlayerGeometry(index, laneCount, player);
          return (
            <motion.div
              key={player.id}
              className={`tournament-node ${player.status}`}
              title={`${player.username} - ${statusLabel[player.status]}`}
              initial={false}
              layout
              animate={{
                left: `${(point.x / VIEWBOX_WIDTH) * 100}%`,
                top: `${(point.y / VIEWBOX_HEIGHT) * 100}%`,
                opacity: player.status === 'eliminated' ? 0.5 : 1,
                scale: player.status === 'winner' ? 1.18 : player.status === 'advanced' ? 1.07 : 1,
              }}
              transition={{ type: 'spring', stiffness: 145, damping: 22, mass: 0.82 }}
            >
              {player.status === 'winner' && (
                <motion.span
                  className="tournament-node-crown"
                  initial={{ opacity: 0, y: 8, scale: 0.7 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ delay: 0.14, type: 'spring', stiffness: 210, damping: 16 }}
                >
                  <Crown />
                </motion.span>
              )}
              <div className="tournament-node-avatar">
                {player.status === 'winner' ? <Trophy /> : (player.avatar || getInitial(player.username))}
              </div>
              <div className="tournament-node-name">{player.username}</div>
              {player.status === 'eliminated' && (
                <span className="tournament-node-x" aria-hidden="true">
                  <X />
                </span>
              )}
              {player.status === 'winner' && <span className="tournament-node-badge">FINISH</span>}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};

export default TournamentMountain;
