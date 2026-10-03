import { ENGINE_SCHEMA } from './profile-version.js';
import { validatePlanRule, validateWarmup, ruleOfPrescription, contentHash } from '../engine/index.js';
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const list = v => Array.isArray(v) ? v : [];

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
    if (!Number.isInteger(p.position) || p.position < 0 || !id(p.generatedAt) || !Number.isFinite(Date.parse(p.generatedAt))) bad(at, 'invalid generation position/time');
    const parameters = p.parameters;
    if (!isObj(parameters?.load) || !isObj(parameters.load.expression)) bad(`${at}.parameters.load`, 'invalid load expression wrapper');
    else {
      try {
        const rule = ruleOfPrescription(p);
        const check = validatePlanRule({ ...rule, parameters: { ...rule.parameters, load: parameters.load.expression, ...(parameters.loadTo ? { loadTo: parameters.loadTo.expression } : {}) } });
        if (!check.ok) bad(`${at}.parameters`, check.errors[0]);
      } catch { bad(`${at}.parameters`, 'invalid resolved parameters'); }
    }
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
    if (!isObj(s) || s.trackId !== key || !['active', 'completed'].includes(s.status) || !Number.isInteger(s.position) || s.position < 0 || !Number.isInteger(s.cyclesCompleted) || s.cyclesCompleted < 0) { bad(at, 'invalid progression state'); continue; }
    if (s.lastPrescriptionId != null && (!prescriptions[s.lastPrescriptionId] || prescriptions[s.lastPrescriptionId].trackId !== key)) bad(at, 'last prescription does not resolve');
    if (s.lastCompletedLogId != null && (!exposures.has(s.lastCompletedLogId) || exposures.get(s.lastCompletedLogId).trackId !== key)) bad(at, 'last log does not resolve');
    if (s.lastActual != null) actual(s.lastActual, `${at}.lastActual`);
    for (const k of ['trainingMax', 'terminalTarget']) if (s[k] != null && !amount(s[k])) bad(`${at}.${k}`, 'invalid load');
  }
  return { ok: errors.length === 0, errors };
}

