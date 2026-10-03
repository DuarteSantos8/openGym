/* The one v1 → v2 profile migration.
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
import { validOneRepMax, validateCanonicalProfile } from './profile-validation.js';
import {
  INCREMENTING_GATES, PRESETS, advanceProgression, currentOneRm, defaultPlanRule, estimate1RM,
  generatePrescription, isValidDeloadFactor, migrateOccurrence, normalizeEffort, planFingerprint, presetForPolicy, ruleOfPrescription, summarizeActual, validateIntensifier, validatePlanRule, validateWarmup
} from '../engine/index.js';

export { ENGINE_SCHEMA, isLegacyProfile, migrationStatus } from './profile-version.js';

const MODES = ['reps', 'time', 'cardio'];
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const records = v => (Array.isArray(v) ? v.filter(isObj) : []);
const list = v => (Array.isArray(v) ? v : []);
const num = v => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  // Beyond 1e15 (past the last representable date in ms) nothing is a count, a load or a time: and the products below (reps × load, min × 60) must not overflow.
  return typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e15 ? n : null;
};
// A logged count, load, time or speed is never negative: a negative one is a typo, not a value.
const nn = v => { const n = num(v); return n != null && n >= 0 ? n : null; };
const whole = (v, lo = 1) => { const n = num(v); return n != null && Math.round(n) >= lo ? Math.round(n) : null; };
const fixed = n => ({ min: n, max: n });
const clone = v => JSON.parse(JSON.stringify(v));
// An id is a non-empty string or a finite number: [] / {} / true would stringify into a colliding or empty key.
const idOf = (v, fallback) => (typeof v === 'string' && v !== '' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : fallback);
const iso = ms => new Date(ms).toISOString();
const whenOf = w => num(w?.start) ?? (Date.parse(`${w?.d}T00:00:00Z`) || 0);
const dayOf = w => Number.isFinite(Date.parse(w?.d)) ? Date.parse(w.d) : Math.floor(whenOf(w) / 86400000) * 86400000;

/** `base`, then `base~2`, `base~3`… in call order. */
function uniqueIds() {
  const seen = new Set();
  return base => { let id = base, n = 2; while (seen.has(id)) id = `${base}~${n++}`; seen.add(id); return id; };
}

/* ---------- what the catalogue says about an exercise ----------
   Mirrors frontend/src/lib/exercises.js (isCardio, isBodyweightEq, isAssisted) and
   workout-model.js (isWarmupRow): this module has to run in the API image, which has no frontend/.
   A frozen copy on purpose, with no parity test: it reads v1 data the way the v1 app did, so it
   must not follow later changes to the frontend originals. */
const BODYWEIGHT_EQ = new Set(['body weight', 'band', 'resistance band']);
// Equipment that is a load in its own right (exercises.js isLoadedEq): the rest of the catalogue
// (an ab wheel, a stability ball…) is worked in reps when nothing is loaded on it.
const LOADED_EQ = new Set(['barbell', 'ez barbell', 'olympic barbell', 'trap bar', 'dumbbell', 'kettlebell', 'cable', 'leverage machine', 'smith machine', 'sled machine', 'weighted']);
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
// v1 addStep treats a load within 0.1 of the grid as on it (one-decimal storage: 21.25 → 21.3)
const near = (v, step) => Math.abs(v - Math.round(v / step) * step) <= 0.1 + 1e-9;
// A step must also divide the increment, or load + inc is rounded off the load v1 prescribed.
const divides = (step, inc) => !(inc > 0) || Math.abs(inc / step - Math.round(inc / step)) < 1e-6;
function stepFor(loads, inc, unit) {
  return [...(inc > 0 ? [inc] : []), ...STEPS[unit]].find(step => divides(step, inc) && loads.every(v => near(v, step))) ?? 0.001;
}

// v1 progression.js defaultIncrement/weightIncrement: an exercise's own `inc`, else its body part's
// default — lower-body and back work takes the bigger jump. On a timed hold `inc` is seconds
// (DEFAULT_SEC_INCREMENT); cardio has none.
const HEAVY_BP = new Set(['upper legs', 'lower legs', 'back', 'hips', 'glutes']);
function incrementOf(cfg, info, mode, unit) {
  if (mode === 'cardio') return null;
  if (num(cfg.inc) > 0) return num(cfg.inc);
  if (mode === 'time') return 5;
  return HEAVY_BP.has(info?.bp) ? (unit === 'lb' ? 10 : 5) : (unit === 'lb' ? 5 : 2.5);
}

// v1 progression.js MAX_BW_SETS: where a bodyweight climb stops adding sets.
const MAX_BW_SETS = 6;
const MAX_SETS = 50;

/** v1's double-progression window (rep-range.js normalizeRepRange): `reps` is the top of it and
 *  `repsMin` the bottom. `repsMax` never bounded it — it only capped a bodyweight climb — but a
 *  plan written that way (a range with no `reps`) reads as the range it says. */
function doubleRange(v) {
  const stride = v.side === true ? 2 : 1;
  const align = n => Math.max(stride, Math.ceil(n / stride) * stride);
  const upper = align(whole(v.reps) ?? whole(v.repsMax) ?? 10);
  const lower = align(whole(v.repsMin) ?? Math.max(1, upper - 2));
  return lower >= upper ? { min: lower, max: lower + stride } : { min: lower, max: upper };
}

/** A canonical rule from plain v1 numbers — a routine entry, or that entry with a logged target
 *  over it. `reps`: the exact rep window, for a logged day whose window is not the plan's. */
