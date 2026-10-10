// Pure helpers over the state object S (ported 1:1 from the vanilla app).
import { syncSupersetMeta } from './superset-meta.js'
import { todayISO, isoOf, weekKey, weekStartOf, fmtNum } from './format.js'
import { legacyEntriesOf } from './prescription/index.js'
import { rowsOfPerformance } from './session-ui-adapter.js'
import { fmtSpeed } from './speed.js'
import { hasIncline, inclineFrom } from './incline.js'
import { isCardio, isBodyweightEq, isAssisted, betterWeight } from './exercises.js'
import { barWeightFor } from './bar.js'
import { phaseForSet, modeForSet, modeForEntry, isWarmupRow, isFailureSet, isDropSet, isRestPauseSet, normalizeMode, completedVolumeOf, hasCompletedWork, nextDropWeight, splitBurstReps, makeSideSet, isSideSet, syncSideAggregate, WEIGHT_ORIGIN_MANUAL, dropsOf, clustersOf } from './workout-model.js'
import { backoffAt, backoffStepOf, backoffWeights } from './backoff.js'
import { dbLoadOf, bellsIn, volumeFactor, historyAs, ownedFloor } from './dumbbells.js'
const objectOf = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {}
// Completed-state-independent work rows whose authoritative mode matches the requested mode.
const workRowsForMode = (entry = {}, mode = 'reps') => {
  const source = objectOf(entry)
  const target = objectOf(source.target || source)
  const expectedMode = normalizeMode(mode, 'reps')
  return (Array.isArray(source.sets) ? source.sets : [])
    .filter(set => phaseForSet(set) === 'work' && modeForSet(set, target) === expectedMode)
}
// i18n-core, not i18n: this file is imported by mcp/, which is plain Node with no Vite and no
// React. i18n.js is the Vite half — import.meta.glob over the locale packs, useSyncExternalStore
// for the hook — and it re-exports this very `t` from core, so nothing changes here except what
// gets dragged along behind it.
import { t } from './i18n-core.js'
import { queueNext, pinState, queueLiveOn } from './queue.js'
import { isPyramid, pyramidLabel, pyramidTargetAt, pyramidWeightAt, PYRAMID_MAX } from './pyramid.js'

// When a workout happened, as epoch ms: its own recorded start, else noon on its calendar day.
// Noon rather than midnight because `new Date('2026-09-22')` parses as UTC midnight, which any
// negative UTC offset drags back into the day before; noon survives every zone and DST shift.
// Several copies of this rule had drifted apart — some onto UTC midnight, some onto `||`, which
// throws away a legitimate start of 0 — and readers that feed the strength/recovery decay off it
// dated start-less history up to 14 h out, in a direction set by the reader's timezone. NaN when
// the workout carries neither a start nor a usable day.
export const workoutAt = w => {
  if (Number.isFinite(w?.start)) return w.start
  const day = w?.d
  return typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day)
    ? new Date(day + 'T12:00:00').getTime()
    : NaN
}

/** Total load × repetitions of the non-skipped rows, drop and rest-pause segments counted once. */
export function volumeOf(performance) {
  const rowVolume = row => {
    const reps = row?.observations?.find(o => o.metric === 'repetitions')?.value
    const load = row?.resistance?.kind === 'external-load' ? row.resistance.value : 0
    return reps != null && load ? reps * load : 0
  }
  let total = 0
  for (const row of performance?.sets || []) {
    if (row.status === 'skipped') continue
    total += rowVolume(row)
    for (const seg of row.segments || []) total += rowVolume(seg)
  }
  return total
}

// How an exercise is logged (issue #16). This used to be derived from the body part alone,
// which meant a plank or a farmer's carry could only be timed by filing it under cardio.
// A routine entry can now say so explicitly:
//   reps   — weight × reps      sets look like { w, r }
//   time   — a work duration    sets look like { sec, w }   (w = 0 for bodyweight)
//   cardio — duration + speed   sets look like { min, speed }
// An entry without `mode` behaves exactly as before, so every existing plan, workout and
// plan file is read unchanged and nothing needs migrating.
export function modeOf(cfg) {
  const m = cfg && cfg.mode
  if (m === 'reps' || m === 'time' || m === 'cardio') return m
  return isCardio(cfg && (cfg.id || cfg.exerciseId)) ? 'cardio' : 'reps'
}
export const isTimed = cfg => modeOf(cfg) === 'time'

// Two flags that ride on top of a mode rather than making new ones (issues #31/#32), because
// "bodyweight" and "per side" are true of a rep set and of a timed hold alike:
//   bodyweight — the exercise carries no load of its own, so `w` means *added* weight and is
//                asked for only once you say there is some. Seeded from the equipment field.
//                Spelled out rather than `bw`, which a workout already uses for the weigh-in
//                it was logged at — two different things one letter apart is a bug waiting.
//   side       — the exercise is unilateral. You still log what you did: 16, the total across
//                both sides. The split is derived for planning ("8 per side"), never entered
//                — a number that sometimes means one side and sometimes both is the thing
//                that made this ambiguous in the first place, and one rep count that always
//                means the same thing beats two that need a legend.
// Both are absent on every plan, workout and backup written before they existed, and absent
// reads as false, so nothing needs migrating.
export const isBw = cfg => (cfg && cfg.bodyweight != null ? !!cfg.bodyweight : isBodyweightEq(cfg && cfg.id))
export const isPerSide = cfg => !!(cfg && cfg.side)
// What one side did, for display only. Half of an odd total is shown as it falls (8.5) rather
// than rounded away: it means the sides were not even, which is worth seeing.
export const sideReps = reps => (reps || 0) / 2
// Unilateral work moves in pairs, so its rep target steps by two — 16, 18, 20 — and a total
// that stayed odd would put a rep on one side and not the other.
export const repStep = cfg => (isPerSide(cfg) ? 2 : 1)
// How many planned sets a count of logged work rows stands for: the inverse of buildSets, which
// lays a per-side timed hold out as one left and one right row per set. Without it a copy of
// such a session (Repeat today, Save as routine) read 2 sets as 4 and buildSets doubled them
// again. A pair with only one side logged still counts as its set.
export const setsFromRows = (cfg, rows) => {
  const n = Math.max(0, Number(rows) || 0)
  return modeOf(cfg) === 'time' && isPerSide(cfg) ? Math.ceil(n / 2) : n
}

// mm:ss for a work duration — seconds alone read badly past a minute ("90 s" vs "1:30").
export function fmtSec(sec) {
  const n = Math.max(0, Math.round(Number(sec) || 0))
  return Math.floor(n / 60) + ':' + String(n % 60).padStart(2, '0')
}

