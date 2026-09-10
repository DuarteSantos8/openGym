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
    if (plan.reps != null) target.reps = plan.reps
    if (plan.sec != null) target.sec = plan.sec
    if (plan.sets != null) target.sets = plan.sets
    // A wave prescribes each row separately, so the session has to remember all of them or
    // readSession would grade a 1-rep top set against a 5-rep target and call it a miss.
    if (plan.rows) target.rows = plan.rows
    return { id: cfg.id, sg: cfg.sg, target, plan, sets, ...(noProg ? { noProg: true } : {}) }
  })
}

/**
 * The one config value the engine ever writes back.
 *
 * A wave's training max is a number the lifter owns rather than one the log implies, and a
 * completed cycle bumps it — so the routine has to learn the new value or the next cycle runs
 * at the old one. Written when the session *finishes*, not when it starts: a session you
 * discard never happened, and a bump it never lifted would put the derived cycle stage out of
 * step with the history it is derived from.
 *
 * Matched by `rid` + exercise id rather than by position: a routine edited between start and
 * finish must not have someone else's training max written into it, and the same exercise
 * twice in a routine shares one config anyway (progression reads history by id).
 *
 * Mutates the store draft `s` — call inside store.update.
 */
export function commitTrainingMax(s, entries) {
  ;(entries || []).forEach(e => {
    const tm = e?.plan?.trainingMax
    if (!(tm > 0) || !e.rid) return
    const routine = (s.routines || []).find(r => r.id === e.rid)
    const cfg = (routine?.ex || []).find(x => x.id === e.id)
    if (cfg && cfg.trainingMax !== tm) cfg.trainingMax = tm
  })
}
