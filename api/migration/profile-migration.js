/* The one v1 → v2 profile migration
 * (spec: docs/superpowers/specs/2026-09-25-automatic-engine-data-migration-design.md).
 *
 * Shared by the API's migration transaction and the browser/Capacitor build (local copies, backup
 * import) — both images carry api/migration. Pure and deterministic: ids come from existing
 * routine/workout ids and array positions, timestamps from the workout they describe, and nothing
 * reads the clock or a random source, so a retry after a crash — or a device converting its own
 * copy of the same profile — produces the identical document.
 *
 * Imports only the engine and ./profile-version.js. The built-in exercise catalogue (a v1 profile
 * stores only an exerciseId, and cardio/bodyweight/assisted are read off the catalogue entry) is
 * passed in by the caller. Both callers — api/server.js and frontend/src/store/useStore.js — must
 * pass the same one, LIB_BY_ID from api/coach/core/library.js: a different catalogue on the phone
 * would convert the same profile into a different document.
 *
 * Why not in api/engine: this is a one-off data conversion, not training logic, and it needs the
 * catalogue; the engine stays catalogue-free.
 */
import { ENGINE_SCHEMA, migrationStatus } from './profile-version.js';
import {
  INCREMENTING_GATES, PRESETS, advanceProgression, currentOneRm, defaultPlanRule, estimate1RM,
  generatePrescription, migrateOccurrence, normalizeEffort, presetForPolicy, summarizeActual, validatePlanRule, validateWarmup
} from '../engine/index.js';

export { ENGINE_SCHEMA, isLegacyProfile, migrationStatus } from './profile-version.js';

const MODES = ['reps', 'time', 'cardio'];
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const records = v => (Array.isArray(v) ? v.filter(isObj) : []);
const list = v => (Array.isArray(v) ? v : []);
const num = v => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};
const whole = (v, lo = 1) => { const n = num(v); return n != null && Math.round(n) >= lo ? Math.round(n) : null; };
const fixed = n => ({ min: n, max: n });
const clone = v => JSON.parse(JSON.stringify(v));
const idOf = (v, fallback) => (v != null && v !== '' ? String(v) : fallback);
const iso = ms => new Date(ms).toISOString();
const whenOf = w => num(w?.start) ?? (Date.parse(`${w?.d}T00:00:00Z`) || 0);

/** `base`, then `base~2`, `base~3`… in call order. */
function uniqueIds() {
  const seen = new Map();
  return base => { const n = (seen.get(base) || 0) + 1; seen.set(base, n); return n === 1 ? base : `${base}~${n}`; };
}

/* ---------- what the catalogue says about an exercise ----------
   Mirrors frontend/src/lib/exercises.js (isCardio, isBodyweightEq, isAssisted) and
   workout-model.js (isWarmupRow): this module has to run in the API image, which has no frontend/.
   A frozen copy on purpose, with no parity test: it reads v1 data the way the v1 app did, so it
   must not follow later changes to the frontend originals. */
const BODYWEIGHT_EQ = new Set(['body weight', 'band', 'resistance band']);
const exerciseOf = (ctx, id) => records(ctx.state.customEx).find(c => String(c.id) === id) || ctx.catalogue.get(id) || null;
const modeOf = (cfg, ex) => (MODES.includes(cfg?.mode) ? cfg.mode : ex?.bp === 'cardio' ? 'cardio' : 'reps');
const isBodyweight = (cfg, ex) => (cfg?.bodyweight != null ? !!cfg.bodyweight : BODYWEIGHT_EQ.has(ex?.eq));
const isAssisted = ex => (typeof ex?.assisted === 'boolean' ? ex.assisted
  : ex?.eq === 'leverage machine' && /\bassist(ed)?\b/i.test(String(ex?.n || '')));
const WARMUP = new Set(['warmup', 'warm-up', 'warm_up']);
const isWarmupRow = row => (row?.phase != null && row.phase !== ''
  ? WARMUP.has(String(row.phase).trim().toLowerCase()) : row?.warmup === true);
