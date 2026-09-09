// Converting a profile between kg and lb. Until now the unit switch only relabelled the numbers
// (60 kg became "60 lb", issue #22); this walks every stored weight once. Rounded to what a gym
// can load: lb to the nearest 0.5, kg to the nearest 0.25 — enough that a value converted there
// and back lands where it started for any plate-loadable number.
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

/** A new state object with every weight expressed in `to`, and `unit` set to it. */
export function convertStateUnit(S, to) {
  const from = S.unit || 'kg'
  if (from === to) return S
  const c = v => convertWeight(v, from, to)
  const out = { ...S, unit: to }
  if (Array.isArray(S.bodyweight)) out.bodyweight = S.bodyweight.map(b => ({ ...b, w: c(b.w) }))
  if (S.targetW != null) out.targetW = c(S.targetW)
  if (S.exWeights) out.exWeights = Object.fromEntries(Object.entries(S.exWeights).map(([k, v]) => [k, v && typeof v === 'object' ? { ...v, w: c(v.w) } : c(v)]))
  if (S.barWeights) out.barWeights = Object.fromEntries(Object.entries(S.barWeights).map(([k, v]) => [k, c(v)]))
  if (Array.isArray(S.routines)) out.routines = S.routines.map(r => ({ ...r, ex: (r.ex || []).map(cfg => convTarget(cfg, from, to)) }))
  if (Array.isArray(S.workouts)) out.workouts = S.workouts.map(w => ({ ...w, entries: (w.entries || []).map(e => convEntry(e, from, to)) }))
  if (S.active) out.active = { ...S.active, entries: (S.active.entries || []).map(e => convEntry(e, from, to)) }
  return out
}
