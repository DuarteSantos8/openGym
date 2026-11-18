/* What the app checks in the plan before the Coach reads it: weekly sets against the person's
 * ranges, one-session-a-week muscles for a strength goal, too many sets on one exercise. Pure.
 * Only what falls outside; below a range is "room for more", never a grade. */
import { MUSCLES, weeklyPlanSets, sessionsOf } from './muscle-weights.js';

// frontend lib/muscle-targets.js DEFAULT_TARGETS, TARGET_MAX, LEGACY_TARGET and targetOf (parity test in coach-parity.test.js).
export const DEFAULT_TARGETS = {
  chest: [10, 20], lats: [10, 20], 'upper-back': [6, 16], 'front-delts': [4, 12], 'side-delts': [8, 20],
  'rear-delts': [6, 16], biceps: [8, 18], triceps: [6, 16], quadriceps: [8, 18], hamstring: [6, 16],
  gluteal: [4, 16], calves: [8, 16], abs: [6, 16],
};
const TARGET_MAX = 40;
const LEGACY_TARGET = { 'side-delts': 'deltoids', 'rear-delts': 'deltoids', lats: 'upper-back' };
export function targetOf(S, slug) {
  const own = S?.muscleTargets?.[slug] ?? (LEGACY_TARGET[slug] ? S?.muscleTargets?.[LEGACY_TARGET[slug]] : undefined);
  if (Array.isArray(own) && own.length === 2) {
    const lo = Math.round(Number(own[0])), hi = Math.round(Number(own[1]));
    if (Number.isFinite(lo) && Number.isFinite(hi) && lo >= 0 && hi >= lo && hi <= TARGET_MAX) return [lo, hi];
  }
  return DEFAULT_TARGETS[slug] ? [...DEFAULT_TARGETS[slug]] : null;
}

const round1 = n => Math.round(n * 10) / 10;

export function planChecks(S, profile) {
  const load = weeklyPlanSets(S);
  const low = [], high = [], freq = [], per = [];
  const sessions = profile?.goal === 'strength' ? sessionsOf(S, true) : null; // null for a rotation
  for (const muscle of MUSCLES) {
    const range = targetOf(S, muscle);
    if (!range) continue;
    const [lo, hi] = range, sets = round1(load[muscle] || 0);
    if (sets > 0 && sets < lo) low.push({ id: `volume-low:${muscle}`, tag: 'volume', muscle, sets, low: lo, high: hi });
    if (sets > hi) high.push({ id: `volume-high:${muscle}`, tag: 'volume-cap', muscle, sets, low: lo, high: hi });
    if (sessions && sessions.filter(d => d[muscle] > 0).length === 1) freq.push({ id: `frequency:${muscle}`, tag: 'frequency', muscle, sessions: 1 });
  }
  const cap = profile?.experience === 'new' ? 3 : 4;
  for (const r of Array.isArray(S?.routines) ? S.routines : []) {
    for (const e of Array.isArray(r?.ex) ? r.ex : []) {
      if (e?.sets > cap) per.push({ id: `sets-per-exercise:${r.id}:${e.id}`, tag: 'sets-per-exercise', routine: r.id, exercise: e.id, sets: e.sets, cap });
    }
  }
  return [...low, ...freq, ...per, ...high];
}

/** The tag of the check a `ref` names, or null when it names none. */
export const tagOfRef = (ref, checks) => (checks || []).find(c => c.id === ref)?.tag ?? null;
