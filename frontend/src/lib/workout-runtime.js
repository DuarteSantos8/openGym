import { modeForSet, normalizePhase, normalizePhaseList, normalizeMode, normalizeTargetKind, amrapMinRepsFor, withoutWorkLoad, isWarmupOnlyTarget } from './workout-model.js'

const objectOf = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {}
const finite = value => {
  if (value === '' || value == null) return null
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : null
}
const positive = (value, fallback = null) => {
  const number = finite(value)
  return number == null || number < 0 ? fallback : number
}
const positiveInt = (value, fallback = 0) => {
  const number = finite(value)
  return number == null || number < 0 ? fallback : Math.round(number)
}
const round = value => Math.round(value * 10) / 10
const snap = (value, increment) => increment > 0 ? round(Math.round(value / increment) * increment) : round(value)
export const REST_PRESETS = [0, 60, 90, 120, 150, 180]

/** Whether the selected routine phases include a work phase; omitted means the normal mix. */
export function hasSelectedWorkPhase(config = {}) {
  const source = objectOf(config)
  const nestedTarget = objectOf(source.target)
  const phases = normalizePhaseList(source.phases ?? nestedTarget.phases)
  return phases == null || phases.includes('work')
}

/** Column controls and labels for one logged-row mode. */
export function setTableColumnsForMode(mode, unit = 'kg') {
  const resolved = normalizeMode(mode, 'reps')
  const weight = { f: 'w', field: 'w', step: 2.5, dec: true, label: 'Weight', unit }
  if (resolved === 'cardio') return {
    primary: { f: 'min', field: 'min', step: 1, dec: false, label: 'Duration (min)' },
    secondary: { f: 'speed', field: 'speed', step: 0.5, dec: true, label: 'Speed (km/h)' },
    timed: false
  }
  if (resolved === 'time') return {
    primary: { f: 'sec', field: 'sec', step: 5, dec: false, label: 'Seconds' },
    secondary: weight,
    timed: true
  }
  return {
    primary: weight,
    secondary: { f: 'r', field: 'r', step: 1, dec: false, label: 'Reps' },
    timed: false
  }
}

/** Preserve row order while identifying whether one entry needs row-specific table headings. */
export function tableModesForEntry(entry = {}) {
  const source = objectOf(entry)
  const target = objectOf(source.target || source)
  const sets = Array.isArray(source.sets) ? source.sets : []
  const modes = sets.map(set => modeForSet(set, target))
  return [...new Set(modes.length ? modes : [modeForSet({}, target)])]
}

/** Whether an entry needs row-specific headings, including a singleton parent-mode conflict. */
export function tableModesRequirePerRowHeaders(entry = {}) {
  const source = objectOf(entry)
  const target = objectOf(source.target || source)
  const modes = tableModesForEntry(source)
  if (modes.length > 1) return true
  return modes.length === 1 && modes[0] !== modeForSet({}, target)
}

/** Normalize phase-specific rest without inventing a warm-up default. */
export function normalizeRestSettings(input = {}) {
  const source = input && typeof input === 'object' ? input : {}
  return {
    warmupRestSec: positiveInt(source.warmupRestSec ?? source.warmupRest, null),
    workRestSec: positiveInt(source.workRestSec ?? source.workRest ?? source.restSec, null)
  }
}

/** Resolve rest with set > exercise > routine > global precedence. */
export function restSecondsFor(set = {}, exercise = {}, routine = {}, globalRest = 90) {
  const phase = normalizePhase(set.phase, 'work')
  const field = phase === 'warmup' ? 'warmupRestSec' : 'workRestSec'
  const values = [set[field], set.restSec, exercise[field], routine[field], globalRest]
  for (const value of values) {
    const n = positiveInt(value, null)
    if (n != null) return n
  }
  return 0
}

/** Resolve a timed-set preparation countdown using the same override hierarchy as rest. */
export function prepSecondsFor(set = {}, exercise = {}, routine = {}, globalPrep = 5) {
  const values = [set.prepSec, exercise.prepSec, routine.prepSec, globalPrep]
  for (const value of values) {
    const n = positiveInt(value, null)
    if (n != null) return n
  }
  return 0
}

