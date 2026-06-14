import type { FC } from 'react';
import { motion } from 'framer-motion';
import { Trophy, X } from 'lucide-react';

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
type StageCounts = Record<TournamentRoundLevel, number>;

const VIEWBOX_WIDTH = 1440;
const VIEWBOX_HEIGHT = 900;
const CENTER_X = VIEWBOX_WIDTH / 2;
const NODE_CONNECT_OFFSET = 44;

const LEVEL_Y: Record<TournamentRoundLevel, number> = {
  1: 810,
  2: 655,
  3: 500,
  4: 340,
  5: 168,
};

const LEVEL_SPREAD: Record<TournamentRoundLevel, number> = {
  1: 600,
  2: 485,
  3: 330,
  4: 175,
  5: 0,
};

const TARGET_COUNTS: Record<TournamentRoundLevel, number> = {
  1: 10,
  2: 8,
  3: 4,
  4: 2,
  5: 1,
};

const LEVEL_LABELS: Record<TournamentRoundLevel, string> = {
  1: 'BOTTOM',
  2: 'ROUND 2',
  3: 'ROUND 3',
  4: 'SEMI FINAL',
  5: 'FINAL',
};

const LEVEL_ORDER: TournamentRoundLevel[] = [5, 4, 3, 2, 1];

const clampLevel = (level: number): TournamentRoundLevel => {
  if (level <= 1) return 1;
  if (level >= 5) return 5;
  return level as TournamentRoundLevel;
};

const getInitial = (username: string) => (username.trim()[0] || '?').toUpperCase();

const buildStageCounts = (entryCount: number): StageCounts => {
  const count = Math.max(1, Math.min(10, entryCount));
  const roundTwo = count >= 9
    ? 8
    : count >= 5
      ? Math.min(8, Math.max(4, Math.ceil(count * 0.75)))
      : count;
  const roundThree = count >= 8
    ? 4
    : count >= 5
      ? Math.min(4, Math.max(2, Math.ceil(roundTwo / 2)))
      : Math.min(2, count);

  return {
    1: count,
    2: Math.max(1, roundTwo),
    3: Math.max(1, roundThree),
    4: count >= 2 ? 2 : 1,
    5: 1,
  };
};

const getStageSpread = (level: TournamentRoundLevel, slotCount: number) => {
  if (slotCount <= 1) return 0;
  const targetCount = TARGET_COUNTS[level];
  const density = Math.min(1, (slotCount - 1) / Math.max(1, targetCount - 1));
  const floor = level === 1 ? 0.5 : 0.56;
  return LEVEL_SPREAD[level] * Math.max(floor, density);
};

const getStagePoint = (level: TournamentRoundLevel, slotIndex: number, stageCounts: StageCounts): Point => {
  const slotCount = stageCounts[level];
  const spread = getStageSpread(level, slotCount);
  const ratio = slotCount <= 1 ? 0.5 : slotIndex / (slotCount - 1);
  return {
    x: CENTER_X - spread + ratio * spread * 2,
    y: LEVEL_Y[level],
  };
};

const mapSlotToNextStage = (slotIndex: number, fromCount: number, toCount: number) => {
  if (toCount <= 1 || fromCount <= 1) return 0;
  return Math.max(0, Math.min(toCount - 1, Math.round((slotIndex / (fromCount - 1)) * (toCount - 1))));
};

