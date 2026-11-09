/* A trainer's writes into a member's profile: a small whitelist of patch operations, applied on
 * the server to a copy of the member's document, never a whole document sent by the trainer
 * (docs/TRAINERS.md, "Changes and undo").
 *
 *   cleanOps(raw)                       the ops a request may carry, validated, or an OpError
 *   applyOps(S, ops, { by, t })         applies them to S (mutated) and returns, per op, what it did
 *                                       and its inverse
 *   applyRestores(S, restores, { t })   puts entries back the way an inverse says (the member's Undo)
 *
 * Every change is stamped here the way the app stamps its own (sync-stamps.js stampEntry, the
 * `deleted` and `edited` records), so the member's devices merge it like a change made on a second
 * device: the newer stamp per field wins and a deletion stays deleted. server.js then writes the
 * document through stampPut, the same path as PUT /api/data. Every entry a trainer writes carries
 * `_by: { kind: 'trainer', id, name, at }`, which syncs as an ordinary field.
 *
 * An inverse is a list of restores: { list, key, value } where `value` is the entry as it was
 * (null: it did not exist), or for the week plan the weekday's value. */
import crypto from 'node:crypto';
import { stampEntry } from '../sync-stamps.js';

export class OpError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

// The category each op needs (scopes.js), checked by the caller for every op on its own.
export const OP_CATEGORY = {
  'routine.put': 'plans', 'routine.remove': 'plans', 'week.set': 'plans',
  'bodyweight.put': 'bodyweight', 'measurement.put': 'measurements',
  'workout.add': 'workouts', 'workout.edit': 'workouts',
  // Only the server makes these two, as part of assigning a routine (never from a request body):
  // the trainer's custom exercises the routine needs, and the routine put on a weekday.
  'custom.put': 'plans', 'week.add': 'plans',
};
const INTERNAL = new Set(['custom.put', 'week.add']);
export const MAX_OPS = 20;

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v);
const isISO = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d + 'T00:00:00Z'));
const clone = v => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const text = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, '').trim().slice(0, n) : '');
const idOk = v => (typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,80}$/.test(v)) || (Number.isInteger(v) && v >= 0);
const finite = (v, lo, hi) => Number.isFinite(+v) && +v >= lo && +v <= hi;
const bad = msg => new OpError(400, 'bad-op', msg);
// Fields of a routine or custom exercise that point at media, which never travel to another profile.
const MEDIA_KEY = /photo|video|media|img|image|gif|sound|audio|avatar/i;
const noMedia = o => { const out = {}; for (const [k, v] of Object.entries(o)) if (!MEDIA_KEY.test(k) && k !== '_f' && k !== '_u' && k !== '_ts') out[k] = v; return out; };

// Built-in measurement fields (frontend lib/measurements.js MEASUREMENT_KEYS), in cm or %.
export const MEASUREMENT_KEYS = ['neck', 'shoulders', 'chest', 'waist', 'hips', 'abdomen', 'upperArmLeft', 'upperArmRight', 'forearmLeft',
  'forearmRight', 'wristLeft', 'wristRight', 'thighLeft', 'thighRight', 'calfLeft', 'calfRight', 'ankleLeft', 'ankleRight', 'bodyFat'];