function prescriptionOf(target = {}) {
  const source = target && typeof target === 'object' ? target : {}
  const raw = source.weightPrescription || source.load || {}
  const marker = raw && typeof raw.kind === 'string' ? raw.kind.trim().toLowerCase() : ''
  if (raw && typeof raw === 'object' && (marker === 'percentage' || marker === 'workset_percent' || raw.percent != null)) {
    return {
      kind: marker === 'workset_percent' ? 'workset_percent' : 'percentage',
      percent: Math.max(0, Math.min(200, positive(raw.percent, 0))),
      fallbackWeight: positive(raw.fallbackWeight ?? raw.fallback, positive(source.weight, 0))
    }
  }
  return {
    kind: 'fixed',
    weight: positive(raw.weight ?? source.weight, 0)
  }
}

/**
 * Estimate a theoretical 1RM from eligible completed work sets. Warm-ups and timed sets are
 * deliberately excluded so a preparatory load cannot silently drive a percentage prescription.
 * A historical entry is preferred over a bare set array because its target is the parent-mode
 * authority for unannotated legacy rows.
 */
function theoretical1RM(history = [], fallbackTarget = {}) {
  const source = objectOf(history)
  const sets = Array.isArray(history) ? history : (Array.isArray(source.sets) ? source.sets : [])
  const target = Array.isArray(history)
    ? objectOf(fallbackTarget)
    : (source.target && typeof source.target === 'object' ? source.target : objectOf(fallbackTarget))
  let best = 0
  for (const set of sets) {
    const phase = normalizePhase(set.phase, 'work')
    const w = positive(set.w ?? set.weight, 0)
    const reps = positiveInt(set.r ?? set.reps, 0)
    if (phase !== 'work' || modeForSet(set, target) !== 'reps' || set.done !== true || w <= 0 || reps < 1) continue
    const estimate = reps === 1 ? w : w * (1 + reps / 30)
    if (estimate > best) best = estimate
  }
  return best
}

function maxWorkWeight(input = []) {
  const source = objectOf(input)
  const sets = Array.isArray(input) ? input : (Array.isArray(source.sets) ? source.sets : [])
  let best = 0
  let found = false
  for (const set of sets) {
    if (normalizePhase(set?.phase, 'work') !== 'work') continue
    found = true
    const weight = positive(set?.w ?? set?.weight, 0)
    if (weight > best) best = weight
  }
  return found ? best : null
}

/** Resolve and freeze a fixed or percentage load for the current workout. */
export function resolveTargetLoad(target = {}, history = [], increment = 0, context = {}) {
  const prescription = prescriptionOf(target)
  if (prescription.kind === 'fixed') return round(prescription.weight)
  if (prescription.kind === 'workset_percent') {
    const sessionWorkWeight = maxWorkWeight(context?.workSets)
    const historyWorkWeight = maxWorkWeight(history)
    const raw = sessionWorkWeight != null
      ? sessionWorkWeight * prescription.percent / 100
      : historyWorkWeight != null
        ? historyWorkWeight * prescription.percent / 100
        : prescription.fallbackWeight
    return snap(Math.max(0, raw), Math.max(0, finite(increment) || 0))
  }
  const max = theoretical1RM(history, target)
  const raw = max > 0 ? max * prescription.percent / 100 : prescription.fallbackWeight
  return snap(Math.max(0, raw), Math.max(0, finite(increment) || 0))
}

function warmupEntries(config = {}) {
  if (Array.isArray(config.warmup)) return config.warmup
  const count = positiveInt(config.warmupSets, 0)
  if (!count) return []
  const legacyMode = normalizeMode(config.warmupMode, config.warmupSec != null ? 'time' : 'reps')
  const legacyPrescription = config.warmupWeightPrescription || config.warmupLoad
  return Array.from({ length: count }, () => ({
    phase: 'warmup',
    mode: legacyMode,
    reps: config.warmupReps,
    sec: config.warmupSec,
    weight: config.warmupWeight,
    weightPrescription: legacyPrescription,
    ...(config.warmupRestSec != null ? { restSec: config.warmupRestSec } : {})
  }))
}