const entryMode = (entry, ex, rows) => (MODES.includes(entry.target?.mode) ? entry.target.mode
  : rows.some(row => num(row.min) != null) ? 'cardio' : rows.some(row => num(row.sec) != null) ? 'time' : modeOf(null, ex));

/* ---------- plan rules ---------- */
// resolveLoad rounds every absolute load, so the step must leave each recorded load exactly as it
// was: the lifter's own increment when it fits, else the coarsest plate step that does.
const STEPS = { kg: [2.5, 1.25, 1, 0.5, 0.25, 0.1, 0.05, 0.01, 0.001], lb: [5, 2.5, 1, 0.5, 0.25, 0.1, 0.01, 0.001] };
const onGrid = (v, step) => Math.abs(v / step - Math.round(v / step)) < 1e-6;
function stepFor(loads, inc, unit) {
  return [...(inc > 0 ? [inc] : []), ...STEPS[unit]].find(step => loads.every(v => onGrid(v, step))) ?? 0.001;
}

/** A canonical rule from plain v1 numbers — a routine entry, or that entry with a logged target over it. */
function ruleFrom(v, { id, routineId, exerciseId, preset, unit, mode, step, rest }) {
  const rule = defaultPlanRule(preset, { id, exerciseId, routineId, unit });
  const p = rule.parameters;
  const sets = whole(v.sets);
  if (sets) p.sets = fixed(sets);
  if (mode === 'reps') {
    const lo = whole(v.repsMin), hi = whole(v.repsMax), reps = whole(v.reps);
    if (preset === 'double' && lo && hi && lo <= hi) p.reps = { min: lo, max: hi };
    else if (reps) p.reps = fixed(reps);
  } else {
    const seconds = mode === 'cardio' ? (num(v.min) > 0 ? num(v.min) * 60 : 20 * 60) : (num(v.sec) > 0 ? num(v.sec) : 30);
    Object.assign(p, { reps: fixed(1), durationSeconds: fixed(seconds) });
  }
  const w = num(v.weight);
  const loaded = INCREMENTING_GATES.includes(PRESETS[preset].gate);
  p.load = w > 0 || loaded ? { mode: 'absolute', value: w > 0 ? w : 0, unit } : { mode: 'empty' };
  p.restSeconds = whole(v.restSec ?? v.rest, 0) ?? rest ?? p.restSeconds;
  const inc = num(v.inc);
  if (inc != null && inc >= 0) rule.increment = { type: 'absolute', value: inc, unit };
  // v1 never had a terminal target: a migrated track keeps progressing, it never "completes".
  Object.assign(rule, { target: { mode: 'none' }, completion: [], rounding: { mode: 'nearest', step } });
  return rule;
}

// Fields with no executable equivalent in the v2 engine. Kept verbatim in migrationAudit and shown
// as "needs review"; the immutable v1 backup holds everything else.
const UNSUPPORTED = ['side', 'intensifier', 'deloadFactor'];
function noteUnsupported(d, out) {
  const at = { routineId: d.routineId, occurrenceId: d.occurrenceId, exerciseId: d.exerciseId };
  for (const field of UNSUPPORTED) if (d.cfg[field] != null && d.cfg[field] !== false) out.push({ ...at, field, value: clone(d.cfg[field]) });
  if (d.mode === 'cardio' && d.cfg.speed != null) out.push({ ...at, field: 'speed', value: d.cfg.speed });
  if (d.preset === 'manual' && typeof d.cfg.prog === 'string' && d.cfg.prog && d.cfg.prog !== 'off') out.push({ ...at, field: 'prog', value: d.cfg.prog });
}

