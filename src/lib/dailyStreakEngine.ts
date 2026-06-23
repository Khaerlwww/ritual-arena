import { streakScoreBoost } from "./rarity";

export const HOUR = 3_600;
export const DAY = 86_400;
const MIN = 20 * HOUR;
const MAX = 48 * HOUR;

export const BOOST_MILESTONES: { day: number; boost: number }[] = [
  { day: 3, boost: 8 },
  { day: 7, boost: 15 },
  { day: 14, boost: 25 },
  { day: 30, boost: 40 },
];

export type DailyView = {
  streak: number;
  longestStreak: number;
  totalCheckIns: number;
  lastCheckIn: number;
  canCheckIn: boolean;
  hoursUntilOpen: number;
  willResetIfLate: boolean;
  boost: number;
  nextMilestone?: { day: number; boost: number };
  daysToNext: number;
  progressPct: number;
  status: string;
};

export type DailyStreakLike = {
  streak: number;
  lastCheckIn: number;
  longestStreak: number;
  totalCheckIns: number;
};

export function viewDailyStreak(d: DailyStreakLike, now: number = Math.floor(Date.now() / 1000)): DailyView {
  const fresh = d.lastCheckIn === 0;
  const elapsed = fresh ? Number.POSITIVE_INFINITY : now - d.lastCheckIn;
  const canCheckIn = fresh || elapsed >= MIN;
  const hoursUntilOpen = fresh || elapsed >= MIN ? 0 : Math.ceil((MIN - elapsed) / 3600);
  const willResetIfLate = !fresh && elapsed > MAX;

  const boost = streakScoreBoost(d.streak);
  const next = BOOST_MILESTONES.find((m) => d.streak < m.day);
  const prev = BOOST_MILESTONES.filter((m) => m.day <= d.streak).map((m) => m.day).pop() ?? 0;
  const daysToNext = next ? next.day - d.streak : 0;
  const progressPct = next ? Math.min(100, Math.round(((d.streak - prev) / (next.day - prev)) * 100)) : 100;

  let status: string;
  if (fresh) status = "First daily signature starts your streak.";
  else if (willResetIfLate) status = "Streak lapsed - check in to start a fresh streak.";
  else if (canCheckIn) status = "Daily sync available.";
  else status = `Next sync in ~${hoursUntilOpen}h.`;
  if (next && daysToNext > 0) status += ` next milestone at a ${next.day}-day streak.`;
  else if (!next) status += " Max training milestone reached.";

  return {
    streak: d.streak,
    longestStreak: d.longestStreak,
    totalCheckIns: d.totalCheckIns,
    lastCheckIn: d.lastCheckIn,
    canCheckIn,
    hoursUntilOpen,
    willResetIfLate,
    boost,
    nextMilestone: next,
    daysToNext,
    progressPct,
    status,
  };
}

export function dailyCalendar(d: DailyStreakLike, days = 28, now: number = Math.floor(Date.now() / 1000)) {
  const cells: { ts: number; active: boolean; today: boolean }[] = [];
  const startOfToday = Math.floor(now / DAY) * DAY;
  const lastDay = d.lastCheckIn ? Math.floor(d.lastCheckIn / DAY) * DAY : 0;
  for (let i = days - 1; i >= 0; i--) {
    const ts = startOfToday - i * DAY;
    const active = lastDay !== 0 && ts <= lastDay && ts > lastDay - d.streak * DAY;
    cells.push({ ts, active, today: ts === startOfToday });
  }
  return cells;
}
