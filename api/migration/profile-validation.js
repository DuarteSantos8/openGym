import { ENGINE_SCHEMA, contractOf } from './profile-version.js';
import { MAX_PHASES, validatePlanRule, validateProgramme, validateWarmup, ruleOfPrescription, contentHash, phaseById } from '../engine/index.js';
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const list = v => Array.isArray(v) ? v : [];

/* ---------- programmes (contract 1, programme-upgrade.js) ----------
   The shapes engine/programme-run.js deriveRun reads without a guard: a synced record that fails
   them would break a run's view for good, so they are refused here. */
const str = v => typeof v === 'string' && v.length > 0;
const when = v => Number.isFinite(v) || (typeof v === 'string' && Number.isFinite(Date.parse(v)));
const whole = (v, lo = 0) => Number.isInteger(v) && v >= lo;
const distinct = ids => new Set(ids).size === ids.length;
// A calendar day: 2026-02-30 matches the shape but rolls over to March 2.
const isDay = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
const isPolicy = p => isObj(p) && ['advance', 'repeat'].includes(p.onFailure) && ['advance', 'repeat'].includes(p.onSkipped);
const isEffort = e => isObj(e) && ['advisory', 'operational'].includes(e.mode) && Number.isFinite(e.rpe) && e.rpe >= 6 && e.rpe <= 10;
const isAmount = v => isObj(v) && Number.isFinite(v.value) && ['kg', 'lb'].includes(v.unit);
const isRef = r => validOneRepMax(r?.id, r);
// `p<period>:a<appointment>`, then `:<occurrence>` for one exercise's slot.
const isSlot = v => typeof v === 'string' && /^p\d+:a\d+(:.+)?$/.test(v);
function isZone(tz) {
  if (!str(tz)) return false;
  try { new Intl.DateTimeFormat('en-CA', { timeZone: tz }); return true; } catch { return false; }
}
// A programme's (or a run's frozen) definition, with the bounds: 16 weeks or blocks, 50 tracks, 32 authored phases a track.
function definitionErrors(def, at) {
  if (!isObj(def) || !str(def.id) || !whole(def.rev, 1)) return [`${at}: invalid programme identity`];
  const out = [], s = def.schedule, weeks = s?.mode === 'weeks';
  if (!(weeks ? Array.isArray(s.appts) && s.appts.every(a => isObj(a) && str(a.rid) && (a.day === undefined || (whole(a.day) && a.day <= 6))) && (s.ordered === undefined || s.ordered === true)
    : s?.mode === 'rotation' && Array.isArray(s.sequence) && s.sequence.every(str))) out.push(`${at}.schedule is invalid`);
  if (!(whole(def.duration?.n, 1) && def.duration.n <= 16 && def.duration.unit === (weeks ? 'weeks' : 'blocks'))) out.push(`${at}.duration must be 1 to 16 ${weeks ? 'weeks' : 'blocks'}`);
  if (!['stop', 'extend'].includes(def.end) || !['inherit', 'ask', 'keep'].includes(def.refs)) out.push(`${at}: invalid end or refs`);
  if (def.needs !== undefined && !(Array.isArray(def.needs) && def.needs.every(n => ['binding', 'repair'].includes(n)))) out.push(`${at}.needs is invalid`);
  if (!Array.isArray(def.tracks) || def.tracks.length > 50) return [...out, `${at}.tracks must hold at most 50 tracks`];
  // Replay finds a track or stage by id and takes the first match: two with one id would shadow each other.
  if (!distinct(def.tracks.map(t => t?.id))) out.push(`${at}.tracks must have distinct ids`);
  def.tracks.forEach((t, i) => {
    const tat = `${at}.tracks[${i}]`;
    if (!isObj(t) || !str(t.id) || !str(t.exerciseId) || !Array.isArray(t.slots) || !t.slots.every(x => isObj(x) && str(x.rid) && str(x.oid))
      || (t.policy !== undefined && !isPolicy(t.policy)) || (t.tm !== undefined && !isAmount(t.tm))) return out.push(`${tat} is invalid`);
    const stages = Array.isArray(t.stages) ? t.stages : [];
    if (!stages.length || stages.length > 16 || !stages.every(st => isObj(st) && str(st.id) && ['work', 'recovery', 'rest'].includes(st.kind)
      && (st.close === undefined || ['completion', 'calendar'].includes(st.close)) && isObj(st.targets) && Object.values(st.targets).every(x => isObj(x) && ['inherit', 'set'].includes(x.own)))) return out.push(`${tat}.stages must hold 1 to 16 stages`);
    if (!distinct(stages.map(st => st.id))) out.push(`${tat}.stages must have distinct ids`);
    if (stages.reduce((n, st) => n + Object.values(st.targets).filter(x => x.own === 'set').length, 0) > MAX_PHASES) out.push(`${tat}: at most ${MAX_PHASES} authored phases`);
  });
  return out;
}
const EVENTS = {
  skip: e => isSlot(e.slot), discard: e => isSlot(e.slot) && typeof e.worked === 'boolean', close: e => whole(e.period, 1),
  bypass: e => whole(e.period, 1) && Array.isArray(e.appts) && e.appts.every(a => whole(a)), resolve: e => isSlot(e.slot) && ['failed', 'skipped'].includes(e.as),
  assign: e => str(e.exposureId) && isSlot(e.slot), pause: () => true, resume: () => true, end: () => true,
  policy: e => str(e.trackId) && isPolicy(e.policy), 'end-policy': e => ['stop', 'extend'].includes(e.end),
  reference: e => str(e.trackId) && isRef(e.ref) && (e.from == null || str(e.from)), amend: e => isObj(e.def),
  conflict: e => str(e.trackId) && str(e.exposureId) && ['recorded', 'recomputed'].includes(e.keep)
};
// exposure.programme = prescription.provenance.programme: where a session went in a run.
const isAssignment = g => isObj(g) && str(g.runId) && whole(g.rev, 1) && str(g.trackId) && isSlot(g.slot) && str(g.stage) && whole(g.attempt, 1)
  && ['work', 'maintenance', 'extra'].includes(g.role) && (g.ref == null || isRef(g.ref)) && (g.effort == null || isEffort(g.effort));