function draftRoutines(state, ctx) {
  const routineId = uniqueIds();
  return records(state.routines).map((routine, i) => {
    const id = routineId(idOf(routine.id, `m1-r${i}`));
    const key = idOf(routine.id, null);
    const drafts = list(routine.ex).flatMap((cfg, j) => {
      if (!isObj(cfg) || cfg.id == null || cfg.id === '') return [];
      const exerciseId = String(cfg.id);
      const info = exerciseOf(ctx, exerciseId);
      const mode = modeOf(cfg, info);
      const d = {
        routineId: id, occurrenceId: `${id}:o${j}`, exerciseId, cfg, info, mode,
        preset: presetForPolicy(cfg.prog, mode, isBodyweight(cfg, info)),
        excluded: routine.excludeFromProgression === true || cfg.excludeFromProgression === true,
        links: []
      };
      noteUnsupported(d, ctx.unsupported);
      if (key != null) ctx.byRoutine.set(key, [...(ctx.byRoutine.get(key) || []), d]);
      return [d];
    });
    return { routine, id, drafts };
  });
}

const occurrenceOf = d => ({
  occurrenceId: d.occurrenceId, exerciseId: d.exerciseId, mode: d.mode, rule: d.rule,
  ...(d.warmup ? { warmup: d.warmup } : {}),
  ...(d.cfg.sg ? { sg: d.cfg.sg } : {}),
  ...(d.cfg.note ? { note: String(d.cfg.note) } : {}),
  ...(whole(d.cfg.restSec) ? { restSec: whole(d.cfg.restSec) } : {}),
  ...(d.cfg.excludeFromProgression === true ? { excludeFromProgression: true } : {})
});

/* ---------- history ---------- */
const TARGET = ['sets', 'reps', 'repsMin', 'repsMax', 'weight', 'sec', 'min'];
const targetValues = t => Object.fromEntries(TARGET.filter(k => t?.[k] != null).map(k => [k, t[k]]));

/** The one occurrence a logged entry was prescribed from, or null when that is not certain. */
function linkOf(w, entry, byRoutine) {
  if (!isObj(entry.target) || entry.noProg === true || w.excludeFromProgression === true) return null;
  const routineIds = Array.isArray(w.routineIds) ? w.routineIds : w.routineId != null ? [w.routineId] : [];
  const rid = idOf(entry.rid ?? (routineIds.length === 1 ? routineIds[0] : null), null);
  if (rid == null) return null;
  const matches = (byRoutine.get(rid) || []).filter(d => d.exerciseId === String(entry.id));
  if (matches.length !== 1 || matches[0].excluded) return null;
  return modeOf(entry.target, matches[0].info) === matches[0].mode ? matches[0] : null;
}

// Each linked entry gets the frozen prescription its target describes; the occurrence's own rule
// starts where the newest of them left off (spec "Conservative progression").
function finalizeDraft(d, ctx) {
  const loads = [d.cfg.weight, ...d.links.map(l => l.values.weight)].map(num).filter(v => v > 0);
  d.step = stepFor(loads, num(d.cfg.inc), ctx.unit);
  d.ruleFor = (values, step = d.step) => ruleFrom({ ...d.cfg, ...values }, {
    id: `rule:${d.occurrenceId}`, routineId: d.routineId, exerciseId: d.exerciseId,
    preset: d.preset, unit: ctx.unit, mode: d.mode, step, rest: ctx.rest
  });
  d.links = d.links.filter(link => {
    try {
      link.prescription = generatePrescription({ id: `${link.workoutId}:p${link.j}`, now: link.at, trackId: d.occurrenceId, rule: d.ruleFor(link.values) });
      return true;
    } catch { return false; }   // a target the engine cannot express stays readable legacy history
  });
  const last = d.links.at(-1)?.values;
  d.rule = d.ruleFor({
    ...(last?.weight != null ? { weight: last.weight } : {}),
    ...(d.preset === 'duration' && last?.sec != null ? { sec: last.sec } : {})
  });
  const check = validatePlanRule(d.rule);
  if (!check.ok) throw new Error(`invalid-rule ${d.occurrenceId}: ${check.errors[0]}`);
  d.warmup = migrateOccurrence({ warmupSets: d.cfg.warmupSets }).warmup;
}

