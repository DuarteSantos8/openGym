// Why a session opens at the numbers it does, in the words v1 used (lib/progression.js `why`):
// read off what the engine decided — the prescription beside the one before it, the track's
// stalls, a reset — never decided here. English keys; the caller translates (`t(...why)`).
import { operatorFor, phaseOf, policyOfPreset } from './prescription/index.js'

const loadOf = p => p?.prefill?.load?.value ?? p?.rows?.find(r => r.load)?.load.value ?? 0
const tidy = v => Math.round(v * 100) / 100

/**
 * @returns {{ policy: string, kind: 'first'|'up'|'hold'|'deload', why: any[] } | null}
 *          null for a rule that progresses nothing (v1 'off').
 */
export function prescriptionWhy({ prescription: p, last: q = null, state = null, lastLog = null, reset = null, unit = 'kg', assisted = false }) {
  const policy = policyOfPreset(p?.preset)
  if (!policy || policy === 'off') return null
  const out = (kind, ...why) => ({ policy, kind, why })
  if (!lastLog) return out('first', 'Nothing logged yet, so this session sets the baseline.')
  const phase = phaseOf(p), par = p.parameters
  const d = p.provenance?.deload ?? null
  const after = phase.stall?.after ?? 3, stalls = state?.stalls ?? 0
  // Judged against what was lifted, which is not always what was asked for.
  // (the top set of a session with back-off sets; the least help on an assistance machine)
  const loads = (lastLog.performance?.sets || []).filter(r => r.status === 'completed' && r.role !== 'warmup' && r.resistance?.value > 0).map(r => r.resistance.value)
  const lifted = loads.length ? Math[assisted ? 'min' : 'max'](...loads) : lastLog.actual?.load?.value ?? loadOf(q)
  const w = loadOf(p), wq = lifted, by = tidy(Math.abs(w - wq))
  const harder = wq > 0 && (assisted ? w < wq : w > wq)
  if (reset || (q && q.preset !== p.preset)) {
    // A line of progress carried into a routine that plans the lift its own way still earned its step.
    if (reset === 'first_in_routine' && harder && !par.durationSeconds) return out('up', assisted ? 'Every rep last time. {0} {1} less help.' : 'Every rep last time. {0} {1} more.', by, unit)
    return out('hold', reset === 'first_in_routine' ? 'First time in this routine, so starting from its own target.' : 'Plan changed, so starting from your new target.')
  }
  // A per-side set counts both sides: an even number.
  const aim = (r => (p.perSide ? Math.ceil(r / 2) * 2 : r))(p.values?.reps ?? p.prefill.reps)
  const top = par.reps.max, bottom = par.reps.min, setsMin = par.sets.min
  const aims = p.rows.map(r => r.reps?.min), was = (q?.rows || []).map(r => r.reps?.min)

  if (par.durationSeconds) {
    const sec = p.prefill.durationSeconds, before = q?.prefill?.durationSeconds
    if (d) return out('deload', 'Short {0} sessions in a row. Back off to {1}s and build up again.', d.stalls, sec)
    return sec > before ? out('up', 'Held every set for the full time. Target goes up by {0}s.', sec - before) : out('hold', 'Came up short last time. Same target again.')
  }
  // Nothing loaded: the bodyweight rep ladder, or a loaded lift nobody entered a weight for.
  if (!(w > 0) && !(wq > 0)) {
    if (operatorFor(phase, 'load')) return out('hold', 'No weight logged last time. Enter what you lift and progression takes it from there.')
    const goal = p.prefill.reps, n = p.rows.length, nq = was.length, goalq = q?.prefill?.reps
    if (n > nq) return out('up', '{0} reps in every set! Add a set and go back to {1}.', goalq, goal)
    if (goal > goalq) return out('up', 'Bodyweight: every rep last time, so go for {0} this time.', goal)
    const clean = (lastLog.actual?.reps ?? 0) >= goalq && (lastLog.actual?.sets ?? 0) >= nq
    return clean ? out('hold', '{0} sets of {1}. Time to add weight or try a harder variation.', n, goal) : out('hold', 'Bodyweight: same target again until every set is clean.')
  }
  if (policy === 'triple') {
    if (d) return out('deload', assisted ? 'Stuck for {0} sessions. Back to {1} {2} of help, start again at {3} sets of {4}.' : 'Stuck for {0} sessions. Deload to {1} {2} and start again at {3} sets of {4}.', d.stalls, w, unit, setsMin, bottom)
    if (harder) return out('up', assisted ? 'Top of the range on all {0} sets. {1} {2} less help, back to {3} sets of {4}.' : 'Top of the range on all {0} sets. {1} {2} more, back to {3} sets of {4}.', was.length, by, unit, setsMin, bottom)
    if (aims.length > was.length) return out('up', '{0} reps in every set! Add a set at {1} reps.', top, aims.at(-1))
    if (aims.every((r, i) => r === was[i])) return out('hold', ...(stalls === 0 ? ['Short of the target, but more reps than before. Same sets and reps again.'] : ['Missed reps last time. Same sets and reps again ({0} of {1} to go).', after - stalls, after]))
    return aims.length <= setsMin ? out('hold', 'Same weight, aim for {0} reps in every set.', aims[0]) : out('hold', 'Same weight, aim for {0} reps on the last set.', aims.at(-1))
  }
  // v1's Epley deload (linear and double): the weight that keeps the estimated 1RM a notch lower, or a hold at fewer reps.
  const epley = d && d.method !== 'factor' && d.reps != null
    ? out('deload', d.to >= d.from ? 'Stuck for {0} sessions. Hold {1} {2} and use {3} reps.' : 'Stuck for {0} sessions. Epley deload to {1} {2} for {3} reps.', d.stalls, w, unit, d.reps) : null
  // v1 steady double progression: a rep more only after every set made it; that climb is a hold.
  if (policy === 'steady') {
    if (d) return epley || out('deload', assisted ? 'Stuck for {0} sessions. Back to {1} {2} of help, then build up again.' : 'Stuck for {0} sessions. Deload to {1} {2}.', d.stalls, w, unit)
    if (harder) return out('up', assisted ? 'Top of the rep range in every set. {0} {1} less help, back to {2} reps.' : 'Top of the rep range in every set. {0} {1} more, back to {2} reps.', by, unit, aim)
    const prev = q?.prefill?.reps
    if (prev != null && aim > prev) return out('hold', 'Every set hit {0}. Same weight, {1} reps this time.', prev, aim)
    return out('hold', 'Not every set reached {0} yet. Same weight and target again ({1} of {2} to go).', aim, after - stalls, after)
  }
  if (policy === 'double') {
    if (d) return epley || out('deload', assisted ? 'Stuck for {0} sessions. Back to {1} {2} of help, then build up again.' : 'Stuck for {0} sessions. Deload to {1} {2}.', d.stalls, w, unit)
    if (harder) return out('up', assisted ? 'Top of the rep range in every set. {0} {1} less help, back to {2} reps.' : 'Top of the rep range in every set. {0} {1} more, back to {2} reps.', by, unit, aim)
    return out('hold', 'Same weight, aim for {0} reps this time.', aim)
  }
  if (d) {
    return epley || (assisted ? out('deload', 'Missed reps. {0} {1} of help while you build back up.', w, unit)
      : d.stalls > 1 ? out('deload', 'Missed reps {0} sessions running. Reset to {1} {2} and work back up.', d.stalls, w, unit) : out('deload', 'Missed reps. Reset to {0} {1} and work back up.', w, unit))
  }
  if (harder) {
    const step = operatorFor(phase, 'load')?.step, amrap = lastLog.actual?.amrapReps
    const doubled = policy === 'greyskull' && step?.type === 'absolute' && by >= step.value * 2
    return doubled ? out('up', 'Last set hit {0} reps, twice the target! Take a double jump of {1} {2}.', amrap, by, unit)
      : out('up', assisted ? 'Every rep last time. {0} {1} less help.' : 'Every rep last time. {0} {1} more.', by, unit)
  }
  return out('hold', 'Missed reps last time. Same weight again ({0} of {1} to go).', after - stalls, after)
}