/** Editor shape for a warm-up row, retaining legacy fixed loads when no prescription exists. */
export function warmupDraftForEditor(row = {}, fallback = {}) {
  const source = objectOf(row)
  const base = objectOf(fallback)
  const rawPrescription = objectOf(source.weightPrescription ?? source.load)
  const marker = typeof rawPrescription.kind === 'string' ? rawPrescription.kind.toLowerCase() : ''
  const workset = source.loadMode === 'workset' || marker === 'workset_percent'
  const percentage = !workset && (source.loadMode === 'percentage' || marker === 'percentage' || rawPrescription.percent != null)
  const mode = source.mode === 'time' || source.sec != null || source.seconds != null || source.durationSec != null
    ? 'time'
    : source.mode === 'reps' || source.reps != null
      ? 'reps'
      : normalizeMode(base.mode, base.sec != null ? 'time' : 'reps')
  const fallbackWeight = positive(rawPrescription.fallbackWeight ?? rawPrescription.fallback ?? source.loadFallback, positive(base.weight, 0))
  const fixedWeight = positive(rawPrescription.weight ?? source.weight, positive(base.weight, 0))
  return {
    phase: source.phase || '',
    mode,
    reps: Math.max(1, Math.round(Number(source.reps ?? base.reps ?? 8)) || 8),
    sec: Math.max(1, Math.round(Number(source.sec ?? source.seconds ?? base.sec ?? 30)) || 30),
    loadMode: workset ? 'workset' : percentage ? 'percentage' : 'fixed',
    loadPercent: workset || percentage ? positive(rawPrescription.percent ?? source.loadPercent, 50) : 50,
    loadFallback: workset || percentage ? fallbackWeight : 0,
    weight: workset || percentage ? 0 : fixedWeight,
    ...(source.restSec != null ? { restSec: source.restSec } : base.restSec != null ? { restSec: base.restSec } : {})
  }
}

function setForTarget(target, phase, history, increment, context = {}) {
  const mode = normalizeMode(target.mode, target.sec != null ? 'time' : 'reps')
  const resolvedPhase = normalizePhase(target.phase, normalizePhase(phase, 'work'))
  const weight = resolveTargetLoad(target, history, increment, context)
  const restSec = positiveInt(target.restSec, null)
  const kind = normalizeTargetKind(target.kind, 'fixed')
  if (mode === 'time') {
    return {
      phase: resolvedPhase, mode, w: weight, sec: positiveInt(target.sec, 0), done: false,
      ...(kind === 'amrap' ? { kind: 'amrap' } : {}),
      ...(positiveInt(target.prepSec, 0) > 0 ? { prepSec: positiveInt(target.prepSec, 0) } : {}),
      ...(restSec != null ? { restSec } : {})
    }
  }
  return {
    phase: resolvedPhase, mode, w: weight,
    r: positiveInt(kind === 'amrap' ? amrapMinRepsFor(target, target.reps) : target.reps, 0), done: false,
    ...(kind === 'amrap' ? { kind: 'amrap' } : {}),
    ...(restSec != null ? { restSec } : {})
  }
}

function modeForTarget(target = {}, entry = {}) {
  if (target.mode === 'cardio' || target.min != null || target.speed != null) return 'cardio'
  if (target.mode === 'time' || target.sec != null || target.seconds != null || target.durationSec != null) return 'time'
  if (entry.id && target.mode == null && (entry.min != null || entry.speed != null)) return 'cardio'
  return 'reps'
}

/** Build the next row without crossing an authoritative warm-up-only phase boundary. */
export function addSetForEntry(entry = {}) {
  const source = objectOf(entry)
  const target = objectOf(source.target || source)
  const sets = Array.isArray(source.sets) ? source.sets : []
  const warmupOnly = isWarmupOnlyTarget(target, source)

  if (warmupOnly) {
    const lastWarmup = [...sets].reverse().find(set => normalizePhase(set?.phase, 'work') === 'warmup')
    if (lastWarmup) return { ...lastWarmup, phase: 'warmup', done: false }
    const configured = Array.isArray(target.warmup) ? target.warmup[target.warmup.length - 1] : null
    const warmupTarget = configured
      ? { ...objectOf(configured.target), ...objectOf(configured), phase: 'warmup' }
      : { ...target, phase: 'warmup' }
    return setForTarget(warmupTarget, 'warmup', [], 0)
  }

  const last = sets[sets.length - 1]
  const lastWork = [...sets].reverse().find(set => normalizePhase(set?.phase, 'work') === 'work')
  const workSource = lastWork || last
  const mode = modeForTarget(target, source)
  if (mode === 'cardio') {
    return { phase: 'work', min: workSource ? workSource.min : (target.min || 20), speed: workSource ? workSource.speed : (target.speed || 8), done: false }
  }
  if (mode === 'time') {
    return { phase: 'work', sec: workSource ? workSource.sec : (target.sec || 45), w: workSource ? (workSource.w || 0) : (target.weight || 0), done: false }
  }
  return { phase: 'work', w: workSource ? workSource.w : (target.weight || 0), r: workSource ? workSource.r : target.reps, done: false }
}

