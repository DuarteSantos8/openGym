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

/* ---------- v1.4.5: records, measurements, health, rotation (coach-146) ----------
 * Each of these is one of the categories the person can switch off under "What the Coach sees"
 * (core/categories.js OPTIONAL_CATEGORIES); payload.js only calls a builder whose switch is on. */

export const MAX_RECORDS = 10;
// Epley, the formula the Stats screen uses; only sets of 1 to 12 reps, where it means something.
const e1rm = (w, r) => (w > 0 && r >= 1 && r <= 12 ? w * (1 + (r === 1 ? 0 : r / 30)) : 0);
const r1 = v => Math.round(v * 10) / 10;

/**
 * Estimated one-rep maxes of the most trained loaded lifts over the last 12 weeks: the best ever
 * logged, the best of the last 4 weeks and of the 8 weeks before, so "am I getting stronger?"
 * has numbers. `{ id, name, best, bestOn, recent, before, trendPct }`, at most MAX_RECORDS.
 */
export function recordsOf(S, now) {
  const t = Number.isFinite(now) ? now : Date.now();
  const recentFrom = iso(t - 28 * DAY), windowFrom = iso(t - 84 * DAY);
  const by = new Map();
  for (const w of list(S?.workouts)) {
    const d = typeof w?.d === 'string' ? w.d.slice(0, 10) : '';
    if (!d) continue;
    for (const en of list(w.entries)) {
      if (!en || typeof en.id !== 'string') continue;
      let top = 0;
      for (const s of list(en.sets)) if (doneWork(s)) top = Math.max(top, e1rm(fin(s.w), fin(s.r ?? s.reps)));
      if (!(top > 0)) continue;
      const r = by.get(en.id) || { best: 0, bestOn: null, recent: 0, before: 0, n: 0 };
      if (top > r.best) { r.best = top; r.bestOn = d; }
      if (d >= recentFrom) r.recent = Math.max(r.recent, top);
      else if (d >= windowFrom) r.before = Math.max(r.before, top);
      if (d >= windowFrom) r.n++;
      by.set(en.id, r);
    }
  }
  return [...by.entries()]
    .filter(([, r]) => r.n > 0)
    .sort((a, b) => b[1].n - a[1].n)
    .slice(0, MAX_RECORDS)
    .map(([id, r]) => ({
      id: id.slice(0, 64), name: LIB_BY_ID.get(id)?.n || null,
      best: r1(r.best), bestOn: r.bestOn,
      ...(r.recent ? { recent: r1(r.recent) } : {}),
      ...(r.before ? { before: r1(r.before) } : {}),
      ...(r.recent && r.before ? { trendPct: Math.round((r.recent / r.before - 1) * 1000) / 10 } : {})
    }));
}

export const MAX_MEASURES = 14;
const HEALTH_KEYS = new Set(['bpSys', 'bpDia', 'pulse']);
const MEASURE_KEY = /^[A-Za-z][A-Za-z0-9_:-]{0,39}$/;
/**
 * Body measurements (#82): per field, the latest value and the one about eight weeks before it,
 * in the stored unit (cm, kg or %). Blood pressure and pulse belong to `health`, not here.
 */
export function measurementsOf(S, now) {
  const t = Number.isFinite(now) ? now : Date.now();
  const rows = list(S?.measurements).filter(m => isMap(m) && typeof m.d === 'string').slice().sort((a, b) => (a.d < b.d ? -1 : 1));
  const series = new Map();
  for (const m of rows) {
    const vals = isMap(m.v) ? m.v : m;
    for (const [k, v] of Object.entries(vals)) {
      if (k === 'd' || k === 't' || k === '_ts' || k === 'id' || k === 'note' || HEALTH_KEYS.has(k) || !MEASURE_KEY.test(k)) continue;
      const n = fin(v);
      if (!(n > 0 && n < 1000)) continue;
      if (!series.has(k)) series.set(k, []);
      series.get(k).push({ d: m.d.slice(0, 10), v: n });
    }
  }
  const before = iso(t - 56 * DAY);
  const out = [];
  for (const [key, pts] of series) {
    const last = pts[pts.length - 1];
    const then = [...pts].reverse().find(p => p.d <= before) || (pts.length > 1 ? pts[0] : null);
    out.push({ key, last: r1(last.v), on: last.d, ...(then && then.d !== last.d ? { was: r1(then.v), wasOn: then.d } : {}) });
  }
  return out.sort((a, b) => (a.on < b.on ? 1 : -1)).slice(0, MAX_MEASURES);
}

