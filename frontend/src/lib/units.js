// Converting a profile between kg and lb. Until now the unit switch only relabelled the numbers
// (60 kg became "60 lb", issue #22); this walks every stored weight once. Rounded to what a gym
// can load: lb to the nearest 0.5, kg to the nearest 0.25 — enough that a value converted there
// and back lands where it started for any plate-loadable number.
import { isSideSet, syncSideAggregate } from './workout-model.js'
import { workoutVolume } from './history.js'

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
const convTarget = (cfg, from, to) => {
  if (!cfg || typeof cfg !== 'object') return cfg
  const out = { ...cfg }
  if (out.weight != null) out.weight = convertWeight(out.weight, from, to)
  // A per-exercise increment is a load too — 2.5 kg is 5 lb, not 2.5 lb.
  if (out.inc > 0 && (out.mode == null || out.mode === 'reps')) out.inc = convertWeight(out.inc, from, to)
  if (Array.isArray(out.warmup)) out.warmup = out.warmup.map(w => (w && w.weight != null ? { ...w, weight: convertWeight(w.weight, from, to) } : w))
  return out
}
const convEntry = (e, from, to) => {
  if (!e || typeof e !== 'object') return e
  return {
    ...e,
    ...(e.topW != null ? { topW: convertWeight(e.topW, from, to) } : {}),
    ...(e.target ? { target: convTarget(e.target, from, to) } : {}),
    ...(Array.isArray(e.sets) ? { sets: e.sets.map(s => convSet(s, from, to)) } : {}),
  }
}

// A canonical performance row's load lives at `resistance.value` (only meaningful for an
// external-load resistance — bodyweight/assistance/none carry no stored weight to convert), not
// in the legacy `w`/`drops` fields convSet handles above. A row's segments (drop chain, or the
// other side of a per-side set) carry their own resistance the same way, so they recurse too.
const convPerfRow = (row, from, to) => {
  if (!row || typeof row !== 'object') return row
  const out = { ...row }
  if (out.resistance?.kind === 'external-load' && out.resistance.value != null) {
    out.resistance = { ...out.resistance, value: convertWeight(out.resistance.value, from, to) }
  }
  if (Array.isArray(out.segments) && out.segments.length) out.segments = out.segments.map(seg => convPerfRow(seg, from, to))
  return out
}
const convExposure = (exposure, from, to) => {
  if (!exposure || typeof exposure !== 'object' || !Array.isArray(exposure.performance?.sets)) return exposure
  return { ...exposure, performance: { ...exposure.performance, sets: exposure.performance.sets.map(row => convPerfRow(row, from, to)) } }
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
const convSession = (s, from, to, profile) => {
  const out = { ...s, entries: (s.entries || []).map(e => convEntry(e, from, to)) }
  if (out.bw != null) out.bw = convertBodyWeight(out.bw, from, to)
  if (Array.isArray(out.exposures)) out.exposures = out.exposures.map(exposure => convExposure(exposure, from, to))
  if (Number.isFinite(out.vol)) out.vol = workoutVolume(profile || out, out)
  return out
}

/** A new state object with every weight expressed in `to`, and `unit` set to it. */
export function convertStateUnit(S, to) {
  const from = S.unit || 'kg'
  if (from === to) return S
  const c = v => convertWeight(v, from, to)
  const bw = v => convertBodyWeight(v, from, to)
  const out = { ...S, unit: to }
  if (Array.isArray(S.bodyweight)) out.bodyweight = S.bodyweight.map(b => ({ ...b, w: bw(b.w) }))
  if (S.targetW != null) out.targetW = bw(S.targetW)
  if (S.exWeights) out.exWeights = Object.fromEntries(Object.entries(S.exWeights).map(([k, v]) => [k, v && typeof v === 'object' ? { ...v, w: c(v.w) } : c(v)]))
  if (S.barWeights) out.barWeights = Object.fromEntries(Object.entries(S.barWeights).map(([k, v]) => [k, c(v)]))
  if (Array.isArray(S.routines)) out.routines = S.routines.map(r => ({ ...r, ex: (r.ex || []).map(cfg => convTarget(cfg, from, to)) }))
  if (Array.isArray(S.workouts)) out.workouts = S.workouts.map(s => convSession(s, from, to, S))
  return out
}

/** The in-progress session converted to the new unit. The profile converter no longer sees it:
 *  the session lives in its own store field since the storage split. */
export function convertActiveUnit(A, from, to) {
  return A ? convSession(A, from, to) : null
}