/** One logged v1 row as a SetPerformance row (lib/session-ui-adapter.js performanceRow, plus the
 *  v1 extras it never had to carry: cardio metrics, drops, rest-pause clusters, sides). */
function performanceRow(row, unit, mode) {
  const observations = [];
  const r = num(row.r), w = num(row.w);
  if (r != null && mode !== 'cardio') observations.push({ metric: 'repetitions', unit: 'reps', value: r });
  const duration = mode === 'cardio' ? (num(row.min) != null ? num(row.min) * 60 : null) : num(row.sec);
  if (duration != null) observations.push({ metric: 'duration', unit: 's', value: duration });
  if (mode === 'cardio' && num(row.speed) != null) observations.push({ metric: 'speed', unit: 'kmh', value: num(row.speed) });
  const effort = normalizeEffort({ rir: num(row.rir), rpeEntered: num(row.rpe) });
  const out = {
    prescribed: false,
    role: isWarmupRow(row) ? 'warmup' : 'work',
    status: row.done ? 'completed' : 'skipped',
    observations,
    resistance: w > 0 ? { kind: 'external-load', value: w, unit } : { kind: mode === 'cardio' ? 'none' : 'bodyweight' },
    ...(effort.rir != null ? { rir: effort.rir } : {}),
    ...(effort.rpeEntered != null ? { rpeEntered: effort.rpeEntered } : {}),
    // A drop is extra volume on top of the row; a rest-pause cluster is only how `r` breaks down.
    segments: row.type === 'dropset' ? records(row.drops).map(d => performanceRow({ ...d, done: row.done, phase: row.phase }, unit, mode)) : []
  };
  if (row.type === 'restpause' && Array.isArray(row.clusters)) out.clusters = clone(row.clusters);
  if (isObj(row.sides?.L) && isObj(row.sides?.R)) out.sides = { L: performanceRow(row.sides.L, unit, mode), R: performanceRow(row.sides.R, unit, mode) };
  return out;
}

/** Completed work rows as the engine's per-set actuals (lib/session-ui-adapter.js actualOfRow). */
const performedOf = (rows, unit) => rows.filter(row => !isWarmupRow(row)).flatMap((row, k) => (row.done ? [{
  row: k,
  reps: num(row.sec) != null ? null : num(row.r),
  load: num(row.w) > 0 ? { value: num(row.w), unit } : null,
  durationSeconds: num(row.sec),
  rir: num(row.rir),
  rpeEntered: num(row.rpe)
}] : []));

const repsOf = row => row.observations.find(o => o.metric === 'repetitions')?.value;
const rowVolume = row => (row.resistance.kind === 'external-load' && repsOf(row) != null ? repsOf(row) * row.resistance.value : 0);
const volumeOf = exposures => exposures.reduce((total, x) => total + x.performance.sets
  .filter(row => row.role !== 'warmup' && row.status !== 'skipped')
  .reduce((n, row) => n + rowVolume(row) + row.segments.reduce((m, s) => m + rowVolume(s), 0), 0), 0);