// How hard a set felt, if the profile logs it at all. Two scales for the same thing, kept in
// their own fields: RIR counts the reps still in the tank, RPE reads the same effort off a
// 10-point scale from the top (RPE 8 ≈ RIR 2). A set logged on one scale is never silently
// rewritten as the other — switching the setting changes what new sets ask for, nothing else.
// `min`..`max` is the range the stepper walks. RIR bottoms out at 0 (a set taken to failure);
// RPE bottoms out at 6, since the scale is only meaningful for working sets and anything
// lighter is a warm-up nobody rates.
export const EFFORT = {
  rir: { f: 'rir', hd: 'RIR', step: 0.5, min: 0, max: 10 },
  rpe: { f: 'rpe', hd: 'RPE', step: 0.5, min: 6, max: 10 }
}
// One tap of an effort stepper. Empty is not 0 — an unlogged effort must not become "went to
// failure" from one stray tap — so − on an empty cell leaves it empty, and + starts at the
// bottom of the scale and walks up from there in even steps. Stepping back off the bottom
// clears the cell again, so a mistap is undoable. null means "nothing logged"; the caller
// stores that by dropping the key rather than writing a null.
export function stepEffort(kind, cur, dir) {
  const e = EFFORT[kind]
  if (!e) return cur ?? null
  if (cur == null) return dir < 0 ? null : e.min
  const n = Math.round((cur + dir * e.step) * 100) / 100
  if (dir < 0 && n < e.min) return null
  // only the ceiling is enforced on the way up: a value typed below the floor (nothing stops
  // someone entering RPE 3) still steps in even increments instead of snapping to the floor.
  return dir > 0 ? Math.min(e.max, n) : Math.max(e.min, n)
}
// A typed effort is capped but not floored — clamping up while someone types "10" would turn
// the first keystroke into the floor and fight the input.
export const capEffort = (kind, v) =>
  (v == null || !EFFORT[kind] ? v : Math.min(EFFORT[kind].max, v))
// Which scale a profile logs. `showRir` is the boolean this replaced and is only consulted
// when the profile has no answer of its own — an explicit 'none' has to win over it, or a
// backup or another device that still carries the old flag would switch the column back on.
export const effortOf = S => {
  const e = S && S.effort
  return e === 'none' || EFFORT[e] ? e : (S && S.showRir ? 'rir' : 'none')
}
// The "(RIR 2)" / "(RPE 8)" tail on a set summary, empty when nothing was logged.
const effortTail = s => {
  const k = s.rir != null ? 'rir' : s.rpe != null ? 'rpe' : null
  return k ? ` (${EFFORT[k].hd} ${fmtNum(s[k])})` : ''
}

// One-line summary of a logged set. `cfg` carries the mode when the caller has it (a routine
// entry or a workout entry); passing an id alone keeps the old body-part behaviour.
// `speedUnit` is the profile's (lib/speed.js speedUnitOf); without one a cardio set reads km/h.
const EXPLICIT_MODES = new Set(['reps', 'time', 'cardio'])
export function setLabel(id, s, cfg, speedUnit) {
  // The id is the caller's when the config does not carry one: a freestyle target is built
  // without it, and modeOf would then fall back to 'reps' and print a run as "0×0".
  const c = cfg ? { ...cfg, id: cfg.id ?? id } : { id }
  let mode = modeOf(c)
  // A set saved by an older build carries no target with it; the set's own fields still say what
  // it was — seconds for a timed set, minutes for cardio — so those are not read back as "0 reps".
  if (!cfg && !(s.r > 0)) { if (s.min > 0 || s.speed > 0) mode = 'cardio'; else if (s.sec > 0) mode = 'time' }
  // A target with no mode of its own takes it from the exercise, and an exercise can change: a
  // custom one moved to Cardio after months of rep sets read them all as "0 min @ 0 km/h", next
  // to the volume those same sets still count. A set with reps and nothing cardio was a rep set.
  if (!EXPLICIT_MODES.has(cfg?.mode) && mode !== 'reps' && s.r > 0 && !(s.min > 0 || s.speed > 0 || s.sec > 0)) mode = 'reps'
  // A treadmill grade rides along when the set has one (lib/incline.js); a flat set reads as it did.
  if (mode === 'cardio') return `${s.min || 0} min @ ${fmtSpeed(s.speed || 0, speedUnit)}` + (hasIncline(s) ? ' · ' + t('{0}% incline', fmtNum(Number(s.incline))) : '')
  // A set taken to failure carries its "F" behind the numbers, the mark lifting logs use for it;
  // the history, the text export and the set menu all read it from here.
  const fail = isFailureSet(s) ? ' ' + t('F') : ''
  if (mode === 'time') return fmtSec(s.sec) + (s.w > 0 ? ` · ${fmtNum(s.w)}` : '') + fail
  const bw = isBw(c)
  // A dumbbell weight that says what it means (lib/dumbbells.js, issue #474) says it here too:
  // "20 each × 8" is one 20 in each hand, "40 total × 8" both together. Spaced like the "+10 × 12"
  // of added weight, since the number is no longer the whole load on its own. As entered, and a
  // one-arm exercise (one bell, so both meanings are the same number), read as they always did.
  const meaning = !bw && bellsIn(c) === 2 ? dbLoadOf(c.dbLoad) : null
  const load = (w, reps) => (bw ? (w > 0 ? `+${fmtNum(w)} × ` : '') + reps
    : meaning === 'each' ? `${t('{0} each', fmtNum(w || 0))} × ${reps}`
      : meaning === 'total' ? `${t('{0} total', fmtNum(w || 0))} × ${reps}`
        : `${fmtNum(w || 0)}×${reps}`)
  // A rest-pause set's reps read as its bursts, "60×10+4+2", the way the protocol is written
  // down. The row's own `r` is the total either way; a planned set's bursts already add up to it
  // (applyIntensifierPlan), while bursts added live sit on top of the activation set, which is
  // then whatever the total leaves over. Bursts that do not fit the total are not shown.
  // A planned set has no activation set in front of its bursts, so when its total was raised by
  // hand the leftover is not one: "60×2+6+3+2+1" read as a two-rep set nobody did. Which burst
  // the extra reps belong to is not known, so such a set reads as its plain total. The target
  // says whether the exercise plans rest-pause; a row added to it and given bursts live can only
  // be told apart by that, and reads as its plain total too, which is still what was lifted.
  const planned = c.intensifier?.type === 'restpause'
  const repsOf = side => {
    const reps = side.r || 0
    const bursts = clustersOf(side).map(b => Number(b?.r) || 0).filter(r => r > 0)
    const sum = bursts.reduce((a, b) => a + b, 0)
    if (!bursts.length || sum > reps || (planned && sum !== reps)) return reps
    return (reps > sum ? [reps - sum, ...bursts] : bursts).join('+')
  }
  // One side's "weight×reps" (or bodyweight "reps" / "+belt × reps"), the same shape a whole
  // straight set reads as — reused for each side of a unilateral set below. A drop-set's drops
  // follow it ("100×8 ↘ 80×6"): the volume of the workout counts them, so the list has to show
  // them, or the total includes weight nobody can see where it came from.
  const oneSide = side => {
    const drops = dropsOf(side).filter(d => (Number(d?.r) || 0) > 0)
    return load(side.w, repsOf(side)) + drops.map(d => ' ↘ ' + load(Number(d.w) || 0, Number(d.r))).join('')
  }
  // A unilateral set logged per side (issue #60) reads "L 15×8 · R 15×7" — the asymmetry is the
  // whole point, so both sides are shown rather than a single combined total.
  if (isSideSet(s)) {
    const partial = s.sides.L.done !== s.sides.R.done
    return ['L', 'R'].map(key => {
      const side = s.sides[key]
      return `${t(key)} ${partial && !side.done ? '–' : oneSide(side) + effortTail(side)}`
    }).join(' · ') + fail
  }
  // Bodyweight reads as what you did — "12", or "+10 × 12" once there is a belt involved —
  // rather than "0×12", which says a set was performed with no weight and means nothing.
  return oneSide(s) + fail + effortTail(s)
}
// Default config for a freshly added exercise.
export function defaultConfig(id, mode) {
  const m = mode || modeOf({ id })
  if (m === 'cardio') return { sets: 1, min: 20, speed: 8 }
  // Written only when it is true, so a barbell config is byte-for-byte what it was before
  // the flag existed and a plan file gains nothing it does not need.
  const bw = isBodyweightEq(id) ? { bodyweight: true } : {}
  if (m === 'time') return { sets: 3, sec: 45, weight: 0, mode: 'time', ...bw }
  return { sets: 3, reps: 10, weight: 0, mode: 'reps', ...bw }
}
// A double-progression range is stored as its top (`reps`) and its bottom (`repsMin`), and
// reads as the range it is: "8–12". Printing the top alone made "Reps from 10, up to 15" read
// as "2 × 15" in the plan and then open at 10. `fmt` formats each bound (a per-side split).
const hasRange = cfg => cfg.repsMin > 0 && cfg.repsMin < cfg.reps
const repsOf = (cfg, fmt = v => String(v)) => (hasRange(cfg) ? `${fmt(cfg.repsMin)}–${fmt(cfg.reps)}` : fmt(cfg.reps))

