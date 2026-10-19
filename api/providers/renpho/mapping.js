/* A RENPHO reading → openGym readings (api/health/fold.js mergeReadings). The one place that knows
 * RENPHO's field names and units; the rest of openGym sees `{ type, v, t, d, src, sid, g }` like
 * any other source's.
 *
 * Units, from the community clients (client.js) and checked against each other where they
 * disagree: `weight` (and `fatFreeWeight`) are in the reading's own `weightUnit` (1 kg, 2 lb,
 * 3 and 4 stone); `muscle` is a percentage of the weight (the RenphoGarminSync exporter turns it
 * into kg the same way); `bone` is kg; `water`, `bodyfat`, `protein`, `subfat` and `sinew`
 * (skeletal muscle) are percentages; `visfat` a level; `bmr` kcal; `bodyage` years. Fat mass and
 * muscle mass in kg are worked out from the weight, as the RENPHO app shows them.
 *
 * Segmental values (eight-electrode scales) are taken wherever RENPHO puts them: top-level fields
 * in either spelling (bodyfatLeftArm, bodyfat_left_arm…), or inside `extraField`. Their unit is
 * the scale's own; openGym shows them side by side, never converted.
 *
 * Every reading is also kept whole (raw), unknown fields included: see service.js.
 */
import { SEGMENTS, segType } from '../../health/composition.js';

export const PROVIDER = 'renpho';
const LB = 0.45359237, ST = 6.35029318;

// Field names compared without case or underscores.
const norm = k => String(k).toLowerCase().replace(/[_\s-]/g, '');

// Plain fields: normalised name → [type, how the value converts].
const KG = 'kg', PCT = 'pct', AS_IS = 'as-is';
const PLAIN = {
  weight: ['weight', KG],
  bmi: ['bmi', AS_IS],
  bodyfat: ['bodyFat', AS_IS],
  fatfreeweight: ['leanMass', KG],
  water: ['bodyWater', AS_IS],
  bone: ['boneMass', AS_IS],
  protein: ['protein', AS_IS],
  visfat: ['visceralFat', AS_IS],
  subfat: ['subcutaneousFat', AS_IS],
  bmr: ['bmr', AS_IS],
  bodyage: ['metabolicAge', AS_IS],
  sinew: ['skeletalMuscle', AS_IS],
  smi: ['smi', AS_IS],
  whr: ['whr', AS_IS],
  seawhrvalue: ['whr', AS_IS],
  score: ['bodyScore', AS_IS],
  heartrate: ['heartRate', AS_IS],
  cardiacindex: ['cardiacIndex', AS_IS],
  resistance: ['impedance', AS_IS],
  secresistance: ['impedance2', AS_IS],
};
// Segmental fields: every spelling seen for fat, muscle and the two impedances, per segment.
const SEGMENTAL = {};
const PART_NAMES = { leftArm: 'leftarm', rightArm: 'rightarm', trunk: 'trunk', leftLeg: 'leftleg', rightLeg: 'rightleg' };
for (const part of SEGMENTS) {
  const p = PART_NAMES[part];
  for (const n of ['bodyfat', 'fat', 'fatmass']) SEGMENTAL[n + p] = segType('segFat', part);
  for (const n of ['sinew', 'muscle', 'musclemass']) SEGMENTAL[n + p] = segType('segMuscle', part);
  for (const n of ['resistance20', 'impedance20', 'res20']) SEGMENTAL[n + p] = segType('imp20', part);
  for (const n of ['resistance100', 'impedance100', 'res100']) SEGMENTAL[n + p] = segType('imp100', part);
}
// What a reading carries besides values: known, so the rest can be reported as unknown.
const META = new Set(['id', 'timestamp', 'localcreatedat', 'timezone', 'internalmodel', 'scaletype', 'scalename', 'mac',
  'gender', 'height', 'heightunit', 'birthday', 'waistline', 'hip', 'categorytype', 'persontype', 'invalidflag',
  'weightunit', 'bodyshape', 'createdat', 'updatedat', 'actualresistance', 'actualsecresistance', 'method', 'sportflag',
  'extrafield', 'headvalue', 'headunit', 'babypicture', 'devicetype', 'isauto', 'isnew', 'displaymoduletype',
  'subuserid', 'buserid', 'bodytype', 'createdstamp', 'stature', 'remark', 'pregnantflag', 'category', 'muscle',
  'leftweight', 'rightweight', 'accuracyflag', 'originresistances', 'userid', 'scaleuserid']);

const num = v => (v === null || v === undefined || v === '' || typeof v === 'boolean') ? NaN : Number(v);

