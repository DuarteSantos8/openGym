/* What the Coach knows beyond the plan and the log: the newer things the app keeps track of.
 *
 * Each block is built here, from the synced state, field by field like the rest of the payload
 * (an allowlist: nothing is spread, every number is bounded), and each one is small on purpose,
 * so a review on a 3B model on a CPU box stays a review and not a reading exercise:
 *
 *   muscles     work sets per target muscle: the last 7 days, the 4-week weekly average, the
 *               last 72 hours and days since it was last trained. That is the recovery and the
 *               weekly volume picture the Stats screen draws, in numbers a model can cite.
 *   gym         the active gym's equipment (#808): what it can load, so a suggested weight or a
 *               swap fits the place you are standing in. Sizes only, never the gym's name.
 *   challenges  this month's three goals and which are done, so a plan can lean toward them.
 *
 * No clock is read: `now` is handed in (epoch ms), so the server, the phone and the tests agree.
 */
import { LIB_BY_ID } from './library.js';

const DAY = 86400000;
const iso = ms => new Date(ms).toISOString().slice(0, 10);
const list = v => (Array.isArray(v) ? v : []);
const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v);
const fin = v => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v));
// Mirror of the frontend's isWarmupRow, as payload.js isWarmupSet.
const isWarm = s => {
  const ph = typeof s?.phase === 'string' ? s.phase.trim().toLowerCase() : '';
  if (ph) return ph === 'warmup' || ph === 'warm-up' || ph === 'warm_up';
  return s?.warmup === true;
};
const doneWork = s => s && typeof s === 'object' && !isWarm(s)
  && (s.done === true || (isMap(s.sides) && (s.sides.L?.done === true || s.sides.R?.done === true)));

export const MAX_MUSCLES = 24;

/**
 * Work sets per target muscle (the catalogue's `tg`), over the last four weeks from `now`.
 * `{ muscle, sets7d, weeklyAvg, sets72h, daysSince }`, the most trained first; muscles not
 * trained in four weeks are left out (absence is the signal). Exercises of the person's own carry
 * no muscle in the catalogue and are counted under their body part when they have one.
 */
export function muscleLoad(S, now) {
  const end = Number.isFinite(now) ? now : Date.now();
  const from28 = iso(end - 28 * DAY), from7 = iso(end - 7 * DAY), from3 = iso(end - 3 * DAY), today = iso(end);
  const custom = new Map(list(S?.customEx).filter(c => c && typeof c.id === 'string').map(c => [c.id, c]));
  const by = new Map();
  for (const w of list(S?.workouts)) {
    const d = typeof w?.d === 'string' ? w.d.slice(0, 10) : '';
    if (!d || d < from28 || d > today) continue;
    for (const en of list(w.entries)) {
      const lib = LIB_BY_ID.get(en?.id);
      const muscle = lib?.tg || (typeof custom.get(en?.id)?.bp === 'string' ? custom.get(en.id).bp.slice(0, 40) : null);
      if (!muscle || lib?.bp === 'cardio') continue;
      const n = list(en.sets).filter(doneWork).length;
      if (!n) continue;
      const m = by.get(muscle) || { muscle, sets7d: 0, sets28d: 0, sets72h: 0, last: '' };
      m.sets28d += n;
      if (d >= from7) m.sets7d += n;
      if (d >= from3) m.sets72h += n;
      if (d > m.last) m.last = d;
      by.set(muscle, m);
    }
  }
  return [...by.values()]
    .sort((a, b) => b.sets28d - a.sets28d || (a.muscle < b.muscle ? -1 : 1))
    .slice(0, MAX_MUSCLES)
    .map(m => ({
      muscle: m.muscle, sets7d: m.sets7d, weeklyAvg: Math.round((m.sets28d / 4) * 10) / 10, sets72h: m.sets72h,
      daysSince: Math.max(0, Math.round((Date.parse(today + 'T12:00:00Z') - Date.parse(m.last + 'T12:00:00Z')) / DAY))
    }));
}

const MAX_SIZES = 16;
const MAX_BELLS = 40;
const cleanSizes = (v, max) => [...new Set(list(v).map(fin).filter(n => n > 0 && n < 1000))]
  .sort((a, b) => a - b).slice(0, max);

/**
 * The active gym, as far as loading goes: its equipment, the plate sizes it has (a list of sizes,
 * no counts) and the dumbbells it owns, in the profile's unit. Null when there is nothing to say.
 * The gym's name is the person's own text and stays home.
 */
export function gymOf(S) {
  const unit = S?.unit === 'lb' ? 'lb' : 'kg';
  const prof = S?.equipFilterOn ? list(S.equipProfiles).find(p => p && p.id === S.activeEquipId) : null;
  const equipment = list(prof?.equipment).filter(e => typeof e === 'string' && e).slice(0, 40).map(e => e.slice(0, 40));
  const plateMap = isMap(S?.plates?.[unit]) ? S.plates[unit] : null;
  const plates = plateMap ? cleanSizes(Object.entries(plateMap).filter(([k, n]) => fin(k) > 0 && fin(n) > 0).map(([k]) => k), MAX_SIZES) : [];
  const bells = isMap(S?.dumbbells?.[unit]) ? cleanSizes(S.dumbbells[unit].weights, MAX_BELLS) : [];
  const noDumbbells = S?.dumbbells?.none?.on === true;
  if (!equipment.length && !plates.length && !bells.length && !noDumbbells) return null;
  return {
    unit,
    ...(equipment.length ? { equipment } : {}),
    // No list of its own means a standard set (six pairs of each usual size), which is not news.
    ...(plates.length ? { plates } : {}),
    ...(bells.length ? { dumbbells: bells } : {}),
    ...(noDumbbells ? { noDumbbells: true } : {})
  };
}

const CHALLENGE_ID = /^[a-z]{2,20}$/;
/** This month's goals (frontend/src/lib/challenges.js) and which are done, or null. */
export function challengesOf(S, now) {
  if (S?.monthlyChallenges === false || !isMap(S?.challenges)) return null;
  const month = iso(Number.isFinite(now) ? now : Date.now()).slice(0, 7);
  const m = S.challenges[month];
  if (!isMap(m)) return null;
  const done = new Set(list(m.done).filter(id => typeof id === 'string'));
  const goals = list(m.picked)
    .filter(p => isMap(p) && CHALLENGE_ID.test(p.id) && fin(p.n) > 0 && fin(p.n) < 1e7)
    .slice(0, 3)
    .map(p => ({ id: p.id, n: fin(p.n), ...(p.u === 'kg' || p.u === 'lb' ? { u: p.u } : {}), ...(done.has(p.id) ? { done: true } : {}) }));
  return goals.length ? { month, goals } : null;
}