function cleanRoutine(r) {
  if (!isMap(r)) throw bad('routine must be an object');
  const name = text(r.name, 80);
  if (!name) throw bad('a routine needs a name');
  if (!Array.isArray(r.ex) || r.ex.length > 80) throw bad('routine.ex must be a list of at most 80');
  const ex = r.ex.map(e => {
    if (!isMap(e) || !idOk(e.id)) throw bad('every exercise needs an id');
    const x = noMedia(e);
    if (JSON.stringify(x).length > 4000) throw bad('an exercise is too big');
    return x;
  });
  const out = { ...noMedia(r), name, ex };
  delete out.id; delete out._by; delete out.origin;
  if (JSON.stringify(out).length > 60000) throw bad('that routine is too big');
  return out;
}
function cleanWorkout(w) {
  if (!isMap(w) || !isISO(w.d)) throw bad('a workout needs a date');
  if (!Array.isArray(w.entries) || !w.entries.length || w.entries.length > 40) throw bad('a workout needs 1 to 40 exercises');
  const entries = w.entries.map(e => {
    if (!isMap(e) || !idOk(e.id) || !Array.isArray(e.sets) || e.sets.length > 30) throw bad('every exercise needs an id and its sets');
    return { id: e.id, sets: e.sets.map(s => {
      if (!isMap(s) || !finite(s.w ?? 0, 0, 2000) || !finite(s.r ?? 0, 0, 1000)) throw bad('a set is a weight and reps');
      return { w: +(s.w ?? 0), r: Math.round(+(s.r ?? 0)), done: s.done !== false };
    }) };
  });
  const start = finite(w.start, 1, 9e15) ? Math.floor(+w.start) : Date.parse(w.d + 'T12:00:00Z');
  const end = finite(w.end, start, 9e15) ? Math.floor(+w.end) : start;
  return { d: w.d, name: text(w.name, 80) || 'Workout', start, end, entries, prs: [], routineIds: [], routineId: null };
}

/** The ops of one request, checked and cleaned. Unknown ops and fields never get through. */
export function cleanOps(raw) {
  if (!Array.isArray(raw) || !raw.length) throw bad('ops must be a non-empty list');
  if (raw.length > MAX_OPS) throw bad(`at most ${MAX_OPS} ops at a time`);
  return raw.map(o => {
    if (!isMap(o) || !(o.op in OP_CATEGORY) || INTERNAL.has(o.op)) throw bad('unknown op');
    switch (o.op) {
      case 'routine.put': return { op: o.op, ...(o.id != null ? (idOk(o.id) ? { id: o.id } : (() => { throw bad('bad routine id'); })()) : {}), routine: cleanRoutine(o.routine), ...(isMap(o.origin) ? { origin: o.origin } : {}) };
      case 'routine.remove': if (!idOk(o.id)) throw bad('bad routine id'); return { op: o.op, id: o.id };
      case 'week.set': {
        const day = Number(o.day);
        if (!Number.isInteger(day) || day < 0 || day > 6) throw bad('day is 0 (Sunday) to 6');
        const ids = o.ids == null ? [] : [].concat(o.ids);
        if (ids.length > 4 || !ids.every(idOk)) throw bad('ids are up to 4 routine ids');
        return { op: o.op, day, ids };
      }
      case 'bodyweight.put':
        if (!isISO(o.d) || !finite(o.w, 1, 1000)) throw bad('a weigh-in is a date and a weight');
        return { op: o.op, d: o.d, w: Math.round(+o.w * 100) / 100 };
      case 'measurement.put': {
        if (!isISO(o.d) || !isMap(o.values)) throw bad('a check-in is a date and values');
        const values = {};
        for (const [k, v] of Object.entries(o.values)) {
          if (!MEASUREMENT_KEYS.includes(k)) throw bad('unknown measurement ' + k);
          if (!finite(v, 0, 1000)) throw bad('a measurement is a number');
          values[k] = Math.round(+v * 100) / 100;
        }
        if (!Object.keys(values).length) throw bad('nothing measured');
        return { op: o.op, d: o.d, values };
      }
      case 'workout.add': return { op: o.op, workout: cleanWorkout(o.workout) };
      case 'workout.edit': {
        // A correction of a logged workout: its name and the weight, reps or tick of sets it has.
        // Sets are addressed by position (e, s) as the projection lists them, with the exercise id
        // to make sure the workout still looks that way; nothing is added, removed or reordered.
        // A workout without an id of its own goes by date|start, the way the projection names it.
        if (!idOk(o.id) && !(typeof o.id === 'string' && /^\d{4}-\d{2}-\d{2}\|\d{1,16}$/.test(o.id))) throw bad('bad workout id');
        const sets = o.sets == null ? [] : o.sets;
        if (!Array.isArray(sets) || sets.length > 200) throw bad('sets are at most 200 changes');
        const clean = sets.map(x => {
          if (!isMap(x) || !Number.isInteger(x.e) || !Number.isInteger(x.s) || x.e < 0 || x.s < 0 || !idOk(x.ex)) throw bad('a set change names its exercise and position');
          if (x.side != null && x.side !== 'L' && x.side !== 'R') throw bad('side is L or R');
          if (x.w != null && !finite(x.w, 0, 2000)) throw bad('a weight is 0 to 2000');
          if (x.r != null && !finite(x.r, 0, 1000)) throw bad('reps are 0 to 1000');
          if (x.w == null && x.r == null && x.done == null) throw bad('a set change changes something');
          return { e: x.e, s: x.s, ex: x.ex, ...(x.side ? { side: x.side } : {}), ...(x.w != null ? { w: Math.round(+x.w * 1000) / 1000 } : {}),
            ...(x.r != null ? { r: Math.round(+x.r) } : {}), ...(x.done != null ? { done: !!x.done } : {}) };
        });
        const name = o.name == null ? null : text(o.name, 80);
        if (!clean.length && !name) throw bad('nothing to correct');
        return { op: o.op, id: o.id, ...(name ? { name } : {}), sets: clean };
      }
    }
    throw bad('unknown op');
  });
}