function programmeErrors(state, exposures) {
  const out = [];
  if (state.engineContractRevision !== undefined && !whole(state.engineContractRevision)) out.push('engineContractRevision must be a whole number');
  const map = (key, check) => {
    if (state[key] == null) return;
    if (!isObj(state[key])) return out.push(`${key} must be an object`);
    for (const [k, v] of Object.entries(state[key])) check(v, `${key}[${k}]`, k);
  };
  // Before contract 1 `programmes` is lib/programmes.js's own shape, not checked here.
  if (contractOf(state) >= 1) {
    map('programmes', (p, at, key) => {
      const bad = definitionErrors(p, at);
      if (bad.length) return out.push(...bad);
      if (p.id !== key || typeof p.name !== 'string' || !Number.isFinite(p.at) || !(p.src === undefined || typeof p.src === 'string' || isObj(p.src))) return out.push(`${at}: invalid programme`);
      // One marked for repair is kept readable, not runnable; any other one must compile against today's routines.
      if (!p.needs?.includes('repair')) { const check = validateProgramme(p, { routines: list(state.routines) }); if (!check.ok) out.push(`${at}: ${check.errors[0]}`); }
    });
    const p = state.programme;
    if (p != null && !(isObj(p) && (p.runId === null || str(p.runId)) && (p.saved == null || isObj(p.saved)))) out.push('programme must be { runId, saved }');
  }
  map('programmeRuns', (r, at, key) => {
    if (!isObj(r) || r.id !== key || !str(r.programmeId) || !isDay(r.startedOn) || ![0, 1].includes(r.weekStart) || !isZone(r.tz) || !when(r.at)
      || !['stop', 'extend'].includes(r.end) || !whole(r.cycle, 1) || !(Number.isFinite(r.bump) && r.bump >= 0) || !isObj(r.tracks)
      || (r.firstWeek !== undefined && !(Array.isArray(r.firstWeek) && r.firstWeek.every(i => whole(i)))) || (r.legacy !== undefined && !(isObj(r.legacy) && whole(r.legacy.weekOffset)))) return out.push(`${at}: invalid run`);
    out.push(...definitionErrors(r.def, `${at}.def`));
    for (const [t, v] of Object.entries(r.tracks)) {
      if (!isObj(v) || !isPolicy(v.policy) || !['user', 'legacy'].includes(v.ack) || !['ask', 'keep'].includes(v.refs) || (v.ref !== undefined && !isRef(v.ref))
        || (v.tm !== undefined && !isAmount(v.tm)) || (v.seed !== undefined && !(isObj(v.seed) && Object.values(v.seed).every(isObj)))) out.push(`${at}.tracks[${t}]: invalid run track`);
    }
  });
  map('programmeEvents', (e, at, key) => {
    if (!isObj(e) || e.id !== key || !str(e.runId) || !when(e.at) || !Object.hasOwn(EVENTS, e.type) || !EVENTS[e.type](e)) return out.push(`${at}: invalid event`);
    if (e.type === 'amend') out.push(...definitionErrors(e.def, `${at}.def`));
    // Unstamped (legacy) work may only be assigned to a slot of its own occurrence.
    const x = e.type === 'assign' ? exposures.get(e.exposureId) : null;
    if (x && !x.programme && x.occurrenceId !== e.slot.split(':').slice(2).join(':')) out.push(`${at}: assigns work of another occurrence`);
  });
  map('refReviews', (r, at) => { if (!isObj(r) || !str(r.candidateId) || !['keep', 'later'].includes(r.decision) || !when(r.at)) out.push(`${at}: invalid review`); });
  return out;
}

