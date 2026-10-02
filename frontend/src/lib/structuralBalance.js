import { estimate1RM, FORMULAS, DEFAULT_FORMULA } from './onerm.js'
import { LB_TO_KG } from './recovery.js'
import { isBw } from './history.js'
import { EXIDX, isAssisted } from './exercises.js'
import { isSideSet, isWarmupRow } from './workout-model.js'
import { BALANCE_STATUSES, BORDERLINE_BAND_PCT, EVALUATION_MODES } from './structuralBalanceTemplates.js'

const kgOf = (n, unit) => (unit === 'lb' ? Number(n) * LB_TO_KG : Number(n))

// Mirrors the Stats.jsx `MuscleBalance` bodyweight read exactly (sort by date string, `.at(-1)`,
// convert lb -> kg) rather than the unsorted-assuming `lastBW()` in history.js.
export function bodyweightKgOf(S) {
  const entries = S.bodyweight || []
  if (!entries.length) return null
  const last = entries.slice().sort((a, b) => String(a.d).localeCompare(String(b.d))).at(-1)
  if (!last || !(last.w > 0)) return null
  return kgOf(last.w, S.unit)
}

// An assistance machine (exercises.js isAssisted, issue #232), read the way onerm.js and
// history.js read a logged entry — by the exercise, so the same machine counts the same way on
// every screen.
const isAssistedEntry = entry => isAssisted(entry?.id ? { id: entry.id } : entry)

// The catalogue's belt-and-vest variants of the hanging and supported movements ("weighted
// pull-up", "weighted straight bar dip"): 'weighted' equipment rather than body weight, so
// isBw() reads them as ordinary load, yet what is logged is the plate on the belt — the same
// added weight a bodyweight entry holds. Poliquin's supine pull-up role lists one (0841); read
// as the belt alone, +20 kg for 5 would score a 23 kg pull-up. Bench dips and push-ups keep the
// feet down and stay out, as does everything else on 'weighted' (a plate held for a crunch).
const LIFTER_MOVEMENT = /\b(pull[- ]?ups?|chin[- ]?ups?|muscle[- ]?ups?|dips?)\b/i
// Bench dips whose name does not say so: "weighted tricep dips" (1755) is done seated off the
// edge of a bench, legs out in front, by its own instructions.
const BENCH_DIP_IDS = new Set(['1755'])
const beltOnLifter = id => {
  const ex = EXIDX[id]
  return ex?.eq === 'weighted' && LIFTER_MOVEMENT.test(ex.n) && !/\bbench/i.test(ex.n) && !BENCH_DIP_IDS.has(id)
}

// What one completed set actually moved, in kg. On a bodyweight-configured entry `w` holds only
// what was *added* (history.js: "`w` means *added* weight"), so the lifter's own mass has to be
// added back: a chin-up with +10 kg is not a 10 kg lift, and Poliquin's dip/pull-up ratios are
// against bodyweight + load. The weigh-in stamped on that session is the honest figure for an
// old workout, with the profile's latest as the fallback; with neither, the set is left unscored
// rather than scored against an invented body mass.
//
// On an assistance machine `w` is the help the stack gave, so it comes off the lifter's mass
// instead: 20 kg of help at 80 kg is a 60 kg pull-up. Counting it as load — or adding it to the
// body when the entry is flagged bodyweight — would score more help as a stronger lift. A 0
// there is a row with no help entered, not a set done without any (history.js), and help at or
// above body mass moved nothing: both are left unscored.
const onLifter = entry => {
  const bodyweight = entry.target?.bodyweight ?? entry.bodyweight
  return bodyweight == null ? isBw({ id: entry.id }) || beltOnLifter(entry.id) : !!bodyweight
}

function setLoadKg(S, workout, entry, set, bodyweightKg) {
  const logged = kgOf(set.w || 0, S.unit)
  const stamped = workout?.bw > 0 ? kgOf(workout.bw, S.unit) : null
  const body = stamped ?? bodyweightKg
  if (isAssistedEntry(entry)) {
    if (!(logged > 0) || !(body > 0)) return null
    return body - logged > 0 ? body - logged : null
  }
  if (!onLifter(entry)) return logged
  return body > 0 ? body + logged : null
}

