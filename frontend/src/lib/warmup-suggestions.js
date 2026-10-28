import { WARMUP_MOVEMENTS, defaultWarmupStep } from '../../../api/training/guided-warmup.js'
import { EXIDX } from './exercises.js'
import { exAvailable } from './equipment.js'
import { musclesOf, MUSCLES } from './muscles.js'

const MAX_SUGGESTIONS = 5
const LOWER_BODY = ['gluteal', 'quadriceps', 'hamstring', 'adductors', 'hip-flexors']

// Preparation relevance is deliberately separate from training stimulus. Lower-body
// sessions also prepare hip and ankle movement; those regions are not always credited
// as trained muscles by the routine's main lifts.
function targetsOf(state, exercises) {
  const targets = new Map()
  for (const entry of exercises) {
    const id = typeof entry === 'string' ? entry : entry?.id
    const custom = (state.customEx || []).find(ex => ex?.id === id)
    const exercise = custom || EXIDX[id] || (entry && typeof entry === 'object' ? entry : null)
    for (const [muscle, weight] of Object.entries(musclesOf(exercise))) {
      targets.set(muscle, Math.max(targets.get(muscle) || 0, weight))
    }
  }
  const targetMuscles = MUSCLES.filter(muscle => targets.has(muscle))
  if (LOWER_BODY.some(muscle => targets.has(muscle))) {
    targets.set('hip-flexors', Math.max(targets.get('hip-flexors') || 0, 0.6))
    targets.set('calves', Math.max(targets.get('calves') || 0, 0.6))
  }
  return { targets, targetMuscles }
}

// The preview and its acceptance guard share the same resolved muscle inputs. Only the
// relevant target weights and selected movements enter the snapshot: an unrelated custom
// exercise edit, or a profile rename, cannot invalidate a proposal that has not changed.
export function warmupProposal(state, exercises) {
  const current = state || {}
  const { targets, targetMuscles } = targetsOf(current, Array.isArray(exercises) ? exercises : [])
  // General cardio remains available for manual selection. It should not displace a
  // targeted movement merely because its broad metadata happens to mention more muscles.
  const candidates = WARMUP_MOVEMENTS.filter(movement =>
    movement.family !== 'pulse' && EXIDX[movement.id] && exAvailable(current, EXIDX[movement.id]))
  const covered = new Set()
  const families = new Set()
  const steps = []
  while (steps.length < MAX_SUGGESTIONS) {
    let best
    let bestScore = 0
    for (const movement of candidates) {
      if (families.has(movement.family)) continue
      const score = movement.coverage.reduce((sum, muscle) =>
        sum + (covered.has(muscle) ? 0 : targets.get(muscle) || 0), 0)
      // The catalogue order breaks equal scores, so exercise order and duplicates cannot
      // shuffle a saved suggestion. Stop once every remaining choice is redundant.
      if (score > bestScore) { best = movement; bestScore = score }
    }
    if (!best) break
    steps.push(defaultWarmupStep(best.id))
    families.add(best.family)
    best.coverage.forEach(muscle => covered.add(muscle))
  }
  const snapshot = JSON.stringify({ targets: [...targets].sort(([a], [b]) => a.localeCompare(b)), steps })
  return { steps, targetMuscles, snapshot }
}

/** A deterministic, editable starting point; does not modify the routine or its manual steps. */
export function suggestWarmup(state, exercises) {
  return warmupProposal(state, exercises).steps
}