const getRouteSlots = (entryIndex: number, stageCounts: StageCounts) => {
  const route: Record<TournamentRoundLevel, number> = { 1: entryIndex, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (let level = 1; level < 5; level += 1) {
    const currentLevel = level as TournamentRoundLevel;
    const nextLevel = (level + 1) as TournamentRoundLevel;
    route[nextLevel] = mapSlotToNextStage(route[currentLevel], stageCounts[currentLevel], stageCounts[nextLevel]);
  }
  return route;
};

const getStepPath = (from: Point, to: Point) => {
  const startY = from.y - NODE_CONNECT_OFFSET;
  const endY = to.y + NODE_CONNECT_OFFSET;
  const midY = startY - (startY - endY) * 0.52;
  return [
    `M ${from.x.toFixed(1)} ${startY.toFixed(1)}`,
    `L ${from.x.toFixed(1)} ${midY.toFixed(1)}`,
    `L ${to.x.toFixed(1)} ${midY.toFixed(1)}`,
    `L ${to.x.toFixed(1)} ${endY.toFixed(1)}`,
  ].join(' ');
};

const getNetworkSegments = (stageCounts: StageCounts) => {
  const segments: { key: string; path: string }[] = [];

  for (let level = 1; level < 5; level += 1) {
    const fromLevel = level as TournamentRoundLevel;
    const toLevel = (level + 1) as TournamentRoundLevel;
    const fromCount = stageCounts[fromLevel];
    const toCount = stageCounts[toLevel];

    for (let slotIndex = 0; slotIndex < fromCount; slotIndex += 1) {
      const targetSlot = mapSlotToNextStage(slotIndex, fromCount, toCount);
      const from = getStagePoint(fromLevel, slotIndex, stageCounts);
      const to = getStagePoint(toLevel, targetSlot, stageCounts);
      segments.push({
        key: `${fromLevel}-${slotIndex}-${targetSlot}`,
        path: getStepPath(from, to),
      });
    }
  }

  return segments;
};

const getPlayerPoint = (entryIndex: number, level: TournamentRoundLevel, stageCounts: StageCounts) => {
  const route = getRouteSlots(entryIndex, stageCounts);
  return getStagePoint(level, route[level], stageCounts);
};

const getPlayerRoutePaths = (entryIndex: number, level: TournamentRoundLevel, stageCounts: StageCounts) => {
  const route = getRouteSlots(entryIndex, stageCounts);
  const paths: string[] = [];

  for (let current = 1; current < level; current += 1) {
    const fromLevel = current as TournamentRoundLevel;
    const toLevel = (current + 1) as TournamentRoundLevel;
    const from = getStagePoint(fromLevel, route[fromLevel], stageCounts);
    const to = getStagePoint(toLevel, route[toLevel], stageCounts);
    paths.push(getStepPath(from, to));
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

const TournamentMountain: FC<TournamentMountainProps> = ({ players, currentRound }) => {
  const visiblePlayers = players.slice(0, 10);
  const entryCount = visiblePlayers.length;
  const stageCounts = buildStageCounts(Math.max(entryCount, 1));
  const networkSegments = getNetworkSegments(stageCounts);

  const activeRoutes = visiblePlayers.flatMap((player, index) => {
    const level = player.status === 'winner' ? 5 : clampLevel(player.round_level);
    if (level <= 1) return [];

    const routeClass = player.status === 'eliminated' ? 'eliminated' : 'active';
    return getPlayerRoutePaths(index, level, stageCounts).map((path, pathIndex) => ({
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
            <span>1 SURVIVES</span>
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
          <line className="tournament-mountain-finish-line" x1="548" x2="892" y1="82" y2="82" />

          {LEVEL_ORDER.map((level) => (
            <g key={level}>
              <line
                className="tournament-mountain-zone-line"
                x1="88"
                x2="1352"
                y1={LEVEL_Y[level]}
                y2={LEVEL_Y[level]}
              />
              <text className="tournament-mountain-stage-label" x="94" y={LEVEL_Y[level] - 54}>
                {LEVEL_LABELS[level]}
              </text>
              <text className="tournament-mountain-stage-count" x="1346" y={LEVEL_Y[level] - 54}>
                {level === 5 ? '1/1' : `${stageCounts[level]}/${stageCounts[level]}`}
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
          const level = player.status === 'winner' ? 5 : clampLevel(player.round_level);
          const point = getPlayerPoint(index, level, stageCounts);
          return (
            <motion.div
              key={player.id}
              className={`tournament-node ${player.status}`}
              title={`${player.username} - ${statusLabel[player.status]}`}
              initial={false}
              animate={{
                left: `${(point.x / VIEWBOX_WIDTH) * 100}%`,
                top: `${(point.y / VIEWBOX_HEIGHT) * 100}%`,
                opacity: player.status === 'eliminated' ? 0.44 : 1,
                scale: player.status === 'winner' ? 1.16 : player.status === 'advanced' ? 1.06 : 1,
              }}
              transition={{ type: 'spring', stiffness: 150, damping: 24 }}
            >
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