function migrateWorkout(w, i, ctx) {
  const id = ctx.workoutIds[i];
  const completedAt = iso(num(w.end) ?? whenOf(w));
  const exposures = list(w.entries).flatMap((entry, j) => {
    if (!isObj(entry) || entry.id == null || entry.id === '') return [];
    const exerciseId = String(entry.id);
    const info = exerciseOf(ctx, exerciseId);
    const rows = list(entry.sets).filter(isObj);
    const link = ctx.linked.get(`${i}:${j}`);
    const mode = link ? link.d.mode : entryMode(entry, info, rows);
    const note = typeof entry.note === 'string' ? entry.note.trim() : '';
    const exposure = {
      exposureId: `${id}:x${j}`, exerciseId, mode,
      routineId: link ? link.d.routineId : idOf(entry.rid, null),
      // Canonical legacy history: visible to every reader, never an engine success or failure.
      ...(link
        ? { occurrenceId: link.d.occurrenceId, trackId: link.d.occurrenceId, prescriptionId: link.prescription.id, excludedFromProgression: false }
        : { kind: 'legacy', trackId: null, prescriptionId: null, excludedFromProgression: true }),
      ...(entry.sg ? { sg: entry.sg } : {}),
      ...(isObj(entry.muscleSnapshot) ? { muscleSnapshot: clone(entry.muscleSnapshot) } : {}),
      performance: {
        sets: rows.map(row => performanceRow(row, ctx.unit, mode)),
        ...(note ? { note, ...(entry.notePin ? { notePin: true } : {}) } : {})
      },
      completedAt
    };
    if (link) {
      ctx.prescriptions[link.prescription.id] = link.prescription;
      exposure.actual = summarizeActual(link.prescription, performedOf(rows, ctx.unit));
      exposure.audit = [];
    }
    return [exposure];
  });
  const { entries, routineId, excludeFromProgression, ...rest } = w;
  return {
    ...clone(rest), id, status: 'completed',
    routineIds: Array.isArray(w.routineIds) ? clone(w.routineIds) : routineId != null ? [routineId] : [],
    exposures, vol: num(w.vol) ?? volumeOf(exposures)
  };
}

// Seeded from the newest linked exposure alone: its gate decides one earned increment; no failure
// streak or deload is read back out of older history.
function seedProgression(state, drafts, workouts) {
  const progression = isObj(state.progression) ? clone(state.progression) : {};
  for (const d of drafts) {
    const last = d.links.at(-1);
    if (!last) continue;
    const x = workouts[last.i].exposures.find(e => e.exposureId === `${last.workoutId}:x${last.j}`);
    progression[d.occurrenceId] = advanceProgression({ state: null, prescription: last.prescription, log: { id: x.exposureId, actual: x.actual }, now: x.completedAt });
  }
  return progression;
}

function oneRepMaxesOf(ctx, workouts, unit) {
  const { state } = ctx;
  const out = isObj(state.oneRepMaxes) ? clone(state.oneRepMaxes) : {};
  const best = new Map();
  for (const w of workouts) for (const x of w.exposures) {
    // An assistance machine has no 1RM: the load is the help you were given (issue #232).
    if (x.mode !== 'reps' || isAssisted(exerciseOf(ctx, x.exerciseId))) continue;
    for (const row of x.performance.sets) {
      if (row.status !== 'completed' || row.role === 'warmup' || row.resistance.kind !== 'external-load') continue;
      const value = estimate1RM(row.resistance.value, repsOf(row));
      if (value != null && value > (best.get(x.exerciseId)?.value ?? 0)) best.set(x.exerciseId, { value, capturedAt: x.completedAt, sourceRecordId: x.exposureId });
    }
  }
  for (const [exerciseId, b] of best) {
    const id = `one-rep-max:migrated:${exerciseId}`;
    if (out[id] || b.value <= (currentOneRm(out, exerciseId)?.value ?? 0)) continue;
    out[id] = { id, exerciseId, value: b.value, unit, source: 'estimated', capturedAt: b.capturedAt, sourceRecordId: b.sourceRecordId };
  }
  return out;
}

