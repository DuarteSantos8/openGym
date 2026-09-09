/* "Compare with others here": how one profile sits against everyone else on this instance.
 *
 * Two gates, both required. The admin switches the feature on for the instance (`community`
 * in coach.json), and each person opts in for themselves (`share` in their coach record). A
 * profile that does not share sees nothing — the trade is symmetric on purpose.
 *
 * What is computed is deliberately coarse: a median across at least MIN_PEOPLE participants
 * per number, never a single person's value, never a body weight, never a date. With three
 * people the median is still one person's number, so the floor is a floor on *plausibility*
 * of guessing whose, not a cryptographic guarantee; the docs say so.
 *
 * Everything is read from the state files on disk — the same ones the Coach reads for a
 * review — and cached for a few minutes, because a box with forty profiles should not parse
 * forty JSON blobs on every open of the sheet.
 */
import * as cfgStore from './config.js';
import { readState, listUserIds, isSharing } from './jobs.js';
import { libraryName } from './core/library.js';

export const MIN_PEOPLE = 3;
export const MAX_EXERCISES = 12;
const WEEKS_STRENGTH = 12;
const WEEKS_FREQUENCY = 8;
const CACHE_MS = 5 * 60000;
const LB_TO_KG = 0.45359237;
const REP_CAP = 12;   // mirrors frontend/src/lib/onerm.js: past twelve reps the estimate stops meaning much

// Mirror of frontend/src/lib/workout-model.js isWarmupRow: an explicit phase wins over the
// legacy boolean.
const isWarmup = s => {
  const ph = typeof s?.phase === 'string' ? s.phase.trim().toLowerCase() : '';
  if (ph) return ph === 'warmup' || ph === 'warm-up' || ph === 'warm_up';
  return s?.warmup === true;
};
const epley = (w, r) => w * (1 + Math.min(r, REP_CAP) / 30);
const round1 = n => Math.round(n * 10) / 10;
const median = arr => {
  const a = arr.filter(n => Number.isFinite(n)).sort((x, y) => x - y);
  return a.length ? a[Math.floor(a.length / 2)] : null;
};
const isoDaysAgo = days => { const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString().slice(0, 10); };

/** One participant, reduced to what the cohort reads: kg throughout. */
function participant(S) {
  const since = isoDaysAgo(WEEKS_STRENGTH * 7);
  const sinceFreq = isoDaysAgo(WEEKS_FREQUENCY * 7);
  const toKg = S.unit === 'lb' ? LB_TO_KG : 1;
  const workouts = (S.workouts || []).filter(w => w && w.d && w.d >= since);
  if (!workouts.length) return null;
  const best = {};
  workouts.forEach(w => (w.entries || []).forEach(en => (en.sets || []).forEach(s => {
    if (!s.done || isWarmup(s) || !(s.w > 0) || !(s.r > 0)) return;
    const est = epley(s.w * toKg, s.r);
    if (est > (best[en.id] || 0)) best[en.id] = est;
  })));
  const recent = workouts.filter(w => w.d >= sinceFreq).length;
  return { sessionsPerWeek: round1(recent / WEEKS_FREQUENCY), best };
}

let cache = null;   // { at, rows: Map<uid, participant> }
export function invalidate() { cache = null; }

function rows() {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.rows;
  const out = new Map();
  for (const uid of listUserIds()) {
    if (!isSharing(uid)) continue;
    const S = readState(uid);
    if (!S) continue;
    const p = participant(S);
    if (p) out.set(uid, p);
  }
  cache = { at: Date.now(), rows: out };
  return out;
}

/** Everything the sheet shows, in the requester's unit. */
export function computeCohort(uid) {
  if (!isSharing(uid)) return { ok: false, enabled: true, sharing: false };
  const all = rows();
  const people = all.size;
  if (people < MIN_PEOPLE) return { ok: false, enabled: true, sharing: true, people, minPeople: MIN_PEOPLE };

  const me = all.get(uid) || null;
  const S = readState(uid);
  const unit = S?.unit === 'lb' ? 'lb' : 'kg';
  const out = v => (v == null ? null : round1(unit === 'lb' ? v / LB_TO_KG : v));

  const byEx = new Map();
  for (const p of all.values()) {
    for (const [id, est] of Object.entries(p.best)) {
      if (!byEx.has(id)) byEx.set(id, []);
      byEx.get(id).push(est);
    }
  }
  const exercises = [...byEx.entries()]
    .filter(([, list]) => list.length >= MIN_PEOPLE)
    .map(([id, list]) => ({ id, name: libraryName(id) || id, people: list.length, medianKg: median(list), youKg: me?.best[id] ?? null, list }))
    .sort((a, b) => b.people - a.people || a.name.localeCompare(b.name))
    .slice(0, MAX_EXERCISES);

  // Where the requester stands: for each listed exercise they trained, the share of the
  // *other* participants whose best is at or below theirs, averaged.
  const ranks = exercises.filter(x => x.youKg != null).map(x => {
    const others = x.list.length - 1;
    if (others <= 0) return null;
    const below = x.list.filter(v => v <= x.youKg).length - 1;
    return below / others;
  }).filter(v => v != null);
  const rankPct = ranks.length ? Math.round(ranks.reduce((a, b) => a + b, 0) / ranks.length * 100) : null;

  return {
    ok: true, enabled: true, sharing: true, people, minPeople: MIN_PEOPLE, unit,
    sessionsPerWeek: { median: median([...all.values()].map(p => p.sessionsPerWeek)), you: me?.sessionsPerWeek ?? 0 },
    exercises: exercises.map(x => ({ id: x.id, name: x.name, people: x.people, median: out(x.medianKg), you: out(x.youKg) })),
    rankPct
  };
}

/** The compact form a prompt gets — kg regardless of the requester's unit, or null. */
export function cohortForPayload(uid) {
  try {
    if (!cfgStore.load().community || !isSharing(uid)) return null;
    const all = rows();
    if (all.size < MIN_PEOPLE) return null;
    const me = all.get(uid) || null;
    const byEx = new Map();
    for (const p of all.values()) for (const [id, est] of Object.entries(p.best)) {
      if (!byEx.has(id)) byEx.set(id, []);
      byEx.get(id).push(est);
    }
    const exercises = [...byEx.entries()]
      .filter(([, list]) => list.length >= MIN_PEOPLE)
      .map(([id, list]) => ({ id, name: libraryName(id) || id, median: round1(median(list)), you: me?.best[id] != null ? round1(me.best[id]) : null }))
      .sort((a, b) => (b.you != null) - (a.you != null) || a.name.localeCompare(b.name))
      .slice(0, MAX_EXERCISES);
    return {
      unit: 'kg', people: all.size,
      sessionsPerWeek: { median: median([...all.values()].map(p => p.sessionsPerWeek)), you: me?.sessionsPerWeek ?? 0 },
      exercises
    };
  } catch { return null; }
}
