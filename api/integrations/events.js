/* What happened in a profile, read off two versions of its document: the one on disk before a
 * PUT /api/data and the one it stored. The server has no other moment where it sees a workout
 * finish (the app, the watch, the MCP log_workout tool all end in that PUT), so this is the one
 * place events come from, whichever device logged them.
 *
 *   workout.finished  a workout id the old document did not have
 *   workout.pr        the same workout, when it set records (w.prs, the app's own judgement)
 *   weighin.logged    a body-weight entry the old document did not have, or whose weight changed
 *
 * Only what is recent counts (RECENT_MS, by the entry's own time): a backup restored over the
 * profile, a first sync of a phone that trained offline for months, or an import from another
 * app brings in hundreds of "new" workouts that are not news. The hub also skips anything older
 * than the connection itself. Pure, so the tests can feed it documents. */
import { libraryName } from '../coach/core/library.js';

export const EVENTS = ['workout.finished', 'workout.pr', 'weighin.logged'];
export const RECENT_MS = 7 * 86400_000;
export const MAX_PER_WRITE = 10;
export const PAYLOAD_VERSION = 1;

const list = v => (Array.isArray(v) ? v.filter(x => x && typeof x === 'object' && !Array.isArray(x)) : []);
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : null);
const dayMs = d => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d) ? Date.parse(d.slice(0, 10) + 'T12:00:00Z') : NaN);

/** When a workout happened, as best the document says: its end, its start, or its day. */
export function workoutTime(w) {
  return num(w.end) || num(w.start) || dayMs(w.d) || 0;
}
const weighinTime = b => num(b.t) || dayMs(b.d) || 0;

/** [{ type, entity, at, data }] for what is new in `next`, newest last, at most MAX_PER_WRITE. */
export function detectEvents(prev, next, { now = Date.now() } = {}) {
  const out = [];
  const before = new Set(list(prev?.workouts).map(w => String(w.id)));
  for (const w of list(next?.workouts)) {
    if (w.id == null || before.has(String(w.id))) continue;
    const at = workoutTime(w);
    if (!at || now - at > RECENT_MS || at - now > 86400_000) continue;
    out.push({ type: 'workout.finished', entity: String(w.id).slice(0, 80), at, data: w });
    if (Array.isArray(w.prs) && w.prs.length) out.push({ type: 'workout.pr', entity: String(w.id).slice(0, 80), at, data: w });
  }
  const old = new Map(list(prev?.bodyweight).map(b => [String(b.d), num(b.w)]));
  for (const b of list(next?.bodyweight)) {
    const w = num(b.w);
    if (w == null || typeof b.d !== 'string' || old.get(String(b.d)) === w) continue;
    const at = weighinTime(b);
    if (!at || now - at > RECENT_MS || at - now > 86400_000) continue;
    out.push({ type: 'weighin.logged', entity: `${b.d.slice(0, 10)}:${w}`, at, data: b });
  }
  return out.sort((a, b) => a.at - b.at).slice(-MAX_PER_WRITE);
}

/* ---------- payloads (docs/INTEGRATIONS.md is the reference) ---------- */

const MAX_EXERCISES = 60;
const MAX_SETS = 50;
const NAME_MAX = 80;
const NOTE_MAX = 500;

function exerciseName(id, doc) {
  const own = list(doc?.customEx).find(c => String(c.id) === String(id));
  return text(own?.name, NAME_MAX) || text(libraryName(String(id)), NAME_MAX) || String(id).slice(0, NAME_MAX);
}

const isWarmup = s => (s?.phase != null && s.phase !== '' ? s.phase === 'warmup' : s?.warmup === true);

function setOut(s) {
  if (s?.sides && typeof s.sides === 'object' && s.sides.L && s.sides.R) {
    return { sides: { left: setOut(s.sides.L), right: setOut(s.sides.R) } };
  }
  const o = {};
  if (num(s.w) != null) o.weight = s.w;
  if (num(s.r) != null) o.reps = s.r;
  if (num(s.sec) != null) o.seconds = s.sec;
  if (num(s.min) != null) o.minutes = s.min;
  if (num(s.speed) != null) o.speedKmh = s.speed;
  if (num(s.incline) != null) o.incline = s.incline;
  if (num(s.rpe) != null) o.rpe = s.rpe;
  if (num(s.rir) != null) o.rir = s.rir;
  if (isWarmup(s)) o.warmup = true;
  return o;
}
const done = s => (s?.sides ? s.sides.L?.done === true || s.sides.R?.done === true : s?.done === true);

