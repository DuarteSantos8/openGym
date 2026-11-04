// What a program's phase asks for, read the same way by generation and by advancement: the phase a
// track is in, the values its next session targets, and the rows its groups resolve to.
import { canonicalJSON } from './canonical.js'
import { roundLoad } from './load.js'

const copy = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))

export const phaseById = (program, id) => program.phases.find(ph => ph.id === id) ?? null
export const operatorFor = (phase, metric) => phase.progression.find(op => op.metric === metric) ?? null
/** The phase a prescription was generated in. */
export const phaseOf = p => phaseById(p.ruleSnapshot.program, p.phaseId)
/** A prescribed row's group and the rest after it. */
export const groupIdOf = (p, row) => row.groupId ?? phaseOf(p).groups[0].id
export const restOf = (p, row) => row.restSeconds ?? p.parameters.restSeconds

/**
 * The values a phase opens with. `values` holds what the next session targets: the load
 * expression (the anchor), the sets and reps aim, a timed hold's window, the rest, the rung and
 * the training max. A value no operator moves always reads the plan (see valueOf).
 */
export function initialValues(phase) {
  const p = phase.parameters
  return {
    // Reps climbed from what was done (v1 double progression) open at the plan's own: the top.
    load: copy(p.load), sets: p.sets.min, reps: operatorFor(phase, 'reps')?.basis === 'last_actual' ? p.reps.max : p.reps.min, durationSeconds: copy(p.durationSeconds) ?? null,
    restSeconds: p.restSeconds, difficulty: 0, trainingMax: null
  }
}

/**
 * What a prescription freezes of the values (the load is already its parameters.load.expression):
 * the sets and reps it aimed at, and only the other values its phase uses — the profile stays
 * inside the sync cap (REPORT M5).
 */
export const frozenValues = (phase, values, { sets, reps, durationSeconds, restSeconds }) => ({
  sets, reps, ...(values.rowReps ? { rowReps: copy(values.rowReps) } : {}), ...(durationSeconds ? { durationSeconds: copy(durationSeconds) } : {}),
  ...(operatorFor(phase, 'restSeconds') ? { restSeconds } : {}), ...(operatorFor(phase, 'difficulty') ? { difficulty: values.difficulty } : {}),
  ...(values.trainingMax ? { trainingMax: copy(values.trainingMax) } : {})
})
/** A prescription's values in full: what advance.js steps from. */
export const valuesOfPrescription = p => ({ ...initialValues(phaseOf(p)), ...copy(p.values), load: copy(p.parameters.load.expression) })

/** Where an operator's value starts: the bottom of its range, or the top when it steps down. */
export const startOf = (phase, op) => (op.direction === 'down' ? op.max ?? phase.parameters[op.metric]?.max : op.min ?? phase.parameters[op.metric]?.min)

/** A target as the next session reads it: the progressed value when an operator owns it, else the
 *  plan's. A null value is the start of its range, read against the plan the session is built from:
 *  a finish that sent reps back to the bottom does not know where the bottom will be. */
export function valueOf(phase, values, metric) {
  const p = phase.parameters
  const op = operatorFor(phase, metric)
  if (op) return values[metric] ?? startOf(phase, op)
  if (metric === 'reps' && phase.entry?.reps === 'last_actual') return values.reps ?? p.reps.min
  return { sets: p.sets.min, reps: p.reps.min, durationSeconds: p.durationSeconds ?? null, restSeconds: p.restSeconds }[metric]
}

// What the planner declared as the start of every phase (load and step kind): an edit of either
// restarts the values from the new declaration instead of carrying the progressed ones.
const starts = rule => canonicalJSON(rule.program.phases.map(ph => [ph.id, ph.parameters.load, operatorFor(ph, 'load')?.step.type ?? null]))
export const sameStart = (a, b) => starts(a) === starts(b)

/** The phase a regime exit leads to for a session opening at `load` (bodyweight ↔ loaded), or null. */
export function regimeExit(program, phase, load) {
  const exit = phase.exit
  const loaded = load > 0
  if ((exit?.type === 'load_present' && loaded) || (exit?.type === 'load_absent' && !loaded)) return phaseById(program, exit.to)
  return null
}

/** The values a phase is entered with: its own declaration, the load carried in when it starts from
 *  what was lifted, the reps from what was done (`last_actual`) or from what was asked (`previous`). */
