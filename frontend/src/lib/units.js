// Converting a profile between kg and lb. Until now the unit switch only relabelled the numbers
// (60 kg became "60 lb", issue #22); this walks every stored weight once. Rounded to what a gym
// can load: lb to the nearest 0.5, kg to the nearest 0.25 — enough that a value converted there
// and back lands where it started for any plate-loadable number.
import { isSideSet, syncSideAggregate } from './workout-model.js'
import { workoutVolume } from './history.js'
import { EXIDX } from './exercises.js'
import { defaultBarWeight } from './bar.js'
import { contentHash } from '../../../api/engine/index.js'

const LB_PER_KG = 2.2046226218

export function convertWeight(value, from, to) {
  if (from === to || value == null || value === '' || !Number.isFinite(Number(value))) return value
  const v = Number(value)
  if (to === 'lb') return Math.round(v * LB_PER_KG * 2) / 2
  return Math.round(v / LB_PER_KG * 4) / 4
}

// Body weight is not loaded on a bar: the weigh-in sheet steps and stores it at 0.1, so plate
// rounding would move most weigh-ins on a kg → lb → kg round trip (78.6 → 173.5 → 78.75; QA C15).
// A tenth in either unit is fine enough that kg → lb → kg comes home for every 0.1-kg value.
export function convertBodyWeight(value, from, to) {
  if (from === to || value == null || value === '' || !Number.isFinite(Number(value))) return value
  const v = Number(value)
  return Math.round((to === 'lb' ? v * LB_PER_KG : v / LB_PER_KG) * 10) / 10
}

// Canonical amounts declare their unit at every level, including frozen 1RM snapshots.
function canonicalLoads(value, from, to, convert = true) {
  if (!value || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(v => canonicalLoads(v, from, to, convert))
  const out = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, canonicalLoads(v, from, to, convert)]))
  if (['kg', 'lb'].includes(value.unit) && Number.isFinite(value.value)) {
    const converted = convertWeight(value.value, value.unit, to)
    out.value = convert ? (converted === 0 && value.value > 0 ? value.value * (to === 'lb' ? LB_PER_KG : 1 / LB_PER_KG) : converted) : value.value
    out.unit = to
  } else if (value.kind === 'external-load' && Number.isFinite(value.value)) {
    out.value = convert ? convertWeight(value.value, from, to) : value.value
    out.unit = to
  }
  return out
}

const roundingUnit = (rounding, amount) => rounding?.mode === 'allowed_values'
  ? { ...rounding, allowedValues: [...new Set(rounding.allowedValues.map(amount))] }
  : { ...rounding, ...(rounding?.step != null ? { step: amount(rounding.step) } : {}) }
const completionUnit = (completion, amount) => (completion || []).map(c =>
  ['training_max', 'target_load'].includes(c.metric) && c.target != null ? { ...c, target: amount(c.target) } : c)

/** A canonical plan's absolute loads and increments use their declared weight unit. */
export function convertPlanRuleUnit(rule, from, to, { convert = true } = {}) {
  if (!rule || from === to) return rule
  const amount = value => !convert ? value : convertWeight(value, from, to) || (to === 'lb' ? value * LB_PER_KG : value / LB_PER_KG)
  const out = canonicalLoads(rule, from, to, convert)
  out.rounding = roundingUnit(rule.rounding, amount)
  out.completion = completionUnit(rule.completion, amount)
  return out
}

function convPrescription(p, from, to, convert) {
  const out = canonicalLoads(p, from, to, convert)
  const amount = v => convert ? convertWeight(v, from, to) : v
  out.rounding = roundingUnit(p.rounding, v => amount(v) || (to === 'lb' ? v * LB_PER_KG : v / LB_PER_KG))
  out.completion = completionUnit(p.completion, amount)
  if (out.provenance?.deload && p.parameters?.load?.expression?.mode === 'absolute' && out.provenance.deload.method !== 'seconds') {
    out.provenance.deload.from = amount(p.provenance.deload.from)
    out.provenance.deload.to = amount(p.provenance.deload.to)
  }
  delete out.contentHash
  return { ...out, contentHash: contentHash(out) }
}