const FORM = ['sleep', 'energy', 'sore', 'stress'];
/**
 * How the person has been feeling, only when they switched `health` on: the daily-form check-ins
 * of the last 14 days (1 to 5 each, lib/daily-form.js), the phone's own vitals summary when it sent
 * one (sleep, resting heart rate, HRV, steps: latest and usual), and the latest blood pressure.
 */
export function healthOf(S, now, vitals) {
  const t = Number.isFinite(now) ? now : Date.now();
  const from = iso(t - 14 * DAY);
  const form = Object.entries(isMap(S?.dayForm) ? S.dayForm : {})
    .filter(([d, f]) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= from && isMap(f))
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([d, f]) => {
      const o = { d };
      for (const k of FORM) { const n = fin(f[k]); if (Number.isInteger(n) && n >= 1 && n <= 5) o[k] = n; }
      return o;
    })
    .filter(o => Object.keys(o).length > 1)
    .slice(-14);
  const out = {};
  if (form.length) out.checkins = form;
  const v = cleanVitals(vitals);
  if (v) out.vitals = v;
  const bp = list(S?.measurements).filter(m => isMap(m) && typeof m.d === 'string')
    .map(m => ({ d: m.d.slice(0, 10), v: isMap(m.v) ? m.v : m }))
    .filter(m => fin(m.v.bpSys) > 0 && fin(m.v.bpDia) > 0)
    .sort((a, b) => (a.d < b.d ? -1 : 1)).pop();
  if (bp) out.bloodPressure = { d: bp.d, sys: Math.round(fin(bp.v.bpSys)), dia: Math.round(fin(bp.v.bpDia)), ...(fin(bp.v.pulse) > 0 ? { pulse: Math.round(fin(bp.v.pulse)) } : {}) };
  return Object.keys(out).length ? out : null;
}

/** The phone's vitals summary (frontend lib/vitals.js vitalsSummary), bounded field by field. */
export function cleanVitals(v) {
  if (!isMap(v)) return null;
  const LIM = { sleep: 24 * 60, rhr: 250, hrv: 400, steps: 200000 };
  const out = {};
  for (const [k, max] of Object.entries(LIM)) {
    const e = v[k];
    if (!isMap(e)) continue;
    const val = fin(e.v);
    if (!(val > 0 && val <= max)) continue;
    out[k] = { v: Math.round(val), ...(typeof e.d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.d) ? { d: e.d } : {}), ...(fin(e.usual) > 0 && fin(e.usual) <= max ? { usual: Math.round(fin(e.usual)) } : {}) };
  }
  return Object.keys(out).length ? out : null;
}

/** The routine loop when the plan runs as a rotation (lib/rotation.js): its order and what is next. */
export function rotationOf(S) {
  const r = S?.rotation;
  if (!isMap(r) || !Array.isArray(r.sequence) || !r.sequence.length) return null;
  // A live pass (S.queue) wins over the flag, as rotation.js scheduleModeOf has it.
  if (S.scheduleMode !== 'rotation' && !isMap(S.queue)) return null;
  const seq = r.sequence.filter(x => typeof x === 'string' || x === null).slice(0, 14).map(x => (x === null ? 'rest' : x.slice(0, 64)));
  const at = Number.isInteger(r.at) && r.at >= 0 ? r.at % seq.length : 0;
  return { sequence: seq, next: seq[at] };
}