/** "2 × 10", "3 × 8–12", "2 × 0:45": what a plan asks for per set, without its load. */
export function setsRepsOf(cfg) {
  const mode = modeOf(cfg)
  const n = cfg.sets || 1
  if (mode === 'cardio') return `${n} × ${cfg.min || 20} min`
  if (mode === 'time') return `${n} × ${fmtSec(cfg.sec || 45)}`
  if (isPyramid(cfg)) return pyramidLabel(cfg.pyramid)
  // Triple progression's set range reads as a range too: "3–5 × 8–12".
  const sets = cfg.setsMax > n ? `${n}–${cfg.setsMax}` : n
  return `${sets} × ${repsOf(cfg)}`
}

// One-line summary of a planned exercise ("3 × 10 · 60 kg"), shared by the routine editor
// and the plan export so a mode is described the same way everywhere. `speedUnit` as setLabel.
export function exLine(cfg, unit, speedUnit) {
  const mode = modeOf(cfg)
  const n = cfg.sets || 1
  // Added weight reads as added: "+10 kg" on a dip belt, "60 kg" on a barbell.
  // Back-off sets read as the sequence they open at: "3 × 6 · 26 → 24 → 22 kg".
  const backoff = mode === 'reps' && cfg.weight > 0 ? backoffStepOf(cfg, unit) : 0
  const load = !cfg.weight ? ''
    : backoff ? ' · ' + (isBw(cfg) ? '+' : '') + backoffWeights(cfg.weight, n, backoff).map(fmtNum).join(' → ') + ' ' + unit
      : ' · ' + (isBw(cfg) ? '+' : '') + fmtNum(cfg.weight) + ' ' + unit
  if (mode === 'cardio') return `${n} × ${cfg.min || 20} min @ ${fmtSpeed(cfg.speed || 8, speedUnit)}`
  // A timed hold has no rep count to spell a split out of ("8/side" below) — "per side" says it
  // happens twice, once each side (buildWorkSets), rather than trying to divide a duration.
  if (mode === 'time') return `${setsRepsOf(cfg)}${load}${isPerSide(cfg) ? ' · ' + t('per side') : ''}`
  // This is the line with room for it, so the split is spelled out: "3 × 16 · 8/side".
  const split = isPerSide(cfg) ? ' · ' + t('{0}/side', repsOf(cfg, v => fmtNum(sideReps(v)))) : ''
  return `${setsRepsOf(cfg)}${load}${split}`
}

// Drop superset ids that no longer have an adjacent partner (after unlink/reorder/remove).
export function cleanupSg(ex) {
  ex.forEach((e, i) => {
    if (e.sg && !(ex[i - 1]?.sg === e.sg || ex[i + 1]?.sg === e.sg)) delete e.sg
  })
  // A superset's name and rest (#292) follow its members in and out of the group.
  syncSupersetMeta(ex)
}

// Return the contiguous run around an entry that shares its superset id. A repeated id in a
// separated part of the list is deliberately not included: the display semantics are adjacent
// entries sharing one id, not every entry that happens to carry that id.
function contiguousSgGroup(items, idx) {
  const sg = items[idx]?.sg
  if (!sg) return [idx]
  let first = idx
  let last = idx
  while (first > 0 && items[first - 1]?.sg === sg) first--
  while (last + 1 < items.length && items[last + 1]?.sg === sg) last++
  return Array.from({ length: last - first + 1 }, (_, i) => first + i)
}

function freshSg(items, first, second) {
  const base = `sg-${Math.min(first, second)}-${Math.max(first, second)}`
  let sg = base
  let n = 2
  while (items.some(e => e.sg === sg)) sg = `${base}-${n++}`
  return sg
}

// Purely pair two adjacent entries. Existing contiguous groups on either side are merged, so
// pairing the end of one group with the start of another produces one display unit. A caller can
// provide a group id (useful when restoring a known id); otherwise an existing id is preferred,
// with a deterministic unused id for two previously ungrouped entries.
export function pairAdjacent(items, first, second, groupId) {
  if (!Array.isArray(items)) throw new TypeError('Superset entries must be an array')
  if (!Number.isInteger(first) || !Number.isInteger(second) || !items[first] || !items[second]) {
    throw new RangeError('Superset entry indexes are invalid')
  }
  if (Math.abs(first - second) !== 1) throw new RangeError('Superset entries must be adjacent')

  const next = items.map(e => ({ ...e }))
  const left = Math.min(first, second)
  const right = Math.max(first, second)
  const group = groupId || next[left].sg || next[right].sg || freshSg(next, left, right)
  const members = new Set([...contiguousSgGroup(next, left), ...contiguousSgGroup(next, right)])
  members.forEach(i => { next[i].sg = group })
  return next
}

// Remove one entry from its superset and clean any ids that no longer have an adjacent partner.
// This is pure so the active workout can replace its entries atomically through the store.
export function unpairSuperset(items, idx) {
  if (!Array.isArray(items)) throw new TypeError('Superset entries must be an array')
  if (!Number.isInteger(idx) || !items[idx]) throw new RangeError('Superset entry index is invalid')
  const next = items.map(e => ({ ...e }))
  delete next[idx].sg
  next.forEach((e, i) => {
    if (e.sg && !(next[i - 1]?.sg === e.sg || next[i + 1]?.sg === e.sg)) delete e.sg
  })
  return next
}

/**
 * Is this completed entry excluded from progression / session read-back?
 *
 * "Excluded" moved from a whole-workout flag to a per-entry one (ENG-11): a rehab routine
 * combined with real work excludes only its own exercises. A legacy workout carries the
 * whole-workout flag and no per-entry field, so every one of its entries reads as excluded.
 * `noProg` is frozen onto the entry from its source routine's `excludeFromProgression` at
 * build time — editing the routine flag later never rewrites a saved session.
 */
export function entryExcluded(w, entry) {
  return w?.excludeFromProgression === true || entry?.noProg === true
}

/**
 * The last counting session of an exercise: `{ d, sets, target, rid? }`, or null. Given a routine
 * id, that routine's own last session of it (issue #216): the same bench press in a heavy day and
 * a light day is two lines of progress. A routine that never trained the exercise falls back to
 * its last session anywhere, so a new or copied routine starts from what you actually lift.
 */
export function lastEntryFor(S, exId, rid) {
  if (rid) {
    const own = lastEntryIn(S, exId, rid)
    if (own) return own
  }
  return lastEntryIn(S, exId, null)
}