/* ---------- applying ---------- */
const LIST_KEY = { customEx: x => x?.id, routines: x => x?.id, bodyweight: e => e?.d, measurements: e => e?.d, workouts: w => (w?.id != null ? w.id : `${w?.d}|${w?.start}`) };
const list = (S, l) => (Array.isArray(S[l]) ? S[l] : (S[l] = []));
const findIn = (S, l, key) => list(S, l).findIndex(x => x && String(LIST_KEY[l](x)) === String(key));
function noteDeleted(S, l, key, t) {
  if (!isMap(S.deleted)) S.deleted = {};
  if (!isMap(S.deleted[l])) S.deleted[l] = {};
  S.deleted[l][String(key)] = t;
}
function noteEdited(S, k, t) {
  if (!isMap(S.edited)) S.edited = {};
  S.edited[k] = t;
}
// Weigh-ins and check-ins carry their edit time as `t` (sync-stamps.js DEL_TIME); the rest `_ts`/`_f`.
const STAMP_T = new Set(['bodyweight', 'measurements']);

/** Puts `value` in place of the entry `key` of list `l` (null takes it out), stamped at `t`. */
function putEntry(S, l, key, value, t) {
  const i = findIn(S, l, key);
  const old = i >= 0 ? S[l][i] : null;
  if (value == null) {
    if (i < 0) return;
    S[l].splice(i, 1);
    noteDeleted(S, l, key, t);
    return;
  }
  const x = clone(value);
  if (STAMP_T.has(l)) x.t = t;
  else if (old) stampEntry(old, x, t);
  else x._ts = t;
  if (i >= 0) S[l][i] = x; else S[l].push(x);
  if (l === 'bodyweight' || l === 'measurements') S[l].sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
}
function setWeek(S, day, value, t) {
  if (!isMap(S.week)) S.week = {};
  if (value == null || (Array.isArray(value) && !value.length)) delete S.week[day]; else S.week[day] = value;
  noteEdited(S, `week.${day}`, t);
}
const snapshot = (S, l, key) => { const i = findIn(S, l, key); return i >= 0 ? clone(S[l][i]) : null; };
const newId = (prefix, rand) => prefix + rand(6).toString('hex');

/**
 * Applies `ops` (from cleanOps) to `S`, labelled `by`. Returns one record per op:
 *   { op, cat, summary: { kind, name?, d?, isNew? }, inverse: [restores], touched: [{ list, key }] }
 * `ctx.copyFor(op)` may give a `routine.put` its copy of a trainer's own routine (assign).
 */
