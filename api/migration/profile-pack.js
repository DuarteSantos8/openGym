// Lossless storage/wire form of a canonical (engine v2) profile: the same data in shorter text.
// The in-memory profile never changes shape; this runs at the edges (disk, network, localStorage).
import { ENGINE_SCHEMA } from './profile-version.js';

// Short names in the spirit of v1's `r`, `w`, `rid`: readable in a file or a network trace. Append-only:
// a short name never changes meaning, so every stored document stays readable. Unlisted keys
// (id, min, max, role, mode, rir, rows, …) are already short and keep their name.
export const SHORT = {
  value: 'v', observations: 'obs', resistance: 'res', status: 'st', metric: 'met', unit: 'u', reps: 'r', load: 'w',
  kind: 'k', excludedFromProgression: 'excl', setId: 'sid', derivedFromOutOfPlan: 'oop', sets: 's', prescriptionId: 'pid',
  occurrenceId: 'oid', performance: 'perf', completedAt: 'at', generatedAt: 'gen', restSeconds: 'rest', sourceLogId: 'src',
  exposureId: 'xid', exerciseId: 'eid', parameters: 'par', expression: 'expr', provenance: 'prov', routineId: 'rid',
  resolved: 'rsv', position: 'pos', trackId: 'tid', prefill: 'pre', actual: 'act', audit: 'aud', basis: 'bas'
};
const LONG = Object.fromEntries(Object.entries(SHORT).map(([long, short]) => [short, long]));
// Free-form subtrees (user/catalogue keys): never renamed, in either direction.
const FREE = new Set(['muscleSnapshot', 'legacyTarget', 'legacyPlanned', 'sg', 'warmup', 'intensifier', 'clusters', 'note']);
// The part of a prescription that is the same for every log of a track.
const INVARIANT = ['planRuleId', 'planRuleRevision', 'planFingerprint', 'exerciseId', 'trackId', 'preset', 'assisted', 'perSide', 'restPause', 'bodyweight', 'statusAtGeneration',
  'snapshot1RM', 'ruleSnapshot', 'trainingMax', 'target'];
const OBS_UNIT = { repetitions: 'reps', duration: 's', speed: 'kmh' };

const without = (o, key) => { const { [key]: _, ...rest } = o; return rest; };
const rename = (v, map, strict) => Array.isArray(v) ? v.map(x => rename(x, map, strict))
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => {
    if (strict && k in LONG) throw new Error('pack-collision');   // a real key equal to a short name
    return [map[k] ?? k, FREE.has(k) ? x : rename(x, map, strict)];
  })) : v;

const slimRow = (r, unit) => {
  const o = { ...r };
  if (o.prescribed === (o.setId != null)) delete o.prescribed;
  if (Array.isArray(o.segments)) { if (o.segments.length) o.segments = o.segments.map(s => slimRow(s, unit)); else delete o.segments; }
  if (o.observations) o.observations = o.observations.map(ob => (ob.unit === OBS_UNIT[ob.metric] ? without(ob, 'unit') : ob));
  if (o.resistance?.unit === unit) o.resistance = without(o.resistance, 'unit');
  if (o.sides) o.sides = { L: slimRow(o.sides.L, unit), R: slimRow(o.sides.R, unit) };
  return o;
};
const fatRow = (r, unit) => {
  const o = { ...r };
  if (!('prescribed' in o)) o.prescribed = o.setId != null;
  o.segments = Array.isArray(o.segments) ? o.segments.map(s => fatRow(s, unit)) : [];
  if (o.observations) o.observations = o.observations.map(ob => (ob.unit === undefined && OBS_UNIT[ob.metric] ? { ...ob, unit: OBS_UNIT[ob.metric] } : ob));
  if (o.resistance && o.resistance.kind === 'external-load' && o.resistance.unit === undefined) o.resistance = { ...o.resistance, unit };
  if (o.sides) o.sides = { L: fatRow(o.sides.L, unit), R: fatRow(o.sides.R, unit) };
  return o;
};
const mapRows = (workouts, fn, unit) => workouts.map(w => (Array.isArray(w.exposures)
  ? { ...w, exposures: w.exposures.map(x => (x.performance?.sets ? { ...x, performance: { ...x.performance, sets: x.performance.sets.map(r => fn(r, unit)) } } : x)) } : w));

// Saves happen on every tap, but the store replaces `workouts` / `prescriptions` only when they change:
// pack each by reference once. (ponytail: identity cache, no invalidation needed while they stay immutable.)
const memo = new WeakMap();
const once = (obj, key, make) => {
  const hit = memo.get(obj);
  if (hit?.key === key) return hit.value;
  const value = make();
  memo.set(obj, { key, value });
  return value;
};

function packPrescriptions(all) {
  const templates = {}, index = new Map(), prescriptions = {};
  for (const [id, p] of Object.entries(all)) {
    const block = Object.fromEntries(INVARIANT.filter(k => k in p).map(k => [k, p[k]]));
    const key = JSON.stringify(block);
    if (!index.has(key)) { index.set(key, index.size.toString(36)); templates[index.get(key)] = block; }
    prescriptions[id] = rename({ _t: index.get(key), ...INVARIANT.reduce(without, p) }, SHORT, true);
  }
  return { templates, prescriptions };
}

export function packProfile(profile) {
  if (profile?.engineSchemaVersion !== ENGINE_SCHEMA || profile.packed === 1) return profile;
  const unit = profile.unit === 'lb' ? 'lb' : 'kg';
  const workouts = profile.workouts || [], prescriptions = profile.prescriptions || {};
  try {
    return {
      ...profile, packed: 1,
      ...once(prescriptions, '', () => packPrescriptions(prescriptions)),
      workouts: once(workouts, unit, () => mapRows(workouts, slimRow, unit).map(w => (Array.isArray(w.exposures) ? { ...w, exposures: rename(w.exposures, SHORT, true) } : w)))
    };
  } catch (e) {
    if (e.message === 'pack-collision') return profile;
    throw e;
  }
}

export function unpackProfile(doc) {
  if (doc?.packed !== 1) return doc;
  const { packed, templates, ...rest } = doc;
  const unit = rest.unit === 'lb' ? 'lb' : 'kg';
  const prescriptions = Object.fromEntries(Object.entries(rest.prescriptions || {}).map(([id, p]) => {
    const { _t, ...own } = rename(p, LONG, false);
    return [id, { ...templates?.[_t], ...own }];
  }));
  return { ...rest, prescriptions, workouts: mapRows((rest.workouts || []).map(w => (Array.isArray(w.exposures) ? { ...w, exposures: rename(w.exposures, LONG, false) } : w)), fatRow, unit) };
}
