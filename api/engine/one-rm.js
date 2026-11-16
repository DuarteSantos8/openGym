import { chronologicalWorkouts } from './context.js'

// Historical 1RMs are append-only: entering or estimating a new one adds a record, so an embedded
// Snapshot1RM in an older prescription can never be rewritten by a later value.

export function appendOneRm(dict, record) {
  if (dict?.[record.id]) throw new Error(`1RM ${record.id} already exists`)
  return { ...(dict || {}), [record.id]: record }
}

/** The exercise's newest 1RM by capturedAt (ISO strings sort chronologically), or null. */
export function currentOneRm(dict, exerciseId) {
  let best = null
  for (const r of Object.values(dict || {})) {
    if (r.exerciseId === exerciseId && (!best || r.capturedAt > best.capturedAt)) best = r
  }
  return best
}

// Above this many reps an individual formula says more about work capacity than maximal
// strength, and the formulas disagree by double digits. Refusing to guess beats printing
// a fantasy.
export const REP_CAP = 12

// Weighted ensemble can tolerate slightly higher reps because the blend cancels
// individual-formula drift — but it still has a ceiling.
export const WEIGHTED_REP_CAP = 15

// ── Formula Suite ────────────────────────────────────────────────────────────────

export const FORMULAS = {
  epley:    (w, r) => w * (1 + r / 30),
  brzycki:  (w, r) => w * 36 / (37 - r),
  lombardi: (w, r) => w * Math.pow(r, 0.1),
  oconner:  (w, r) => w * (1 + r / 40),
  mayhew:   (w, r) => (w * 100) / (52.2 + 41.9 * Math.exp(-0.055 * r)),
  wathan:   (w, r) => (w * 100) / (48.8 + 53.8 * Math.exp(-0.075 * r)),
  lander:   (w, r) => (w * 100) / (101.3 - 2.67123 * r),
}
export const DEFAULT_FORMULA = 'epley'

// The formula a profile picked in Settings (Discord "toggle which 1RM formula to use"). Anything
// this build does not know reads as the default, so an older or newer device can't break it.
// Names as the formulas' authors are known, so not translated. 'weighted' blends all seven.
export const FORMULA_NAMES = {
  epley: 'Epley', brzycki: 'Brzycki', lombardi: 'Lombardi', oconner: 'O’Conner',
  mayhew: 'Mayhew', wathan: 'Wathan', lander: 'Lander',
}
export const formulaOf = S => {
  const f = S?.oneRmFormula
  return f === 'weighted' || Object.hasOwn(FORMULAS, f) ? f : DEFAULT_FORMULA
}

// ── RIR %1RM map (Mike Tuchscherer / RTS scale) ─────────────────────────────────
// Index 0 = 1 rep to failure, index 14 = 15 reps to failure.
const RIR_PCT = [
  100, 95.5, 92.2, 89.2, 86.3, 83.7, 81.1, 78.6, 76.2, 73.9,
  71.7, 69.5, 67.5, 65.5, 63.6,
]

function rirEstimate(w, effectiveReps) {
  const idx = Math.min(Math.max(Math.round(effectiveReps) - 1, 0), RIR_PCT.length - 1)
  return (w * 100) / RIR_PCT[idx]
}

// ── Weight Matrix ────────────────────────────────────────────────────────────────
// a_i: absolute reliability; v_i(r): variable attenuation as effective reps rise.
// weight_i(r) = a_i * v_i(r)
const WEIGHTS = {
  epley:    { a: 0.95, v: r => r <= 6  ? 1 : Math.max(0.4, 1 - (r - 6) * 0.12) },
  brzycki:  { a: 1.10, v: r => r <= 8  ? 1 : Math.max(0.3, 1 - (r - 8) * 0.18) },
  lombardi: { a: 0.85, v: r => r <= 5  ? 1 : Math.max(0.4, 1 - (r - 5) * 0.10) },
  oconner:  { a: 0.90, v: r => r <= 6  ? 1 : Math.max(0.4, 1 - (r - 6) * 0.12) },
  mayhew:   { a: 0.95, v: r => r <= 8  ? 1 : Math.max(0.5, 1 - (r - 8) * 0.10) },
  wathan:   { a: 0.90, v: r => r <= 7  ? 1 : Math.max(0.4, 1 - (r - 7) * 0.12) },
  lander:   { a: 0.85, v: r => r <= 7  ? 1 : Math.max(0.35, 1 - (r - 7) * 0.15) },
  rir:      { a: 1.00, v: r => r <= 10 ? 1 : Math.max(0.4, 1 - (r - 10) * 0.15) },
}

