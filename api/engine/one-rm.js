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

// Estimated one-rep max (issue #18), moved from frontend/src/lib/onerm.js so the profile migration
// seeds oneRepMaxes with the same numbers in the API image. The reasoning lives in that file.
// Above this many reps an estimate says more about work capacity than about maximal strength,
// and the formulas disagree by double digits. Refusing to guess beats printing a fantasy.
export const REP_CAP = 12

export const FORMULAS = {
  // Epley 1985 — w · (1 + r/30)
  epley: (w, r) => w * (1 + r / 30),
  // Brzycki 1993 — w · 36/(37 − r); undefined at r ≥ 37, but REP_CAP is far below that
  brzycki: (w, r) => w * 36 / (37 - r),
  // Lombardi 1989 — w · r^0.10
  lombardi: (w, r) => w * Math.pow(r, 0.1)
}
export const DEFAULT_FORMULA = 'epley'

// Estimate a 1RM from one set. Returns null for anything it cannot honestly answer:
// missing/zero/negative load, no reps, non-finite input, or more reps than REP_CAP.
// A single rep is not an estimate — it is the measurement — and comes back unchanged.
export function estimate1RM(w, r, formula = DEFAULT_FORMULA) {
  const weight = Number(w)
  const reps = Number(r)
  if (!isFinite(weight) || !isFinite(reps)) return null
  if (weight <= 0 || reps < 1) return null
  if (reps > REP_CAP) return null
  const fn = FORMULAS[formula] || FORMULAS[DEFAULT_FORMULA]
  const est = reps === 1 ? weight : fn(weight, Math.round(reps))
  if (!isFinite(est) || est <= 0) return null
  return Math.round(est * 10) / 10
}
