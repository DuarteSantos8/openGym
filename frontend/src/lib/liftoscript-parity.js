// EP09-T04: a Liftoscript progression script and openGym's own engine (lib/progression.js),
// side by side over a simulated block of sessions, from the same history.
//
// Nothing here adopts the script's answer. Every week both rules read the session that was just
// logged and say what comes next; the next session is then performed at what openGym prescribes,
// so the two never drift onto different histories and every disagreement is about the rule
// itself. Callers (the program preview, EP09-T02) show the weeks that diverge, and above all any
// week where the script adds load after a missed session, before anything changes.
//
// The evaluator (lib/liftosaur-eval.js) is stateless: it sees this session only. So a rule that
// needs memory, such as the native linear rule's deload after repeated misses (DELOAD_AFTER), is
// reported as a divergence rather than approximated.
import { evaluateLiftoscript } from './liftosaur-eval.js'
import { nextPrescription } from './progression.js'

export const MAX_WEEKS = 26
const DAY = 86400000

/**
 * @param {{ script: string, exId: string, sets?: number, reps?: number, start: number,
 *   prog?: string, unit?: 'kg'|'lb', outcomes: boolean[], startDay?: string }} args
 *   `outcomes[i]` is whether week i's session hit every target rep; a miss leaves the last set
 *   two reps short.
 * @returns {{ weeks: object[], divergences: number, unsafe: number, error?: string }}
 */
export function simulateParity({ script, exId, sets = 3, reps = 5, start, prog = 'linear', unit = 'kg', outcomes, startDay = '2026-01-05' }) {
  if (!Array.isArray(outcomes) || !outcomes.length || outcomes.length > MAX_WEEKS) throw new Error(`Simulate 1 to ${MAX_WEEKS} weeks`)
  if (!Number.isFinite(start) || start <= 0) throw new Error('Start weight must be positive')
  if (!Number.isSafeInteger(sets) || sets < 1 || sets > 20 || !Number.isSafeInteger(reps) || reps < 1 || reps > 100) throw new Error('Invalid sets or reps')
  if (typeof exId !== 'string' || !exId) throw new Error('Pick an exercise')
  const t0 = Date.parse(startDay + 'T00:00:00Z')
  if (!Number.isFinite(t0)) throw new Error('Invalid start day')

  const S = { unit, workouts: [] }
  const routine = { prog }
  const weeks = []
  let weight = start
  for (let i = 0; i < outcomes.length; i++) {
    const hit = outcomes[i] === true
    const done = Array.from({ length: sets }, (_, k) => (hit || k < sets - 1 ? reps : Math.max(0, reps - 2)))
    const d = new Date(t0 + i * 7 * DAY).toISOString().slice(0, 10)
    S.workouts = [...S.workouts, { id: `sim${i}`, d, entries: [{ id: exId, target: { sets, reps, weight }, sets: done.map(r => ({ w: weight, r, done: true })) }] }]

    const next = nextPrescription(S, { id: exId, sets, reps, weight }, routine)
    const native = Number.isFinite(next?.weight) ? next.weight : weight
    let scripted
    try {
      scripted = evaluateLiftoscript(script, { weight, reps, completedReps: Math.min(...done), rpe: 0 }).weight
    } catch (e) {
      return { weeks, divergences: weeks.filter(w => w.diverges).length, unsafe: weeks.filter(w => w.unsafe).length, error: e.message }
    }
    const row = { week: i + 1, hit, weight, native, nativeKind: next?.kind ?? null, script: scripted }
    if (scripted !== native) row.diverges = true
    if (!hit && scripted > weight) row.unsafe = 'adds load after a missed session'
    weeks.push(row)
    weight = native
  }
  return { weeks, divergences: weeks.filter(w => w.diverges).length, unsafe: weeks.filter(w => w.unsafe).length }
}