// Whether a role reads "No data" only for want of a weigh-in, with sets logged: a body-weight
// standard with a lift to hold against it, or a lift on the lifter (a dip, a pull-up, an
// assistance machine with its help entered) from sessions that carry no weigh-in of their own.
// The screen says so, rather than a bare "No data" next to sets the user can see they logged.
function waitsOnBodyweight(S, role, exerciseIds, current, bodyweightKg) {
  if (bodyweightKg > 0 || role.evaluationMode === EVALUATION_MODES.REP_COUNT) return false
  if (current) return role.evaluationMode === EVALUATION_MODES.BODYWEIGHT_RATIO
  return (S.workouts || []).some(workout => !(workout?.bw > 0) && (workout.entries || []).some(entry =>
    exerciseIds.includes(entry.id) && (isAssistedEntry(entry) || onLifter(entry)) &&
    (entry.sets || []).some(set => set.done && !isWarmupRow(set) && (!isAssistedEntry(entry) || kgOf(set.w || 0, S.unit) > 0))))
}

// The lifts one logged row stands for, each as the { w, r } it is read from. A unilateral row's
// `r` is the both-sides total and its `w` the heavier side (workout-model.js), so it is read as
// its two sides instead, the better one counting — as bestRepsOf() does below and progression.js
// halves the total for: 20 kg for 6 a leg is 20 kg for 6, not for 12, which would overstate it,
// and a 15-a-leg step-up would read as 30 reps and fall outside every estimate.
const liftsOf = set => (isSideSet(set) ? [set.sides.L, set.sides.R] : [set])

// Epley run the other way: the load a one-rep max shows for `reps` reps.
export const loadForReps = (oneRmKg, reps) => (reps > 1 ? oneRmKg / (1 + reps / 30) : oneRmKg)

// ATG's figures are a load for a number of reps ("Romanian deadlift: body weight for 12"), not a
// one-rep max, so a lift is read as the load it shows for that many. A set of at least that many
// reps proves its own load; a shorter one is carried over with Epley, the formula estimate1RM()
// estimates with, up to the 1RM and back down (a single is its own 1RM, as it is there). Neither
// goes through estimate1RM(): its rep cap guards a 1RM claim, not a 15-rep standard read from a
// 15-rep set, and its 0.1 kg rounding put a set of exactly body weight for 12 a hair under body
// weight — Borderline, next to "100% / 100%" — about half the time.
export function loadAtReps(loadKg, setReps, reps) {
  const w = Number(loadKg)
  const r = Math.round(Number(setReps))
  if (!isFinite(w) || w <= 0 || !(r >= 1)) return null
  if (r >= reps) return w
  return loadForReps(r === 1 ? w : FORMULAS.epley(w, r), reps)
}

// estimate1RM()'s estimate without its 0.1 kg rounding. A load table only ever divides one
// estimate by another, and two rounded ones of loads exactly at its ratio land either side of it:
// a 100 kg squat and a 125 kg deadlift, both for 5, read 124.94% of Poliquin's 125% — Borderline,
// next to "125% / 125%". Its guards, the rep cap among them, still decide what is an estimate.
function unrounded1RM(loadKg, reps) {
  if (estimate1RM(loadKg, reps) === null) return null
  const w = Number(loadKg)
  const r = Number(reps)
  return r === 1 ? w : FORMULAS[DEFAULT_FORMULA](w, Math.round(r))
}

// Best reading across a whitelist of exercise ids, in kg: the estimated 1RM (`estKg`), or with
// `reps` the load for that many reps (`repsKg`, loadAtReps). Scans the log directly instead of
// calling onerm.js's best1RM(), which reads `s.w` raw and so cannot see the body mass a dip or a
// pull-up moves, nor a unilateral row's sides; the 1RM itself still comes from the shared
// estimate1RM()'s formula and rep cap.
export function resolveCurrent(S, exerciseIds, bodyweightKg, reps = null) {
  const key = reps > 1 ? 'repsKg' : 'estKg'
  let best = null
  for (const exId of exerciseIds) {
    for (const workout of S.workouts || []) {
      const entry = (workout.entries || []).find(e => e.id === exId)
      if (!entry) continue
      for (const set of entry.sets || []) {
        if (!set.done || isWarmupRow(set)) continue
        for (const lift of liftsOf(set)) {
          const loadKg = setLoadKg(S, workout, entry, lift, bodyweightKg)
          if (loadKg === null) continue
          const kg = reps > 1 ? loadAtReps(loadKg, lift.r, reps) : unrounded1RM(loadKg, lift.r)
          if (kg === null) continue
          if (!best || kg > best[key]) {
            best = { [key]: kg, w: Number(lift.w) || 0, r: Math.round(Number(lift.r)), d: workout.d, t: workout.start, exId }
          }
        }
      }
    }
  }
  return best
}