function ruleFrom(v, { id, routineId, exerciseId, preset, unit, mode, step, rest, inc, reps: window, loadedPreset, unloadedLadder }) {
  const rule = defaultPlanRule(preset, { id, exerciseId, routineId, unit });
  if (preset === 'bodyweight_ladder' && loadedPreset) rule.special = { ...rule.special, loadedPreset };
  if (unloadedLadder) rule.special = { ...rule.special, unloadedLadder: true, repCeiling: whole(v.repsMax) ?? 20 };
  const p = rule.parameters;
  p.sets = fixed(Math.min(MAX_SETS, whole(v.sets) ?? 1));
  if (mode === 'reps') {
    const reps = whole(v.reps);
    if (preset === 'double') p.reps = doubleRange(v);
    else if (reps) p.reps = fixed(reps);
    // A bodyweight climb's ceiling (`repsMax`): reps climb to it, then a set is added, up to six.
    const ceiling = whole(v.repsMax) ?? 20;
    if (preset === 'bodyweight_ladder') {
      p.reps = { min: p.reps.min, max: Math.max(p.reps.min, ceiling) };
      p.sets = { min: p.sets.min, max: Math.max(p.sets.min, MAX_BW_SETS) };
    }
    if (window) p.reps = window;
  } else {
    const seconds = mode === 'cardio' ? (num(v.min) > 0 ? num(v.min) * 60 : 20 * 60) : (num(v.sec) > 0 ? num(v.sec) : 45);
    Object.assign(p, { reps: fixed(1), durationSeconds: fixed(seconds) });
    // The interval's target speed (km/h); a cardio row with none opened at 8 in v1.
    if (mode === 'cardio') p.speed = num(v.speed) > 0 ? num(v.speed) : 8;
  }
  const w = num(v.weight);
  const loaded = INCREMENTING_GATES.includes(PRESETS[preset].gate);
  p.load = w > 0 || loaded ? { mode: 'absolute', value: w > 0 ? w : 0, unit } : { mode: 'empty' };
  p.restSeconds = whole(v.restSec ?? v.rest, 0) ?? rest ?? p.restSeconds;
  // v1's default step (incrementOf) only matters where the rule steps by itself; a step the lifter
  // typed is kept wherever it was.
  if (inc > 0 && (loaded || preset === 'hold_seconds' || num(v.inc) > 0)) {
    rule.increment = preset === 'hold_seconds' ? { type: 'seconds', value: inc } : { type: 'absolute', value: inc, unit };
  }
  // Only linear and double progression ever read `deloadFactor` (v1's Epley deload); Greyskull and
  // a timed hold always backed off by the 10 % default, which is what the rule starts with.
  const factor = num(v.deloadFactor);
  if (rule.deload && (preset === 'linear' || preset === 'double') && isValidDeloadFactor(factor)) rule.deload = { after: rule.deload.after, factor };
  // v1 never had a terminal target: a migrated track keeps progressing, it never "completes".
  Object.assign(rule, { target: { mode: 'none' }, completion: [], rounding: { mode: 'nearest', step } });
  return rule;
}

// v1's own "did the plan change" test (progression.js plannedOf/samePlan, issue #275): only sets,
// reps, repsMin and seconds ever decided it, normalized the way v1 stamped them onto an entry --
// never the weight, and an unset count always reads as v1's own default (sets: 1), not this
// migration's preset default (3).
const PLAN_KEYS = ['sets', 'reps', 'repsMin', 'sec'];
function v1PlannedOf(cfg, mode) {
  const out = { sets: Math.max(1, num(cfg.sets) || 1) };
  if (mode === 'reps' && num(cfg.reps) > 0) out.reps = num(cfg.reps);
  if (mode === 'reps' && num(cfg.repsMin) > 0) out.repsMin = num(cfg.repsMin);
  if (mode === 'time' && num(cfg.sec) > 0) out.sec = num(cfg.sec);
  return out;
}
const samePlanV1 = (a, b) => PLAN_KEYS.every(k => (a[k] ?? null) === (b[k] ?? null));

// What the v2 engine cannot run is kept verbatim in migrationAudit and shown as "needs review"; the
// immutable v1 backup holds everything else. A progression rule the engine does not know is the
// one thing left over here — `deloadFactor` and cardio `speed` now have rule fields of their own.
function noteUnsupported(d, out) {
  const at = { routineId: d.routineId, occurrenceId: d.occurrenceId, exerciseId: d.exerciseId };
  if (d.preset === 'manual' && typeof d.policy === 'string' && d.policy && d.policy !== 'off'
    && (d.cfg.prog || !['linear', 'greyskull', 'double', 'time'].includes(d.policy))) out.push({ ...at, field: 'prog', value: d.policy });
}

// v1 progression.js policyFor: the exercise's own rule, else its routine's, else linear on reps. A
// plan that never touched the Rule row still progressed, so it must not migrate as "manual"; v2
// keeps no routine-level default, so the inherited rule is written into each occurrence here.
const policyOf = (cfg, routine, mode) => cfg.prog || routine.prog || (mode === 'reps' ? 'linear' : 'off');