export function workoutPayload(w, doc) {
  const exercises = list(w.entries).slice(0, MAX_EXERCISES).map(e => ({
    id: String(e.id).slice(0, 40),
    name: exerciseName(e.id, doc),
    sets: list(e.sets).filter(done).slice(0, MAX_SETS).map(setOut),
  }));
  let sets = 0, reps = 0, volume = 0;
  for (const e of exercises) for (const s of e.sets) {
    if (s.warmup) continue;
    sets += 1;
    const parts = s.sides ? [s.sides.left, s.sides.right] : [s];
    for (const p of parts) { reps += p.reps || 0; volume += (p.weight || 0) * (p.reps || 0); }
  }
  const start = num(w.start), end = num(w.end);
  return {
    id: String(w.id).slice(0, 80),
    name: text(w.name, NAME_MAX) || null,
    date: typeof w.d === 'string' ? w.d.slice(0, 10) : null,
    startedAt: start ? new Date(start).toISOString() : null,
    endedAt: end ? new Date(end).toISOString() : null,
    durationMin: start && end && end > start ? Math.round((end - start) / 60000) : null,
    unit: doc?.unit === 'lb' ? 'lb' : 'kg',
    bodyweight: num(w.bw),
    totals: { exercises: exercises.length, sets, reps, volume: Math.round(volume * 10) / 10 },
    exercises,
    records: (Array.isArray(w.prs) ? w.prs : []).slice(0, MAX_EXERCISES).map(id => ({ id: String(id).slice(0, 40), name: exerciseName(id, doc) })),
    ...(text(w.note, NOTE_MAX) ? { note: text(w.note, NOTE_MAX) } : {}),
  };
}

function recordsPayload(w, doc) {
  const full = workoutPayload(w, doc);
  return {
    workout: { id: full.id, name: full.name, date: full.date },
    unit: full.unit,
    records: full.records.map(r => {
      const ex = full.exercises.find(e => e.id === r.id);
      const best = (ex?.sets || []).filter(s => !s.warmup && s.weight != null).sort((a, b) => b.weight - a.weight || (b.reps || 0) - (a.reps || 0))[0];
      return { ...r, ...(best ? { weight: best.weight, reps: best.reps ?? null } : {}) };
    }),
  };
}

const weighinPayload = (b, doc) => ({ date: b.d.slice(0, 10), weight: b.w, unit: doc?.unit === 'lb' ? 'lb' : 'kg' });

/** The `data` of an event, as a receiver gets it. */
export function eventData(ev, doc) {
  if (ev.type === 'workout.finished') return { workout: workoutPayload(ev.data, doc) };
  if (ev.type === 'workout.pr') return recordsPayload(ev.data, doc);
  if (ev.type === 'weighin.logged') return { weighin: weighinPayload(ev.data, doc) };
  return {};
}

/** The envelope every delivery has. `id` is the delivery's own, the same on every retry. */
export function envelope({ id, type, data, at = Date.now(), test = false }) {
  return { version: PAYLOAD_VERSION, id, type, createdAt: new Date(at).toISOString(), ...(test ? { test: true } : {}), data };
}

/** What a "Send test event" delivers: a small made-up workout, marked test: true. */
export function testData(type, now = Date.now()) {
  if (type === 'weighin.logged') return { weighin: { date: new Date(now).toISOString().slice(0, 10), weight: 80, unit: 'kg' } };
  const workout = {
    id: 'test', name: 'Test workout', date: new Date(now).toISOString().slice(0, 10),
    startedAt: new Date(now - 45 * 60000).toISOString(), endedAt: new Date(now).toISOString(), durationMin: 45,
    unit: 'kg', bodyweight: null, totals: { exercises: 1, sets: 3, reps: 24, volume: 1440 },
    exercises: [{ id: '0025', name: 'barbell bench press', sets: [{ weight: 60, reps: 8 }, { weight: 60, reps: 8 }, { weight: 60, reps: 8 }] }],
    records: [],
  };
  if (type === 'workout.pr') return { workout: { id: 'test', name: 'Test workout', date: workout.date }, unit: 'kg', records: [{ id: '0025', name: 'barbell bench press', weight: 60, reps: 8 }] };
  return { workout };
}