/** Structural check of a canonical profile; every migration output passes it before it is stored. */
function validateStructure(state) {
  if (!isObj(state)) return { ok: false, errors: ['profile must be an object'] };
  const errors = [];
  if (state.engineSchemaVersion !== ENGINE_SCHEMA) errors.push('engineSchemaVersion must be 2');
  if (state.unit != null && !['kg', 'lb'].includes(state.unit)) errors.push('unit must be kg or lb');
  if ('active' in state) errors.push('active must not be part of the synced profile');
  for (const k of ['prescriptions', 'oneRepMaxes', 'progression']) if (!isObj(state[k])) errors.push(`${k} must be an object`);
  for (const k of ['routines', 'workouts']) if (!Array.isArray(state[k])) errors.push(`${k} must be a list`);
  const occurrences = new Set(), routineIds = new Set();
  list(state.routines).forEach((r, i) => {
    const at = `routines[${i}]`;
    if (!isObj(r)) return errors.push(`${at} must be an object`);
    if (typeof r.id !== 'string' || !r.id) errors.push(`${at}.id is required`);
    if (routineIds.has(r.id)) errors.push(`${at}.id is duplicated`);
    routineIds.add(r.id);
    if (!Array.isArray(r.ex)) return errors.push(`${at}.ex must be a list`);
    r.ex.forEach((o, j) => {
      const oat = `${at}.ex[${j}]`;
      if (!isObj(o) || typeof o.occurrenceId !== 'string' || typeof o.exerciseId !== 'string') return errors.push(`${oat} needs occurrenceId and exerciseId`);
      if (occurrences.has(o.occurrenceId)) errors.push(`${oat}.occurrenceId is duplicated`);
      occurrences.add(o.occurrenceId);
      if ('warmupSets' in o) errors.push(`${oat} still carries warmupSets`);
      // A schema-2 rule without a program was written by a development build of the engine: it is
      // not v1, so it is never migrated again — its v1 backup is the copy to restore.
      if (isObj(o.rule) && !('program' in o.rule) && 'parameters' in o.rule) return errors.push(`${oat}.rule predates configurable programs: restore the v1 backup and migrate again`);
      const check = validatePlanRule(o.rule);
      if (!check.ok) errors.push(`${oat}.rule: ${check.errors[0]}`);
      else {
        if (o.rule.exerciseId !== o.exerciseId) errors.push(`${oat}.rule.exerciseId does not match`);
        if (o.rule.routineId != null && o.rule.routineId !== r.id) errors.push(`${oat}.rule.routineId does not match`);
      }
      if (!validateWarmup(o.warmup)) errors.push(`${oat}.warmup is invalid`);
    });
  });
  const prescriptions = isObj(state.prescriptions) ? state.prescriptions : {};
  for (const [id, p] of Object.entries(prescriptions)) {
    if (!isObj(p) || p.id !== id || typeof p.exerciseId !== 'string' || !Array.isArray(p.rows)) {
      errors.push(`prescriptions[${id}] is not a prescription`);
      continue;
    }
    if (p.provenance?.programme != null && !isAssignment(p.provenance.programme)) errors.push(`prescriptions[${id}].provenance.programme is not a programme assignment`);
    try {
      const check = validatePlanRule(ruleOfPrescription(p));
      if (!check.ok) errors.push(`prescriptions[${id}]: ${check.errors[0]}`);
    } catch { errors.push(`prescriptions[${id}] is not a prescription`); }
  }
  const exposures = new Set(), workoutIds = new Set();
  list(state.workouts).forEach((w, i) => {
    const at = `workouts[${i}]`;
    if (!isObj(w)) return errors.push(`${at} must be an object`);
    if (w.id == null) errors.push(`${at}.id is required`);
    if (workoutIds.has(w.id)) errors.push(`${at}.id is duplicated`);
    workoutIds.add(w.id);
    if ('entries' in w) errors.push(`${at} still carries legacy entries`);
    if (!Array.isArray(w.exposures)) return errors.push(`${at}.exposures must be a list`);
    w.exposures.forEach((x, j) => {
      const xat = `${at}.exposures[${j}]`;
      if (!isObj(x) || typeof x.exerciseId !== 'string') return errors.push(`${xat}.exerciseId is required`);
      if (x.exposureId != null) {
        if (exposures.has(x.exposureId)) errors.push(`${xat}.exposureId is duplicated`);
        exposures.add(x.exposureId);
      }
      if (x.programme != null && !isAssignment(x.programme)) errors.push(`${xat}.programme is not a programme assignment`);
      if (x.prescriptionId != null && !isObj(prescriptions[x.prescriptionId])) errors.push(`${xat}.prescriptionId does not resolve`);
      else if (x.prescriptionId != null && prescriptions[x.prescriptionId].exerciseId !== x.exerciseId) errors.push(`${xat}.prescriptionId belongs to another exercise`);
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

/** The shape of one `oneRepMaxes` record (its source link, if any, is checked against the workouts). */
export function validOneRepMax(key, r) {
  return isObj(r) && r.id === key && typeof r.exerciseId === 'string' && r.exerciseId !== '' && Number.isFinite(r.value) && r.value > 0 && ['kg', 'lb'].includes(r.unit)
    && typeof r.capturedAt === 'string' && Number.isFinite(Date.parse(r.capturedAt)) && ['estimated', 'tested', 'manual', 'entered'].includes(r.source);
}

/** Validate structures consumers dereference; logged finite values need not match the plan. */
export function validateCanonicalProfile(state) {
  let errors;
  try { errors = validateStructure(state).errors; }
  catch { return { ok: false, errors: ['invalid canonical structure'] }; }
  if (!isObj(state)) return { ok: false, errors };
  const bad = (at, message) => errors.push(`${at}: ${message}`);
  const id = v => typeof v === 'string' && v.length > 0;
  const amount = v => isObj(v) && Number.isFinite(v.value) && ['kg', 'lb'].includes(v.unit);
  const range = v => isObj(v) && Number.isFinite(v.min) && Number.isFinite(v.max) && v.min <= v.max;
  const actual = (a, at) => {
    if (!isObj(a) || !Number.isInteger(a.sets) || a.sets < 0) return bad(at, 'invalid actual');
    for (const k of ['reps', 'durationSeconds', 'speed', 'rir', 'rpeEntered', 'amrapReps']) if (a[k] != null && !Number.isFinite(a[k])) bad(`${at}.${k}`, 'must be finite');
    if (a.load != null && !amount(a.load)) bad(`${at}.load`, 'invalid load');
  };
  const row = (r, at) => {
    if (!isObj(r)) return bad(at, 'invalid row');
    if (!['work', 'warmup'].includes(r.role) || !['completed', 'skipped', 'pending'].includes(r.status)) bad(at, 'invalid role/status');
    if (!Array.isArray(r.observations)) bad(`${at}.observations`, 'must be a list');
    else for (const o of r.observations) if (!isObj(o) || !id(o.metric) || !Number.isFinite(o.value)) bad(`${at}.observations`, 'invalid observation');
    const resistance = r.resistance;
    if (!isObj(resistance) || !['external-load', 'bodyweight', 'none', 'assistance'].includes(resistance.kind)
      || (['external-load', 'assistance'].includes(resistance.kind) && !amount(resistance))) bad(`${at}.resistance`, 'invalid resistance');
    for (const k of ['rir', 'rpeEntered']) if (r[k] != null && !Number.isFinite(r[k])) bad(`${at}.${k}`, 'must be finite');
    if (r.segments != null) {
      if (!Array.isArray(r.segments)) bad(`${at}.segments`, 'must be a list');
      else r.segments.forEach((s, i) => row(s, `${at}.segments[${i}]`));
    }
    if (r.clusters != null && (!Array.isArray(r.clusters) || r.clusters.some(c => !isObj(c) || (c.r != null && !Number.isFinite(c.r)) || (c.reps != null && !Number.isFinite(c.reps))))) bad(`${at}.clusters`, 'invalid clusters');
  };
  const prescriptions = isObj(state.prescriptions) ? state.prescriptions : {};
  for (const [key, p] of Object.entries(prescriptions)) {
    const at = `prescriptions[${key}]`;
    if (!isObj(p)) continue;
    if (!id(p.planRuleId) || !id(p.trackId) || !Number.isInteger(p.planRuleRevision) || p.planRuleRevision < 1 || !isObj(p.prefill) || !isObj(p.provenance)) bad(at, 'invalid identity or generation context');
    if (!id(p.generatedAt) || !Number.isFinite(Date.parse(p.generatedAt))) bad(at, 'invalid generation time');
    // The frozen rule, the phase it was generated in and the values it opened at.
    if (!isObj(p.ruleSnapshot) || !phaseById(p.ruleSnapshot.program ?? { phases: [] }, p.phaseId)) bad(`${at}.phaseId`, 'does not name a phase of its frozen rule');
    if (!isObj(p.values) || !Number.isInteger(p.values.sets) || !Number.isFinite(p.values.reps)) bad(`${at}.values`, 'invalid values');
    const parameters = p.parameters;
    if (!isObj(parameters?.load) || !isObj(parameters.load.expression)) bad(`${at}.parameters.load`, 'invalid load expression wrapper');
    for (const [i, r] of list(p.rows).entries()) if (isObj(r) && ((r.groupId != null && !id(r.groupId)) || (r.restSeconds != null && !(Number.isFinite(r.restSeconds) && r.restSeconds >= 0)))) bad(`${at}.rows[${i}]`, 'invalid group or rest');
    for (const key of ['load', 'loadTo']) if (parameters?.[key]?.resolved != null && !amount(parameters[key].resolved)) bad(`${at}.parameters.${key}`, 'invalid resolved load');
    if (p.target?.resolved != null && !amount(p.target.resolved)) bad(`${at}.target`, 'invalid resolved target');
    if (isObj(p.prefill)) {
      if (!Number.isInteger(p.prefill.sets) || p.prefill.sets < 1 || !Number.isFinite(p.prefill.reps)) bad(`${at}.prefill`, 'invalid sets/reps');
      for (const key of ['durationSeconds', 'speed', 'rir']) if (p.prefill[key] != null && !Number.isFinite(p.prefill[key])) bad(`${at}.prefill.${key}`, 'must be finite');
      if (p.prefill.load != null && !amount(p.prefill.load)) bad(`${at}.prefill.load`, 'invalid load');
    }
    if (!Array.isArray(p.rows) || !p.rows.length) bad(`${at}.rows`, 'must contain prescribed work');
    for (const [i, r] of list(p.rows).entries()) if (!isObj(r) || !range(r.reps) || (r.load != null && !amount(r.load)) || (r.loadTo != null && !amount(r.loadTo))) bad(`${at}.rows[${i}]`, 'invalid prescribed row');
    if (p.warmupRows != null && (!Array.isArray(p.warmupRows) || p.warmupRows.some(r => !isObj(r) || !(range(r.reps) || Number.isFinite(r.reps)) || (r.load != null && !amount(r.load))))) bad(`${at}.warmupRows`, 'invalid warmup rows');
    if (p.snapshot1RM != null && !amount(p.snapshot1RM)) bad(`${at}.snapshot1RM`, 'invalid 1RM snapshot');
    if (p.trainingMax != null && !amount(p.trainingMax)) bad(`${at}.trainingMax`, 'invalid training max');
    try { const { contentHash: hash, ...body } = p; if (hash !== contentHash(body)) bad(at, 'content hash does not match'); }
    catch { bad(at, 'invalid frozen content'); }
  }
  const exposures = new Map();
  for (const [i, w] of list(state.workouts).entries()) for (const [j, x] of list(w?.exposures).entries()) {
    const at = `workouts[${i}].exposures[${j}]`;
    if (!isObj(x)) continue;
    if (!id(x.exposureId) || (x.prescriptionId != null && !id(x.trackId)) || (x.trackId != null && !id(x.trackId))) bad(at, 'exposureId and trackId are required');
    if (x.bells != null && x.bells !== 1 && x.bells !== 2) bad(`${at}.bells`, 'must be 1 or 2');
    if (x.dbLoad != null && !['as', 'each', 'total'].includes(x.dbLoad)) bad(`${at}.dbLoad`, 'invalid load meaning');
    exposures.set(x.exposureId, x);
    const p = prescriptions[x.prescriptionId];
    if (p && p.trackId !== x.trackId) bad(at, 'prescription belongs to another track');
    list(x.performance?.sets).forEach((r, k) => row(r, `${at}.performance.sets[${k}]`));
    if (x.actual != null) actual(x.actual, `${at}.actual`);
    if (x.audit != null && (!Array.isArray(x.audit) || x.audit.some(a => !isObj(a) || !id(a.code)))) bad(`${at}.audit`, 'invalid audit');
  }
  for (const [key, r] of Object.entries(isObj(state.oneRepMaxes) ? state.oneRepMaxes : {})) {
    if (!validOneRepMax(key, r)) bad(`oneRepMaxes[${key}]`, 'invalid 1RM record');
    // Imported estimates may have external provenance; only source-linked engine records resolve here.
    else if (r.source === 'estimated' && r.sourceRecordId != null && (!exposures.has(r.sourceRecordId) || exposures.get(r.sourceRecordId).exerciseId !== r.exerciseId)) bad(`oneRepMaxes[${key}]`, 'source exposure does not resolve');
  }
  for (const [key, s] of Object.entries(isObj(state.progression) ? state.progression : {})) {
    const at = `progression[${key}]`;
    if (!isObj(s) || s.trackId !== key || !['active', 'completed'].includes(s.status) || !(s.phaseId === null || id(s.phaseId)) || !Number.isInteger(s.cyclesCompleted) || s.cyclesCompleted < 0
      || !(s.values === null || (isObj(s.values) && isObj(s.values.load)))) { bad(at, 'invalid progression state'); continue; }
    if (s.lastPrescriptionId != null && (!prescriptions[s.lastPrescriptionId] || prescriptions[s.lastPrescriptionId].trackId !== key)) bad(at, 'last prescription does not resolve');
    if (s.lastCompletedLogId != null && (!exposures.has(s.lastCompletedLogId) || exposures.get(s.lastCompletedLogId).trackId !== key)) bad(at, 'last log does not resolve');
    if (s.lastActual != null) actual(s.lastActual, `${at}.lastActual`);
    if (s.terminalTarget != null && !amount(s.terminalTarget)) bad(`${at}.terminalTarget`, 'invalid load');
    if (s.values?.trainingMax != null && !amount(s.values.trainingMax)) bad(`${at}.values.trainingMax`, 'invalid load');
  }
  try { errors.push(...programmeErrors(state, exposures)); } catch { errors.push('invalid programme records'); }
  return { ok: errors.length === 0, errors };
}