export function entryValues(phase, values, { load = null, reps = null, previous = null } = {}) {
  const v = { ...initialValues(phase), trainingMax: copy(values?.trainingMax ?? null) }
  if (phase.entry?.load === 'previous' && load?.value > 0 && phase.parameters.load.mode === 'absolute') v.load = { mode: 'absolute', value: load.value, unit: load.unit ?? phase.parameters.load.unit }
  if (phase.entry?.reps === 'last_actual' && reps > 0) v.reps = Math.floor(reps)
  if (phase.entry?.reps === 'previous' && previous > 0) v.reps = previous
  return v
}

export const isWork = row => row.status === 'completed' && row.role !== 'warmup'

/** The heaviest completed work load of a log (the lightest, on an assistance machine): v1's
 *  readSession.weight, the load a session is held at, backed off from and judged a run by. Only
 *  the prescribed sets count when there are any: a set added on top never moves the plan (v1 #233). */
export function bestLoad(x, assisted) {
  const work = (x?.performance?.sets || []).filter(isWork)
  const own = work.some(r => r.prescribed) ? work.filter(r => r.prescribed) : work
  const loads = own.filter(r => r.resistance?.kind === 'external-load').map(r => r.resistance.value)
  return loads.length ? (assisted ? Math.min(...loads) : Math.max(...loads)) : x?.actual?.load?.value ?? null
}
/** The same as a load, in the log's unit; null when nothing was lifted. */
export const bestLoadOf = (x, assisted, unit) => {
  const value = bestLoad(x, assisted)
  return value == null ? null : { value, unit: x?.actual?.load?.unit ?? x?.performance?.sets?.find(r => r.resistance?.unit)?.resistance.unit ?? unit }
}

/** Load-progressing work whose log carries no load, a weight never typed reading as 0 the way v1's
 *  did (an assistance machine's 0 is real help, not a missing weight). */
export function unweightedLog(p, log) {
  return !!operatorFor(phaseOf(p), 'load') && !p.assisted && !((bestLoad(log, p.assisted) ?? 0) > 0)
}

/** True when the phase gives rows their own loads (percentages, a training max): no single prefilled load fits them. */
export const perRowLoads = phase => phase.groups.some(g => g.load.basis === 'training_max' || g.load.basis === 'absolute' || (g.load.basis === 'anchor' && g.load.percent !== 100))

/**
 * The work rows, group by group in declared order. A row carries its group, its reps target, its
 * load (a percentage of the anchor or of the training max, rounded once) and the rest after it.
 * A Max set opens at what the same set managed last time.
 */
export function rowsFor(phase, { sets, reps, repsMax, anchor, loadTo, trainingMax, rounding, rest, lastWork = [], lastLoads = [] }) {
  const percentOf = (base, percent) => (base ? { value: roundLoad(base.value * percent / 100, rounding), unit: base.unit } : null)
  const rows = []
  for (const g of phase.groups) {
    const n = g.count === 'parameters' ? sets : g.count.min
    for (let k = 0; k < n; k++) {
      const i = rows.length
      const load = g.load.basis === 'absolute' ? (g.load.value > 0 ? { value: roundLoad(g.load.value, rounding), unit: g.load.unit } : lastLoads[i] || anchor) : g.load.basis === 'training_max' ? percentOf(trainingMax, g.load.percent) : g.load.basis === 'anchor' ? percentOf(anchor, g.load.percent) : null
      const seed = Math.max(0, lastWork[i] ?? 0)
      rows.push({
        // The group and the rest after the set, written only where they say something the
        // prescription does not already say (one group; the exercise's rest).
        ...(phase.groups.length > 1 ? { groupId: g.id } : {}),
        reps: g.max ? { min: seed, max: seed } : g.reps === 'parameters' ? { min: reps, max: repsMax } : copy(g.reps),
        load,
        ...(loadTo !== undefined && g.load.basis === 'anchor' && g.load.percent === 100 ? { loadTo: copy(loadTo) } : {}),
        ...(g.restSeconds != null && g.restSeconds !== rest ? { restSeconds: g.restSeconds } : {}),
        ...(g.amrap ? { amrap: true } : {}),
        ...(g.max ? { max: true } : {})
      })
    }
  }
  return rows
}