// Coefficient of variation across the seven formula estimates (scale-invariant).
export function ensembleCV(w, effectiveReps) {
  const vals = Object.keys(FORMULAS).map(f => FORMULAS[f](w, effectiveReps))
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length
  const variance = vals.reduce((a, e) => a + (e - mean) ** 2, 0) / vals.length
  return Math.sqrt(variance) / mean
}

// Weighted average of all formula estimates and the RIR %1RM map. Exported unrounded so
// internal consumers (e.g. the fatigue model's intensity anchor) keep the precise blend;
// the public estimate1RM() applies display rounding.
export function weightedEstimate(w, effectiveReps) {
  let total = 0
  let wsum = 0
  for (const [name, fn] of Object.entries(FORMULAS)) {
    const wt = WEIGHTS[name].a * WEIGHTS[name].v(effectiveReps)
    total += fn(w, effectiveReps) * wt
    wsum += wt
  }
  const rirWt = WEIGHTS.rir.a * WEIGHTS.rir.v(effectiveReps)
  total += rirEstimate(w, effectiveReps) * rirWt
  wsum += rirWt
  return total / wsum
}

// ── Public API ───────────────────────────────────────────────────────────────────

// Estimate a 1RM from one set. Returns null for anything it cannot honestly answer:
// missing/zero/negative load, no reps, non-finite input, or more reps than the cap.
// A single rep to failure is not an estimate — it is the measurement — and comes back
// unchanged.
export function estimate1RM(w, r, formula = DEFAULT_FORMULA, rir = null) {
  const weight = Number(w)
  const reps = Number(r)
  if (!isFinite(weight) || !isFinite(reps)) return null
  if (weight <= 0 || reps < 1) return null

  const validRir = rir != null && Number(rir) >= 0

  // r === 1, no RIR or RIR 0 → measurement, not estimate
  if (reps === 1 && (!validRir || Number(rir) === 0)) {
    return Math.round(weight * 10) / 10
  }

  if (formula === 'weighted') {
    const effectiveReps = validRir ? reps + Number(rir) : reps
    if (effectiveReps > WEIGHTED_REP_CAP) return null
    const est = weightedEstimate(weight, effectiveReps)
    if (!isFinite(est) || est <= 0) return null
    return Math.round(est * 10) / 10
  }

  if (reps > REP_CAP) return null
  const fn = FORMULAS[formula] || FORMULAS[DEFAULT_FORMULA]
  const est = reps === 1 ? weight : fn(weight, Math.round(reps))
  if (!isFinite(est) || est <= 0) return null
  return Math.round(est * 10) / 10
}

/** Rebuild source-linked estimates after history edits/merges; typed records and frozen snapshots stay intact. */
export function reconcileDerivedOneRms(profile) {
  const kept = Object.fromEntries(Object.entries(profile.oneRepMaxes || {}).filter(([, r]) => !(r.source === 'estimated' && r.sourceRecordId)))
  const ordered = chronologicalWorkouts(profile.workouts)
  const meanings = new Map()
  for (const w of ordered) for (const x of w.exposures || []) if (x.dbLoad) meanings.set(x.exerciseId, x.dbLoad)
  const best = new Map()
  for (const w of ordered) for (const x of w.exposures || []) {
    const p = profile.prescriptions?.[x.prescriptionId]
    if (p?.assisted ?? x.assisted) continue
    for (const row of x.performance?.sets || []) {
      if (row.status !== 'completed' || row.role === 'warmup') continue
      const reps = row.observations?.find(o => o.metric === 'repetitions')?.value
      const load = row.resistance
      const estimate = load?.kind === 'external-load' ? estimate1RM(load.value, reps) : null
      const own = profile.dbLoad?.[x.exerciseId]
      const meaning = (typeof own === 'string' ? own : own?.mode) || meanings.get(x.exerciseId) || 'as'
      const bells = x.bells ?? (x.side ? 1 : 2)
      const factor = x.dbLoad && x.dbLoad !== 'as' && meaning !== 'as' && x.dbLoad !== meaning ? x.dbLoad === 'each' ? bells : 1 / bells : 1
      const comparable = estimate == null ? null : estimate * factor
      if (comparable == null || comparable <= (best.get(x.exerciseId)?.comparable ?? 0)) continue
      best.set(x.exerciseId, { comparable, id: `one-rep-max:derived:${x.exposureId}`, exerciseId: x.exerciseId, value: estimate, unit: load.unit, ...(x.dbLoad ? { dbLoad: x.dbLoad } : {}), source: 'estimated', capturedAt: x.completedAt ?? new Date(w.end ?? w.start).toISOString(), sourceRecordId: x.exposureId })
    }
  }
  for (const { comparable, ...r } of best.values()) kept[r.id] = r
  profile.oneRepMaxes = kept
  return kept
}