function draftRoutines(state, ctx) {
  const routineId = uniqueIds();
  return records(state.routines).map((routine, i) => {
    const id = routineId(idOf(routine.id, `m1-r${i}`));
    const key = idOf(routine.id, null);
    const drafts = list(routine.ex).flatMap((cfg, j) => {
      if (!isObj(cfg) || idOf(cfg.id, null) == null) return [];
      const exerciseId = idOf(cfg.id);
      const info = exerciseOf(ctx, exerciseId);
      const mode = modeOf(cfg, info);
      const d = {
        routineId: id, occurrenceId: `${id}:o${j}`, exerciseId, cfg, info, mode,
        // An assistance machine's load is the help given (v1 issue #232); a routine entry can override the catalogue.
        assisted: typeof cfg.assisted === 'boolean' ? cfg.assisted : isAssisted(info),
        policy: policyOf(cfg, routine, mode), preset: presetForPolicy(policyOf(cfg, routine, mode), mode, isBodyweight(cfg, info)),
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
  ...(d.cfg.restSec == null && d.cfg.rest == null ? { restFromProfile: true } : {}),
  ...(d.warmup ? { warmup: d.warmup } : {}),
  ...(d.cfg.sg ? { sg: d.cfg.sg } : {}),
  ...(typeof d.cfg.note === 'string' && d.cfg.note ? { note: d.cfg.note } : {}),
  ...(whole(d.cfg.restSec) ? { restSec: whole(d.cfg.restSec) } : {}),
  ...(whole(d.cfg.warmupRestSec) ? { warmupRestSec: whole(d.cfg.warmupRestSec) } : {}),
  ...(d.cfg.excludeFromProgression === true ? { excludeFromProgression: true } : {}),
  ...(typeof d.cfg.assisted === 'boolean' ? { assisted: d.cfg.assisted } : {}),
  ...(d.cfg.side === true && d.mode === 'reps' ? { side: true } : {}),
  // Only where it overrides the catalogue, the way v1 wrote it.
  ...(d.mode !== 'cardio' && d.cfg.bodyweight != null ? { bodyweight: !!d.cfg.bodyweight } : {}),
  ...(d.intensifier ? { intensifier: d.intensifier } : {}),
  // What the cardio sheet edits (sheets.jsx): the rule holds the same numbers for the engine.
  ...(d.mode === 'cardio' ? { cardio: { sets: d.rule.parameters.sets.min, min: d.rule.parameters.durationSeconds.min / 60, speed: d.rule.parameters.speed } } : {})
});

/* ---------- history ---------- */
const TARGET = ['sets', 'reps', 'repsMin', 'repsMax', 'weight', 'sec', 'min', 'speed'];
const targetValues = t => Object.fromEntries(TARGET.filter(k => t?.[k] != null).map(k => [k, t[k]]));

// v1 never saved an entry with no completed work set: it is converted but excluded, never a miss.
const hasDoneWork = entry => list(entry.sets).some(row => isObj(row) && row.done && !isWarmupRow(row));
// The target values of the newest link that was actually worked.
const lastWorked = d => d.links.findLast(l => !l.skipped)?.values;

const routineIdsOf = w => (Array.isArray(w.routineIds) && w.routineIds.length ? w.routineIds : w.routineId != null ? [w.routineId] : []);

/** The one occurrence a logged entry was prescribed from, or null when that is not certain. */
function linkOf(w, entry, byRoutine) {
  if (!isObj(entry.target) || entry.noProg === true || w.excludeFromProgression === true) return null;
  const routineIds = routineIdsOf(w);
  const rid = idOf(entry.rid ?? (routineIds.length === 1 ? routineIds[0] : null), null);
  if (rid == null) return null;
  const matches = (byRoutine.get(rid) || []).filter(d => d.exerciseId === idOf(entry.id, null));
  if (matches.length !== 1 || matches[0].excluded) return null;
  return modeOf(entry.target, matches[0].info) === matches[0].mode ? matches[0] : null;
}

// Each linked entry gets the frozen prescription its target describes; the occurrence's own rule
// starts where the newest of them left off.
function finalizeDraft(d, ctx) {
  const loads = [d.cfg.weight, ...d.links.map(l => l.values.weight), ...(ctx.liftedLoads.get(d.exerciseId) || [])].map(num).filter(v => v > 0);
  d.inc = incrementOf(d.cfg, d.info, d.mode, ctx.unit);
  // The rounding step is a load step; a timed hold's `inc` is seconds.
  d.step = stepFor(loads, d.mode === 'reps' ? d.inc : null, ctx.unit);
  // v1 climbed reps, not load, where nothing is loaded and the equipment is no load of its own — or
  // the machine only takes load off you, and no help left is where its progression leads.
  d.preset = presetForPolicy(d.policy, d.mode, false);
  if (d.mode === 'reps' && ['linear', 'double', 'greyskull'].includes(d.policy) && !(num(lastWorked(d)?.weight ?? d.cfg.weight) > 0) && (d.assisted || isBodyweight(d.cfg, d.info) || !LOADED_EQ.has(d.info?.eq))) d.preset = 'bodyweight_ladder';
  d.ruleFor = (values, step = d.step, reps) => ruleFrom({ ...d.cfg, ...values }, {
    id: `rule:${d.occurrenceId}`, routineId: d.routineId, exerciseId: d.exerciseId,
    preset: d.mode === 'reps' && ['linear', 'double', 'greyskull'].includes(d.policy) && (d.assisted || isBodyweight(d.cfg, d.info) || !LOADED_EQ.has(d.info?.eq))
      ? num(values.weight ?? d.cfg.weight) > 0 ? presetForPolicy(d.policy, d.mode, false) : 'bodyweight_ladder' : d.preset, unit: ctx.unit, mode: d.mode, step, rest: ctx.rest, inc: d.inc, reps, loadedPreset: d.policy, unloadedLadder: d.mode === 'reps' && ['linear', 'double', 'greyskull'].includes(d.policy) && (d.assisted || isBodyweight(d.cfg, d.info) || !LOADED_EQ.has(d.info?.eq))
  });
  // What a logged double-progression day asked for: the climb's aim (target.reps) up to the plan's
  // top of range, so the "top of the range in every set" gate of advance.js reads it as v1 did.
  const dayWindow = link => {
    const aim = d.preset === 'double' && d.mode === 'reps' ? whole(link.values.reps) : null;
    return aim ? { min: aim, max: Math.max(aim, doubleRange(d.cfg).max) } : undefined;
  };
  d.dayWindow = dayWindow;
  // The fingerprint every unedited log is stamped with is the one the live rule will have — the ladder
  // once the last load is 0 — or the first session after the reach-zero log reads as `plan_changed`.
  const lastValues = lastWorked(d);
  const liveFingerprint = planFingerprint(d.ruleFor(lastValues?.weight != null ? { weight: lastValues.weight } : {}));
  d.links = d.links.filter(link => {
    try {
      // The plan the session was built from (v1 `planned`), never the progressed target: an
      // unstamped log records none, so the engine reads it the way v1.3.9 did. The stamp itself
      // never carried a double-progression ceiling or an unset sets count the way the live
      // routine does, so when v1's own comparison says nothing changed, today's cfg-derived rule
      // stands in for it instead -- only a genuine edit falls back to rebuilding from the stamp.
      const unedited = link.planned && samePlanV1(link.planned, v1PlannedOf(d.cfg, d.mode));
      const fingerprint = !link.planned ? null
        : unedited ? liveFingerprint
        : planFingerprint(d.ruleFor({ repsMin: null, repsMax: null, ...link.planned }));
      link.prescription = generatePrescription({ id: ctx.prescriptionId(`${link.workoutId}:p${link.j}`), now: link.at, trackId: d.occurrenceId, rule: d.ruleFor(link.values, d.step, dayWindow(link)), fingerprint, assisted: typeof link.assisted === 'boolean' ? link.assisted : d.assisted, ...restPauseOf(link.intensifier ?? d.cfg.intensifier) });
      return true;
    } catch { return false; }   // a target the engine cannot express stays readable legacy history
  });
  const last = lastWorked(d);
  d.rule = d.ruleFor({
    ...(last?.weight != null ? { weight: last.weight } : {}),
    // Duration stays the plan identity; the last prescription carries the earned duration.
  });
  const check = validatePlanRule(d.rule);
  if (!check.ok) throw new Error(`invalid-rule ${d.occurrenceId}: ${check.errors[0]}`);
  d.warmup = migrateOccurrence({ warmupSets: d.cfg.warmupSets }).warmup;
  // A factor set on an exercise whose rule cannot back off (no progression, or a ladder) has nothing to act on.
  if (d.cfg.deloadFactor != null && d.cfg.deloadFactor !== false && !d.rule.deload) {
    ctx.unsupported.push({ routineId: d.routineId, occurrenceId: d.occurrenceId, exerciseId: d.exerciseId, field: 'deloadFactor', value: clone(d.cfg.deloadFactor) });
  }
  // The set count is held to the engine's own maximum: say so rather than quietly plan fewer sets.
  if (whole(d.cfg.sets) > MAX_SETS) ctx.unsupported.push({ routineId: d.routineId, occurrenceId: d.occurrenceId, exerciseId: d.exerciseId, field: 'sets', value: clone(d.cfg.sets) });
  d.intensifier = intensifierOf(d.cfg.intensifier, d.rule);
  // One the rule cannot run (a preset that shapes its own rows, a timed or unloaded rule) is audited instead.
  if (d.cfg.intensifier != null && d.cfg.intensifier !== false && !d.intensifier) {
    ctx.unsupported.push({ routineId: d.routineId, occurrenceId: d.occurrenceId, exerciseId: d.exerciseId, field: 'intensifier', value: clone(d.cfg.intensifier) });
  }
}

// The rest-pause target as logged on an entry is raw v1 data: its rep total counts only when it is a whole number.
const restPauseOf = i => ({ restPause: i?.type === 'restpause', restPauseReps: whole(i?.totalReps) });

/** v1's drop-set or rest-pause plan, already the engine's shape: its numbers held to the engine's bounds. */
function intensifierOf(raw, rule) {
  if (!isObj(raw)) return null;
  const whole = (v, lo, hi, fallback) => Math.min(hi, Math.max(lo, Math.round(num(v) ?? fallback)));
  const i = raw.type === 'dropset' ? { type: 'dropset', count: whole(raw.count, 1, 5, 1), pct: num(raw.pct) > 0 && num(raw.pct) < 100 ? num(raw.pct) : 20 }
    : raw.type === 'restpause' ? { type: 'restpause', totalReps: whole(raw.totalReps, 1, 100, 8), restSec: whole(raw.restSec, 5, 120, 15) }
    : null;
  return i && validateIntensifier(i, rule) ? i : null;
}

/** One logged v1 row as a SetPerformance row (lib/session-ui-adapter.js performanceRow, plus the
 *  v1 extras it never had to carry: cardio metrics, drops, rest-pause clusters, sides). */
function performanceRow(row, unit, mode) {
  const observations = [];
  const r = nn(row.r), w = nn(row.w);
  if (r != null && mode !== 'cardio') observations.push({ metric: 'repetitions', unit: 'reps', value: r });
  const duration = mode === 'cardio' ? (nn(row.min) != null ? nn(row.min) * 60 : null) : nn(row.sec);
  if (duration != null) observations.push({ metric: 'duration', unit: 's', value: duration });
  if (mode === 'cardio' && nn(row.speed) != null) observations.push({ metric: 'speed', unit: 'kmh', value: nn(row.speed) });
  const effort = normalizeEffort({ rir: num(row.rir), rpeEntered: num(row.rpe) });
  const out = {
    prescribed: row.setId != null,
    ...(row.setId != null ? { setId: row.setId } : {}),
    role: isWarmupRow(row) ? 'warmup' : 'work',
    status: row.done ? 'completed' : 'skipped',
    observations,
    resistance: w > 0 ? { kind: 'external-load', value: w, unit } : { kind: mode === 'cardio' ? 'none' : 'bodyweight' },
    ...(effort.rir != null ? { rir: effort.rir } : {}),
    ...(effort.rpeEntered != null ? { rpeEntered: effort.rpeEntered } : {}),
    // A drop is extra volume on top of the row; a rest-pause cluster is only how `r` breaks down.
    segments: row.type === 'dropset' ? records(row.drops).map(d => performanceRow({ ...d, done: row.done, phase: row.phase }, unit, mode)) : []
  };
  // A cluster's counts are numbers or nothing: whatever else was typed there is not a count.
  if (row.type === 'restpause' && Array.isArray(row.clusters)) out.clusters = row.clusters.flatMap(c => {
    if (!isObj(c)) return num(c) != null ? [{ r: num(c) }] : [];   // a bare number is the cluster's reps
    const { r, reps, ...rest } = c;
    return [{ ...clone(rest), ...(num(r) != null ? { r: num(r) } : {}), ...(num(reps) != null ? { reps: num(reps) } : {}) }];
  });
  if (isObj(row.sides?.L) && isObj(row.sides?.R)) out.sides = { L: performanceRow(row.sides.L, unit, mode), R: performanceRow(row.sides.R, unit, mode) };
  return out;
}

/** Completed work rows as the engine's per-set actuals (lib/session-ui-adapter.js actualOfRow). */
const performedOf = (rows, unit, assisted = false) => rows.filter(row => !isWarmupRow(row)).flatMap((row, k) => {
  const sides = isObj(row.sides?.L) && isObj(row.sides?.R) ? [row.sides.L, row.sides.R] : null;
  if (!row.done || sides?.some(side => !side.done)) return [];
  const least = key => sides ? sides.every(side => nn(side[key]) != null) ? Math.min(...sides.map(side => nn(side[key]))) : null : nn(row[key]);
  const load = sides ? sides.every(side => nn(side.w) != null) ? (assisted ? Math.max : Math.min)(...sides.map(side => nn(side.w))) : null : nn(row.w);
  return [{
    row: k,
    ...(sides ? { sideReps: sides.map(side => nn(side.r)), sideLoads: sides.map(side => nn(side.w)) } : {}),
    reps: nn(row.sec) != null || nn(row.min) != null ? null : sides ? least('r') == null ? null : sides.reduce((n, side) => n + nn(side.r), 0) : nn(row.r),
    load: load != null && load >= 0 ? { value: load, unit } : null,
    durationSeconds: least('sec') ?? (least('min') != null ? least('min') * 60 : null),
    rir: num(row.rir),
    rpeEntered: num(row.rpe)
  }];
});

const repsOf = row => row.observations.find(o => o.metric === 'repetitions')?.value;
const rowVolume = row => (row.resistance.kind === 'external-load' && repsOf(row) != null ? repsOf(row) * row.resistance.value : 0);
const volumeOf = exposures => exposures.reduce((total, x) => total + x.performance.sets
  .filter(row => row.role !== 'warmup' && row.status !== 'skipped')
  .reduce((n, row) => n + rowVolume(row) + row.segments.reduce((m, s) => m + rowVolume(s), 0), 0), 0);

function executionOf(entry, d) {
  const target = isObj(entry.target) ? entry.target : {};
  const out = {};
  for (const key of ['side', 'bodyweight', 'assisted', 'intensifier', 'warmupRestSec']) {
    const value = target[key] ?? entry[key] ?? d?.cfg[key];
    if (value != null) out[key] = clone(value);
  }
  return out;
}

function migrateWorkout(w, i, ctx) {
  const id = ctx.workoutIds[i];
  const completedAt = iso(num(w.end) ?? whenOf(w));
  const exposures = list(w.entries).flatMap((entry, j) => {
    if (!isObj(entry) || idOf(entry.id, null) == null) return [];
    const exerciseId = idOf(entry.id);
    const info = exerciseOf(ctx, exerciseId);
    // A record from before sets were kept holds only the weight confirmed for it (`topW`): one done
    // work row at that load, with no reps, keeps it as the exercise's best and a point on its chart.
    const logged = list(entry.sets).filter(isObj);
    const rows = logged.length || !(num(entry.topW) > 0) ? logged : [{ w: num(entry.topW), done: true }];
    const link = ctx.linked.get(`${i}:${j}`);
    let workIndex = 0;
    const performanceRows = rows.map(row => {
      if (isWarmupRow(row)) return row;
      const index = workIndex++;
      return link && index < link.prescription.rows.length ? { ...row, setId: `r${index}` } : row;
    });
    const mode = link ? link.d.mode : entryMode(entry, info, rows);
    const note = typeof entry.note === 'string' ? entry.note.trim() : '';
    const exposure = {
      exposureId: `${id}:x${j}`, exerciseId, mode,
      ...executionOf(entry, link?.d),
      routineId: link ? link.d.routineId : idOf(entry.rid, null),
      // Canonical legacy history: visible to every reader, never an engine success or failure.
      ...(link
        ? { occurrenceId: link.d.occurrenceId, trackId: link.d.occurrenceId, prescriptionId: link.prescription.id, excludedFromProgression: !!link.skipped }
        // What v1 prescribed for the entry stays with it, verbatim: no prescription can hold it,
        // and the readers of the v1 entry shape (performance.js legacyEntriesOf) take it from here.
        : {
          kind: 'legacy', trackId: null, prescriptionId: null, excludedFromProgression: true,
          ...(entry.noProg === true || w.excludeFromProgression === true || (ctx.byRoutine.get(idOf(entry.rid ?? w.routineId, '')) || []).some(d => d.exerciseId === exerciseId && d.excluded) ? { progressionExclusion: 'explicit' } : {}),
          ...(isObj(entry.target) ? { legacyTarget: clone(entry.target) } : {}),
          ...(isObj(entry.planned) ? { legacyPlanned: clone(entry.planned) } : {})
        }),
      ...(entry.sg ? { sg: entry.sg } : {}),
      ...(isObj(entry.muscleSnapshot) ? { muscleSnapshot: clone(entry.muscleSnapshot) } : {}),
      performance: {
        sets: performanceRows.flatMap(row => isObj(row.sides?.L) && isObj(row.sides?.R)
          ? ['L', 'R'].map(side => ({ ...performanceRow({ rir: row.rir, rpe: row.rpe, ...row.sides[side], setId: row.setId, phase: row.phase, warmup: row.warmup }, ctx.unit, mode), side }))
          : [performanceRow(row, ctx.unit, mode)]),
        ...(note ? { note, ...(entry.notePin ? { notePin: true } : {}) } : {})
      },
      completedAt
    };
    if (link) {
      ctx.prescriptions[link.prescription.id] = link.prescription;
      exposure.actual = summarizeActual(link.prescription, performedOf(rows, ctx.unit, link.prescription.assisted));
      exposure.audit = [];
    }
    return [exposure];
  });
  const { entries, routineId, excludeFromProgression, ...rest } = w;
  return {
    ...clone(rest), id, status: 'completed',
    routineIds: clone(routineIdsOf(w)),
    exposures, vol: num(w.vol) ?? (Number.isFinite(volumeOf(exposures)) ? volumeOf(exposures) : 0)
  };
}

// A track's state is what its linked sessions leave it, oldest to newest, as each finish advanced
// it: the newest one's gate decides one earned increment, and the run of misses at one load that v1
// recomputed from history on every read (stallCount) is counted here so a deload comes when v1's
// would have. An edit of the plan between two sessions ends the run, as it did in v1.
function seedProgression(state, drafts, workouts) {
  const progression = {};
  for (const d of drafts) {
    let track = null;
    let before = null;
    for (const link of d.links) {
      if (link.skipped) continue;
      const x = workouts[link.i].exposures.find(e => e.exposureId === `${link.workoutId}:x${link.j}`);
      const p = link.prescription;
      if (before?.planFingerprint && p.planFingerprint && before.planFingerprint !== p.planFingerprint) track = null;
      track = advanceProgression({ state: track, prescription: p, log: { id: x.exposureId, actual: x.actual }, now: x.completedAt });
      before = p;
    }
    if (track) progression[d.occurrenceId] = track;
  }
  return progression;
}

function oneRepMaxesOf(ctx, workouts, unit) {
  const { state } = ctx;
  // An existing dictionary is kept record by record; one that is not a 1RM, or points at a log this
  // conversion does not hold, goes to the audit instead of making the profile invalid.
  const out = {};
  for (const [key, r] of Object.entries(isObj(state.oneRepMaxes) ? state.oneRepMaxes : {})) {
    if (validOneRepMax(key, r) && (r.source !== 'estimated' || r.sourceRecordId == null)) out[key] = clone(r);
    else ctx.stray.push({ path: `oneRepMaxes[${key}]`, value: clone(r) });
  }
  const best = new Map();
  for (const w of workouts) for (const x of w.exposures) {
    // An assistance machine has no 1RM: the load is the help you were given (issue #232).
    if (x.mode !== 'reps' || (typeof x.assisted === 'boolean' ? x.assisted : ctx.prescriptions[x.prescriptionId]?.assisted ?? isAssisted(exerciseOf(ctx, x.exerciseId)))) continue;
    for (const row of x.performance.sets) {
      if (row.status !== 'completed' || row.role === 'warmup' || row.resistance.kind !== 'external-load') continue;
      const value = estimate1RM(row.resistance.value, repsOf(row));
      if (Number.isFinite(value) && value > (best.get(x.exerciseId)?.value ?? 0)) best.set(x.exerciseId, { value, capturedAt: x.completedAt, sourceRecordId: x.exposureId });
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
  const retained = [];
  list(active.entries).forEach((entry, j) => {
    if (!isObj(entry) || idOf(entry.id, null) == null) return;
    retained.push(j);
    const exerciseId = idOf(entry.id);
    const info = exerciseOf(ctx, exerciseId);
    const rows = list(entry.sets).filter(isObj);
    const work = rows.filter(row => !isWarmupRow(row));
    const target = isObj(entry.target) ? entry.target
      : { mode: entryMode(entry, info, rows), sets: work.length || 1, reps: work[0]?.r, weight: work[0]?.w, sec: work[0]?.sec, min: work[0]?.min, speed: work[0]?.speed };
    const d = linkOf(active, { ...entry, target }, ctx.byRoutine);
    const values = targetValues(target);
    const w = num(values.weight);
    const fit = step => (w > 0 && !near(w, step) ? stepFor([w], null, ctx.unit) : step);
    const rule = d ? d.ruleFor(values, fit(d.step), d.dayWindow({ values })) : ruleFrom(values, {
      id: `rule:${id}:${j}`, routineId: null, exerciseId, preset: 'manual', unit: ctx.unit,
      mode: modeOf(target, info), step: fit(STEPS[ctx.unit][0]), rest: ctx.rest
    });
    const trackId = d ? d.occurrenceId : `${id}:t${j}`;
    const base = `${id}:active:p${j}`;
    let prescriptionId = base, suffix = 2;
    while (ctx.prescriptions[prescriptionId]) prescriptionId = `${base}~${suffix++}`;
    const prescription = generatePrescription({ id: prescriptionId, now, trackId, rule, assisted: typeof target.assisted === 'boolean' ? target.assisted : d ? d.assisted : isAssisted(info), ...restPauseOf(target.intensifier ?? d?.cfg.intensifier) });
    ctx.prescriptions[prescription.id] = prescription;
    const exposureId = ctx.exposureId(`${id}:active:x${j}`);
    exposures.push({
      exposureId, exerciseId, ...executionOf({ ...entry, target }, d), mode: modeOf(target, info), exerciseNameSnapshot: info?.n || exerciseId,
      ...(target.side === true || d?.cfg.side === true ? { side: true } : {}),
      ...(d?.warmup ? { warmup: clone(d.warmup) } : {}),
      routineId: d ? d.routineId : idOf(entry.rid, null), ...(d ? { occurrenceId: d.occurrenceId } : {}), trackId,
      excludedFromProgression: !d, prescriptionId: prescription.id, ...(entry.sg ? { sg: entry.sg } : {}),
      performance: { sets: [] }
    });
    let k = 0;
    entries.push({
      ...clone(entry), target: { ...clone(target), mode: modeOf(target, info), ...(modeOf(target, info) === 'time' && num(target.sec) == null ? { sec: 45 } : {}) }, exposureId, ...(d ? {} : { noProg: true }),
      sets: rows.map(row => {
        // ponytail: v1 kept no warm-up edit provenance; unfinished configured ramps become
        // automatic, and the next hand edit clears the marker as on a newly generated session.
        if (isWarmupRow(row)) return { ...clone(row), ...(d?.warmup && !row.done && row.autoWarmup == null ? { autoWarmup: true } : {}) };
        const index = k++;
        return row.setId || index >= prescription.rows.length ? clone(row) : { ...clone(row), setId: `r${index}` };
      })
    });
  });
  const { entries: legacy, ...rest } = active;
  const before = retained.filter(index => index < (whole(active.cur, 0) ?? 0)).length;
  return { ...clone(rest), id, cur: Math.min(before, Math.max(0, entries.length - 1)), exposures, entries };
}

/* ---------- public ---------- */
/** `catalogue`: Map of built-in exercise id → catalogue entry (LIB_BY_ID). */
export function migrateProfileV1ToV2(state, catalogue) {
  // Without it every built-in exercise would silently migrate as a plain reps/external-load one.
  if (typeof catalogue?.get !== 'function') throw new Error('migration-needs-catalogue');
  if (!migrationStatus(state).required) return { profile: state, activeSession: null };
  const unit = state.unit === 'lb' ? 'lb' : 'kg';
  const dateFixes = [];
  const badMs = v => num(v) == null || !Number.isFinite(new Date(num(v)).getTime());
  // v1 data we cannot date is repaired from its sibling field and audited, never allowed to block the upgrade.
  const fixDates = (w, path) => {
    const out = { ...w };
    for (const key of ['start', 'end']) if (out[key] != null && badMs(out[key])) { dateFixes.push({ field: 'date', path: `${path}.${key}`, value: clone(out[key]) }); delete out[key]; }
    if (out.d != null && !Number.isFinite(Date.parse(`${out.d}T00:00:00Z`))) { dateFixes.push({ field: 'date', path: `${path}.d`, value: clone(out.d) }); delete out.d; }
    return out;
  };
  state = { ...state, workouts: Array.isArray(state.workouts) ? state.workouts.map((w, i) => (isObj(w) ? fixDates(w, `workouts[${i}]`) : w)) : state.workouts };
  if (isObj(state.active)) state = { ...state, active: fixDates(state.active, 'active') };
  const workouts = records(state.workouts);
  const workoutId = uniqueIds();
  const ctx = {
    state, catalogue, unit, rest: whole(state.restSec, 0), byRoutine: new Map(), unsupported: [], linked: new Map(),
    prescriptions: {}, stray: [],
    workoutIds: workouts.map((w, i) => workoutId(idOf(w.id, `m1-w${i}`)))
  };
  ctx.liftedLoads = new Map();
  for (const w of workouts) for (const entry of list(w.entries)) if (isObj(entry) && idOf(entry.id, null) != null) for (const row of list(entry.sets)) {
    if (isObj(row) && row.done && !isWarmupRow(row) && num(row.w) > 0) ctx.liftedLoads.set(idOf(entry.id), [...(ctx.liftedLoads.get(idOf(entry.id)) || []), num(row.w)]);
  }
  ctx.prescriptionId = uniqueIds();
  Object.keys(ctx.prescriptions).forEach(id => ctx.prescriptionId(id));
  ctx.exposureId = uniqueIds();
  workouts.forEach((w, i) => list(w.entries).forEach((_, j) => ctx.exposureId(`${ctx.workoutIds[i]}:x${j}`)));
  const routines = draftRoutines(state, ctx);
  const drafts = routines.flatMap(r => r.drafts);
  // Which logged entries belong, beyond doubt, to which occurrence — oldest first.
  const oldestFirst = workouts.map((_, i) => i).sort((a, b) => dayOf(workouts[a]) - dayOf(workouts[b]) || whenOf(workouts[a]) - whenOf(workouts[b]) || ctx.workoutIds[a].localeCompare(ctx.workoutIds[b]) || a - b);
  for (const i of oldestFirst) list(workouts[i].entries).forEach((entry, j) => {
    const d = isObj(entry) ? linkOf(workouts[i], entry, ctx.byRoutine) : null;
    if (d) d.links.push({ i, j, workoutId: ctx.workoutIds[i], at: iso(whenOf(workouts[i])), values: targetValues(entry.target), planned: isObj(entry.planned) ? entry.planned : null, intensifier: entry.target?.intensifier ?? entry.intensifier, assisted: entry.target?.assisted ?? entry.assisted, skipped: !hasDoneWork(entry) });
  });
  for (const d of drafts) finalizeDraft(d, ctx);
  for (const d of drafts) for (const link of d.links) ctx.linked.set(`${link.i}:${link.j}`, { d, prescription: link.prescription, skipped: link.skipped });
  const outWorkouts = workouts.map((w, i) => migrateWorkout(w, i, ctx));
  const activeSession = isObj(state.active) ? migrateActive(state.active, ctx) : null;
  // `packed` / `templates` are the wire form's own markers (profile-pack.js): a profile never carries them.
  const { active, packed, templates, ...rest } = state;
  // Unreadable records cannot become exercises, but their original bytes remain recoverable.
  // A v1 document owns no prescriptions or progression (nor the wire form's markers): whatever sits there was not written by v1.
  const oneRepMaxes = oneRepMaxesOf(ctx, outWorkouts, unit);   // fills ctx.stray
  const discarded = [...ctx.stray];
  for (const key of ['prescriptions', 'progression', 'packed', 'templates']) if (state[key] != null && !(isObj(state[key]) && !Object.keys(state[key]).length)) discarded.push({ path: key, value: clone(state[key]) });
  const auditList = (items, path, needsId = false) => {
    if (items != null && !Array.isArray(items)) { discarded.push({ path, value: clone(items) }); return; }
    list(items).forEach((value, i) => {
    const at = `${path}[${i}]`;
    if (!isObj(value) || (needsId && idOf(value.id, null) == null)) discarded.push({ path: at, value: clone(value) });
    else {
      if ('ex' in value) auditList(value.ex, `${at}.ex`, true);
      if ('entries' in value) auditList(value.entries, `${at}.entries`, true);
      if ('sets' in value && /entries\[\d+\]$/.test(at)) auditList(value.sets, `${at}.sets`);
    }
    });
  };
  auditList(state.routines, 'routines');
  auditList(state.workouts, 'workouts');
  if (isObj(active)) auditList(active.entries, 'active.entries', true);
  list(state.coach?.snapshots).forEach((snap, i) => { if (isObj(snap)) auditList(snap.routines, `coach.snapshots[${i}].routines`); });
  const profile = {
    ...clone(rest),
    unit,
    engineSchemaVersion: ENGINE_SCHEMA,
    routines: routines.map(({ routine, id, drafts: ds }) => ({ ...clone(routine), id, ex: ds.map(occurrenceOf) })),
    workouts: oldestFirst.map(i => outWorkouts[i]),
    prescriptions: ctx.prescriptions,
    oneRepMaxes,
    progression: seedProgression(state, drafts, outWorkouts),
    migrationAudit: { fromSchema: 1, unsupported: [...ctx.unsupported, ...dateFixes], ...(discarded.length ? { discarded } : {}) }
  };
  // A pre-upgrade Coach revert must restore canonical occurrences too. No history is replayed:
  // a snapshot is the old plan, not another copy of the athlete's logged sessions.
  if (Array.isArray(profile.coach?.snapshots)) profile.coach.snapshots = profile.coach.snapshots.map(snap => {
    if (!isObj(snap) || !Array.isArray(snap.routines) || (snap.routines.every(r => isObj(r) && Array.isArray(r.ex) && r.ex.every(o => o?.exerciseId && o?.occurrenceId)))) return snap;
    const converted = migrateProfileV1ToV2({ unit, restSec: state.restSec, customEx: state.customEx, routines: snap.routines, workouts: [] }, catalogue).profile;
    return { ...snap, routines: converted.routines, migrationAudit: converted.migrationAudit };
  });
  const activeCheck = validateCanonicalActive(profile, activeSession);
  if (!activeCheck.ok) throw new Error(`invalid-active ${activeCheck.errors[0]}`);
  return { profile, activeSession };
}

/** Validate editable entries together with the frozen prescription dictionary they refer to. */
export function validateCanonicalActive(profile, active) {
  if (active == null) return { ok: true, errors: [] };
  if (!isObj(active) || !Array.isArray(active.entries) || !Array.isArray(active.exposures)) return { ok: false, errors: ['active entries and exposures must be lists'] };
  const ids = new Set(list(profile.workouts).map(w => w.id));
  let validationId = 'active-validation';
  while (ids.has(validationId)) validationId += '~';
  const check = validateCanonicalProfile({ ...profile, workouts: [...list(profile.workouts), { id: validationId, exposures: active.exposures }] });
  const errors = [...check.errors];
  if (!Number.isInteger(active.cur) || active.cur < 0 || active.cur >= Math.max(1, active.entries.length)) errors.push('active.cur is invalid');
  if (active.entries.length !== active.exposures.length) errors.push('active entries and exposures do not match');
  active.entries.forEach((entry, i) => {
    const exposure = active.exposures[i];
    if (!isObj(entry) || !isObj(entry.target) || !Array.isArray(entry.sets) || entry.sets.some(row => !isObj(row))) { errors.push(`active.entries[${i}] is invalid`); return; }
    if (entry.exposureId !== exposure?.exposureId || String(entry.id) !== exposure?.exerciseId || entry.target.mode !== exposure?.mode) errors.push(`active.entries[${i}] does not match its exposure`);
  });
  return { ok: errors.length === 0, errors };
}

export { validateCanonicalProfile } from './profile-validation.js';