/** Prepend explicitly configured warm-ups to work sets, retaining phase on every logged row. */
export function prependWarmupSets(config = {}, workSets = [], history = [], increment = 0) {
  const phases = normalizePhaseList(config.phases)
  const selected = phases == null ? null : new Set(phases)
  const warmupContext = { workSets }
  const warmups = warmupEntries(config)
    .map(target => setForTarget(target, 'warmup', history, increment, warmupContext))
    .filter(set => selected == null || selected.has(set.phase))
  const work = (Array.isArray(workSets) ? workSets : []).map(set => ({
    ...set,
    phase: normalizePhase(set.phase, 'work'),
    mode: normalizeMode(set.mode, set.sec != null ? 'time' : 'reps'),
    ...(positiveInt(config.prepSec, 0) > 0 && normalizeMode(set.mode, set.sec != null ? 'time' : 'reps') === 'time'
      ? { prepSec: positiveInt(config.prepSec, 0) } : {})
  })).filter(set => selected == null || selected.has(set.phase))
  const lastWork = work.reduce((last, set, index) => set.phase === 'work' ? index : last, -1)
  const preparedWork = work.map((set, index) => {
    if (config.kind !== 'amrap' || index !== lastWork) return set
    return {
      ...set,
      kind: 'amrap'
    }
  })
  return [...warmups, ...preparedWork]
}

/** Build an editor target that mirrors the active warm-up rows, including manually added rows. */
export function warmupConfigForEntry(entry = {}) {
  const source = objectOf(entry)
  const target = objectOf(source.target)
  const configured = Array.isArray(target.warmup) ? target.warmup : []
  const rows = (Array.isArray(source.sets) ? source.sets : [])
    .filter(set => normalizePhase(set?.phase, 'work') === 'warmup')
  const warmup = rows.map((set, index) => {
    const mode = modeForSet(set, target)
    const derived = {
      phase: 'warmup',
      mode,
      ...(mode === 'time' ? { sec: positiveInt(set.sec, 30) } : { reps: positiveInt(set.r, 8) }),
      weightPrescription: { kind: 'fixed', weight: positive(set.w, 0) },
      ...(set.restSec != null ? { restSec: set.restSec } : {})
    }
    return { ...derived, ...objectOf(configured[index] || configured[configured.length - 1]), phase: 'warmup' }
  })
  return { ...target, warmup }
}

/** Apply a phase-config save to an active entry without rewriting completed warm-ups or work rows. */
export function applyWarmupConfigToEntry(entry = {}, config = {}, history = [], increment = 0) {
  const source = objectOf(entry)
  const sets = Array.isArray(source.sets) ? source.sets : []
  const oldWarmups = sets.filter(set => normalizePhase(set?.phase, 'work') === 'warmup')
  const workSets = sets.filter(set => normalizePhase(set?.phase, 'work') === 'work')
  const target = { ...objectOf(source.target), ...objectOf(config) }
  const configuredWarmups = prependWarmupSets(target, workSets, history, increment)
    .filter(set => normalizePhase(set?.phase, 'work') === 'warmup')
    .map((set, index) => oldWarmups[index]?.done === true
      ? { ...set, ...oldWarmups[index], phase: 'warmup' }
      : set)
  return {
    ...source,
    target,
    sets: [...configuredWarmups, ...workSets]
  }
}

export function applyWorkConfigToEntry(entry = {}, config = {}, history = [], increment = 0) {
  const source = objectOf(entry)
  const sets = Array.isArray(source.sets) ? source.sets : []
  const warmups = sets.filter(set => normalizePhase(set?.phase, 'work') === 'warmup')
  const workSets = sets.filter(set => normalizePhase(set?.phase, 'work') === 'work')
  const target = { ...objectOf(source.target), ...objectOf(config) }
  const count = Math.max(1, Math.round(Number(target.sets) || workSets.length || 3))
  const rebuilt = []
  workSets.forEach((set, i) => {
    if (i >= count) return
    if (set.done === true) { rebuilt.push(set); return }
    rebuilt.push(setForTarget(target, 'work', history, increment))
  })
  while (rebuilt.length < count) rebuilt.push(setForTarget(target, 'work', history, increment))
  return { ...source, target, sets: [...warmups, ...rebuilt] }
}