function lastEntryIn(S, exId, rid) {
  const workouts = S.workouts || []
  for (let i = workouts.length - 1; i >= 0; i--) {
    const w = workouts[i]
    const exposure = (w.exposures || []).find(x => x.exerciseId === exId && (!rid || x.routineId === rid))
    if (!exposure) continue
    // A session that does not count — a planned deload, or a rehab block merged into a real
    // session — is not "last time" for the next regular prescription: its reps and durations
    // must not seed the rows any more than its weight seeds the progression.
    if (exposure.excludedFromProgression) continue
    // Work sets only. Every caller asks the same question — "what did you actually lift last
    // time" — to seed the next session's rows, to size a freestyle config, and to print "Last
    // time" on the card. A warm-up answers none of them: seeding position 0 from a 50% ramp row
    // walks the working weight DOWN a little every session, and counting the ramp rows makes a
    // 3x5 come back as a 5-set exercise. Warm-ups are already excluded from volume, records and
    // progression; this is the same rule one level up.
    const done = rowsOfPerformance(exposure.performance?.sets, exposure.mode).filter(row => hasCompletedWork(row) && !isWarmupRow(row))
    // `target` is what the session prescribed; finished workouts carry it so labels and the
    // progression engine can read a session back the way it was logged. Older workouts have
    // none — modeOf() falls back to the body part for them, which is what they were.
    if (done.length) {
      const p = S.prescriptions?.[exposure.prescriptionId]
      // A cardio interval's target is minutes and speed, a hold's is seconds; an entry migrated from v1
      // that no prescription could hold keeps the target v1 recorded for it.
      const duration = p?.prefill.durationSeconds == null ? {}
        : exposure.mode === 'cardio' ? { min: p.prefill.durationSeconds / 60, ...(p.prefill.speed != null ? { speed: p.prefill.speed } : {}) }
          : { sec: p.prefill.durationSeconds }
      const target = p || !exposure.legacyTarget
        ? { mode: exposure.mode, sets: p?.rows.length || done.length, ...(p ? { reps: p.prefill.reps } : {}), ...duration, ...(p?.rows[0]?.load ? { weight: p.rows[0].load.value } : {}) }
        : { ...exposure.legacyTarget, ...(exposure.mode ? { mode: exposure.mode } : {}), sets: exposure.legacyTarget.sets || done.length }
      return { d: w.d, sets: done, target, ...(exposure.routineId ? { rid: exposure.routineId } : {}) }
    }
  }
  return null
}

/** How long any single note may get. Long enough for a paragraph, short enough to stay a note. */
export const NOTE_MAX = 500

/**
 * The most recent session note the user pinned for this exercise, or null.
 *
 * A note written mid-session is about that session — "shoulder twinged today". Some of them are
 * about the NEXT one instead: "go a notch narrower". The pin is how the user says which, at the
 * moment of writing, when they are the only one who knows. Pinned notes surface again the next
 * time the exercise comes up; unpinned ones stay in that day's history.
 *
 * Only the newest pinned note is returned: a pin is a message to your next self, and a stack of
 * them from six sessions ago is noise, not context.
 */
export function pinnedNoteFor(S, exId, editing = S?.active?.editingWorkoutId) {
  const workouts = S?.workouts || []
  // Editing a logged workout: its own pinned note is already in the editor, as that entry's
  // note, so it is not shown a second time as the note from last time. The key is the one
  // session-edit.js gives the editor (id, or day|start for a workout logged before ids). The
  // running session is not part of S, so a caller that has one passes its key.
  for (let i = workouts.length - 1; i >= 0; i--) {
    const w = workouts[i]
    if (editing != null && (w.id != null ? w.id : `${w.d}|${w.start}`) === editing) continue
    const exposure = (w.exposures || []).find(item => item.exerciseId === exId)
    // The finish keeps an exercise's note with what was logged (performance), as the migration does.
    const note = (exposure?.performance?.note || '').trim()
    if (note && exposure.performance.notePin) return { note, d: workouts[i].d }
  }
  return null
}

/** The standing note for an exercise — the one that is true every session. */
export const exNoteFor = (S, exId) => ((S?.exNotes || {})[exId] || '').trim() || null

// A freestyle exercise starts with the last target the user actually trained, rather than the
// generic config sheet defaults used when there is no history. Only the target shape and the
// number of rows are seeded here, so the config sheet and the rows agree.
export function freestyleConfig(S, cfg) {
  const last = lastEntryFor(S, cfg.id)
  if (!last) return { ...cfg }
  // What a dumbbell weight meant last time is that session's stamp, not a choice to copy: a
  // freestyle add follows the exercise's own setting as it is now (lib/dumbbells.js).
  const { dbLoad: _meant, ...lastTarget } = last.target || {}
  return {
    ...cfg,
    ...lastTarget,
    id: cfg.id,
    sets: Math.max(1, last.sets.length)
  }
}
export function bestWeightFor(S, exId, as) {
  // `as`: the meaning of a dumbbell weight to compare in (lib/dumbbells.js) — the session's own
  // when a set is judged as a record — so a past "40 total" is the 20 each it was. Without one,
  // every weight counts as logged, as it always did.
  const H = as ? historyAs(S, exId, as) : S
  // 0 means "nothing logged with a load yet" and must not win a min() for an assisted machine.
  let best = 0
  ;(H.workouts || []).forEach(w => (w.exposures || []).forEach(exposure => {
    if (exposure.exerciseId !== exId) return
    const weights = (exposure.performance?.sets || [])
      .filter(row => row.status === 'completed' && row.role !== 'warmup')
      .map(row => row.resistance?.kind === 'external-load' ? Number(row.resistance.value) : 0)
      .filter(weight => Number.isFinite(weight) && weight > 0)
    const entryBest = weights.reduce((current, weight) => current > 0 ? betterWeight(exId, current, weight) : weight, 0)
    if (entryBest > 0) best = best > 0 ? betterWeight(exId, best, entryBest) : entryBest
  }))
  return best
}
/**
 * The routines planned for a date, in merge order. Plural is the primary form now that a
 * weekday can hold several routines (`S.week[wd]` is `string[]`); the singular helpers below
 * are thin wrappers. `[]` — a stray empty array, or a key that is absent — all mean rest, so
 * "is this a rest day?" is `effectiveRoutineIds(S, iso).length === 0`.
 *
 * `S.dayPlan[iso]` stays scalar (a routine id, the `'rest'` sentinel, or undefined): the
 * per-date override and Start-time are single-pick. All array-tolerance is on `S.week`.
 *
 * A coach week (`S.queue`, lib/queue.js) has no weekdays: its sessions are done in order, and
 * the first undone one is today's session — so it goes in front of whatever the weekday
 * holds. The planner's own weekday pointers (a week applied before the queue existed) are
 * hidden behind it; routines you planned yourself ride along as a combined day. `today` is a
 * parameter so tests and the reminder builder can pin the clock; the override still wins.
 *
 * An override naming a queue session is a PIN (queue.js): the session is that day's, with the
 * weekday's own routines riding along as on any queue day, and the floating rule skips it on
 * other days. Once the session is done the pin is fulfilled and the day reads as if unpinned.
 */