export function applyOps(S, ops, { by, t, rand = crypto.randomBytes } = {}) {
  const label = by ? { kind: 'trainer', id: by.id, name: String(by.name || '').slice(0, 60), at: t } : null;
  const out = [];
  let lastRoutine = null;
  for (const o of ops) {
    const rec = { op: o.op, cat: OP_CATEGORY[o.op], inverse: [], touched: [] };
    switch (o.op) {
      case 'routine.put': {
        // The same trainer's routine again (a new version of an assigned one) replaces the copy.
        let id = o.id;
        if (id == null && o.origin?.sourceId) {
          const prev = list(S, 'routines').find(r => r?.origin?.kind === 'trainer' && r.origin.id === o.origin.id && r.origin.sourceId === o.origin.sourceId);
          if (prev) id = prev.id;
        }
        if (id != null && findIn(S, 'routines', id) < 0) throw new OpError(404, 'no-routine', 'no such routine');
        if (id == null) id = newId('tr_', rand);
        const before = snapshot(S, 'routines', id);
        const value = { ...(before || {}), ...o.routine, id, ...(o.origin ? { origin: o.origin } : {}), ...(label ? { _by: label } : {}) };
        delete value._ts; delete value._f; delete value._u;
        rec.inverse.push({ list: 'routines', key: id, value: before });
        putEntry(S, 'routines', id, value, t);
        rec.summary = { kind: o.op, name: value.name, isNew: !before, id };
        rec.touched.push({ list: 'routines', key: id });
        lastRoutine = id;
        break;
      }
      case 'routine.remove': {
        const before = snapshot(S, 'routines', o.id);
        if (!before) throw new OpError(404, 'no-routine', 'no such routine');
        rec.inverse.push({ list: 'routines', key: o.id, value: before });
        // Take it off the week plan as well, so no weekday points at nothing.
        for (const [day, v] of Object.entries(isMap(S.week) ? S.week : {})) {
          const ids = [].concat(v || []);
          if (!ids.includes(o.id)) continue;
          rec.inverse.push({ list: 'week', key: day, value: clone(v) });
          setWeek(S, day, ids.filter(x => x !== o.id), t);
        }
        putEntry(S, 'routines', o.id, null, t);
        rec.summary = { kind: o.op, name: before.name, id: o.id };
        rec.touched.push({ list: 'routines', key: o.id });
        break;
      }
      case 'week.set': {
        const known = new Set(list(S, 'routines').map(r => r?.id));
        if (!o.ids.every(x => known.has(x))) throw new OpError(404, 'no-routine', 'no such routine');
        const before = isMap(S.week) && S.week[o.day] != null ? clone(S.week[o.day]) : null;
        rec.inverse.push({ list: 'week', key: String(o.day), value: before });
        setWeek(S, o.day, o.ids.length ? o.ids : null, t);
        const names = o.ids.map(x => list(S, 'routines').find(r => r?.id === x)?.name).filter(Boolean);
        rec.summary = { kind: o.op, day: o.day, name: names.join(', ') };
        rec.touched.push({ list: 'week', key: String(o.day) });
        break;
      }
      case 'week.add': {
        if (lastRoutine == null) throw bad('week.add follows a routine.put');
        const before = isMap(S.week) && S.week[o.day] != null ? clone(S.week[o.day]) : null;
        const ids = [].concat(before || []).filter(x => x !== lastRoutine);
        rec.inverse.push({ list: 'week', key: String(o.day), value: before });
        setWeek(S, o.day, [...ids, lastRoutine].slice(-4), t);
        rec.summary = { kind: o.op, day: o.day, name: list(S, 'routines').find(r => r?.id === lastRoutine)?.name || '' };
        rec.touched.push({ list: 'week', key: String(o.day) });
        break;
      }
      case 'custom.put': {
        // A custom exercise the member does not have yet; one they have keeps theirs.
        if (findIn(S, 'customEx', o.exercise.id) >= 0) { rec.summary = { kind: o.op, name: o.exercise.name, kept: true }; break; }
        rec.inverse.push({ list: 'customEx', key: o.exercise.id, value: null });
        putEntry(S, 'customEx', o.exercise.id, { ...noMedia(o.exercise), ...(label ? { _by: label } : {}) }, t);
        rec.summary = { kind: o.op, name: o.exercise.name };
        rec.touched.push({ list: 'customEx', key: o.exercise.id });
        break;
      }
      case 'bodyweight.put': {
        const before = snapshot(S, 'bodyweight', o.d);
        rec.inverse.push({ list: 'bodyweight', key: o.d, value: before });
        putEntry(S, 'bodyweight', o.d, { ...(before || {}), d: o.d, w: o.w, ...(label ? { _by: label } : {}) }, t);
        rec.summary = { kind: o.op, d: o.d, w: o.w };
        rec.touched.push({ list: 'bodyweight', key: o.d });
        break;
      }
      case 'measurement.put': {
        const before = snapshot(S, 'measurements', o.d);
        rec.inverse.push({ list: 'measurements', key: o.d, value: before });
        putEntry(S, 'measurements', o.d, { ...(before || {}), d: o.d, ...o.values, ...(label ? { _by: label } : {}) }, t);
        rec.summary = { kind: o.op, d: o.d, n: Object.keys(o.values).length };
        rec.touched.push({ list: 'measurements', key: o.d });
        break;
      }
      case 'workout.edit': {
        const before = snapshot(S, 'workouts', o.id);
        if (!before) throw new OpError(404, 'no-workout', 'no such workout');
        const w = clone(before);
        // The same positions the projection showed: entries and sets that are objects, in order.
        const entries = Array.isArray(w.entries) ? w.entries.filter(isMap) : [];
        for (const x of o.sets) {
          const e = entries[x.e];
          const st = e && Array.isArray(e.sets) ? e.sets.filter(isMap)[x.s] : null;
          if (!e || String(e.id) !== String(x.ex) || !st) throw new OpError(409, 'changed-since', 'that workout changed since you looked');
          const target = isMap(st.sides) ? (x.side ? st.sides[x.side] : null) : (x.side ? null : st);
          if (!isMap(target)) throw new OpError(409, 'changed-since', 'that workout changed since you looked');
          if (x.w != null) target.w = x.w;
          if (x.r != null) target.r = x.r;
          if (x.done != null) target.done = x.done;
        }
        if (o.name) w.name = o.name;
        if (label) w._edit = label;
        rec.inverse.push({ list: 'workouts', key: o.id, value: before });
        putEntry(S, 'workouts', o.id, w, t);
        rec.summary = { kind: o.op, d: w.d, name: w.name, n: o.sets.length };
        rec.touched.push({ list: 'workouts', key: o.id });
        break;
      }
      case 'workout.add': {
        const id = newId('tw_', rand);
        const w = { ...o.workout, id, ...(label ? { _by: label } : {}) };
        rec.inverse.push({ list: 'workouts', key: id, value: null });
        putEntry(S, 'workouts', id, w, t);
        rec.summary = { kind: o.op, d: w.d, name: w.name };
        rec.touched.push({ list: 'workouts', key: id });
        break;
      }
    }
    out.push(rec);
  }
  return out;
}