const isPercentageTarget = target => target?.weightPrescription?.kind === 'percentage'

/** Apply a progression plan without replacing a load resolved from a percentage prescription. */
export function sessionConfigFor(target = {}, plan = {}) {
  const source = target && typeof target === 'object' ? target : {}
  const out = { ...source }
  // Greyskull is the backwards-compatible routine default. Freeze that decision into the
  // session target so finished history still knows that its final work row was AMRAP. An
  // explicit fixed target (or explicit `amrap: false` from an older plan) wins.
  if (out.kind == null && out.targetKind == null && out.amrap !== false && plan?.policy === 'greyskull') out.kind = 'amrap'
  else if (out.kind == null && out.targetKind == null && out.amrap === false) out.kind = 'fixed'
  if (!isPercentageTarget(source) && plan?.weight != null) out.weight = plan.weight
  if (plan?.reps != null) out.reps = plan.reps
  if (plan?.sec != null) out.sec = plan.sec
  if (plan?.amrapMissPolicy) out.amrapMissPolicy = plan.amrapMissPolicy
  if (normalizeTargetKind(out.kind ?? out.targetKind, 'fixed') === 'amrap'
    && normalizeMode(out.mode, out.sec != null ? 'time' : 'reps') === 'reps') {
    const minimum = amrapMinRepsFor(out, out.reps)
    if (minimum != null) {
      out.amrapMinReps = minimum
      // `reps` is retained as a read-only legacy alias; all consumers use amrapMinReps.
      out.reps = minimum
    }
  }
  if (isPercentageTarget(source) && out.resolvedWeight == null) out.resolvedWeight = out.weight
  return hasSelectedWorkPhase(source) ? out : withoutWorkLoad(out)
}

/** Keep the progression explanation while preventing its weight field from overriding a resolved load. */
export function sessionPlanFor(target = {}, plan) {
  if (!plan) return plan
  if (!hasSelectedWorkPhase(target)) return withoutWorkLoad(plan)
  if (!isPercentageTarget(target) || plan.weight == null) return plan
  return { ...plan, weight: undefined }
}

export function isAmrapEntry(entry = {}) {
  const target = entry?.target || {}
  const explicit = target.kind ?? target.targetKind
  if (explicit === 'fixed' || target.amrap === false) return false
  if (explicit === 'amrap' || target.amrap === true) return true
  return target.kind === 'amrap' || target.targetKind === 'amrap'
    || target.prog === 'greyskull' || entry?.plan?.policy === 'greyskull'
}

/** Only the final work row is the result row for a reps/time AMRAP target. */
export function isAmrapResult(entry = {}, setIndex) {
  if (!isAmrapEntry(entry) || !Array.isArray(entry.sets) || !entry.sets[setIndex]) return false
  if (normalizePhase(entry.sets[setIndex].phase, 'work') !== 'work') return false
  let lastWork = -1
  entry.sets.forEach((set, index) => {
    if (normalizePhase(set?.phase, 'work') === 'work') lastWork = index
  })
  return setIndex === lastWork
}

export function amrapCapFor(entry = {}, setIndex) {
  // Kept as a compatibility export for callers from the cap-based implementation. Rep AMRAP
  // never has a maximum, so this intentionally always returns null.
  return null
}

/** Timer duration for one row; an AMRAP safety cap belongs only to the final work row. */
export function timerDurationForSet(entry = {}, setIndex) {
  const set = Array.isArray(entry.sets) ? entry.sets[setIndex] || {} : {}
  const target = objectOf(entry.target || entry)
  const isResult = isAmrapResult(entry, setIndex)
  return timerDurationFor({
    ...target,
    sec: set.sec ?? target.sec ?? 45,
    kind: isResult ? target.kind : 'fixed',
    amrapMaxSec: isResult ? target.amrapMaxSec : null
  })
}

