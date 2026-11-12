// Tempo per exercise or per set (#572): the four-digit lifting tempo, "3-1-1-0".
//
//   1st  eccentric: the lowering, in seconds
//   2nd  the pause at the bottom (the stretched position)
//   3rd  concentric: the lift
//   4th  the pause at the top (the squeezed position)
//
// Each digit is 0 to 9, or X for "as fast as you can" (an explosive lift). Stored as the string
// it is written as, normalised to dashes ("3-1-X-0"), on an exercise's routine target
// (`target.tempo`) and, for one set of one session, on the set row itself (`row.tempo`), which
// wins. Absent means no tempo: every routine and workout from before keeps its exact shape, and
// an older app that does not know the field keeps it untouched (it rides along in the target).
//
// Pure: the workout screen reads it, the tempo guide plays it (components/TempoGuide.jsx).

export const PHASES = ['down', 'bottom', 'up', 'top']
// What a phase is called on screen and how it sounds: the lowering low, the lift high, the two
// pauses in between, so a pocket can tell them apart without a look.
export const PHASE_LABEL = { down: 'Lower', bottom: 'Pause', up: 'Lift', top: 'Squeeze' }
export const PHASE_FREQ = { down: 523, bottom: 659, up: 880, top: 659 }
// The seconds an X stands for in the guide and in time under tension: one quick second.
export const X_SEC = 1
export const MAX_REPS = 50

const DIGIT = /^(?:[0-9]|x)$/i

/** "3110", "3/1/1/0", "3 1 1 0", "3-1-x-0" → "3-1-X-0"; null for anything that is not a tempo. */
export function normalizeTempo(raw) {
  if (raw == null) return null
  let s = String(raw).trim()
  if (!s) return null
  let parts
  if (/^[0-9xX]{4}$/.test(s)) parts = s.split('')
  else parts = s.split(/\s*[-/.:,\s]\s*/)
  if (parts.length !== 4 || !parts.every(p => DIGIT.test(p))) return null
  parts = parts.map(p => p.toUpperCase())
  // A tempo that takes no time at all says nothing.
  if (parts.every(p => p === '0')) return null
  return parts.join('-')
}

/** { down, bottom, up, top } in seconds (X as X_SEC), with `x` naming the phases written as X. */
export function parseTempo(raw) {
  const n = normalizeTempo(raw)
  if (!n) return null
  const parts = n.split('-')
  const out = { x: [] }
  PHASES.forEach((ph, i) => {
    if (parts[i] === 'X') { out[ph] = X_SEC; out.x.push(ph) } else out[ph] = +parts[i]
  })
  return out
}

/** The tempo a set is done at: its own (one session), else the exercise's. null for none. */
export function tempoOf(target, row) {
  return normalizeTempo(row?.tempo) || normalizeTempo(target?.tempo)
}

/**
 * How many reps the guide counts for a set: one side's on a per-side set, since each side is lifted
 * on its own (the side up next, else the left), else the set's, else the plan's, else 8. The row's
 * own `r` on a per-side set is both sides together.
 */
export function guideReps(row, target) {
  const sides = row?.sides
  if (sides?.L && sides?.R) {
    const side = !sides.L.done ? sides.L : !sides.R.done ? sides.R : sides.L
    if (Number(side.r) > 0) return Number(side.r)
  }
  return Number(row?.r) || Number(target?.reps) || 8
}

/** Seconds one rep takes at this tempo. */
export function repSec(raw) {
  const p = parseTempo(raw)
  return p ? PHASES.reduce((a, ph) => a + p[ph], 0) : 0
}

/** Time under tension of a set: reps × one rep's seconds (0 without a tempo or reps). */
export function tutSec(raw, reps) {
  const r = Math.max(0, Math.round(Number(reps) || 0))
  return r ? repSec(raw) * r : 0
}

/**
 * The guide's script for `reps` reps: one step per phase that takes time, in order, each
 * { rep (1-based), phase, at (seconds from the start), sec }. A 0 phase is left out, so 3-0-1-0
 * goes lower, lift, lower, lift. Capped at MAX_REPS.
 */
export function tempoSteps(raw, reps) {
  const p = parseTempo(raw)
  const n = Math.min(MAX_REPS, Math.max(0, Math.round(Number(reps) || 0)))
  if (!p || !n) return []
  const out = []
  let at = 0
  for (let rep = 1; rep <= n; rep++) {
    for (const phase of PHASES) {
      const sec = p[phase]
      if (!(sec > 0)) continue
      out.push({ rep, phase, at, sec })
      at += sec
    }
  }
  return out
}

/** Where the guide is `elapsed` seconds in: the step, the seconds left in it, or done. */
export function stepAt(steps, elapsed) {
  if (!steps.length) return { done: true }
  const last = steps[steps.length - 1]
  if (elapsed >= last.at + last.sec) return { done: true }
  let i = 0
  while (i + 1 < steps.length && steps[i + 1].at <= elapsed) i++
  const s = steps[i]
  return { done: false, index: i, step: s, left: Math.max(0, Math.ceil(s.at + s.sec - elapsed - 1e-9)) }
}