// Best completed-set rep count across a whitelist, ignoring load entirely. `best1RM()` requires
// weight > 0 (a rep with no load isn't an estimate of anything), which makes it unusable for
// rep-count roles that are meant to be scored at pure bodyweight (pull-ups, dips, Nordic curl —
// no added-weight expected at all): a lifelong-bodyweight pull-up set would otherwise always
// read as 'no-data'. This mirrors onerm.js's bestSetOf()'s done/warmup filtering but drops the
// weight requirement, since reps — not an estimated 1RM — is the whole signal here.
function bestRepsOf(entry) {
  let best = null
  for (const set of entry?.sets || []) {
    if (!set.done || isWarmupRow(set)) continue
    // A unilateral row's `r` is the both-sides total (workout-model.js), but a rep target like
    // "10 pull-ups" is per limb, so the better side is what it should be read against.
    const reps = Math.round(isSideSet(set)
      ? Math.max(Number(set.sides.L?.r) || 0, Number(set.sides.R?.r) || 0)
      : Number(set.r))
    if (!isFinite(reps) || reps < 1) continue
    if (!best || reps > best.r) best = { r: reps, w: Number(set.w) || 0 }
  }
  return best
}

// A rep target is reps at body weight: reps the machine helped with are not those reps, so an
// assistance machine a role was pointed at reads as no data here rather than as a pass.
export function resolveCurrentReps(S, exerciseIds) {
  let best = null
  for (const exId of exerciseIds) {
    for (const workout of S.workouts || []) {
      const entry = (workout.entries || []).find(e => e.id === exId)
      const found = entry && !isAssistedEntry(entry) && bestRepsOf(entry)
      if (found && (!best || found.r > best.r)) best = { ...found, d: workout.d, t: workout.start, exId }
    }
  }
  return best
}

// Female target when the source table gives a distinct same-exercise figure, else the
// male/default one.
export function targetFor(role, S) {
  const female = S.body === 'female'
  if (role.evaluationMode === EVALUATION_MODES.REP_COUNT) {
    return female && role.repsTargetFemale != null ? role.repsTargetFemale : role.repsTarget
  }
  return female && role.targetPctFemale != null ? role.targetPctFemale : role.targetPct
}

export function overrideKey(template, role) {
  return `${template.id}:${role.id}`
}

// One role's override as S.balanceOverrides stores it: `{ id, _ts }`, the chosen exercise and
// when it was chosen, with `id: null` once the role is back on its default. The clear is kept
// as a stamped entry rather than deleted so it can win a sync against the other device's older
// choice (lib/sync-merge.js keeps whichever side set a role last). A bare id string is how the
// first builds of this screen stored it, and still reads as that exercise.
export function overrideIdOf(value) {
  if (typeof value === 'string') return value || null
  return value && typeof value.id === 'string' && value.id ? value.id : null
}

// `overrides` with the role under `key` set to `exId`, or back on its default for null.
export function withOverride(overrides, key, exId, now = Date.now()) {
  return { ...(overrides || {}), [key]: { id: exId || null, _ts: now } }
}

// A choice of the role's own default exercise is the default: not "Custom", and read across the
// whole whitelist like the default is, rather than narrowed to that one exercise.
const overrideFor = (S, template, role) => {
  const id = overrideIdOf(S.balanceOverrides?.[overrideKey(template, role)])
  return id && id !== role.exerciseIds[0] ? id : null
}

// The exercise ids to resolve "current" from: the user's chosen override if one exists for this
// role, otherwise the role's curated whitelist.
export function exerciseIdsFor(S, template, role) {
  const override = overrideFor(S, template, role)
  return override ? [override] : role.exerciseIds
}

