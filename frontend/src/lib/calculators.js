// The Tools page (gm-tools, 1.4.5): the lifting and body calculators people otherwise open another
// app for. Pure and unit-free in, kilograms and centimetres inside; the page converts lb and in at
// its edges. Every formula names where it comes from, and the tests check each against published
// values.
import { estimate1RM, DEFAULT_FORMULA } from './onerm.js'
import { repFactor } from './set-records.js'
import { snapDown } from './warmup-snap.js'

export const LB_PER_KG = 2.2046226218
export const CM_PER_IN = 2.54
const num = v => Number(v)
const ok = v => Number.isFinite(num(v)) && num(v) > 0

// ── % of 1RM ───────────────────────────────────────────────────────────────────

export const PCT_STEPS = [100, 95, 90, 85, 80, 75, 70, 65, 60, 55, 50, 40]

/**
 * Rounded load table: each percentage of `oneRm`, snapped down to something the gym can load
 * (`grid`: plates.js dropGrid, the same rounding warm-ups use), with the reps the profile's
 * formula says that load is good for (the formula turned around; null past 12 reps).
 */
export function percentTable(oneRm, { grid = 2.5, formula = DEFAULT_FORMULA, steps = PCT_STEPS } = {}) {
  if (!ok(oneRm)) return []
  return steps.map(pct => {
    const raw = oneRm * pct / 100
    let reps = null
    for (let r = 1; r <= 12; r++) { const f = repFactor(r, formula); if (f && oneRm / f >= raw - 1e-9) reps = r }
    // Lighter than 12 reps' worth: more than the formulas honestly say (onerm.js REP_CAP).
    if (reps === 12 && oneRm / repFactor(12, formula) > raw * 1.02) reps = null
    return { pct, raw, w: snapDown(raw, grid) || raw, reps: pct === 100 ? 1 : reps }
  })
}

// ── RPE load ───────────────────────────────────────────────────────────────────
// Mike Tuchscherer's RPE chart (Reactive Training Systems), as % of 1RM by reps to failure
// (reps done + reps in reserve): 1 → 100, 2 → 95.5 … The same table onerm.js uses for its RIR
// blend. Half RPEs sit halfway between their neighbours.
const RTS = [100, 95.5, 92.2, 89.2, 86.3, 83.7, 81.1, 78.6, 76.2, 73.9, 71.7, 69.5, 67.5, 65.5, 63.6]

/** % of 1RM for `reps` at `rpe` (6 to 10), or null outside the chart. */
export function rpePercent(reps, rpe) {
  const r = Math.round(num(reps)), e = num(rpe)
  if (!(r >= 1) || !(e >= 6 && e <= 10)) return null
  const toFail = r + (10 - e) - 1          // 0-based index, may be a half
  if (toFail > RTS.length - 1) return null
  const lo = Math.floor(toFail), hi = Math.ceil(toFail)
  return Math.round((RTS[lo] + (RTS[hi] - RTS[lo]) * (toFail - lo)) * 10) / 10
}

/** The load for `reps` at `rpe` from a 1RM, rounded down to the grid. */
export function rpeLoad(oneRm, reps, rpe, grid = 2.5) {
  const pct = rpePercent(reps, rpe)
  if (pct == null || !ok(oneRm)) return null
  const raw = oneRm * pct / 100
  return { pct, raw, w: snapDown(raw, grid) || raw }
}

/** The 1RM a set says, from weight, reps and RPE: the RTS chart read backwards. */
export function e1rmFromRpe(w, reps, rpe) {
  const pct = rpePercent(reps, rpe)
  return pct && ok(w) ? Math.round(num(w) / pct * 1000) / 10 : null
}

// ── Strength scores (bodyweight in kg, total in kg) ────────────────────────────

// DOTS (Tim Konertz, 2019; used by USAPL and many federations since): total × 500 over a
// fourth-degree polynomial of body weight, fitted on 40-210 kg for men and 40-150 kg for women.
const DOTS = {
  male: [-307.75076, 24.0900756, -0.1918759221, 0.0007391293, -0.000001093],
  female: [-57.96288, 13.6175032, -0.1126655495, 0.0005158568, -0.0000010706],
}
const DOTS_BW = { male: [40, 210], female: [40, 150] }
export function dots(total, bw, sex = 'male') {
  if (!ok(total) || !ok(bw)) return null
  const k = sex === 'female' ? 'female' : 'male'
  const x = Math.min(Math.max(num(bw), DOTS_BW[k][0]), DOTS_BW[k][1])
  const d = DOTS[k].reduce((s, c, i) => s + c * x ** i, 0)
  return round2(num(total) * 500 / d)
}

// Wilks (Robert Wilks, 1994 original, the one most meets and calculators still print): total ×
// 500 over a fifth-degree polynomial. Clamped to the ranges the coefficients were published for.
const WILKS = {
  male: [-216.0475144, 16.2606339, -0.002388645, -0.00113732, 7.01863e-6, -1.291e-8],
  female: [594.31747775582, -27.23842536447, 0.82112226871, -0.00930733913, 4.731582e-5, -9.054e-8],
}
const WILKS_BW = { male: [40, 201.9], female: [26.51, 154.53] }
export function wilks(total, bw, sex = 'male') {
  if (!ok(total) || !ok(bw)) return null
  const k = sex === 'female' ? 'female' : 'male'
  const x = Math.min(Math.max(num(bw), WILKS_BW[k][0]), WILKS_BW[k][1])
  const d = WILKS[k].reduce((s, c, i) => s + c * x ** i, 0)
  return round2(num(total) * 500 / d)
}

