// LIFTIQ-FORK: the one object the integration stores on a set (`set.vbt`), and its sanitiser.
// Derived numbers only (about 300 bytes): never a raw sample trace. Pure, no DOM, no vendor import.
export const VBT_VERSION = 1
export const VBT_ALGORITHM = 'pulses-1' // docs/REP_ANALYSIS.md in the LiftIQ repo
export const VBT_MAX_REPS = 50

const finite = x => typeof x === 'number' && Number.isFinite(x)
// A number clamped into [lo, hi] and rounded to `dp` decimals, or null when it is not a number.
function num(x, lo, hi, dp) {
  if (typeof x === 'string' && x.trim() !== '') x = Number(x)
  if (!finite(x)) return null
  const f = 10 ** dp
  return Math.round(Math.min(hi, Math.max(lo, x)) * f) / f
}
const text = (x, max) => (typeof x === 'string' ? x.replace(/[^\x20-\x7e]/g, '').slice(0, max) : '')

/**
 * Whatever comes in (a stored set, an import, a sync from another device), what goes out is
 * either null or a small plain object with clamped types and lengths. Unknown keys are dropped.
 */
export function sanitizeVbt(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  if (raw.src !== 'liftiq') return null
  const pv = (Array.isArray(raw.pv) ? raw.pv : []).slice(0, VBT_MAX_REPS).map(x => num(x, 0, 10, 2)).filter(x => x !== null)
  const withSetup = num(raw.repsWithSetup, 0, VBT_MAX_REPS, 0)
  const noSetup = num(raw.repsNoSetup, 0, VBT_MAX_REPS, 0)
  if (!pv.length && withSetup === null && noSetup === null) return null
  const out = {
    v: VBT_VERSION,
    alg: text(raw.alg, 16) || VBT_ALGORITHM,
    src: 'liftiq',
    repsWithSetup: withSetup ?? 0,
    repsNoSetup: noSetup ?? 0,
    setupIncluded: raw.setupIncluded === true,
    mpv: num(raw.mpv, 0, 10, 2),
    vlPct: num(raw.vlPct, -100, 100, 1),
    pv,
    upCm: num(raw.upCm, 0, 500, 0),
    fw: text(raw.fw, 16),
    pkg: text(raw.pkg, 12),
    at: num(raw.at, 0, 8.64e15, 0),
  }
  // null means "not measured" (a mean of nothing, a loss needs >= 4 reps): leave the key out.
  for (const k of ['mpv', 'vlPct', 'upCm', 'at']) if (out[k] === null) delete out[k]
  if (!out.fw) delete out.fw
  if (!out.pkg) delete out.pkg
  return out
}

/**
 * The stored object from a review: `metrics` and `reps` of the analysis chosen in the review
 * (setup pull in or out), plus the two detected counts.
 */
export function buildVbt({ reps, metrics, repsWithSetup, repsNoSetup, setupIncluded, fw, pkg, capturedAt }) {
  return sanitizeVbt({
    src: 'liftiq', alg: VBT_ALGORITHM,
    repsWithSetup, repsNoSetup, setupIncluded: !!setupIncluded,
    mpv: metrics?.meanPeakVelocity ?? undefined,
    vlPct: metrics?.velocityLossPct ?? undefined,
    upCm: metrics?.meanUpstrokeCm ?? undefined,
    pv: (reps || []).map(r => r.vPeak),
    fw, pkg, at: capturedAt,
  })
}

/** Compact label for a set row ("0.52 m/s, -18%"), or '' when there is nothing to show. */
export function vbtLabel(vbt) {
  const v = sanitizeVbt(vbt)
  if (!v || v.mpv === undefined) return ''
  return v.mpv.toFixed(2) + ' m/s' + (v.vlPct !== undefined ? ', ' + (v.vlPct > 0 ? '-' : '+') + Math.abs(Math.round(v.vlPct)) + '%' : '')
}