// Actual percentage a role's current reading represents, given its evaluation mode. Returns
// null when it can't be scored yet (anchor has no reading of its own, or bodyweight unknown).
export function ratioFor(role, current, ctx) {
  if (role.evaluationMode === EVALUATION_MODES.LOAD_RATIO) {
    if (!ctx.anchorCurrent || !(ctx.anchorCurrent.estKg > 0)) return null
    return (current.estKg / ctx.anchorCurrent.estKg) * 100
  }
  if (role.evaluationMode === EVALUATION_MODES.BODYWEIGHT_RATIO) {
    if (!(ctx.bodyweightKg > 0)) return null
    // A role with reps was resolved as the load for them (resolveCurrent), one without as a 1RM.
    const kg = role.reps > 1 ? current.repsKg : current.estKg
    return kg > 0 ? (kg / ctx.bodyweightKg) * 100 : null
  }
  // rep-count: the best completed-set rep count (resolveCurrentReps), as a percentage of the
  // target rep count.
  return (current.r / ctx.targetPct) * 100
}

// A reading taken from loads exactly at a ratio can still come out a floating-point hair under
// it (a lb load and a lb body weight both converted to kg, one divided by the other), so one
// within this many points of an edge counts as reaching it.
const EDGE_TOLERANCE_PCT = 1e-9

export function classify(actualPct, targetPct) {
  if (actualPct === null || actualPct === undefined || !isFinite(actualPct)) return BALANCE_STATUSES.NO_DATA
  if (actualPct >= targetPct - EDGE_TOLERANCE_PCT) return BALANCE_STATUSES.BALANCED
  if (actualPct >= targetPct - BORDERLINE_BAND_PCT - EDGE_TOLERANCE_PCT) return BALANCE_STATUSES.BORDERLINE
  return BALANCE_STATUSES.WEAK
}

function evaluateRole(template, role, currentByRoleId, bodyweightKg, S) {
  const current = currentByRoleId.get(role.id)
  // For load-ratio/bodyweight-ratio, `targetPct` is a percentage — the same scale classify()
  // compares actualPct against. For rep-count it's a raw rep count (used as ratioFor()'s
  // denominator), so classify() must compare against 100 instead — actualPct is already
  // normalized to "% of the rep target" by the time it gets there.
  const targetPct = targetFor(role, S)
  const classifyTarget = role.evaluationMode === EVALUATION_MODES.REP_COUNT ? 100 : targetPct
  const override = overrideFor(S, template, role)
  // Which exercise this role is set to, whether or not it has ever been logged — the view needs
  // it to name the role's exercise (and to show an override back to the user who chose it).
  const configuredExerciseId = override || role.exerciseIds[0] || null
  const base = { roleId: role.id, configuredExerciseId, targetPct, isOverridden: Boolean(override) }
  const needsBodyweight = waitsOnBodyweight(S, role, exerciseIdsFor(S, template, role), current, bodyweightKg)
  if (!current) {
    return { ...base, mappedExerciseId: null, current: null, actualPct: null, status: BALANCE_STATUSES.NO_DATA, needsBodyweight, needsAnchor: false }
  }
  // An anchor role (no anchorRoleId) is compared against itself — always 100% when it has data.
  const anchorCurrent = role.anchorRoleId ? currentByRoleId.get(role.anchorRoleId) : current
  const actualPct = ratioFor(role, current, { anchorCurrent, bodyweightKg, targetPct })
  // Logged, but nothing to hold it against: the anchor never was. Still no score, but the view
  // must not say there is no data for a lift with months of sets — it says what is missing.
  const needsAnchor = !!role.anchorRoleId && role.evaluationMode === EVALUATION_MODES.LOAD_RATIO && !(anchorCurrent?.estKg > 0)
  return { ...base, mappedExerciseId: current.exId, current, actualPct, status: classify(actualPct, classifyTarget), needsBodyweight, needsAnchor }
}

// Pure ratio-computation engine entry point.
export function computeBalance(S, template) {
  const bodyweightKg = bodyweightKgOf(S)
  const currentByRoleId = new Map(
    template.roles.map(role => {
      const ids = exerciseIdsFor(S, template, role)
      const current = role.evaluationMode === EVALUATION_MODES.REP_COUNT
        ? resolveCurrentReps(S, ids)
        : resolveCurrent(S, ids, bodyweightKg, role.evaluationMode === EVALUATION_MODES.BODYWEIGHT_RATIO ? role.reps : null)
      return [role.id, current]
    })
  )
  return template.roles.map(role => evaluateRole(template, role, currentByRoleId, bodyweightKg, S))
}