/* ---------- the in-progress workout ---------- */
// Its v1 targets become frozen prescriptions (never re-derived from history); rows keep every value
// the athlete already entered, and rows past the prescription stay unprescribed.
function migrateActive(active, ctx) {
  const id = idOf(active.id, 'm1-active');
  const now = iso(whenOf(active));
  const exposures = [];
  const entries = [];
  list(active.entries).forEach((entry, j) => {
    if (!isObj(entry) || entry.id == null || entry.id === '') return;
    const exerciseId = String(entry.id);
    const info = exerciseOf(ctx, exerciseId);
    const rows = list(entry.sets).filter(isObj);
    const work = rows.filter(row => !isWarmupRow(row));
    const target = isObj(entry.target) ? entry.target
      : { mode: entryMode(entry, info, rows), sets: work.length || 1, reps: work[0]?.r, weight: work[0]?.w, sec: work[0]?.sec, min: work[0]?.min };
    const d = linkOf(active, { ...entry, target }, ctx.byRoutine);
    const values = targetValues(target);
    const w = num(values.weight);
    const fit = step => (w > 0 && !onGrid(w, step) ? stepFor([w], null, ctx.unit) : step);
    const rule = d ? d.ruleFor(values, fit(d.step)) : ruleFrom(values, {
      id: `rule:${id}:${j}`, routineId: null, exerciseId, preset: 'manual', unit: ctx.unit,
      mode: modeOf(target, info), step: fit(STEPS[ctx.unit][0]), rest: ctx.rest
    });
    const trackId = d ? d.occurrenceId : `${id}:t${j}`;
    const prescription = generatePrescription({ id: `${id}:p${j}`, now, trackId, rule });
    ctx.prescriptions[prescription.id] = prescription;
    const exposureId = `${id}:x${j}`;
    exposures.push({
      exposureId, exerciseId, exerciseNameSnapshot: info?.n || exerciseId,
      routineId: d ? d.routineId : idOf(entry.rid, null), ...(d ? { occurrenceId: d.occurrenceId } : {}), trackId,
      excludedFromProgression: !d, prescriptionId: prescription.id, ...(entry.sg ? { sg: entry.sg } : {}),
      performance: { sets: [] }
    });
    let k = 0;
    entries.push({
      ...clone(entry), exposureId, ...(d ? {} : { noProg: true }),
      sets: rows.map(row => (isWarmupRow(row) || row.setId || k >= prescription.rows.length ? clone(row) : { ...clone(row), setId: `r${k++}` }))
    });
  });
  const { entries: legacy, ...rest } = active;
  return { ...clone(rest), id, exposures, entries };
}

/* ---------- public ---------- */
/** `catalogue`: Map of built-in exercise id → catalogue entry (LIB_BY_ID). */
export function migrateProfileV1ToV2(state, catalogue) {
  // Without it every built-in exercise would silently migrate as a plain reps/external-load one.
  if (typeof catalogue?.get !== 'function') throw new Error('migration-needs-catalogue');
  if (!migrationStatus(state).required) return { profile: state, activeSession: null };
  const unit = state.unit === 'lb' ? 'lb' : 'kg';
  const workouts = records(state.workouts);
  const workoutId = uniqueIds();
  const ctx = {
    state, catalogue, unit, rest: whole(state.restSec, 0), byRoutine: new Map(), unsupported: [], linked: new Map(),
    prescriptions: isObj(state.prescriptions) ? clone(state.prescriptions) : {},
    workoutIds: workouts.map((w, i) => workoutId(idOf(w.id, `m1-w${i}`)))
  };
  const routines = draftRoutines(state, ctx);
  const drafts = routines.flatMap(r => r.drafts);
  // Which logged entries belong, beyond doubt, to which occurrence — oldest first.
  const oldestFirst = workouts.map((_, i) => i).sort((a, b) => whenOf(workouts[a]) - whenOf(workouts[b]) || a - b);
  for (const i of oldestFirst) list(workouts[i].entries).forEach((entry, j) => {
    const d = isObj(entry) ? linkOf(workouts[i], entry, ctx.byRoutine) : null;
    if (d) d.links.push({ i, j, workoutId: ctx.workoutIds[i], at: iso(whenOf(workouts[i])), values: targetValues(entry.target) });
  });
  for (const d of drafts) finalizeDraft(d, ctx);
  for (const d of drafts) for (const link of d.links) ctx.linked.set(`${link.i}:${link.j}`, { d, prescription: link.prescription });
  const outWorkouts = workouts.map((w, i) => migrateWorkout(w, i, ctx));
  const activeSession = isObj(state.active) ? migrateActive(state.active, ctx) : null;
  const { active, ...rest } = state;
  const profile = {
    ...clone(rest),
    engineSchemaVersion: ENGINE_SCHEMA,
    routines: routines.map(({ routine, id, drafts: ds }) => ({ ...clone(routine), id, ex: ds.map(occurrenceOf) })),
    workouts: outWorkouts,
    prescriptions: ctx.prescriptions,
    oneRepMaxes: oneRepMaxesOf(ctx, outWorkouts, unit),
    progression: seedProgression(state, drafts, outWorkouts),
    migrationAudit: { fromSchema: 1, unsupported: ctx.unsupported }
  };
  return { profile, activeSession };
}