/** The reading's own id, or one made of what identifies it when RENPHO gave none. */
export function externalIdOf(raw) {
  if (raw.id != null && String(raw.id) !== '') return String(raw.id);
  const ts = raw.timeStamp ?? raw.time_stamp ?? '';
  const dev = raw.mac || raw.internalModel || raw.internal_model || raw.scaleName || '';
  const who = raw.bUserId ?? raw.b_user_id ?? raw.subUserId ?? '';
  return `ts:${ts}:${dev}:${who}`;
}

/** When it was measured, ms. RENPHO counts seconds. */
export function timeOf(raw) {
  const n = num(raw.timeStamp ?? raw.time_stamp);
  if (!Number.isFinite(n) || n <= 0) return NaN;
  return n > 1e12 ? n : n * 1000;
}

// The local day of the reading: the scale's own local time when RENPHO gives it, otherwise the
// day of `t` at the reading's zone offset, otherwise UTC.
function dayOf(raw, t) {
  const local = String(raw.localCreatedAt ?? raw.local_created_at ?? '');
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(local);
  if (m) return m[1];
  const tz = String(raw.timeZone ?? raw.time_zone ?? '');
  const off = /^(?:GMT|UTC)?([+-])(\d{1,2}):?(\d{2})?$/.exec(tz);
  const shift = off ? (off[1] === '-' ? -1 : 1) * ((Number(off[2]) * 60) + Number(off[3] || 0)) * 60000 : 0;
  return new Date(t + shift).toISOString().slice(0, 10);
}

function toKg(v, unit) {
  const u = Number(unit);
  return u === 2 ? v * LB : u === 3 || u === 4 ? v * ST : v;
}

// extraField: a JSON string or an object, maybe nesting one level.
function extraOf(raw) {
  let x = raw.extraField ?? raw.extra_field;
  if (typeof x === 'string') { try { x = JSON.parse(x); } catch { return {}; } }
  if (!x || typeof x !== 'object' || Array.isArray(x)) return {};
  const flat = {};
  for (const [k, v] of Object.entries(x)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) for (const [k2, v2] of Object.entries(v)) flat[k2] = v2;
    else flat[k] = v;
  }
  return flat;
}

const round = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

/**
 * One RENPHO reading as openGym readings, or null when it has no time. `fields` names the values
 * it carried (openGym types), `unknown` the fields neither a value nor known metadata.
 */
export function mapMeasurement(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const t = timeOf(raw);
  if (!Number.isFinite(t)) return null;
  const externalId = externalIdOf(raw);
  const d = dayOf(raw, t);
  const unit = raw.weightUnit ?? raw.weight_unit;
  const values = {};
  const unknown = [];
  const take = (src, fromExtra) => {
    for (const [k, v] of Object.entries(src)) {
      const n = norm(k);
      const seg = SEGMENTAL[n];
      const plain = PLAIN[n];
      if (seg || plain) {
        const x = num(v);
        if (!Number.isFinite(x)) continue;
        if (seg) { if (!(seg in values) || fromExtra === false) values[seg] = x; continue; }
        const [type, how] = plain;
        if (type in values && fromExtra) continue;
        values[type] = how === KG ? toKg(x, unit) : x;
      } else if (!META.has(n) && !fromExtra) unknown.push(k);
      else if (fromExtra && !META.has(n)) unknown.push('extraField.' + k);
    }
  };
  take(raw, false);
  take(extraOf(raw), true);
  // Worked out from the weight, as the RENPHO app shows them.
  const w = values.weight;
  const muscle = num(raw.muscle ?? raw.muscle_rate);
  if (Number.isFinite(w) && Number.isFinite(muscle) && muscle > 0) values.muscleMass = w * muscle / 100;
  if (Number.isFinite(w) && Number.isFinite(values.bodyFat) && values.bodyFat > 0 && !('fatMass' in values)) values.fatMass = w * values.bodyFat / 100;
  // A reading RENPHO marks invalid (a weigh-in with shoes on, deleted in the app) brings no values.
  const invalid = Number(raw.invalidFlag ?? raw.invalid_flag) > 0;
  const readings = invalid ? [] : Object.entries(values).map(([type, v]) => ({
    type, v: round(v), t, d, src: PROVIDER, sid: `${externalId}:${type}`, g: `${PROVIDER}:${externalId}`,
  }));
  return { externalId, t, d, readings, fields: Object.keys(values).sort(), unknown: unknown.sort(), invalid };
}

/** Whether a reading belongs to the signed-in account (and not to a family member on the scale). */
export function belongsTo(raw, accountId) {
  const b = raw.bUserId ?? raw.b_user_id;
  return b == null || String(b) === String(accountId);
}