// IPF GL points (IPF, 2020): total × 100 / (A − B·e^(−C·bw)), classic (raw) three-lift
// coefficients. The IPF also publishes equipped and bench-only sets; raw full power is the common case.
const GL = { male: [1199.72839, 1025.18162, 0.00921], female: [610.32796, 1045.59282, 0.03048] }
export function ipfGl(total, bw, sex = 'male') {
  if (!ok(total) || !ok(bw)) return null
  const [A, B, C] = GL[sex === 'female' ? 'female' : 'male']
  return round2(num(total) * 100 / (A - B * Math.exp(-C * num(bw))))
}

// ── Body ───────────────────────────────────────────────────────────────────────

/** Body mass index (Quetelet): kg / m². */
export function bmi(kg, cm) {
  if (!ok(kg) || !ok(cm)) return null
  return round1(num(kg) / (num(cm) / 100) ** 2)
}
/** The WHO adult bands, as a key: under (< 18.5), normal (< 25), over (< 30), obese. */
export const bmiBand = v => (v == null ? null : v < 18.5 ? 'under' : v < 25 ? 'normal' : v < 30 ? 'over' : 'obese')

/**
 * Fat-free mass index (Kouri, Pope, Katz & Oliva 1995): lean mass / m², and the version
 * normalised to 1.80 m (+ 6.1 × (1.8 − height in m)) that their cut-off of about 25 refers to.
 */
export function ffmi(kg, cm, bodyFatPct) {
  if (!ok(kg) || !ok(cm) || !(num(bodyFatPct) >= 0 && num(bodyFatPct) < 100)) return null
  const m = num(cm) / 100
  const lean = num(kg) * (1 - num(bodyFatPct) / 100)
  const raw = lean / m ** 2
  return { lean: round1(lean), ffmi: round1(raw), normalized: round1(raw + 6.1 * (1.8 - m)) }
}

/**
 * U.S. Navy body fat (Hodgdon & Beckett 1984, the metric form of DoD Instruction 1308.3): from
 * height, neck and waist, plus hips for women, all in cm. Null when the tape does not add up
 * (a waist no bigger than the neck).
 */
export function navyBodyFat({ sex = 'male', heightCm, neckCm, waistCm, hipCm } = {}) {
  const h = num(heightCm), n = num(neckCm), w = num(waistCm), hip = num(hipCm)
  if (!ok(h) || !ok(n) || !ok(w)) return null
  let bf
  if (sex === 'female') {
    if (!ok(hip) || w + hip - n <= 0) return null
    bf = 495 / (1.29579 - 0.35004 * Math.log10(w + hip - n) + 0.22100 * Math.log10(h)) - 450
  } else {
    if (w - n <= 0) return null
    bf = 495 / (1.0324 - 0.19077 * Math.log10(w - n) + 0.15456 * Math.log10(h)) - 450
  }
  return Number.isFinite(bf) && bf > 0 && bf < 75 ? round1(bf) : null
}

// ── Pace ───────────────────────────────────────────────────────────────────────

/** Pace (seconds per km or mile, in the unit the distance is in) and speed from distance and time. */
export function pace(distance, seconds) {
  if (!ok(distance) || !ok(seconds)) return null
  return { secPer: num(seconds) / num(distance), speed: round2(num(distance) / (num(seconds) / 3600)) }
}
/** How long `distance` takes at `secPer` seconds per unit. */
export const timeAt = (distance, secPer) => (ok(distance) && ok(secPer) ? num(distance) * num(secPer) : null)

// The race distances a pace is usually held against, in km.
export const RACES = [{ id: '5k', km: 5 }, { id: '10k', km: 10 }, { id: 'half', km: 21.0975 }, { id: 'marathon', km: 42.195 }]

/** "h:mm:ss" or "m:ss" for a number of seconds. */
export function fmtClock(sec) {
  if (!(num(sec) >= 0) || !Number.isFinite(num(sec))) return '–'
  const s = Math.round(num(sec))
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), r = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`
}
/** Seconds from "h:mm:ss", "mm:ss" or plain minutes; null when it does not read. */
export function parseClock(text) {
  const s = String(text ?? '').trim()
  if (!s) return null
  if (/^\d+([.,]\d+)?$/.test(s)) return Math.round(num(s.replace(',', '.')) * 60)
  const parts = s.split(':')
  if (parts.length > 3 || parts.some(p => !/^\d+$/.test(p))) return null
  return parts.reduce((acc, p) => acc * 60 + num(p), 0)
}

// ── helpers ────────────────────────────────────────────────────────────────────

/** A set's 1RM the way the rest of the app estimates it, for the page's own "from a set" field. */
export const oneRmOf = (w, r, formula = DEFAULT_FORMULA) => estimate1RM(w, r, formula)

function round1(v) { return Math.round(v * 10) / 10 }
function round2(v) { return Math.round(v * 100) / 100 }