export function effectiveRoutineIds(S, iso, today = todayISO()) {
  const ov = S.dayPlan[iso]
  if (ov === 'rest') return []
  const pin = pinState(S, ov)
  if (!pin && ov && S.routines.some(r => r.id === ov)) return [ov]
  const wd = new Date(iso + 'T12:00:00').getDay()
  const weekday = [].concat(S.week[wd] || []).filter(id => S.routines.some(r => r.id === id))
  const q = pin === 'open' ? ov : queueNext(S, iso, today)
  // The planner's weekday pointers stay hidden on the queue's day even when it has no session for
  // it (every remaining one pinned to another day): those sessions have their days.
  const own = q || queueLiveOn(S, iso, today) ? weekday.filter(id => !S.queue.ids.includes(id)) : weekday
  return q ? [q, ...own] : own
}
export function effectiveRoutines(S, iso) {
  return effectiveRoutineIds(S, iso).map(id => S.routines.find(r => r.id === id)).filter(Boolean)
}
export const effectiveRoutineId = (S, iso) => effectiveRoutineIds(S, iso)[0] ?? null
export const effectiveRoutine = (S, iso) => effectiveRoutines(S, iso)[0] ?? null

/**
 * The next day that actually has something to train, looking forward from `iso` (exclusive).
 *
 * Takes a date string rather than reading the clock so callers and tests agree on "today".
 * A routine with no exercises does not count: starting one lands you in an empty session, so
 * it is not an answer to "what is next" (the same guard TabBar applies before starting). On a
 * combined day, any one routine with exercises makes the day trainable.
 * Returns null when the whole week is rest.
 *
 * Return shape carries `routines` (the whole day) plus `routine` = `routines[0]` for the
 * "what's next" label.
 */
export function nextTrainingDay(S, iso) {
  for (let i = 1; i <= 7; i++) {
    const d = new Date(iso + 'T12:00:00')
    d.setDate(d.getDate() + i)
    const nextIso = isoOf(d)
    const routines = effectiveRoutines(S, nextIso)
    if (routines.some(r => (r.ex || []).length)) {
      return { iso: nextIso, weekday: d.getDay(), routines, routine: routines[0] }
    }
  }
  return null
}

/** Beyond this a "warm-up" is its own workout; the config stepper stops here too. */
export const MAX_PLANNED_WARMUPS = 5

/**
 * Stamp every work row with the exercise's planned intensifier and pre-fill its drops/clusters,
 * already computed and editable — the plan designs the set, not a button pressed mid-workout.
 *
 * Must run after prescription rows are built: a drop-set's chain is a percentage of each row's
 * own `w`, so it has to be computed from the final prescribed weight, not an earlier one —
 * otherwise a bumped working weight would leave stale, cheaper
 * drops sitting underneath it. `grid` puts each drop on a loadable weight (nextDropWeight).
 */
export function applyIntensifierPlan(sets, cfg, grid) {
  return applyFailurePlan(shapeRows(sets, cfg, grid), cfg)
}

/**
 * "Last set to failure" (`cfg.lastToFailure`, written only when on): the last work row of a
 * freshly built exercise is marked as taken to failure, the way Greyskull's final set is an
 * AMRAP. Only that one row, and only a row not logged yet; every other row keeps what it had, so
 * a plan without the flag builds exactly the rows it always did. Runs inside applyIntensifierPlan,
 * the step every way of building an exercise's rows ends with, so none of them can forget it.
 */
export function applyFailurePlan(sets, cfg) {
  if (!cfg || cfg.lastToFailure !== true || modeOf(cfg) === 'cardio') return sets
  let last = -1
  sets.forEach((s, i) => { if (!isWarmupRow(s)) last = i })
  // A timed per-side hold is an L row and an R row that read as one set: both halves are the set.
  const from = last > 0 && sets[last]?.side === 'R' && sets[last - 1]?.side === 'L' ? last - 1 : last
  if (last < 0) return sets
  return sets.map((s, i) => (i >= from && i <= last && !s.done ? { ...s, failure: true } : s))
}

function shapeRows(sets, cfg, grid) {
  const kind = cfg && cfg.intensifier && cfg.intensifier.type
  if (kind !== 'dropset' && kind !== 'restpause') return sets
  if (kind === 'dropset') {
    const count = Math.max(1, Math.round(cfg.intensifier.count) || 1)
    const pct = cfg.intensifier.pct
    // Stamp a descending chain of drops onto a row (or one side of a per-side row): each drop is
    // pct% lighter than the last, at that row/side's own rep count.
    const withDrops = row => {
      const drops = []
      let w = row.w || 0
      for (let k = 0; k < count; k++) { w = nextDropWeight(w, pct, grid); drops.push({ w, r: row.r }) }
      return { ...row, type: 'dropset', drops }
    }
    return sets.map(s => {
      if (isWarmupRow(s)) return s
      // A unilateral set drops per side (issue #60): stamp each side, then resync the aggregate.
      if (isSideSet(s)) return syncSideAggregate({ ...s, sides: { L: withDrops(s.sides.L), R: withDrops(s.sides.R) } })
      return withDrops(s)
    })
  }
  // Rest-pause trains as exactly two sets, not one per configured `sets` count: a warm-up at
  // the exercise's own configured reps, then a single rest-pause work set. Doing the full
  // activation+bursts protocol several times over isn't how rest-pause is actually trained, so
  // planning it replaces the rows it is given rather than stamping each of them.
  // The work row's own reps are the total — not "the total minus what the bursts carry" — and
  // the bursts are the full breakdown of that same total, down to the last one. See
  // extraVolumeOf/setTonnage: a rest-pause row's `clusters` are read-only display of how `r`
  // breaks down, not extra volume on top of it, precisely so this doesn't double-count.
  const restSec = Math.max(5, cfg.intensifier.restSec || 15)
  const totalReps = Math.max(1, Math.round(cfg.intensifier.totalReps) || 1)
  const w = (sets.find(s => !isWarmupRow(s)) || sets[0] || {}).w || 0
  const warmup = { w, r: Math.max(1, Math.round(cfg.reps) || 1), done: false, phase: 'warmup' }
  const work = { w, r: totalReps, done: false, type: 'restpause', clusters: splitBurstReps(totalReps).map(r => ({ r, restSec })) }
  if (isPerSide(cfg)) {
    const source = sets.find(s => !isWarmupRow(s))
    // The configured total covers both limbs; preserve it even for an odd total.
    const side = (key, reps) => ({
      w: source?.sides?.[key]?.w ?? w, r: reps, done: false, type: 'restpause',
      clusters: splitBurstReps(reps).map(r => ({ r, restSec })),
    })
    // The warm-up is per side too (issue #60): makeSideSet splits its combined reps the same
    // way the work set's are, each side its own reps/weight/effort and done tick.
    return [makeSideSet(warmup), syncSideAggregate({ ...work, sides: {
      L: side('L', Math.ceil(totalReps / 2)), R: side('R', Math.floor(totalReps / 2)),
    } })]
  }
  return [warmup, work]
}
// Warm-ups are excluded from volume by the role written on each row at finish: a warm-up the
// user checks off is logged 'completed' just like a work set.
export function workoutVolume(S, w = S) {
  if (!w.exposures) return (w.entries || []).reduce((sum, entry) => sum + entry.sets.reduce((v, row) => v + (isWarmupRow(row) ? 0 : completedVolumeOf(row)), 0) * volumeFactor(entry), 0)
  return (w.exposures || []).reduce((total, exposure) =>
    total + volumeOf({ sets: (exposure.performance?.sets || []).filter(row => row.role !== 'warmup') }) * volumeFactor(exposure), 0)
}
// Finished sessions carry their canonical local calendar day in `d`. Keep it aligned with
// History/calendar readers, and use the local start timestamp only for older records whose date
// is missing or malformed. Invalid records stay out of the activity map.
const timestampOf = value => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}
export function workoutDay(w) {
  const day = String(w?.d || '')
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    const date = new Date(day + 'T12:00:00')
    if (isoOf(date) === day) return day
  }
  const start = timestampOf(w?.start)
  if (start !== null) {
    const date = new Date(start)
    if (!Number.isNaN(date.getTime())) return isoOf(date)
  }
  return null
}