/** The entries an op left behind, as a fingerprint per touched key: Undo can tell whether the
 *  member changed them since. Stamps and labels do not count. */
export function fingerprintOf(S, touched) {
  const out = {};
  for (const { list: l, key } of touched) {
    const v = l === 'week' ? (isMap(S.week) ? S.week[key] ?? null : null) : snapshot(S, l, key);
    const plain = v && typeof v === 'object' && !Array.isArray(v) ? (({ _ts, _f, _u, t, ...rest }) => rest)(v) : v;
    out[`${l}|${key}`] = crypto.createHash('sha256').update(JSON.stringify(plain ?? null)).digest('base64url').slice(0, 16);
  }
  return out;
}

/** The member's Undo: every restore of an inverse, newest first, stamped at `t` so it wins. */
export function applyRestores(S, restores, { t }) {
  for (const r of [...restores].reverse()) {
    if (r.list === 'week') setWeek(S, r.key, r.value, t);
    else if (r.list in LIST_KEY) putEntry(S, r.list, r.key, r.value, t);
  }
}

/** A trainer's own custom exercise as it travels with an assigned routine: no media, no stamps. */
export const customCopy = c => noMedia(c);
/** A trainer's own routine as it travels to a member: the same cleaning a routine.put gets. */
export const routineCopy = r => cleanRoutine(r);
