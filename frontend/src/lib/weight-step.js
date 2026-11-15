// One weight step for every exercise (Settings → Weight step). Someone on microplates wanted
// 0.25 kg everywhere and had to open every exercise of every routine to set it; the owner wanted
// 0.1 too. `S.wstep` holds one step per unit, { kg, lb }, kept per unit like the plates (a 0.25 kg
// step is not a 0.25 lb one), and stands in for the per-lift default (exercises.js
// defaultIncrement: 2.5 kg, 5 for the legs). An exercise's own Step (`inc`) still wins, and
// "Apply to all exercises" clears those so the whole plan follows the one picked here.
import { setProfileSteps } from './exercises.js'
import { modeOf } from './history.js'
import { fmtPlate } from './format.js'

export const STEPS = {
  kg: [0.1, 0.25, 0.5, 1, 1.25, 2, 2.5, 5],
  lb: [0.1, 0.25, 0.5, 1, 1.25, 2, 2.5, 5, 10],
}

/** '0.25 kg': a step as a label, with all the places it has (fmtNum would print 0.3). */
export const fmtStepLabel = (v, unit) => fmtPlate(v) + ' ' + (unit === 'lb' ? 'lb' : 'kg')

const unitOf = S => (S?.unit === 'lb' ? 'lb' : 'kg')

/** The profile's own step in its unit, or null for "each lift's default". */
export function profileStep(S, unit = unitOf(S)) {
  const v = Number(S?.wstep?.[unit])
  return v > 0 && v <= 50 ? v : null
}

/** The next value of a step list from `v` in direction `dir` (the Step stepper walks the list). */
export function nextStep(v, dir, unit = 'kg') {
  const list = STEPS[unit === 'lb' ? 'lb' : 'kg']
  const n = Number(v) || 0
  if (dir > 0) return list.find(x => x > n + 1e-9) ?? n + 5
  const lower = list.filter(x => x < n - 1e-9)
  return lower.length ? lower[lower.length - 1] : list[0]
}

/** Pushes the profile's steps to defaultIncrement. App.jsx calls it on every change. */
export const applyProfileSteps = S => setProfileSteps(S?.wstep)

// The rows a step means anything for: rep work (a timed exercise's `inc` is seconds).
const ownStep = cfg => cfg && typeof cfg === 'object' && modeOf(cfg) === 'reps' && Number(cfg.inc) > 0

function slots(S) {
  const out = []
  for (const r of S?.routines || []) for (const e of r?.ex || []) {
    if (ownStep(e)) out.push(e)
    for (const c of Object.values(e?.subCfg || {})) if (ownStep(c)) out.push(c)
  }
  return out
}

/** How many exercises in the routines have a step of their own that differs from `step`. */
export function stepOverrides(S, step) {
  return slots(S).filter(c => Math.abs(Number(c.inc) - step) > 1e-9).length
}

const clearInc = cfg => {
  if (!ownStep(cfg)) return cfg
  const { inc, ...rest } = cfg
  return rest
}

/**
 * The routines with every exercise's own step taken out, so all of them follow the profile's
 * step; the workout in progress too. A new copy: the store's draft must not be written into.
 * The exercises that are left without a step use profileStep from then on, and any of them
 * can be given its own again in its settings.
 */
export function applyStepToAll(S) {
  const routines = (S.routines || []).map(r => (!Array.isArray(r?.ex) ? r : {
    ...r,
    ex: r.ex.map(e => {
      let out = clearInc(e)
      if (out?.subCfg && typeof out.subCfg === 'object') {
        out = { ...out, subCfg: Object.fromEntries(Object.entries(out.subCfg).map(([k, c]) => [k, clearInc(c)])) }
      }
      return out
    }),
  }))
  const active = S.active && Array.isArray(S.active.entries)
    ? { ...S.active, entries: S.active.entries.map(en => (en?.target && ownStep({ ...en.target, id: en.id }) ? { ...en, target: clearInc(en.target) } : en)) }
    : S.active
  return { routines, active }
}