// Duration is derived from the completed session timestamps rather than a cached display value.
export function workoutDuration(w) {
  const start = timestampOf(w?.start)
  const end = timestampOf(w?.end)
  return start !== null && end !== null ? Math.max(0, end - start) : 0
}

// A unilateral row counts as two toward the "x / y sets" progress — one per side — since each
// side is logged and ticked on its own (issue #60). Every other row counts as one.
export const setUnits = s => (isSideSet(s) ? 2 : 1)
// How many of a row's units are done: both sides independently for a per-side row, else 0/1.
export const doneUnits = s => (isSideSet(s) ? (s.sides.L.done ? 1 : 0) + (s.sides.R.done ? 1 : 0) : (s.done ? 1 : 0))
// Total completion-units across a session's rows (both sides of every unilateral set counted).
export const setUnitsTotal = entries => (entries || []).reduce((n, e) => n + (e.sets || []).reduce((m, s) => m + setUnits(s), 0), 0)

// A canonical per-side row is a main row plus one completed segment (see the "per-side aggregate
// stays readable by existing consumers" tests in history.test.js) — the same shape doneUnits
// counted as 2 for the old L/R fields. Counting only the top-level row silently undercounts a
// real unilateral workout's "x sets" tile, so each completed segment is its own unit too.
export function setsDone(w) {
  return (w.exposures || []).reduce((total, exposure) => total + (exposure.performance?.sets || []).reduce((n, row) => {
    const rowUnit = row.status === 'completed' ? 1 : 0
    const segUnits = (row.segments || []).filter(seg => seg.status === 'completed').length
    return n + rowUnit + segUnits
  }, 0), 0)
}
export function setsDoneActive(A) {
  let n = 0
  if (A) A.entries.forEach(e => e.sets.forEach(s => { n += doneUnits(s) }))
  return n
}
export const lastBW = S => (S.bodyweight.length ? S.bodyweight[S.bodyweight.length - 1] : null)

// Group consecutive items sharing a superset id (sg) into "units" of indices.
// items may be routine exercises ({sg}) or active-workout entries ({sg}).
export function supersetUnits(items) {
  const units = []
  items.forEach((e, i) => {
    const prev = items[i - 1]
    if (i > 0 && e.sg && prev && prev.sg && e.sg === prev.sg) units[units.length - 1].push(i)
    else units.push([i])
  })
  return units
}

// A saved session's entries in the sections its detail sheet shows: one per routine (by `rid`, in
// the order each first appears), the entries with no routine together, and inside each section its
// superset units. Indexes point into `entries`. A superset never spans two sections — in a combined
// session the last exercise of one routine can be paired with the first of the next, and they are
// read back apart, each under its own routine. The detail sheet and "Copy as text" both group a
// workout through this, so the text never shows a superset the sheet does not.
export function sessionSections(entries) {
  const list = Array.isArray(entries) ? entries : []
  const sections = []
  list.forEach((e, i) => {
    const rid = e?.rid || null
    let section = sections.find(x => x.rid === rid)
    if (!section) { section = { rid, items: [] }; sections.push(section) }
    section.items.push(i)
  })
  return sections.map(({ rid, items }) => ({
    rid, items, units: supersetUnits(items.map(i => list[i])).map(unit => unit.map(k => items[k])),
  }))
}

// Move the selected occurrence's complete display unit by one neighbouring unit. Returning a
// new array keeps this helper pure; the caller decides how to persist it. Index identity matters
// here because the same exercise id may appear more than once with different setup.
export function moveSupersetUnit(items, index, direction) {
  if (!Array.isArray(items) || (direction !== -1 && direction !== 1)) return null
  const units = supersetUnits(items)
  const source = units.findIndex(unit => unit.includes(index))
  const target = source + direction
  if (source < 0 || target < 0 || target >= units.length) return null
  const reordered = [...units]
  const selected = reordered[source]
  reordered[source] = reordered[target]
  reordered[target] = selected
  return reordered.flat().map(i => items[i])
}
// The routine editor's up/down arrows (#377). A member of a superset moves inside it, past the
// next member; at the superset's edge it leaves it — its position kept, its `sg` dropped — so the
// next press moves it on as an exercise of its own. Anything else (a single exercise, a lone
// leftover `sg`) moves as a whole unit, as moveSupersetUnit does: it jumps a superset and never
// joins one (that is the link button's job). Moving a whole superset is left to drag. Returns the
// new list — entries that change are copies, the others keep their identity — or null when the
// press would do nothing. A superset left with one member is dissolved here, like cleanupSg would.
export function moveRoutineEntry(items, index, direction) {
  if (!Array.isArray(items) || (direction !== -1 && direction !== 1)) return null
  if (!Number.isInteger(index) || index < 0 || index >= items.length) return null
  const group = contiguousSgGroup(items, index)
  if (group.length < 2) return moveSupersetUnit(items, index, direction)
  const next = items.slice()
  const other = index + direction
  if (group.includes(other)) {
    next[index] = items[other]
    next[other] = items[index]
    return next
  }
  const { sg, ...left } = items[index]
  next[index] = left
  const rest = group.filter(i => i !== index)
  if (rest.length === 1) {
    const { sg: _gone, ...alone } = items[rest[0]]
    next[rest[0]] = alone
  }
  return next
}
export function unitOf(units, idx) { return units.find(u => u.includes(idx)) || [idx] }

export function streakWeeks(S) {
  if (!S.workouts.length) return 0
  const ws = weekStartOf(S)
  const weeks = new Set(S.workouts.map(w => weekKey(w.d, ws)))
  let streak = 0
  const cur = new Date()
  for (let i = 0; i < 520; i++) {
    const wk = weekKey(isoOf(cur), ws)
    if (weeks.has(wk)) streak++
    else if (i > 0) break
    cur.setDate(cur.getDate() - 7)
  }
  return streak
}

/**
 * Cascade an explicit work-set load edit through the later inherited work sets.
 *
 * Missing `weightOrigin` is inherited for compatibility with existing sessions. A row or side
 * marked `manual` is an explicit exception, so it stays put even when it is heavier or lighter.
 * `side` narrows a per-side edit to one limb; without it both limbs are eligible independently.
 * Completed rows (and completed limbs) never get rewritten. Clearing an inherited load removes
 * its `w` key just like a direct edit.
 *
 * Only a work-set edit cascades, and only onto work sets. Warm-ups are a ramp (buildSets), each
 * rung its own load, so editing one rung leaves the rungs after it where they were (setting
 * warm-up 1 of a 60/90/105 ramp to 65 used to turn it into 65/65/65).
 *
 * `backoffStep` (an entry built with back-off sets, lib/backoff.js): each later work row lands
 * one more step below the edited one rather than at the same load, so 26 → 27.5 on the top set
 * makes the back-off sets 25.5 and 23.5, not 27.5 three times.
 */
