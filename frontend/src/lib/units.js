// Converting a profile between kg and lb. Until now the unit switch only relabelled the numbers
// (60 kg became "60 lb", issue #22); this walks every stored weight once. Rounded to what a gym
// can load: lb to the nearest 0.5, kg to the nearest 0.25 — enough that a value converted there
// and back lands where it started for any plate-loadable number.
import { isSideSet, syncSideAggregate } from './workout-model.js'
import { EXIDX } from './exercises.js'
import { defaultBarWeight } from './bar.js'

const LB_PER_KG = 2.2046226218

export function convertWeight(value, from, to) {
  if (from === to || value == null || value === '' || !Number.isFinite(Number(value))) return value
  const v = Number(value)
  if (to === 'lb') return Math.round(v * LB_PER_KG * 2) / 2
  return Math.round(v / LB_PER_KG * 4) / 4
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
    ...(Array.isArray(e.sets) ? { sets: e.sets.map(s => convSet(s, from, to)) } : {}),
  }
}

/** A new state object with every weight expressed in `to`, and `unit` set to it. */
export function convertStateUnit(S, to) {
  const from = S.unit || 'kg'
  if (from === to) return S
  const c = v => convertWeight(v, from, to)
  const out = { ...S, unit: to }
  if (Array.isArray(S.bodyweight)) out.bodyweight = S.bodyweight.map(b => ({ ...b, w: c(b.w) }))
  if (S.targetW != null) out.targetW = c(S.targetW)
  if (S.exWeights) out.exWeights = Object.fromEntries(Object.entries(S.exWeights).map(([k, v]) => [k, v && typeof v === 'object' ? { ...v, w: c(v.w) } : c(v)]))
  if (S.barWeights) out.barWeights = convBarWeights(S.barWeights, from, to)
  if (Array.isArray(S.routines)) out.routines = S.routines.map(r => ({ ...r, ex: (r.ex || []).map(cfg => convTarget(cfg, from, to)) }))
  if (Array.isArray(S.workouts)) out.workouts = S.workouts.map(w => ({ ...w, entries: (w.entries || []).map(e => convEntry(e, from, to)) }))
  if (S.active) out.active = { ...S.active, entries: (S.active.entries || []).map(e => convEntry(e, from, to)) }
  return out
}