const convSet = (set, from, to) => {
  if (!set || typeof set !== 'object') return set
  const out = { ...set }
  if (isSideSet(set)) return syncSideAggregate({ ...set, sides: {
    L: convSet(set.sides.L, from, to), R: convSet(set.sides.R, from, to),
  } })
  if (out.w != null) out.w = convertWeight(out.w, from, to)
  if (Array.isArray(out.drops)) out.drops = out.drops.map(d => ({ ...d, w: convertWeight(d.w, from, to) }))
  return out
}
const convTarget = (cfg, from, to, convert = true) => {
  if (!cfg || typeof cfg !== 'object') return cfg
  const out = { ...cfg }
  if (out.rule) out.rule = convertPlanRuleUnit(out.rule, from, to, { convert })
  if (!convert) return out
  if (out.weight != null) out.weight = convertWeight(out.weight, from, to)
  // A per-exercise increment is a load too — 2.5 kg is 5 lb, not 2.5 lb.
  if (out.inc > 0 && (out.mode == null || out.mode === 'reps')) out.inc = convertWeight(out.inc, from, to)
  if (Array.isArray(out.warmup)) out.warmup = out.warmup.map(w => (w && w.weight != null ? { ...w, weight: convertWeight(w.weight, from, to) } : w))
  return out
}
// A bar is a stamped object, not a number: the 45 lb bar IS the 20 kg bar (44.1 lb), so an
// override that equals the old unit's default for that bar type drops out and the new unit's
// default takes over — 45 lb → 20 kg, not 20.5, which with a kg plate set would leave every row
// "1 kg short". An explicit 0 ("no bar", lib/bar.js) stays 0. A custom bar converts like any
// other weight (a 33 lb women's bar → 15 kg), and drops out too if it lands on the new default.
const convBarWeights = (bw, from, to) => {
  const out = {}
  for (const [id, v] of Object.entries(bw || {})) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) continue
    if (v === 0) { out[id] = 0; continue }
    const eq = EXIDX[id]?.eq
    if (eq && v === defaultBarWeight(eq, from)) continue
    const c = convertWeight(v, from, to)
    if (eq && c === defaultBarWeight(eq, to)) continue
    out[id] = c
  }
  return out
}
const convEntry = (e, from, to) => {
  if (!e || typeof e !== 'object') return e
  return {
    ...e,
    ...(e.topW != null ? { topW: convertWeight(e.topW, from, to) } : {}),
    ...(e.target ? { target: convTarget(e.target, from, to) } : {}),
    // The plan the entry was built from (lib/session-start.js) carries the routine's weight too.
    ...(e.planned ? { planned: convTarget(e.planned, from, to) } : {}),
    ...(Array.isArray(e.sets) ? { sets: e.sets.map(s => convSet(s, from, to)) } : {}),
  }
}

const convExposure = (exposure, from, to, convert = true) => {
  const out = canonicalLoads(exposure, from, to, convert)
  for (const key of ['legacyTarget', 'legacyPlanned', 'planned']) if (out?.[key]) out[key] = convTarget(out[key], from, to, convert)
  if (convert && Array.isArray(out?.audit)) out.audit = out.audit.map(a => a.field === 'load'
    ? { ...a, expected: typeof a.expected === 'number' ? convertWeight(a.expected, from, to) : a.expected && { ...a.expected, ...(a.expected.min != null ? { min: convertWeight(a.expected.min, from, to), max: convertWeight(a.expected.max, from, to) } : {}) }, actual: typeof a.actual === 'number' ? convertWeight(a.actual, from, to) : a.actual } : a)
  return out
}