export function cascadeWeight(rows, from, value, side, backoffStep = 0) {
  const source = rows[from]
  if (!source || isWarmupRow(source)) return rows.slice()
  const sides = isSideSet(source) ? (side ? [side] : ['L', 'R']) : null
  const next = rows.slice()
  const stepDown = backoffStep > 0 && value != null
  let k = 0
  const setWeight = row => {
    const out = { ...row }
    if (value == null) delete out.w
    else out.w = stepDown ? backoffAt(value, k, backoffStep) : value
    return out
  }
  const setSideWeight = (row, key) => {
    const current = row.sides?.[key]
    if (!current || current.done === true || current.weightOrigin === WEIGHT_ORIGIN_MANUAL) return row
    const nextSide = setWeight(current)
    return syncSideAggregate({ ...row, sides: { ...row.sides, [key]: nextSide } })
  }
  for (let j = from + 1; j < next.length; j++) {
    const row = next[j]
    if (isWarmupRow(row)) continue
    // How many work sets below the edited one this row sits, done or not: a logged set in
    // between still holds its place in the sequence.
    k++
    if (sides) {
      if (!isSideSet(row)) continue
      let out = row
      for (const key of sides) out = setSideWeight(out, key)
      next[j] = out
    } else if (!isSideSet(row) && !row.done && row.weightOrigin !== WEIGHT_ORIGIN_MANUAL) {
      next[j] = setWeight(row)
    }
  }
  return next
}

/**
 * The first work weight moved: re-aim the generated warm-ups still waiting (incomplete rows with
 * `autoWarmup`). Each keeps its share of the old work weight, rounded down to the step; one that
 * would reach the new work weight or repeat the previous warm-up is dropped. Done, manual and
 * hand-edited warm-ups are session facts and are never touched. The first work row is pinned to
 * `to` — the caller (Workout.jsx `setField`) has usually already set it there itself, but pinning
 * it here too keeps this function correct on its own, since it is the reference the ramp is built
 * against; later work rows are left as the caller (`cascadeWeight`) already resolved them.
 */
export function rerampAutoWarmups(rows, from, to, step = 2.5) {
  if (!(from > 0) || !(to > 0)) return rows
  let prev = 0
  let workSeen = false
  return rows.flatMap(row => {
    if (!isWarmupRow(row)) {
      if (workSeen) return [row]
      workSeen = true
      return [{ ...row, w: to }]
    }
    if (!row.autoWarmup || row.done) { prev = row.w || 0; return [row] }
    // ponytail: ratio of an already-rounded load drifts up to one step per edit; carry the recipe percent on the row if that ever matters
    const w = Number((Math.floor(Number((row.w / from * to / step).toFixed(6))) * step).toFixed(6))
    if (w <= 0 || w >= to || w === prev) return []
    prev = w
    return [{ ...row, w }]
  })
}

/**
 * Insert a warm-up row at the end of the warm-up block, ramping toward the working weight.
 *
 * Each added row halves what is left between the last warm-up and the first work set, so the
 * first one lands at half the working weight, a second at three quarters, and so on — and a
 * row you edited by hand is what the next one ramps from. `step` is the exercise's own loading
 * step (passed in by the caller so this module stays independent): a warm-up you cannot
 * actually load onto the bar is noise.
 *
 * The reference is the first WORK row, never `rows[at - 1]` alone: for the first warm-up
 * `at` is 0, and reading `rows[-1]` used to fall through to the *last* row — the heaviest
 * work set — so "add warm-up set" handed you a full-weight set to correct by hand.
 */
export function insertWarmupRow(rows, mode, target, step = 2.5, floor = 0) {
  const firstWork = rows.findIndex(x => !isWarmupRow(x))
  const at = firstWork === -1 ? rows.length : firstWork
  const prev = at > 0 ? rows[at - 1] : null            // the warm-up this one ramps from
  const work = firstWork === -1 ? null : rows[firstWork]
  const rampTo = to => {
    const from = prev ? (prev.w || 0) : 0
    // Nothing to ramp toward: bodyweight, cardio, a timed hold with no load.
    if (!(to > 0)) return 0
    // Already at or past the work weight — which happens when a warm-up was edited by hand
    // above it. Returning `from` here handed the next warm-up that same too-heavy number and
    // let it propagate down the block. A warm-up is never heavier than the set it warms up for.
    if (to <= from) return to
    // Rounded DOWN to the step: a warm-up that lands a notch light costs nothing, one that
    // lands a notch heavy is a set you have to strip plates off before you can use it. Never
    // under `floor` (barFloor), and never over the work weight even when the bar is heavier.
    return Math.min(to, Math.max(0, floor, rungDown(from + (to - from) / 2, step)))
  }
  const warm = mode === 'cardio'
    ? {
      min: prev ? prev.min : (work ? work.min : (target.min || 20)),
      speed: prev ? prev.speed : (work ? work.speed : (target.speed || 8)),
      ...inclineFrom(prev || work),
      done: false, phase: 'warmup', warmup: true,
    }
    : mode === 'time'
      ? {
        sec: prev ? prev.sec : (work ? work.sec : (target.sec || 45)),
        w: rampTo(work ? (work.w || 0) : (target.weight || 0)),
        done: false, phase: 'warmup', warmup: true,
      }
      : {
        w: rampTo(work ? (work.w || 0) : (target.weight || 0)),
        r: work ? work.r : (prev ? prev.r : target.reps),
        done: false, phase: 'warmup', warmup: true,
      }
  // A unilateral exercise warms up per side too (issue #60): the warm-up row splits into L/R
  // like the work sets it ramps toward, each side logged and ticked on its own with its own
  // reps and effort. The reps `r` above is the combined total (the work set's, or the plan's
  // even target), so makeSideSet halves it the same way a work row is split; both sides share
  // the ramped weight. Only reps-mode warm-ups split — a timed hold or a cardio warm-up is not
  // per-side. makeSideSet spreads the row, so `phase`/`warmup` carry onto the side set.
  const warmRow = mode === 'reps' && isPerSide(target) ? makeSideSet(warm) : warm
  const next = rows.slice()
  next.splice(at, 0, warmRow)
  return next
}

// The set-number menu's "Make it a warm-up set": the row takes the shape insertWarmupRow gives a
// warm-up (its weight, reps and tick kept; drops, bursts, sides and effort dropped, since a
// warm-up has none) and moves to the end of the warm-ups, so it is numbered, rested and left out
// of progression and records like any other warm-up. A row that is one already is left alone.
// Only a plain straight set: a warm-up is one weight times one rep count, so a drop set would
// lose its drops, a rest-pause row would add its bursts into one inflated rep count, and a
// per-side row would merge both sides with no way back (a per-side warm-up is never made a work
// set again).
export const canBeWarmup = row => !!row && !isWarmupRow(row) && !isSideSet(row) && !isDropSet(row) && !isRestPauseSet(row)

export function makeWarmupAt(rows, i) {
  const src = rows[i]
  if (!canBeWarmup(src)) return rows
  const warm = { w: src.w || 0, r: src.r, done: !!src.done, phase: 'warmup', warmup: true }
  if (src.at != null) warm.at = src.at
  return placeRow(rows, i, warm)
}
// And back: "Count it as a working set" makes it the first work set.
export function makeWorkAt(rows, i) {
  const src = rows[i]
  if (!src || !isWarmupRow(src)) return rows
  const { phase, warmup, ...work } = src
  return placeRow(rows, i, work)
}
// Takes row i out and puts `row` where the work sets begin.
const placeRow = (rows, i, row) => {
  const next = rows.filter((_, j) => j !== i)
  const firstWork = next.findIndex(x => !isWarmupRow(x))
  next.splice(firstWork === -1 ? next.length : firstWork, 0, row)
  return next
}

