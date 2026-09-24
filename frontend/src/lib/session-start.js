// How a session's exercise entries are built from a routine. Shared by the live start and by
// "log a past workout", which is the same screen pointed at another day — both must walk up
// to identical entries, or the two paths drift apart the first time a prescription rule changes.
// Imports both history.js and progression.js (which itself imports history.js); nothing in
// either imports this file, so there is no cycle.
import { buildSets, applyIntensifierPlan, modeOf } from './history.js'
import { nextPrescription, applyPrescription, defaultIncrement, weightIncrement } from './progression.js'

// Returns a bare array of session entries. "Excluded from progression" is per-entry now
// (`entry.noProg`, written only when true) rather than a wrapper flag — a rehab routine merged
// into real work must exclude only its own exercises. The merge helper (lib/session-merge.js)
// stamps `entry.rid`; this builder is unaware of which routine it serves, so the single-routine
// and combined paths share it unchanged.
export function buildSessionEntries(st, r) {
  // The prescription is applied as the session is built, so you walk up to the bar with the
  // right weight already on the screen instead of being told about it afterwards. `plan` is
  // kept on the entry purely so the workout can explain the number it chose.
  const noProg = r?.excludeFromProgression === true
  return (r ? r.ex : []).map(cfg => {
    const plan = noProg ? { policy: 'off', kind: 'off' } : nextPrescription(st, cfg, r)
    // The warm-up ramp and the prescription snap to the exercise's own increment (1.25 kg
    // plates exist), not the unit default; a timed exercise's `inc` is seconds, so it keeps the
    // default for its optional load.
    const step = modeOf(cfg) === 'reps' ? weightIncrement(cfg, st.unit) : defaultIncrement(cfg.id, st.unit)
    const sets = applyIntensifierPlan(applyPrescription(buildSets(st, cfg, { step, useTarget: plan.kind === 'off' }), plan, step), cfg)
    const target = { ...cfg }
    if (plan.weight != null) target.weight = plan.weight
    // Double progression opens at `aim`, a rung on the way up the range, but it is graded
    // against the top of that range — readSession compares every set to `target.reps`. Storing
    // the rung here made the session grade itself against what it opened at, so hitting the
    // opened reps read as "top of the range in every set" and the weight climbed every session
    // without the range ever being completed (#278). `repsTop` is the grading target.
    if (plan.repsTop != null) target.reps = plan.repsTop
    else if (plan.reps != null) target.reps = plan.reps
    if (plan.sec != null) target.sec = plan.sec
    if (plan.sets != null) target.sets = plan.sets
    return { id: cfg.id, sg: cfg.sg, target, plan, sets, ...(noProg ? { noProg: true } : {}) }
  })
}
