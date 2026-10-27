// Converting a profile between kg and lb. Until now the unit switch only relabelled the numbers
// (60 kg became "60 lb", issue #22); this walks every stored weight once. Rounded to what a gym
// can load: lb to the nearest 0.5, kg to the nearest 0.25 — enough that a value converted there
// and back lands where it started for any plate-loadable number.
import { isSideSet, syncSideAggregate } from './workout-model.js'
import { workoutVolume } from './history.js'
import { EXIDX } from './exercises.js'
import { defaultBarWeight, barTypeWeight } from './bar.js'
import { contentHash } from '../../../api/engine/index.js'

const LB_PER_KG = 2.2046226218

export function convertWeight(value, from, to) {
  if (from === to || value == null || value === '' || !Number.isFinite(Number(value))) return value
  const v = Number(value)
  if (to === 'lb') return Math.round(v * LB_PER_KG * 2) / 2
  return Math.round(v / LB_PER_KG * 4) / 4
}

// An exercise with a weight unit of its own (#657, lib/ex-unit.js) is shown and typed in that unit
// while its weights are still stored in the profile's. Those convert exactly, not to a plate grid:
// 45 lb on a kg profile is stored as 20.4117 kg and reads back as 45 lb. Four places in storage,
// three on screen (EXACT_VIEW): a number typed in the other unit then comes back exactly as typed.
export const LB_KG = 0.45359237
export const EXACT_STORE = 4
export const EXACT_VIEW = 3
export function convertExact(value, from, to, places = EXACT_STORE) {
  if (from === to || value == null || value === '' || !Number.isFinite(Number(value))) return value
  const v = Number(value)
  const p = 10 ** places
  return Math.round((to === 'lb' ? v / LB_KG : v * LB_KG) * p) / p
}
// The usual load steps of each unit, pair by pair: a 2.5 kg step is a 5 lb one, not 5.51 lb. A step
// off this list converts exactly. Both columns are distinct, so the pairing works both ways.
const STEP_PAIRS = [[0.5, 1], [1, 2], [1.25, 2.5], [2.5, 5], [5, 10], [10, 20]]
/** An increment in the other unit: its usual counterpart (STEP_PAIRS), else converted exactly. */
export function convertStep(value, from, to, places = EXACT_STORE) {
  if (from === to || !(Number(value) > 0)) return value
  const v = Number(value)
  const pair = STEP_PAIRS.find(p => Math.abs(p[from === 'kg' ? 0 : 1] - v) < 1e-6)
  return pair ? pair[to === 'kg' ? 0 : 1] : convertExact(v, from, to, places)
}
/** The unit an exercise is pinned to (S.exUnit[id] = { unit, _ts }), or null for the profile's. */
export function exUnitPin(S, exId) {
  const v = S?.exUnit?.[exId]
  const u = v && typeof v === 'object' ? v.unit : v
  return u === 'kg' || u === 'lb' ? u : null
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
export function canonicalLoads(value, from, to, convert = true, amount = convertWeight) {
  if (!value || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(v => canonicalLoads(v, from, to, convert, amount))
  const out = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, canonicalLoads(v, from, to, convert, amount)]))
  if (['kg', 'lb'].includes(value.unit) && Number.isFinite(value.value)) {
    const converted = amount(value.value, value.unit, to)
    out.value = convert ? (converted === 0 && value.value > 0 ? value.value * (to === 'lb' ? LB_PER_KG : 1 / LB_PER_KG) : converted) : value.value
    for (const k of ['low', 'high']) if (Number.isFinite(value[k])) out[k] = convert ? amount(value[k], value.unit, to) : value[k]   // a 1RM record's range
    out.unit = to
  } else if (value.kind === 'external-load' && Number.isFinite(value.value)) {
    out.value = convert ? amount(value.value, from, to) : value.value
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
export function convertPlanRuleUnit(rule, from, to, { convert = true, weight = convertWeight, increment = weight } = {}) {
  if (!rule || from === to) return rule
  const amount = value => !convert ? value : weight(value, from, to) || (to === 'lb' ? value * LB_PER_KG : value / LB_PER_KG)
  const out = canonicalLoads(rule, from, to, convert, weight)
  out.rounding = roundingUnit(rule.rounding, rule.rounding?.mode === 'allowed_values' ? amount : value => convert ? increment(value, from, to) || amount(value) : value)
  out.program.phases = out.program.phases.map((phase, i) => ({ ...phase, progression: phase.progression.map((op, j) => op.step?.type === 'absolute' ? { ...op, step: { ...op.step, value: convert ? increment(rule.program.phases[i].progression[j].step.value, from, to) : op.step.value } } : op) }))
  out.program = { ...out.program, completion: completionUnit(rule.program.completion, amount) }
  return out
}

export function convPrescription(p, from, to, convert, weight = convertWeight, increment = weight) {
  const out = canonicalLoads(p, from, to, convert, weight)
  const amount = v => convert ? weight(v, from, to) : v
  if (p.warmupRows) out.warmupRows = out.warmupRows.map((row, i) => row.uiRow ? { ...row, uiRow: convert ? mapSetWeights(p.warmupRows[i].uiRow, v => weight(v, from, to)) : row.uiRow } : row)
  if (p.backoffStep != null) out.backoffStep = amount(p.backoffStep)
  // The frozen rule converts as a rule does: its rounding and completion targets are loads without a unit.
  out.ruleSnapshot = convertPlanRuleUnit(p.ruleSnapshot, from, to, { convert, weight, increment })
  if (out.provenance?.deload && p.parameters?.load?.expression?.mode === 'absolute' && out.provenance.deload.method !== 'seconds') {
    out.provenance.deload.from = amount(p.provenance.deload.from)
    out.provenance.deload.to = amount(p.provenance.deload.to)
  }
  delete out.contentHash
  return { ...out, contentHash: contentHash(out) }
}

// Every weight in a set, a target or an entry, walked through `c`. The kg ↔ lb switch below
// passes the plate-grid rounding; a per-exercise unit (lib/ex-unit.js) passes an exact one, and
// hands `c` the same field of `prev` (the copy the value was made from) so a number that was not
// touched can be kept as it was stored. `cInc` is the converter for an increment, which a
// per-exercise unit snaps to the other unit's usual step rather than converting to the gram.
export const mapSetWeights = (set, c, prev) => {
  if (!set || typeof set !== 'object') return set
  const p = prev && typeof prev === 'object' ? prev : null
  const out = { ...set }
  if (isSideSet(set)) return syncSideAggregate({ ...set, sides: {
    L: mapSetWeights(set.sides.L, c, p?.sides?.L), R: mapSetWeights(set.sides.R, c, p?.sides?.R),
  } })
  if (out.w != null) out.w = c(out.w, p?.w)
  if (Array.isArray(out.drops)) out.drops = out.drops.map((d, i) => ({ ...d, w: c(d.w, p?.drops?.[i]?.w) }))
  return out
}
export const mapTargetWeights = (cfg, c, prev, cInc = c) => {
  if (!cfg || typeof cfg !== 'object') return cfg
  const p = prev && typeof prev === 'object' ? prev : {}
  const out = { ...cfg }
  if (out.weight != null) out.weight = c(out.weight, p.weight)
  // A per-exercise increment is a load too — 2.5 kg is 5 lb, not 2.5 lb.
  if (out.inc > 0 && (out.mode == null || out.mode === 'reps')) out.inc = cInc(out.inc, p.inc)
  // The step a session's back-off sets were built with is that same increment.
  if (out.backoffStep > 0) out.backoffStep = cInc(out.backoffStep, p.backoffStep)
  if (Array.isArray(out.warmup)) out.warmup = out.warmup.map((w, i) => (w && w.weight != null ? { ...w, weight: c(w.weight, p.warmup?.[i]?.weight) } : w))
  // A pyramid's own weight per set; 0 ("no plan for this set") stays 0.
  if (Array.isArray(out.pyramidWeight)) out.pyramidWeight = out.pyramidWeight.map((w, i) => (w > 0 ? c(w, p.pyramidWeight?.[i]) : w))
  return out
}
export const mapEntryWeights = (e, c, prev, cInc = c) => {
  if (!e || typeof e !== 'object') return e
  const p = prev && typeof prev === 'object' ? prev : {}
  return {
    ...e,
    ...(e.topW != null ? { topW: c(e.topW, p.topW) } : {}),
    ...(e.target ? { target: mapTargetWeights(e.target, c, p.target, cInc) } : {}),
    // The plan the entry was built from (lib/session-start.js) carries the routine's weight too.
    ...(e.planned ? { planned: mapTargetWeights(e.planned, c, p.planned, cInc) } : {}),
    ...(Array.isArray(e.sets) ? { sets: e.sets.map((s, i) => mapSetWeights(s, c, p.sets?.[i])) } : {}),
  }
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
const convTarget = (cfg, from, to, convert = true, weight = convertWeight, increment = weight) => {
  if (!cfg || typeof cfg !== 'object') return cfg
  const out = { ...cfg }
  if (out.rule) out.rule = convertPlanRuleUnit(out.rule, from, to, { convert, weight, increment })
  if (!convert) return out
  return mapTargetWeights(out, v => weight(v, from, to), null, v => increment(v, from, to))
}
// A bar is a stamped object, not a number: the 45 lb bar IS the 20 kg bar (44.1 lb), so an
// override that equals the old unit's default for that bar type drops out and the new unit's
// default takes over — 45 lb → 20 kg, not 20.5, which with a kg plate set would leave every row
// "1 kg short". An explicit 0 ("no bar", lib/bar.js) stays 0. A custom bar converts like any
// other weight (a 33 lb women's bar → 15 kg), and drops out too if it lands on the new default.
// Your own bars (S.barDefaults, kept per unit) count as the new unit's default: an override that
// lands on the bar you set for the type there drops out, and a standard bar stays a standard bar
// (20 kg → 45 lb) even when your lb default for the type is something else.
const convBarWeights = (bw, from, to, own, convertOf = () => convertWeight) => {
  const out = {}
  for (const [id, v] of Object.entries(bw || {})) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) continue
    if (v === 0) { out[id] = 0; continue }
    const eq = EXIDX[id]?.eq
    const c = eq && v === defaultBarWeight(eq, from) ? defaultBarWeight(eq, to) : convertOf(id)(v, from, to)
    if (eq && c === barTypeWeight({ unit: to, barDefaults: own }, eq)) continue
    out[id] = c
  }
  return out
}
const convEntry = (e, from, to, weight = convertWeight, increment = weight) => mapEntryWeights(e, v => weight(v, from, to), null, v => increment(v, from, to))