/** Structural check of a canonical profile; every migration output passes it before it is stored. */
export function validateCanonicalProfile(state) {
  if (!isObj(state)) return { ok: false, errors: ['profile must be an object'] };
  const errors = [];
  if (state.engineSchemaVersion !== ENGINE_SCHEMA) errors.push('engineSchemaVersion must be 2');
  if ('active' in state) errors.push('active must not be part of the synced profile');
  for (const k of ['prescriptions', 'oneRepMaxes', 'progression']) if (!isObj(state[k])) errors.push(`${k} must be an object`);
  for (const k of ['routines', 'workouts']) if (!Array.isArray(state[k])) errors.push(`${k} must be a list`);
  const occurrences = new Set();
  records(state.routines).forEach((r, i) => {
    const at = `routines[${i}]`;
    if (typeof r.id !== 'string' || !r.id) errors.push(`${at}.id is required`);
    if (!Array.isArray(r.ex)) return errors.push(`${at}.ex must be a list`);
    r.ex.forEach((o, j) => {
      const oat = `${at}.ex[${j}]`;
      if (!isObj(o) || typeof o.occurrenceId !== 'string' || typeof o.exerciseId !== 'string') return errors.push(`${oat} needs occurrenceId and exerciseId`);
      if (occurrences.has(o.occurrenceId)) errors.push(`${oat}.occurrenceId is duplicated`);
      occurrences.add(o.occurrenceId);
      if ('warmupSets' in o) errors.push(`${oat} still carries warmupSets`);
      if (o.rule !== undefined) { const check = validatePlanRule(o.rule); if (!check.ok) errors.push(`${oat}.rule: ${check.errors[0]}`); }
      if (!validateWarmup(o.warmup)) errors.push(`${oat}.warmup is invalid`);
    });
  });
  const prescriptions = isObj(state.prescriptions) ? state.prescriptions : {};
  const exposures = new Set();
  records(state.workouts).forEach((w, i) => {
    const at = `workouts[${i}]`;
    if (w.id == null) errors.push(`${at}.id is required`);
    if ('entries' in w) errors.push(`${at} still carries legacy entries`);
    if (!Array.isArray(w.exposures)) return errors.push(`${at}.exposures must be a list`);
    w.exposures.forEach((x, j) => {
      const xat = `${at}.exposures[${j}]`;
      if (!isObj(x) || typeof x.exerciseId !== 'string') return errors.push(`${xat}.exerciseId is required`);
      if (x.exposureId != null) {
        if (exposures.has(x.exposureId)) errors.push(`${xat}.exposureId is duplicated`);
        exposures.add(x.exposureId);
      }
      if (x.prescriptionId != null && !isObj(prescriptions[x.prescriptionId])) errors.push(`${xat}.prescriptionId does not resolve`);
      const rows = x.performance?.sets;
      if (!Array.isArray(rows)) return errors.push(`${xat}.performance.sets must be a list`);
      rows.forEach((row, k) => {
        if (!isObj(row) || !['work', 'warmup'].includes(row.role) || !Array.isArray(row.observations) || !isObj(row.resistance)) {
          errors.push(`${xat}.performance.sets[${k}] is not a performance row`);
        }
      });
    });
  });
  return { ok: errors.length === 0, errors };
}