// A session carries its body weight of the day and a cached total volume; History rows, the
// detail header, the month calendar and the heatmap tooltips read those rather than summing
// sets, so they must move with the sets or show kg totals under an lb label (QA C11). The
// volume is re-added from the converted sets, so it agrees with the set list to the number.
// Shared between a completed workout (convertStateUnit, below) and the in-progress session
// (convertActiveUnit) — same shape, different store field since the storage split.
// `profile` (only ever present for a completed workout under convertStateUnit — the in-progress
// session has no cached `vol` to recompute, see convertActiveUnit below) is passed through to
// workoutVolume. Each row carries its own role, so no profile lookup is needed for warm-ups.
const convSession = (s, from, to, profile, convert = true) => {
  const out = { ...s }
  if (Array.isArray(s.entries)) out.entries = s.entries.map(e => convert ? convEntry(e, from, to) : { ...e, ...(e.target ? { target: convTarget(e.target, from, to, false) } : {}) })
  if (convert && out.bw != null) out.bw = convertBodyWeight(out.bw, from, to)
  if (Array.isArray(out.exposures)) out.exposures = out.exposures.map(exposure => convExposure(exposure, from, to, convert))
  if (Number.isFinite(out.vol)) out.vol = workoutVolume(profile || out, out)
  return out
}

/** A new state object with every weight expressed in `to`, and `unit` set to it. */
export function convertStateUnit(S, to, { convert = true } = {}) {
  const from = S.unit || 'kg'
  if (from === to) return S
  const c = v => convert ? convertWeight(v, from, to) : v
  const bw = v => convert ? convertBodyWeight(v, from, to) : v
  const out = { ...S, unit: to }
  if (Array.isArray(S.bodyweight)) out.bodyweight = S.bodyweight.map(b => ({ ...b, w: bw(b.w) }))
  if (S.targetW != null) out.targetW = bw(S.targetW)
  if (S.exWeights) out.exWeights = Object.fromEntries(Object.entries(S.exWeights).map(([k, v]) => [k, v && typeof v === 'object' ? { ...v, w: c(v.w) } : c(v)]))
  if (convert && S.barWeights) out.barWeights = convBarWeights(S.barWeights, from, to)
  // The plate inventory (S.plates) is carried over as it is, not converted: it is kept per unit
  // (lib/plates.js), because a 45 lb plate does not become a 20.4 kg one. After the switch the
  // rows load from the new unit's own list, or the standard set until you count yours, and
  // switching back finds the old list as you left it. The load kinds (S.loadKind) hold no weight.
  if (Array.isArray(S.routines)) out.routines = S.routines.map(r => ({ ...r, ex: (r.ex || []).map(cfg => convTarget(cfg, from, to, convert)) }))
  if (Array.isArray(S.workouts)) out.workouts = S.workouts.map(s => convSession(s, from, to, out, convert))
  for (const key of ['oneRepMaxes', 'progression']) if (S[key]) out[key] = canonicalLoads(S[key], from, to, convert)
  if (S.progression) for (const state of Object.values(out.progression)) {
    const prescription = S.prescriptions?.[state.lastPrescriptionId]
    if (convert && Number.isFinite(state.stallLoad) && !prescription?.parameters?.durationSeconds) state.stallLoad = c(state.stallLoad)
  }
  if (S.prescriptions) out.prescriptions = Object.fromEntries(Object.entries(S.prescriptions).map(([id, p]) => [id, convPrescription(p, from, to, convert)]))
  if (S.coach?.snapshots) out.coach = { ...S.coach, snapshots: S.coach.snapshots.map(s => convertStateUnit({ ...s, unit: from }, to, { convert })) }
  return out
}

/** The in-progress session converted to the new unit. The profile converter no longer sees it:
 *  the session lives in its own store field since the storage split. */
export function convertActiveUnit(A, from, to, { convert = true } = {}) {
  return A ? convSession(A, from, to, null, convert) : null
}