/** Return a completed final AMRAP result in the same phase/mode/target vocabulary as history. */
export function amrapResultFor(entry = {}) {
  if (!isAmrapEntry(entry) || !Array.isArray(entry.sets)) return null
  const index = entry.sets.findLastIndex(set => normalizePhase(set?.phase, 'work') === 'work')
  if (index < 0 || !isAmrapResult(entry, index)) return null
  const set = entry.sets[index]
  if (!set || set.done !== true) return null
  const target = entry.target || entry
  const mode = modeForSet(set, target)
  if (mode !== 'reps' && mode !== 'time') return null
  const actual = mode === 'time' ? positive(set.sec ?? set.seconds ?? set.actualSec, 0) : positive(set.r ?? set.reps ?? set.actualReps, 0)
  const targetValue = mode === 'time'
    ? positive(target.sec ?? target.seconds ?? target.durationSec, null)
    : amrapMinRepsFor(target, target.reps)
  return { index, phase: 'work', mode, actual, target: targetValue, amrapMinReps: mode === 'reps' ? targetValue : null }
}

/** A fixed timer ends at its target; a timed AMRAP may use an explicit duration limit. */
export function timerDurationFor(target = {}) {
  const sec = positiveInt(target.sec, 0)
  const kind = normalizeTargetKind(target.kind ?? target.targetKind, 'fixed')
  const maxSec = positiveInt(target.amrapMaxSec, 0)
  return Math.max(1, kind === 'amrap' && maxSec > 0 ? Math.max(sec, maxSec) : sec)
}

export function hasWorkRows(entry = {}) {
  return Array.isArray(entry.sets) && entry.sets.some(set => normalizePhase(set?.phase, 'work') === 'work')
}

/** Completed-state-independent work rows whose authoritative mode matches the requested mode. */
export function workRowsForMode(entry = {}, mode = 'reps') {
  const source = objectOf(entry)
  const target = objectOf(source.target || source)
  const expectedMode = normalizeMode(mode, 'reps')
  return (Array.isArray(source.sets) ? source.sets : [])
    .filter(set => normalizePhase(set?.phase, 'work') === 'work' && modeForSet(set, target) === expectedMode)
}

// Heaviest weight lifted to the FULL target in this entry: done work sets that hit
// their goal (reps >= target reps, or time held >= target sec) count. A set where the
// last few reps were missed does not set the default weight. Falls back to all done
// sets when nothing hit the full target, so there is still a sensible default.
export function bestFullSetWeight(entry = {}, target = null) {
  const rows = workRowsForMode(entry, 'reps').filter(s => s.done)
  if (!rows.length) return 0
  const t = objectOf(target || entry?.target || entry)
  const goal = t.reps > 0 ? t.reps : 0
  const full = goal > 0 ? rows.filter(s => (s.r || 0) >= goal) : []
  const pool = full.length ? full : rows
  return Math.max(0, ...pool.map(s => s.w || 0))
}

export function shouldConfirmWorkingWeight(entry = {}, _mode = null) {
  // The row mode is authoritative. A mixed entry may open this sheet because it contains a
  // reps work row, but a timed-only entry never does even when its target still says `reps`.
  return workRowsForMode(entry, 'reps').length > 0
}

/** Guard asynchronous timer callbacks against finish, discard, navigation, and deletion. */
export function canApplyTimedResult(active, workoutId, entryIdx, setIdx) {
  if (!active || active.id !== workoutId || !Array.isArray(active.entries)) return false
  const entry = active.entries[entryIdx]
  const set = entry && Array.isArray(entry.sets) ? entry.sets[setIdx] : null
  return !!set && set.done !== true
}

/** Remove a set, or remove the exercise when it was the last remaining set. */
export function removeActiveSet(active, entryIdx, setIdx, stopTimersForRemoval = () => {}) {
  if (!active || !Array.isArray(active.entries)) return { removed: false, removedExercise: false }
  const entry = active.entries[entryIdx]
  if (!entry || !Array.isArray(entry.sets) || !entry.sets[setIdx]) return { removed: false, removedExercise: false }
  stopTimersForRemoval()
  if (entry.sets.length === 1) {
    active.entries.splice(entryIdx, 1)
    active.cur = Math.min(Math.max(0, Number(active.cur) || 0), Math.max(0, active.entries.length - 1))
    return { removed: true, removedExercise: true }
  }
  entry.sets.splice(setIdx, 1)
  return { removed: true, removedExercise: false }
}

/** Stop asynchronous timer work before changing the active exercise cursor. */
export function navigateActiveExercise(active, nextCur, stopTimers = () => {}) {
  const next = Number(nextCur)
  if (!active || !Array.isArray(active.entries) || !Number.isInteger(next)
    || next < 0 || next >= active.entries.length) return false
  stopTimers()
  active.cur = next
  return true
}