/** The rows one set takes up at `i`: a timed per-side hold is an L row and an R row that read
 *  as one set number (addSet pushes them as a pair), so taking one out takes its partner too.
 *  Anything else is the row alone. Returns [start, count]. */
export function setSpanAt(rows, i) {
  const row = rows[i]
  if (row?.side === 'L' && rows[i + 1]?.side === 'R') return [i, 2]
  if (row?.side === 'R' && rows[i - 1]?.side === 'L') return [i - 1, 2]
  return [i, 1]
}


// What a copied set leaves behind (v1.3.11, swipe right or "Copy this set"): the tick and when it
// happened, a hold's set-aside plan, the manual-weight marker (the copy follows a weight change
// above it like any inherited row) and the drop/burst sub-rows, which belong to the set that was
// actually done. Weight, reps, time, speed, effort, the warm-up phase, a pyramid's Max and the
// side layout all come along.
const NOT_COPIED = ['done', 'at', 'planSec', 'weightOrigin', 'type', 'drops', 'clusters']
const bare = src => {
  const out = { ...src }
  for (const k of NOT_COPIED) delete out[k]
  return out
}
function copyOfRow(src) {
  if (isSideSet(src)) {
    const side = sd => ({ ...bare(sd), done: false })
    return syncSideAggregate({ ...bare(src), sides: { L: side(src.sides.L), R: side(src.sides.R) }, done: false })
  }
  return { ...bare(src), done: false }
}

/** "One more like this one": a copy of row `i` right below it, unticked and without sub-rows.
 *  A timed per-side hold is planned as an L row then an R row (buildSets), so copying either
 *  half copies the pair and puts it after the pair, keeping every L next to its R. */
export function copySpanAt(rows, i) {
  const work = r => r && !isWarmupRow(r) ? r.side : null
  const start = work(rows[i]) === 'R' && work(rows[i - 1]) === 'L' ? i - 1 : i
  const end = work(rows[start]) === 'L' && work(rows[start + 1]) === 'R' ? start + 1 : start
  return { start, end }
}
export function copyRowAt(rows, i) {
  if (!rows[i]) return rows.slice()
  const { start, end } = copySpanAt(rows, i)
  const next = rows.slice()
  next.splice(end + 1, 0, ...rows.slice(start, end + 1).map(copyOfRow))
  return next
}

/** Undo for a removed set: `row` back at index `i` exactly as it was (tick, values, sub-rows).
 *  An index past the end (the entry lost rows since) lands it last. */
export function insertRowAt(rows, i, row) {
  const next = rows.slice()
  const at = Number.isInteger(i) ? Math.max(0, Math.min(i, next.length)) : next.length
  next.splice(at, 0, row)
  return next
}

/** Remove the set at `i` (both halves of a per-side pair), never emptying the entry. */
export function removeRowAt(rows, i) {
  const [start, count] = setSpanAt(rows, i)
  if (rows.length <= count) return rows.slice()
  const next = rows.slice()
  next.splice(start, count)
  return next
}

/** "Remove set": the last set, which for a timed per-side exercise is its last L/R pair. */
export const removeLastSet = rows => rows.length ? removeRowAt(rows, rows.length - 1) : rows.slice()

/** Completed non-warm-up sets across a workout's exposures. */
export function workSetsDone(S, w = S) {
  return (w?.exposures || []).reduce((n, exposure) =>
    n + (exposure.performance?.sets || []).filter(row => row.status === 'completed' && row.role !== 'warmup').length, 0)
}

const METRIC_MODES = ['reps', 'time', 'cardio']
const completedRowsForMode = (entry, mode) => workRowsForMode(entry, mode).filter(s => hasCompletedWork(s) && !isWarmupRow(s))

export function metricRowsForEntry(entry, mode) {
  const requested = typeof mode === 'string' ? mode.trim().toLowerCase() : ''
  const resolved = METRIC_MODES.includes(requested) ? requested : metricModeForEntry(entry)
  return resolved ? completedRowsForMode(entry, resolved) : []
}

/** The authoritative metric for an entry; reps rows take precedence over timed/cardio rows. */

export function metricModeForEntry(entry, fallback = null) {
  for (const mode of METRIC_MODES) {
    if (completedRowsForMode(entry, mode).length) return mode
  }
  return modeForEntry(entry, fallback)
}

/** Best load from completed work rows, with a guarded reps-only legacy topW fallback. */

export function bestWeightForEntry(entry = {}) {
  const target = entry.target || entry
  const workRows = Array.isArray(entry.sets)
    ? entry.sets.filter(s => phaseForSet(s) === 'work')
    : []
  const repsRows = metricRowsForEntry(entry, 'reps')
  // Reps rows are the authoritative load metric for a mixed entry. Otherwise use every
  // completed work row (timed holds can carry an added load too).
  const completedRows = repsRows.length
    ? repsRows
    : workRows.filter(set => hasCompletedWork(set) && !isWarmupRow(set))
  // On an assistance machine the smallest load is the best set, so "best" folds the other way
  // (issue #232). Everything below still returns a plain number — the caller does not branch.
  const assisted = isAssisted(entry.id ? { id: entry.id } : entry)
  let best = 0
  let hasUsableWeight = false
  completedRows.forEach(set => {
    const completedSets = isSideSet(set)
      ? [set.sides.L, set.sides.R].filter(side => side?.done === true)
      : [set]
    completedSets.forEach(completedSet => {
      const weight = Number(completedSet?.w)
      if (!Number.isFinite(weight)) return
      // A 0 on an assistance machine is a row with no load entered, not a set done with no help
      // at all — folding it in as "the least assistance ever" would invent a record nobody did
      // and then ask for negative help next time. Anyone truly needing none has left the machine
      // behind and should log the unassisted exercise instead.
      if (assisted && !(weight > 0)) return
      best = hasUsableWeight ? betterWeight(entry.id, best, weight) : weight
      hasUsableWeight = true
    })
  })

  // A real completed row, including an explicit zero for an unloaded bodyweight set, always
  // wins. A manual topW is only useful for old records whose rows did not carry a usable load.
  if (hasUsableWeight) return best

  const parentMode = modeForSet({}, target)
  const hasNonRepsWorkRow = workRows.some(set => modeForSet(set, target) !== 'reps')
  const hasWarmupRow = Array.isArray(entry.sets) && entry.sets.some(isWarmupRow)
  const topWeight = Number(entry.topW)
  // topW predates phase-tagged warm-ups. It remains a fallback for legacy all-work records,
  // but cannot override resolved work rows once any warm-up marker exists.
  if (parentMode === 'reps' && !hasNonRepsWorkRow && !hasWarmupRow && Number.isFinite(topWeight)
    && (best <= 0 || (assisted ? topWeight > 0 && topWeight < best : topWeight > best))) best = topWeight
  return best
}

export const barFloor = (S, exId) => barWeightFor(S, exId) || 0

const rungDown = (value, step) => Array.isArray(step) ? ownedFloor(step, value) : Math.floor(value / step + 1e-9) * step