const convExposure = (exposure, from, to, convert = true, weight = convertWeight, increment = weight) => {
  const out = canonicalLoads(exposure, from, to, convert, weight)
  for (const key of ['legacyTarget', 'legacyPlanned', 'planned']) if (out?.[key]) out[key] = convTarget(out[key], from, to, convert, weight, increment)
  if (convert && Array.isArray(out?.audit)) out.audit = out.audit.map(a => a.field === 'load'
    ? { ...a, expected: typeof a.expected === 'number' ? convertWeight(a.expected, from, to) : a.expected && { ...a.expected, ...(a.expected.min != null ? { min: convertWeight(a.expected.min, from, to), max: convertWeight(a.expected.max, from, to) } : {}) }, actual: typeof a.actual === 'number' ? convertWeight(a.actual, from, to) : a.actual } : a)
  return out
}

const convertersFor = (S, id, to) => {
  const pin = exUnitPin(S, id)
  return pin ? [ (v, from, unit) => convertExact(v, from, unit, pin === to ? EXACT_VIEW : EXACT_STORE), convertStep ] : [convertWeight, convertWeight]
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
  if (Array.isArray(s.entries)) out.entries = s.entries.map(e => convert ? convEntry(e, from, to, ...convertersFor(profile, e.id, to)) : { ...e, ...(e.target ? { target: convTarget(e.target, from, to, false) } : {}) })
  if (convert && out.bw != null) out.bw = convertBodyWeight(out.bw, from, to)
  if (Array.isArray(out.exposures)) out.exposures = out.exposures.map(exposure => convExposure(exposure, from, to, convert, ...convertersFor(profile, exposure.exerciseId, to)))
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
  if (Array.isArray(S.bodyweight)) out.bodyweight = S.bodyweight.map(b => ({ ...b, w: bw(b.w), ...(Array.isArray(b.ins) ? { ins: b.ins.map(r => r && r.w != null ? { ...r, w: bw(r.w) } : r) } : {}) }))
  if (S.targetW != null) out.targetW = bw(S.targetW)
  // A weekly-rate corridor in the profile's unit (#759) moves with it, to the hundredth: 0.25 kg a
  // week is 0.55 lb, and a tenth would make it 0.6. One in percent of body weight holds no weight.
  if (convert && S.rateGoal && S.rateGoal.by === 'w') {
    const r = v => Math.round((to === 'lb' ? Number(v) * LB_PER_KG : Number(v) / LB_PER_KG) * 100) / 100
    out.rateGoal = { ...S.rateGoal, lo: r(S.rateGoal.lo || 0), hi: r(S.rateGoal.hi || 0) }
  }
  if (S.exWeights) out.exWeights = Object.fromEntries(Object.entries(S.exWeights).map(([k, v]) => [k, v && typeof v === 'object' ? { ...v, w: convert ? convertersFor(S, k, to)[0](v.w, from, to) : v.w } : convert ? convertersFor(S, k, to)[0](v, from, to) : v]))
  if (convert && S.barWeights) out.barWeights = convBarWeights(S.barWeights, from, to, S.barDefaults, id => convertersFor(S, id, to)[0])
  // The plate inventory (S.plates) is carried over as it is, not converted: it is kept per unit
  // (lib/plates.js), because a 45 lb plate does not become a 20.4 kg one. After the switch the
  // rows load from the new unit's own list, or the standard set until you count yours, and
  // switching back finds the old list as you left it. The dumbbell list (S.dumbbells) and your
  // bars (S.barDefaults) are kept per unit the same way. The load kinds (S.loadKind) and what a
  // dumbbell weight means (S.dbLoad) hold no weight.
  if (Array.isArray(S.routines)) out.routines = S.routines.map(r => ({ ...r, ex: (r.ex || []).map(cfg => convTarget(cfg, from, to, convert, ...convertersFor(S, cfg.exerciseId || cfg.id, to))) }))
  if (Array.isArray(S.workouts)) out.workouts = S.workouts.map(s => convSession(s, from, to, out, convert))
  for (const key of ['oneRepMaxes', 'progression']) if (S[key]) out[key] = Object.fromEntries(Object.entries(S[key]).map(([id, value]) => [id, canonicalLoads(value, from, to, convert, convertersFor(S, value.exerciseId || S.routines?.flatMap(r => r.ex || []).find(o => o.occurrenceId === id)?.exerciseId, to)[0])]))
  if (S.progression) for (const state of Object.values(out.progression)) {
    // A stall run is kept by the weight lifted (v1 stallCount), a timed hold's included.
    if (convert && Number.isFinite(state.stallAt)) state.stallAt = c(state.stallAt)
    if (convert && state.deload && state.deload.method !== 'seconds' && state.values?.load?.mode === 'absolute') state.deload = { ...state.deload, from: c(state.deload.from), to: c(state.deload.to) }
  }
  if (S.prescriptions) out.prescriptions = Object.fromEntries(Object.entries(S.prescriptions).map(([id, p]) => [id, convPrescription(p, from, to, convert, ...convertersFor(S, p.exerciseId, to))]))
  if (S.coach?.snapshots) out.coach = { ...S.coach, snapshots: S.coach.snapshots.map(s => convertStateUnit({ ...s, unit: from }, to, { convert })) }
  return out
}

/** The in-progress session converted to the new unit. The profile converter no longer sees it:
 *  the session lives in its own store field since the storage split. */
export function convertActiveUnit(A, from, to, { convert = true, profile = null } = {}) {
  return A ? convSession(A, from, to, profile, convert) : null
}
