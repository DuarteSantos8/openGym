import { describe, it, expect } from 'vitest'
import { nextTrainingDay, modeOf, isTimed, fmtSec, setLabel, defaultConfig, buildSets, freestyleConfig, exLine, workoutVolume, bestWeightFor, bestWeightForEntry, completedRepsOf, metricRowsForEntry, effortOf, stepEffort, capEffort, isBw, isPerSide, sideReps, repStep, cascadeWeight, insertWarmupRow, makeWarmupAt, canBeWarmup, makeWorkAt, removeRowAt, removeLastSet, setSpanAt, workSetsDone, setsDone, setsDoneActive, setUnits, doneUnits, setUnitsTotal, pairAdjacent, unpairSuperset, supersetUnits, sessionSections, applyIntensifierPlan, pinnedNoteFor, exNoteFor, effectiveRoutineIds, effectiveRoutines, effectiveRoutineId, effectiveRoutine, lastEntryFor, entryExcluded, entryRoutineId, setsRepsOf } from './history.js'
import { makeSideSet, setSideField, toggleSide, WEIGHT_ORIGIN_MANUAL } from './workout-model.js'
import { EXDB } from './exercises.js'
import { todayISO, isoOf } from './format.js'

// Real ids out of the shipped catalogue, so the body-part fallback is exercised for real.
const CARDIO = EXDB.find(e => e.bp === 'cardio').id
// A *loaded* lift: the catalogue's first non-cardio entry is a sit-up, which since issue #32
// defaults to bodyweight and would quietly send every label test down the other path.
const LIFT = EXDB.find(e => e.bp !== 'cardio' && e.eq !== 'body weight').id
const BW = EXDB.find(e => e.eq === 'body weight').id

describe('modeOf', () => {
  it('falls back to the body part when a plan has no mode — every existing plan keeps working', () => {
    expect(modeOf({ id: CARDIO })).toBe('cardio')
    expect(modeOf({ id: LIFT })).toBe('reps')
    expect(modeOf({ id: 'no-such-exercise' })).toBe('reps')
    expect(modeOf({})).toBe('reps')
    expect(modeOf(null)).toBe('reps')
    expect(modeOf(undefined)).toBe('reps')
  })

  it('lets an explicit mode win over the body part', () => {
    expect(modeOf({ id: LIFT, mode: 'time' })).toBe('time')
    expect(modeOf({ id: CARDIO, mode: 'reps' })).toBe('reps')
    expect(modeOf({ id: CARDIO, mode: 'time' })).toBe('time')
  })

  it('ignores a mode it does not know rather than trusting a bad file', () => {
    expect(modeOf({ id: LIFT, mode: 'nonsense' })).toBe('reps')
    expect(modeOf({ id: CARDIO, mode: '' })).toBe('cardio')
  })

  it('exposes the timed check', () => {
    expect(isTimed({ id: LIFT, mode: 'time' })).toBe(true)
    expect(isTimed({ id: LIFT })).toBe(false)
  })
})

describe('fmtSec', () => {
  it('reads as a clock, not a pile of seconds', () => {
    expect(fmtSec(0)).toBe('0:00')
    expect(fmtSec(9)).toBe('0:09')
    expect(fmtSec(45)).toBe('0:45')
    expect(fmtSec(60)).toBe('1:00')
    expect(fmtSec(90)).toBe('1:30')
    expect(fmtSec(605)).toBe('10:05')
  })
  it('is defensive about junk input', () => {
    expect(fmtSec(-5)).toBe('0:00')
    expect(fmtSec(undefined)).toBe('0:00')
    expect(fmtSec(null)).toBe('0:00')
    expect(fmtSec(NaN)).toBe('0:00')
    expect(fmtSec(44.6)).toBe('0:45')
  })
})

describe('setLabel', () => {
  it('describes each mode in its own terms', () => {
    expect(setLabel(LIFT, { w: 60, r: 10 })).toBe('60×10')
    expect(setLabel(CARDIO, { min: 20, speed: 9 })).toBe('20 min @ 9 km/h')
    expect(setLabel(LIFT, { sec: 45, w: 0 }, { mode: 'time' })).toBe('0:45')
    expect(setLabel(LIFT, { sec: 90, w: 20 }, { mode: 'time' })).toBe('1:30 · 20')
  })

  it('reads a legacy set with no config exactly as before', () => {
    expect(setLabel(LIFT, { w: 0, r: 0 })).toBe('0×0')
    expect(setLabel(CARDIO, {})).toBe('0 min @ 0 km/h')
  })

  // A target built without an id (a freestyle one) and without a mode used to fall back to reps,
  // so a run read "0×0": the id the caller passes decides the mode then, as it does with no target.
  it('reads a cardio set by the exercise id when its target carries neither id nor mode', () => {
    expect(setLabel(CARDIO, { min: 20, speed: 9 }, { sets: 1, min: 20, speed: 8 })).toBe('20 min @ 9 km/h')
    // a target that says otherwise still wins
    expect(setLabel(CARDIO, { sec: 45, w: 0 }, { mode: 'time' })).toBe('0:45')
  })

  // QA 1.3.11: a custom exercise moved to Cardio after months of rep sets read its history as
  // "0 min @ 0 km/h" next to the volume those sets still count. A target with no mode of its own
  // follows the set's fields; one that names a mode still decides.
  it('reads a rep set as reps when its exercise has become cardio since', () => {
    expect(setLabel(CARDIO, { w: 50, r: 10 }, { sets: 3, reps: 10, weight: 50, bodyweight: false })).toBe('50×10')
    // no target at all: the catalogue's cardio entry is body weight, so the load reads as added
    expect(setLabel(CARDIO, { w: 50, r: 10 })).toBe('+50 × 10')
    expect(setLabel(CARDIO, { min: 20, speed: 9, r: 0 }, { sets: 1 })).toBe('20 min @ 9 km/h')
    expect(setLabel(CARDIO, { w: 50, r: 10 }, { mode: 'cardio' })).toBe('0 min @ 0 km/h')
  })

  it('appends RIR when present, including a valid 0', () => {
    expect(setLabel(LIFT, { w: 60, r: 10, rir: 2 })).toBe('60×10 (RIR 2)')
    expect(setLabel(LIFT, { w: 60, r: 10, rir: 1.5 })).toBe('60×10 (RIR 1.5)')
    expect(setLabel(LIFT, { w: 60, r: 10, rir: 0 })).toBe('60×10 (RIR 0)')
  })

  it('says nothing about RIR on a set that never logged one', () => {
    expect(setLabel(LIFT, { w: 60, r: 10 })).toBe('60×10')
    // cleared in the UI: the key is dropped, but a null must read the same as absent
    expect(setLabel(LIFT, { w: 60, r: 10, rir: null })).toBe('60×10')
  })

  it('appends RPE for a set logged on that scale', () => {
    expect(setLabel(LIFT, { w: 60, r: 10, rpe: 8 })).toBe('60×10 (RPE 8)')
    expect(setLabel(LIFT, { w: 60, r: 10, rpe: 9.5 })).toBe('60×10 (RPE 9.5)')
    expect(setLabel(LIFT, { w: 60, r: 10, rpe: null })).toBe('60×10')
  })

  it('keeps each set on the scale it was logged with', () => {
    // switching the setting must not rewrite history: an old RIR set still reads as RIR
    expect(setLabel(LIFT, { w: 60, r: 10, rir: 2 })).toBe('60×10 (RIR 2)')
    // and a set that somehow carries both is described once, by the one it was logged with
    expect(setLabel(LIFT, { w: 60, r: 10, rir: 2, rpe: 8 })).toBe('60×10 (RIR 2)')
  })

  // Discord (rubik_97): a drop-set's drops were counted in the workout's volume but never shown,
  // so the history detail listed less weight than its own total added up to.
  it('lists a drop-set\'s drops after the main set, effort last', () => {
    const drop = { w: 100, r: 8, type: 'dropset', drops: [{ w: 80, r: 6 }, { w: 60, r: 5 }] }
    expect(setLabel(LIFT, drop)).toBe('100×8 ↘ 80×6 ↘ 60×5')
    expect(setLabel(LIFT, { ...drop, rir: 0 })).toBe('100×8 ↘ 80×6 ↘ 60×5 (RIR 0)')
    // a drop nobody did (no reps) is not work, and drops on a row that is not a drop-set are stale
    expect(setLabel(LIFT, { w: 100, r: 8, type: 'dropset', drops: [{ w: 80, r: 0 }] })).toBe('100×8')
    expect(setLabel(LIFT, { w: 100, r: 8, type: 'straight', drops: [{ w: 80, r: 6 }] })).toBe('100×8')
  })

  it('writes a rest-pause set as its bursts, adding up to the logged total', () => {
    // bursts added live sit on top of the activation set: 10 + 4 + 2 = 16
    expect(setLabel(LIFT, { w: 60, r: 16, type: 'restpause', clusters: [{ r: 4, restSec: 15 }, { r: 2, restSec: 15 }] })).toBe('60×10+4+2')
    // a planned set's bursts are the whole total already (applyIntensifierPlan)
    expect(setLabel(LIFT, { w: 60, r: 12, type: 'restpause', clusters: [6, 3, 2, 1].map(r => ({ r, restSec: 15 })) })).toBe('60×6+3+2+1')
    // bursts that no longer fit the total (edited by hand) leave just the total
    expect(setLabel(LIFT, { w: 60, r: 5, type: 'restpause', clusters: [{ r: 4 }, { r: 3 }] })).toBe('60×5')
  })

  // A planned rest-pause set has no activation set: its bursts are the whole total. Raising the
  // total by hand put the difference in front, "60×2+6+3+2+1", a two-rep set nobody did.
  it('reads a planned rest-pause set whose total was raised by hand as its plain total', () => {
    const cfg = { id: LIFT, reps: 8, intensifier: { type: 'restpause', totalReps: 12, restSec: 15 } }
    const [, work] = applyIntensifierPlan([{ w: 60, r: 8, done: false }], cfg)
    expect(setLabel(LIFT, work, cfg)).toBe('60×6+3+2+1')
    expect(setLabel(LIFT, { ...work, r: 14 }, cfg)).toBe('60×14')
    // a burst added live on top keeps the breakdown, since the total follows it
    const added = { ...work, r: 13, clusters: [...work.clusters, { r: 1, restSec: 15 }] }
    expect(setLabel(LIFT, added, cfg)).toBe('60×6+3+2+1+1')
    // per side, each side is read the same way
    const sided = applyIntensifierPlan([makeSideSet({ w: 20, r: 8, done: false })], { ...cfg, side: true })[1]
    sided.sides.L = { ...sided.sides.L, r: sided.sides.L.r + 2 }
    expect(setLabel(LIFT, sided, { ...cfg, side: true })).toBe('L 20×8 · R 20×3+2+1')
    // an unplanned set with live bursts still shows its activation set first
    expect(setLabel(LIFT, { w: 60, r: 16, type: 'restpause', clusters: [{ r: 4 }, { r: 2 }] }, { id: LIFT, reps: 10 })).toBe('60×10+4+2')
  })

  it('reads drops and bursts of a bodyweight exercise as reps and added weight', () => {
    const cfg = { id: BW, bodyweight: true }
    expect(setLabel(BW, { w: 10, r: 8, type: 'dropset', drops: [{ w: 0, r: 5 }] }, cfg)).toBe('+10 × 8 ↘ 5')
    expect(setLabel(BW, { w: 0, r: 12, type: 'restpause', clusters: [{ r: 3 }] }, cfg)).toBe('9+3')
  })

  it('shows each side\'s own drops on a unilateral drop-set', () => {
    const side = (w, r, drops) => ({ w, r, done: true, type: 'dropset', drops })
    const s = { w: 20, r: 16, done: true, type: 'dropset', sides: { L: side(20, 8, [{ w: 15, r: 6 }]), R: side(20, 8, [{ w: 15, r: 5 }]) } }
    expect(setLabel(LIFT, s, { id: LIFT, side: true })).toBe('L 20×8 ↘ 15×6 · R 20×8 ↘ 15×5')
  })
})

describe('effortOf', () => {
  it('reads the scale a profile logs', () => {
    expect(effortOf({ effort: 'rpe' })).toBe('rpe')
    expect(effortOf({ effort: 'rir' })).toBe('rir')
    expect(effortOf({ effort: 'none' })).toBe('none')
    expect(effortOf({})).toBe('none')
  })

  it('keeps the column for a profile still carrying the old showRir flag', () => {
    expect(effortOf({ showRir: true })).toBe('rir')
    // what a stored profile actually looks like once it is overlaid on DEF
    expect(effortOf({ effort: null, showRir: true })).toBe('rir')
    expect(effortOf({ effort: null })).toBe('none')
    expect(effortOf({ showRir: false })).toBe('none')
    // once the new setting is chosen it wins, whatever the old flag said
    expect(effortOf({ showRir: true, effort: 'rpe' })).toBe('rpe')
    expect(effortOf({ showRir: true, effort: 'none' })).toBe('none')
  })

  // The store cannot be imported here (it reaches for `navigator` at module load), so the
  // overlay it performs is reproduced literally: stored profile spread over the defaults.
  // DEF.effort is null precisely so this lands on the showRir fallback rather than on 'none'.
  const overlay = stored => ({ unit: 'kg', effort: null, ...stored })

  it('survives the overlay every load path performs', () => {
    // upgrading with the column on: local state, a server pull and a restored backup all
    // arrive as a stored object spread over the defaults, and all must keep the column
    expect(effortOf(overlay({ showRir: true }))).toBe('rir')
    expect(effortOf(overlay({ showRir: false }))).toBe('none')
    // a profile predating the RIR feature entirely
    expect(effortOf(overlay({}))).toBe('none')
    // and one written by this version
    expect(effortOf(overlay({ effort: 'rpe' }))).toBe('rpe')
    // an old backup restored over a profile that had already chosen: the file wins, because
    // an import replaces state wholesale rather than merging
    expect(effortOf(overlay({ showRir: true, effort: undefined }))).toBe('rir')
  })

  it('is not fooled by a junk value', () => {
    expect(effortOf({ effort: 'rpe10' })).toBe('none')
    expect(effortOf({ effort: 'RIR' })).toBe('none')
    expect(effortOf({ effort: 'f' })).toBe('none')
    expect(effortOf(null)).toBe('none')
    expect(effortOf(undefined)).toBe('none')
    // a junk value with the old flag still set falls back rather than showing nothing
    expect(effortOf({ effort: 'nope', showRir: true })).toBe('rir')
  })
})

describe('stepEffort', () => {
  it('starts at the bottom of the scale and walks up', () => {
    // the first + on an empty cell lands on the lowest value, not on some "typical" middle:
    // the stepper counts up from the floor the way every other stepper in the app does
    expect(stepEffort('rir', null, 1)).toBe(0)
    expect(stepEffort('rpe', null, 1)).toBe(6)
    // and then in even steps
    expect(stepEffort('rir', 0, 1)).toBe(0.5)
    expect(stepEffort('rir', 0.5, 1)).toBe(1)
    expect(stepEffort('rpe', 6, 1)).toBe(6.5)
  })

  it('leaves an untouched cell unlogged when stepped down', () => {
    // one stray − on a fresh row must not stamp "(RIR 0)" — went to failure — on the set
    expect(stepEffort('rir', null, -1)).toBe(null)
    expect(stepEffort('rpe', null, -1)).toBe(null)
    expect(stepEffort('rir', undefined, -1)).toBe(null)
  })

  it('clears the cell again when stepped back off the floor', () => {
    // so a mistap is undoable rather than sticking at the floor for good
    expect(stepEffort('rir', 0, -1)).toBe(null)
    expect(stepEffort('rpe', 6, -1)).toBe(null)
    // but a step that stays inside the scale is an ordinary step
    expect(stepEffort('rir', 0.5, -1)).toBe(0)
    expect(stepEffort('rpe', 6.5, -1)).toBe(6)
  })

  it('stops at the top of the scale', () => {
    expect(stepEffort('rir', 9.5, 1)).toBe(10)
    expect(stepEffort('rir', 10, 1)).toBe(10)
    expect(stepEffort('rpe', 10, 1)).toBe(10)
  })

  it('keeps halves clean instead of drifting into float dust', () => {
    let v = null
    for (let i = 0; i < 6; i++) v = stepEffort('rpe', v, 1)
    expect(v).toBe(8.5)
    expect(stepEffort('rir', 0.1 + 0.2, 1)).toBe(0.8)
  })

  it('steps evenly from a value typed below the floor rather than snapping', () => {
    // nothing stops someone typing RPE 3; the stepper must not jump them to 6 on one tap
    expect(stepEffort('rpe', 3, 1)).toBe(3.5)
    // stepping down out of the scale from there just clears it
    expect(stepEffort('rpe', 3, -1)).toBe(null)
  })

  it('does nothing when the profile logs no effort at all', () => {
    expect(stepEffort('none', null, 1)).toBe(null)
    expect(stepEffort('none', 2, 1)).toBe(2)
    expect(stepEffort(undefined, 2, -1)).toBe(2)
  })
})

describe('capEffort', () => {
  it('caps a typed value at the top of the scale', () => {
    expect(capEffort('rir', 12)).toBe(10)
    expect(capEffort('rpe', 99)).toBe(10)
    expect(capEffort('rpe', 8)).toBe(8)
  })

  it('does not floor a typed value, so typing "10" survives its first keystroke', () => {
    // clamping up would turn the "1" of "10" into 6 and fight the input
    expect(capEffort('rpe', 1)).toBe(1)
    expect(capEffort('rir', 0)).toBe(0)
  })

  it('passes an emptied field through untouched', () => {
    expect(capEffort('rir', null)).toBe(null)
    expect(capEffort('rpe', undefined)).toBe(undefined)
    expect(capEffort('none', 12)).toBe(12)
  })
})

// End-to-end on the data, not the pixels: what a set carries after the taps a real session
// makes, and what it reads back as afterwards.
describe('logging effort across a session', () => {
  it('logs a working set on the chosen scale', () => {
    // four + taps from empty on an RPE profile: 6, 6.5, 7, 7.5
    let v = null
    for (let i = 0; i < 4; i++) v = stepEffort('rpe', v, 1)
    expect(setLabel(LIFT, { w: 80, r: 5, rpe: v })).toBe('80×5 (RPE 7.5)')
  })

  it('a set taken to failure is logged, not left blank', () => {
    const v = stepEffort('rir', null, 1)      // one + on an RIR profile
    expect(v).toBe(0)
    expect(setLabel(LIFT, { w: 100, r: 3, rir: v })).toBe('100×3 (RIR 0)')
  })

  it('switching the setting mid-history rewrites nothing', () => {
    const old = { w: 60, r: 10, rir: 2 }      // logged while the profile was on RIR
    const fresh = { w: 60, r: 10, rpe: 8 }    // logged after switching to RPE
    expect(effortOf({ effort: 'rpe' })).toBe('rpe')
    expect(setLabel(LIFT, old)).toBe('60×10 (RIR 2)')
    expect(setLabel(LIFT, fresh)).toBe('60×10 (RPE 8)')
    // turning the column off entirely hides the control but keeps both sets readable
    expect(effortOf({ effort: 'none' })).toBe('none')
    expect(setLabel(LIFT, old)).toBe('60×10 (RIR 2)')
  })

  it('never attaches effort to a mode that has no place for it', () => {
    // cardio and timed sets have no third stepper, and their labels ignore the field even
    // if an import or an old file put one there
    expect(setLabel(CARDIO, { min: 20, speed: 9, rpe: 8 })).toBe('20 min @ 9 km/h')
    expect(setLabel(LIFT, { sec: 45, rir: 2 }, { id: LIFT, mode: 'time' })).toBe('0:45')
  })
})

describe('defaultConfig', () => {
  it('gives each mode a sensible starting point', () => {
    expect(defaultConfig(LIFT)).toEqual({ sets: 3, reps: 10, weight: 0, mode: 'reps' })
    expect(defaultConfig(CARDIO)).toEqual({ sets: 1, min: 20, speed: 8 })
    expect(defaultConfig(LIFT, 'time')).toEqual({ sets: 3, sec: 45, weight: 0, mode: 'time' })
  })
  it('seeds the bodyweight flag from the catalogue, and only when it is true', () => {
    expect(defaultConfig(BW)).toEqual({ sets: 3, reps: 10, weight: 0, mode: 'reps', bodyweight: true })
    expect(defaultConfig(BW, 'time')).toEqual({ sets: 3, sec: 45, weight: 0, mode: 'time', bodyweight: true })
    expect('bodyweight' in defaultConfig(LIFT)).toBe(false)
  })
})

/* ---------- bodyweight and per side (issues #31/#32/#33) ---------- */

describe('isBw', () => {
  it('defaults from the catalogue so an existing plan needs no flag', () => {
    expect(isBw({ id: BW })).toBe(true)
    expect(isBw({ id: LIFT })).toBe(false)
  })
  it('lets the config win in both directions — a belt on a dip, a flag on a machine', () => {
    expect(isBw({ id: BW, bodyweight: false })).toBe(false)
    expect(isBw({ id: LIFT, bodyweight: true })).toBe(true)
  })
})

describe('sideReps', () => {
  it('halves the logged total, because the total is what was logged', () => {
    expect(sideReps(16)).toBe(8)
    expect(sideReps(0)).toBe(0)
  })
  it('shows an odd total as it falls rather than rounding the imbalance away', () => {
    expect(sideReps(17)).toBe(8.5)
  })
})

describe('exLine — per side on a timed hold', () => {
  it('reads "per side" rather than splitting a duration in half', () => {
    expect(exLine({ id: LIFT, sets: 3, sec: 45, mode: 'time', side: true }, 'kg')).toBe('3 × 0:45 · per side')
  })
  it('leaves a plain hold untouched', () => {
    expect(exLine({ id: LIFT, sets: 3, sec: 45, mode: 'time' }, 'kg')).toBe('3 × 0:45')
  })
})

describe('repStep', () => {
  it('steps unilateral work in twos so the total stays splittable', () => {
    expect(repStep({ side: true })).toBe(2)
    expect(repStep({})).toBe(1)
    expect(repStep(null)).toBe(1)
  })
})

describe('setLabel — bodyweight', () => {
  it('reads as reps alone, because "0×12" describes nothing', () => {
    expect(setLabel(BW, { w: 0, r: 12 }, { id: BW })).toBe('12')
  })
  it('spells out a belt as an addition', () => {
    expect(setLabel(BW, { w: 10, r: 8 }, { id: BW })).toBe('+10 × 8')
  })
  it('logs a per-side set as the plain total, like every other set in the app', () => {
    expect(setLabel(BW, { w: 0, r: 16 }, { id: BW, side: true })).toBe('16')
    expect(setLabel(LIFT, { w: 20, r: 16 }, { id: LIFT, side: true })).toBe('20×16')
  })
  it('keeps the effort tail', () => {
    expect(setLabel(BW, { w: 0, r: 12, rir: 2 }, { id: BW })).toBe('12 (RIR 2)')
  })
})

describe('exLine', () => {
  it('shows the split where there is room for it, next to the total you log', () => {
    expect(exLine({ id: LIFT, sets: 3, reps: 16, side: true }, 'kg')).toBe('3 × 16 · 8/side')
  })
  it('marks added weight as added', () => {
    expect(exLine({ id: BW, sets: 3, reps: 8, weight: 10 }, 'kg')).toBe('3 × 8 · +10 kg')
  })
  it('summarises a planned exercise per mode', () => {
    expect(exLine({ id: LIFT, sets: 3, reps: 10 }, 'kg')).toBe('3 × 10')
    expect(exLine({ id: LIFT, sets: 3, reps: 10, weight: 60 }, 'kg')).toBe('3 × 10 · 60 kg')
    expect(exLine({ id: LIFT, sets: 3, sec: 45, mode: 'time' }, 'kg')).toBe('3 × 0:45')
    expect(exLine({ id: LIFT, sets: 2, sec: 90, weight: 20, mode: 'time' }, 'kg')).toBe('2 × 1:30 · 20 kg')
    expect(exLine({ id: CARDIO, sets: 1, min: 20, speed: 8 }, 'kg')).toBe('1 × 20 min @ 8 km/h')
  })
  it('reads a double-progression range as the range, not as its top', () => {
    // "Reps from 10, up to 15" used to read "2 × 15" in the plan and then open at 10.
    expect(exLine({ id: LIFT, sets: 2, reps: 15, repsMin: 10, weight: 40 }, 'kg')).toBe('2 × 10–15 · 40 kg')
    expect(exLine({ id: LIFT, sets: 3, reps: 16, repsMin: 12, side: true }, 'kg')).toBe('3 × 12–16 · 6–8/side')
    // A bottom at or above the top is not a range.
    expect(exLine({ id: LIFT, sets: 2, reps: 10, repsMin: 10 }, 'kg')).toBe('2 × 10')
  })
  it('gives the sets and reps alone for the workout card', () => {
    expect(setsRepsOf({ id: LIFT, sets: 2, reps: 10, weight: 60 })).toBe('2 × 10')
    expect(setsRepsOf({ id: LIFT, sets: 3, reps: 12, repsMin: 8, weight: 40 })).toBe('3 × 8–12')
    expect(setsRepsOf({ id: LIFT, sets: 2, sec: 45, mode: 'time' })).toBe('2 × 0:45')
  })
})

const emptyS = { workouts: [], exWeights: {} }

describe('freestyleConfig', () => {
  it('inherits the last target and completed set count for a newly added exercise', () => {
    const S = {
      exWeights: {},
      workouts: [{
        d: '2026-01-01',
        entries: [{
          id: LIFT,
          target: { mode: 'reps', sets: 4, reps: 8, weight: 60, prog: 'linear' },
          sets: [
            { w: 60, r: 8, done: true },
            { w: 62.5, r: 7, done: true },
            { w: 62.5, r: 6, done: true },
            { w: 62.5, r: 5, done: true }
          ]
        }]
      }]
    }
    const cfg = freestyleConfig(S, { id: LIFT, mode: 'reps', sets: 3, reps: 10, weight: 0 })

    expect(cfg).toEqual({ id: LIFT, mode: 'reps', sets: 4, reps: 8, weight: 60, prog: 'linear' })
    expect(buildSets(S, cfg)).toEqual([
      { w: 60, r: 8, done: false },
      { w: 62.5, r: 7, done: false },
      { w: 62.5, r: 6, done: false },
      { w: 62.5, r: 5, done: false }
    ])
  })

  // Planned warm-ups: the routine says how many, buildSets stacks them onto the work sets with
  // the same ramp the in-session button uses. A plan without the field must not change shape.
  it('adds no rows when the config asks for no warm-ups', () => {
    const S = { exWeights: {}, workouts: [] }
    const cfg = { id: '0025', mode: 'reps', sets: 2, reps: 5, weight: 100 }
    expect(buildSets(S, cfg)).toEqual([
      { w: 100, r: 5, done: false },
      { w: 100, r: 5, done: false },
    ])
  })

  it('prepends the planned warm-ups as a ramp toward the work weight', () => {
    const S = { exWeights: {}, workouts: [] }
    const cfg = { id: '0025', mode: 'reps', sets: 2, reps: 5, weight: 100, warmupSets: 3 }
    const rows = buildSets(S, cfg, { step: 2.5 })
    expect(rows.map(r => r.w)).toEqual([50, 75, 87.5, 100, 100])
    expect(rows.slice(0, 3).every(r => r.phase === 'warmup')).toBe(true)
    expect(rows.slice(3).every(r => r.phase === undefined)).toBe(true)
  })

  // A 55 lb bench used to get warm-ups at 25 and 40 lb, lighter than the 45 lb bar it is done
  // with. A barbell rung never goes under the bar; everything without a bar ramps as before.
  it('never ramps a barbell warm-up below the bar it is done with', () => {
    const S = { unit: 'lb', exWeights: {}, workouts: [] }
    const bench = { id: '0025', mode: 'reps', sets: 3, reps: 10, weight: 55, warmupSets: 1 }
    expect(buildSets(S, bench, { step: 5 }).map(r => r.w)).toEqual([45, 55, 55, 55])
    // two rungs from the bar: 45, then half the gap left
    expect(buildSets(S, { ...bench, warmupSets: 2 }, { step: 5 }).map(r => r.w).slice(0, 2)).toEqual([45, 50])
    // heavy lifts ramp exactly as before: every rung is above the bar anyway
    expect(buildSets(S, { ...bench, weight: 135, warmupSets: 3 }, { step: 5 }).map(r => r.w).slice(0, 3)).toEqual([65, 100, 115])
    // the athlete's own bar weight wins, and "no bar" (0) floors nothing
    expect(buildSets({ ...S, barWeights: { '0025': 35 } }, bench, { step: 5 })[0].w).toBe(35)
    expect(buildSets({ ...S, barWeights: { '0025': 0 } }, bench, { step: 5 })[0].w).toBe(25)
    // a bar heavier than the work weight still never makes a warm-up heavier than the work set
    expect(buildSets({ ...S, barWeights: { '0025': 65 } }, bench, { step: 5 })[0].w).toBe(55)
    // a dumbbell lift has no bar: half, as always
    expect(buildSets(S, { id: '0289', mode: 'reps', sets: 1, reps: 10, weight: 50, warmupSets: 1 }, { step: 5 })[0].w).toBe(25)
    // the in-session button takes the same floor
    const rows = [{ w: 55, r: 10, done: false }]
    expect(insertWarmupRow(rows, 'reps', bench, 5, 45)[0].w).toBe(45)
    expect(insertWarmupRow(rows, 'reps', bench, 5)[0].w).toBe(25)
  })

  it('caps the planned warm-ups and ignores nonsense values', () => {
    const S = { exWeights: {}, workouts: [] }
    const base = { id: '0025', mode: 'reps', sets: 1, reps: 5, weight: 100 }
    expect(buildSets(S, { ...base, warmupSets: 99 }, { step: 2.5 }).filter(r => r.phase === 'warmup')).toHaveLength(5)
    expect(buildSets(S, { ...base, warmupSets: -2 }, { step: 2.5 })).toHaveLength(1)
    expect(buildSets(S, { ...base, warmupSets: 'x' }, { step: 2.5 })).toHaveLength(1)
  })

  it('keeps planned warm-ups out of the work-set count', () => {
    const S = { exWeights: {}, workouts: [] }
    const rows = buildSets(S, { id: '0025', mode: 'reps', sets: 3, reps: 5, weight: 100, warmupSets: 2 }, { step: 2.5 })
    const logged = { entries: [{ id: '0025', sets: rows.map(r => ({ ...r, done: true })) }] }
    expect(logged.entries[0].sets).toHaveLength(5)
    expect(workSetsDone(logged)).toBe(3)
  })

  it('inherits the target for timed and cardio exercises too', () => {
    const timed = {
      exWeights: {},
      workouts: [{
        d: '2026-01-02',
        entries: [{
          id: LIFT,
          target: { mode: 'time', sets: 2, sec: 60, weight: 15 },
          sets: [{ sec: 55, w: 15, done: true }, { sec: 60, w: 17.5, done: true }]
        }]
      }]
    }
    const cardio = {
      exWeights: {},
      workouts: [{
        d: '2026-01-03',
        entries: [{
          id: CARDIO,
          target: { sets: 2, min: 30, speed: 7 },
          sets: [{ min: 28, speed: 7, done: true }, { min: 30, speed: 7.5, done: true }]
        }]
      }]
    }

    const timedCfg = freestyleConfig(timed, { id: LIFT, mode: 'time', sets: 3, sec: 45, weight: 0 })
    expect(timedCfg).toEqual({ id: LIFT, mode: 'time', sets: 2, sec: 60, weight: 15 })
    expect(buildSets(timed, timedCfg)).toEqual([
      { sec: 55, w: 15, done: false },
      { sec: 60, w: 17.5, done: false }
    ])

    const cardioCfg = freestyleConfig(cardio, { id: CARDIO, sets: 1, min: 20, speed: 8 })
    expect(cardioCfg).toEqual({ id: CARDIO, sets: 2, min: 30, speed: 7 })
    expect(buildSets(cardio, cardioCfg)).toEqual([
      { min: 28, speed: 7, done: false },
      { min: 30, speed: 7.5, done: false }
    ])
  })

  it('keeps the supplied defaults when there is no completed matching workout', () => {
    const cfg = freestyleConfig(emptyS, { id: LIFT, mode: 'reps', sets: 3, reps: 10, weight: 50 })
    expect(cfg).toEqual({ id: LIFT, mode: 'reps', sets: 3, reps: 10, weight: 50 })
  })
})

describe('buildSets', () => {
  it('builds reps sets from the plan when there is no history', () => {
    expect(buildSets(emptyS, { id: LIFT, sets: 3, reps: 8, weight: 50 }))
      .toEqual([{ w: 50, r: 8, done: false }, { w: 50, r: 8, done: false }, { w: 50, r: 8, done: false }])
  })

  it('builds timed sets, carrying the planned duration and load', () => {
    expect(buildSets(emptyS, { id: LIFT, mode: 'time', sets: 2, sec: 60, weight: 20 }))
      .toEqual([{ sec: 60, w: 20, done: false }, { sec: 60, w: 20, done: false }])
  })

  it('doubles a per-side timed hold — once on each side, full duration both times', () => {
    expect(buildSets(emptyS, { id: LIFT, mode: 'time', sets: 2, sec: 30, weight: 0, side: true }))
      .toEqual([
        { sec: 30, w: 0, done: false, side: 'L' }, { sec: 30, w: 0, done: false, side: 'R' },
        { sec: 30, w: 0, done: false, side: 'L' }, { sec: 30, w: 0, done: false, side: 'R' },
      ])
  })

  it('carries a per-side timed hold forward by row, L and R each keeping their own history', () => {
    const S = { exWeights: {}, workouts: [{ d: '2026-01-01', entries: [{ id: LIFT, target: { mode: 'time', side: true }, sets: [
      { sec: 40, w: 5, done: true, side: 'L' }, { sec: 35, w: 5, done: true, side: 'R' },
    ] }] }] }
    expect(buildSets(S, { id: LIFT, mode: 'time', sets: 1, sec: 30, weight: 0, side: true }))
      .toEqual([{ sec: 40, w: 5, done: false, side: 'L' }, { sec: 35, w: 5, done: false, side: 'R' }])
  })

  it('builds cardio sets unchanged', () => {
    expect(buildSets(emptyS, { id: CARDIO, sets: 1, min: 25, speed: 9 }))
      .toEqual([{ min: 25, speed: 9, done: false }])
  })

  it('carries last time\'s numbers forward within the same mode', () => {
    const S = { exWeights: {}, workouts: [{ d: '2026-01-01', entries: [{ id: LIFT, target: { mode: 'time' }, sets: [{ sec: 70, w: 10, done: true }] }] }] }
    expect(buildSets(S, { id: LIFT, mode: 'time', sets: 2, sec: 45, weight: 0 }))
      .toEqual([{ sec: 70, w: 10, done: false }, { sec: 70, w: 10, done: false }])
  })

  it('does not seed a duration from a rep count when an exercise switches to time', () => {
    const S = { exWeights: {}, workouts: [{ d: '2026-01-01', entries: [{ id: LIFT, sets: [{ w: 60, r: 10, done: true }] }] }] }
    expect(buildSets(S, { id: LIFT, mode: 'time', sets: 1, sec: 45, weight: 0 }))
      .toEqual([{ sec: 45, w: 0, done: false }])
  })

  it('does not seed reps from a timed set when an exercise switches back', () => {
    const S = { exWeights: {}, workouts: [{ d: '2026-01-01', entries: [{ id: LIFT, target: { mode: 'time' }, sets: [{ sec: 70, w: 10, done: true }] }] }] }
    expect(buildSets(S, { id: LIFT, mode: 'reps', sets: 1, reps: 8, weight: 40 }))
      .toEqual([{ w: 40, r: 8, done: false }])
  })

  it('seeds the weight from the last session, and the confirmed working weight only when there is none', () => {
    // The confirmed weight is keyed by exercise alone — a heavy day's number — so it no longer
    // beats the session the rows are read from (#216). It still fills in without history.
    const S = { exWeights: { [LIFT]: { w: 75 } }, workouts: [{ d: '2026-01-01', entries: [{ id: LIFT, sets: [{ w: 60, r: 10, done: true }] }] }] }
    expect(buildSets(S, { id: LIFT, sets: 1, reps: 8, weight: 50 })).toEqual([{ w: 60, r: 10, done: false }])
    expect(buildSets({ ...S, workouts: [] }, { id: LIFT, sets: 1, reps: 8, weight: 50 })).toEqual([{ w: 75, r: 8, done: false }])
  })

  it('opens at the plan\'s reps with planReps, taking only the weight from the last session', () => {
    const S = { exWeights: {}, workouts: [{ d: '2026-01-01', entries: [{ id: LIFT, sets: [{ w: 60, r: 15, done: true }, { w: 62.5, r: 12, done: true }] }] }] }
    expect(buildSets(S, { id: LIFT, sets: 2, reps: 10, weight: 50 }, { planReps: true }))
      .toEqual([{ w: 60, r: 10, done: false }, { w: 62.5, r: 10, done: false }])
    // Planned warm-ups copy the work row, so they follow the plan too.
    expect(buildSets(S, { id: LIFT, sets: 1, reps: 10, weight: 50, warmupSets: 1 }, { planReps: true, step: 2.5 }).map(s => s.r))
      .toEqual([10, 10])
  })

  it('keeps each side\'s carried weight and splits the plan\'s reps evenly with planReps', () => {
    const side = (w, r) => ({ w, r, done: true })
    const S = { exWeights: {}, workouts: [{ d: '2026-01-01', entries: [{ id: LIFT, target: { side: true }, sets: [
      { w: 22.5, r: 13, done: true, sides: { L: side(22.5, 7), R: side(20, 6) } },
    ] }] }] }
    const [row] = buildSets(S, { id: LIFT, sets: 1, reps: 16, weight: 20, side: true }, { planReps: true })
    expect(row.sides.L).toMatchObject({ w: 22.5, r: 8 })
    expect(row.sides.R).toMatchObject({ w: 20, r: 8 })
    expect(row.r).toBe(16)
    // Without it the logged asymmetry carries over, reps included.
    const [carried] = buildSets(S, { id: LIFT, sets: 1, reps: 16, weight: 20, side: true })
    expect([carried.sides.L.r, carried.sides.R.r]).toEqual([7, 6])
  })

  it('ignores planReps for freestyle, which reproduces what you did', () => {
    const S = { exWeights: {}, workouts: [{ d: '2026-01-01', entries: [{ id: LIFT, sets: [{ w: 60, r: 15, done: true }] }] }] }
    expect(buildSets(S, { id: LIFT, sets: 1, reps: 10, weight: 50 }, { planReps: true, preferLast: true }))
      .toEqual([{ w: 60, r: 15, done: false }])
  })

  it('can preserve each last set weight for freestyle instead of using the working-weight hint', () => {
    const S = { exWeights: { [LIFT]: { w: 75 } }, workouts: [{ d: '2026-01-01', entries: [{ id: LIFT, sets: [
      { w: 60, r: 10, done: true }, { w: 62.5, r: 8, done: true }
    ] }] }] }
    expect(buildSets(S, { id: LIFT, sets: 2, reps: 8, weight: 50 }, { preferLast: true }))
      .toEqual([{ w: 60, r: 10, done: false }, { w: 62.5, r: 8, done: false }])
  })

  it('can use a deload target without carrying regular-session values into it', () => {
    const S = { exWeights: { [LIFT]: { w: 75 } }, workouts: [{ d: '2026-01-01', entries: [{ id: LIFT, sets: [
      { w: 75, r: 10, done: true }, { w: 75, r: 9, done: true }
    ] }] }] }
    expect(buildSets(S, { id: LIFT, sets: 2, reps: 12, weight: 40 }, { useTarget: true }))
      .toEqual([{ w: 40, r: 12, done: false }, { w: 40, r: 12, done: false }])
  })

  it('uses the current routine target instead of another routine\'s bodyweight history', () => {
    const S = {
      exWeights: {},
      workouts: [{
        d: '2026-01-01',
        routineId: 'routine-a',
        entries: [{
          id: BW,
          target: { sets: 2, reps: 15, weight: 0, bodyweight: true },
          sets: [{ w: 0, r: 15, done: true }, { w: 0, r: 15, done: true }]
        }]
      }]
    }
    const cfg = { id: BW, sets: 4, reps: 8, weight: 0, bodyweight: true, prog: 'off' }

    expect(buildSets(S, cfg, { useTarget: true })).toEqual([
      { w: 0, r: 8, done: false },
      { w: 0, r: 8, done: false },
      { w: 0, r: 8, done: false },
      { w: 0, r: 8, done: false }
    ])

    const reverseS = {
      exWeights: {},
      workouts: [{
        d: '2026-01-02',
        routineId: 'routine-b',
        entries: [{
          id: BW,
          target: { sets: 4, reps: 8, weight: 0, bodyweight: true },
          sets: [
            { w: 0, r: 8, done: true }, { w: 0, r: 8, done: true },
            { w: 0, r: 8, done: true }, { w: 0, r: 8, done: true }
          ]
        }]
      }]
    }
    expect(buildSets(reverseS, { ...cfg, sets: 2, reps: 15 }, { useTarget: true })).toEqual([
      { w: 0, r: 15, done: false },
      { w: 0, r: 15, done: false }
    ])
  })

  it('preserves configured load, reps, duration and cardio targets when history is present', () => {
    const repsS = {
      exWeights: { [LIFT]: { w: 75 } },
      workouts: [{ d: '2026-01-01', entries: [{ id: LIFT, sets: [{ w: 75, r: 15, done: true }] }] }]
    }
    expect(buildSets(repsS, { id: LIFT, sets: 2, reps: 8, weight: 40 }, { useTarget: true }))
      .toEqual([{ w: 40, r: 8, done: false }, { w: 40, r: 8, done: false }])

    const timedS = {
      exWeights: {},
      workouts: [{ d: '2026-01-02', entries: [{ id: LIFT, target: { mode: 'time' }, sets: [{ sec: 90, w: 20, done: true }] }] }]
    }
    expect(buildSets(timedS, { id: LIFT, mode: 'time', sets: 2, sec: 30, weight: 5 }, { useTarget: true }))
      .toEqual([{ sec: 30, w: 5, done: false }, { sec: 30, w: 5, done: false }])

    const cardioS = {
      exWeights: {},
      workouts: [{ d: '2026-01-03', entries: [{ id: CARDIO, sets: [{ min: 45, speed: 10, done: true }] }] }]
    }
    expect(buildSets(cardioS, { id: CARDIO, sets: 2, min: 20, speed: 8 }, { useTarget: true }))
      .toEqual([{ min: 20, speed: 8, done: false }, { min: 20, speed: 8, done: false }])
  })

})

describe('applyIntensifierPlan', () => {
  it('pre-fills every work row with a chain of drops, each pct% lighter than the one before', () => {
    const sets = [{ w: 100, r: 8, done: false }, { w: 100, r: 8, done: false }]
    const out = applyIntensifierPlan(sets, { intensifier: { type: 'dropset', count: 2, pct: 20 } })
    expect(out).toEqual([
      { w: 100, r: 8, done: false, type: 'dropset', drops: [{ w: 80, r: 8 }, { w: 64, r: 8 }] },
      { w: 100, r: 8, done: false, type: 'dropset', drops: [{ w: 80, r: 8 }, { w: 64, r: 8 }] },
    ])
  })

  it('collapses rest-pause to exactly two rows regardless of how many sets were configured: a warm-up at the exercise\'s own reps, then one work set whose own reps ARE the total', () => {
    const sets = [{ w: 60, r: 8, done: false }, { w: 60, r: 8, done: false }, { w: 60, r: 8, done: false }]
    const out = applyIntensifierPlan(sets, { reps: 8, intensifier: { type: 'restpause', totalReps: 12, restSec: 15 } })
    expect(out).toEqual([
      { w: 60, r: 8, done: false, phase: 'warmup' },
      { w: 60, r: 12, done: false, type: 'restpause', clusters: [{ r: 6, restSec: 15 }, { r: 3, restSec: 15 }, { r: 2, restSec: 15 }, { r: 1, restSec: 15 }] },
    ])
    // the full breakdown always sums back to the row's own r — no reps missing, none double-counted
    expect(out[1].clusters.reduce((sum, c) => sum + c.r, 0)).toBe(out[1].r)
  })

  it('the warm-up reps come from the exercise\'s own configured reps, not the rest-pause total', () => {
    const sets = [{ w: 60, r: 8, done: false }]
    const out = applyIntensifierPlan(sets, { reps: 5, intensifier: { type: 'restpause', totalReps: 20, restSec: 15 } })
    expect(out[0]).toEqual({ w: 60, r: 5, done: false, phase: 'warmup' })
  })

  it('carries the prescribed weight from the built sets onto both new rows', () => {
    const sets = [{ w: 82.5, r: 8, done: false }]
    const out = applyIntensifierPlan(sets, { reps: 8, intensifier: { type: 'restpause', totalReps: 4, restSec: 15 } })
    expect(out[0].w).toBe(82.5)
    expect(out[1].w).toBe(82.5)
  })

  it('never touches a warm-up row', () => {
    const sets = [{ w: 20, r: 8, done: false, phase: 'warmup' }, { w: 100, r: 8, done: false }]
    const out = applyIntensifierPlan(sets, { intensifier: { type: 'dropset', count: 1, pct: 20 } })
    expect(out[0]).toEqual({ w: 20, r: 8, done: false, phase: 'warmup' })
    expect(out[1].type).toBe('dropset')
  })

  it('leaves sets untouched with no intensifier configured', () => {
    const sets = [{ w: 100, r: 8, done: false }]
    expect(applyIntensifierPlan(sets, {})).toBe(sets)
    expect(applyIntensifierPlan(sets, { intensifier: { type: 'nonsense' } })).toBe(sets)
  })
})

describe('workoutVolume', () => {
  it('counts reps work and leaves timed/cardio sets out — there is no weight × reps for a hold', () => {
    const w = { entries: [
      { id: LIFT, sets: [{ w: 60, r: 10, done: true }, { w: 60, r: 10, done: false }] },
      { id: LIFT, target: { mode: 'time' }, sets: [{ sec: 60, w: 20, done: true }] },
      { id: CARDIO, sets: [{ min: 20, speed: 9, done: true }] }
    ] }
    expect(workoutVolume(w)).toBe(600)
  })

  it('needs no per-side case — the logged reps are already both sides (issue #31)', () => {
    const w = { entries: [{ id: LIFT, target: { side: true }, sets: [{ w: 20, r: 16, done: true }] }] }
    expect(workoutVolume(w)).toBe(320)
  })

  it('adds drop-set drops on top of the row\'s main set', () => {
    const dropRow = { type: 'dropset', w: 100, r: 5, done: true, drops: [{ w: 80, r: 5 }, { w: 60, r: 5 }] }
    expect(workoutVolume({ entries: [{ id: LIFT, sets: [dropRow] }] })).toBe(100 * 5 + 80 * 5 + 60 * 5)
  })

  it('counts a rest-pause row once — its own r is already the total across every burst', () => {
    const burstRow = { type: 'restpause', w: 60, r: 20, done: true, clusters: [{ r: 10, restSec: 15 }, { r: 5, restSec: 15 }, { r: 3, restSec: 15 }, { r: 1, restSec: 15 }, { r: 1, restSec: 15 }] }
    expect(workoutVolume({ entries: [{ id: LIFT, sets: [burstRow] }] })).toBe(60 * 20)
  })

  it('ignores drops/bursts on a row that was never checked off', () => {
    const dropRow = { type: 'dropset', w: 100, r: 5, done: false, drops: [{ w: 80, r: 5 }] }
    expect(workoutVolume({ entries: [{ id: LIFT, sets: [dropRow] }] })).toBe(0)
  })

  it('leaves an unloaded bodyweight set at zero volume rather than inventing a number', () => {
    const w = { entries: [{ id: BW, target: { bodyweight: true }, sets: [{ w: 0, r: 20, done: true }] }] }
    expect(workoutVolume(w)).toBe(0)
  })

  it('recognizes both warm-up schemas in work-set counts', () => {
    const w = {
      unit: 'kg',
      entries: [{
        id: LIFT,
        unit: 'kg',
        sets: [
          { warmup: true, unit: 'kg', w: 20, r: 5, done: true },
          { phase: 'warmup', unit: 'kg', w: 30, r: 5, done: true },
          { phase: 'work', unit: 'kg', w: 60, r: 5, done: true },
        ],
      }],
    }
    expect(workSetsDone(w)).toBe(1)
  })

  it('counts work sets the way it counts all sets: each side of a unilateral row (QA 1.3.9)', () => {
    const both = toggleSide(toggleSide(makeSideSet({ w: 20, r: 20 }), 'L'), 'R')
    const one = toggleSide(makeSideSet({ w: 20, r: 20 }), 'L')
    const w = { entries: [{ id: LIFT, sets: [both, one, { w: 30, r: 5, done: true }] }] }
    expect(setsDone(w)).toBe(4)
    // No warm-ups, so every set is a work set — the summary read "4 sets · 2 work".
    expect(workSetsDone(w)).toBe(4)
  })

  it('does not use a warm-up as the previous best working weight', () => {
    expect(bestWeightFor({ workouts: [{ entries: [{ id: LIFT, topW: 120, sets: [
      { phase: 'warmup', done: true, w: 120 },
      { phase: 'work', done: true, w: 80 },
    ] }] }] }, LIFT)).toBe(80)
    expect(bestWeightFor({ workouts: [{ entries: [{ id: LIFT, topW: 120, sets: [
      { phase: 'warmup', done: true, w: 120 },
    ] }] }] }, LIFT)).toBe(0)
  })

  it('uses completed non-warm-up load for timed entries', () => {
    expect(bestWeightForEntry({ target: { mode: 'time' }, topW: 200, sets: [
      { phase: 'warmup', sec: 30, w: 30, done: true },
      { phase: 'work', sec: 60, w: 20, done: true },
      { phase: 'work', sec: 75, w: 25, done: true },
      { phase: 'work', sec: 90, w: 40, done: false },
    ] })).toBe(25)
  })

  it('does not report a repeated weighted timed hold as a new load PR (blocker 3)', () => {
    const prior = {
      id: LIFT,
      target: { mode: 'time' },
      sets: [{ phase: 'work', sec: 60, w: 20, done: true }],
    }
    const repeated = {
      id: LIFT,
      target: { mode: 'time' },
      sets: [{ phase: 'work', sec: 60, w: 20, done: true }],
    }
    const state = { workouts: [{ entries: [prior] }] }
    const repeatedWeight = Math.max(0, ...repeated.sets.filter(set => set.done).map(set => set.w || 0))

    expect(bestWeightForEntry(prior)).toBe(20)
    expect(repeatedWeight > bestWeightFor(state, LIFT)).toBe(false)
  })
})

describe('superset editing', () => {
  it('pairs adjacent entries without mutating the source and keeps the display units contiguous', () => {
    const entries = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    const paired = pairAdjacent(entries, 1, 2, 'sg-new')

    expect(paired).toEqual([{ id: 'a' }, { id: 'b', sg: 'sg-new' }, { id: 'c', sg: 'sg-new' }])
    expect(entries).toEqual([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
    expect(supersetUnits(paired)).toEqual([[0], [1, 2]])
  })

  it('merges both contiguous groups when their boundary entries are paired', () => {
    const entries = [
      { id: 'a', sg: 'left' }, { id: 'b', sg: 'left' },
      { id: 'c', sg: 'right' }, { id: 'd', sg: 'right' }
    ]
    const merged = pairAdjacent(entries, 1, 2)

    expect(merged.map(e => e.sg)).toEqual(['left', 'left', 'left', 'left'])
    expect(entries.map(e => e.sg)).toEqual(['left', 'left', 'right', 'right'])
  })

  it('unpairs one entry and removes sg values left without an adjacent partner', () => {
    const entries = [
      { id: 'a', sg: 'group' }, { id: 'b', sg: 'group' }, { id: 'c', sg: 'group' },
      { id: 'd', sg: 'orphan' }
    ]
    const unpaired = unpairSuperset(entries, 1)

    expect(unpaired).toEqual([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }])
    expect(entries.map(e => e.sg)).toEqual(['group', 'group', 'group', 'orphan'])
  })

  it('rejects a non-adjacent pairing request', () => {
    const entries = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

    expect(() => pairAdjacent(entries, 0, 2, 'sg-invalid')).toThrow(/adjacent/)
    expect(entries).toEqual([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
  })
})

// The one grouping the detail sheet and "Copy as text" share: per routine first, supersets inside.
describe('sessionSections', () => {
  it('splits by routine in the order each first appears and pairs supersets only inside a section', () => {
    const entries = [
      { id: 'a', rid: 'A', sg: 'x' }, { id: 'b', rid: 'B', sg: 'x' }, { id: 'c', rid: 'B', sg: 'y' },
      { id: 'd', rid: 'B', sg: 'y' }, { id: 'e', rid: 'A' },
    ]
    expect(sessionSections(entries)).toEqual([
      { rid: 'A', items: [0, 4], units: [[0], [4]] },
      { rid: 'B', items: [1, 2, 3], units: [[1], [2, 3]] },
    ])
  })

  it('keeps a workout without routines as one section, the flat list', () => {
    const entries = [{ id: 'a', sg: 'x' }, { id: 'b', sg: 'x' }, { id: 'c' }]
    expect(sessionSections(entries)).toEqual([{ rid: null, items: [0, 1, 2], units: supersetUnits(entries) }])
    expect(sessionSections(undefined)).toEqual([])
  })
})

describe('superset editing', () => {
  it('pairs adjacent entries without mutating the source and keeps the display units contiguous', () => {
    const entries = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    const paired = pairAdjacent(entries, 1, 2, 'sg-new')

    expect(paired).toEqual([{ id: 'a' }, { id: 'b', sg: 'sg-new' }, { id: 'c', sg: 'sg-new' }])
    expect(entries).toEqual([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
    expect(supersetUnits(paired)).toEqual([[0], [1, 2]])
  })

  it('merges both contiguous groups when their boundary entries are paired', () => {
    const entries = [
      { id: 'a', sg: 'left' }, { id: 'b', sg: 'left' },
      { id: 'c', sg: 'right' }, { id: 'd', sg: 'right' }
    ]
    const merged = pairAdjacent(entries, 1, 2)

    expect(merged.map(e => e.sg)).toEqual(['left', 'left', 'left', 'left'])
    expect(entries.map(e => e.sg)).toEqual(['left', 'left', 'right', 'right'])
  })

  it('unpairs one entry and removes sg values left without an adjacent partner', () => {
    const entries = [
      { id: 'a', sg: 'group' }, { id: 'b', sg: 'group' }, { id: 'c', sg: 'group' },
      { id: 'd', sg: 'orphan' }
    ]
    const unpaired = unpairSuperset(entries, 1)

    expect(unpaired).toEqual([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }])
    expect(entries.map(e => e.sg)).toEqual(['group', 'group', 'group', 'orphan'])
  })

  it('rejects a non-adjacent pairing request', () => {
    const entries = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

    expect(() => pairAdjacent(entries, 0, 2, 'sg-invalid')).toThrow(/adjacent/)
    expect(entries).toEqual([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
  })
})


describe('session row helpers', () => {
  it('cascadeWeight propagates to same-flag undone rows and never rewrites done sets', () => {
    const rows = [
      { warmup: true, w: 20, done: true },
      { warmup: true, w: 20, done: false },
      { w: 60, done: true },
      { w: 60, done: false },
      { w: 60, done: false },
    ]
    const next = cascadeWeight(rows, 2, 62.5)
    expect(next[2].w).toBe(60)             // done set untouched
    expect(next[3].w).toBe(62.5)           // same flag (work), undone
    expect(next[4].w).toBe(62.5)           // same flag (work), undone
    expect(next[1].w).toBe(20)             // different flag (warm-up) untouched
  })

  // Editing warm-up 1 of an incline bench ramp used to copy the new load onto the later
  // warm-ups, so each one had to be put back by hand. Each rung keeps its own load.
  it('cascadeWeight leaves the later warm-up rungs on their ramp loads', () => {
    const S = { unit: 'lb', exWeights: {}, workouts: [] }
    const rows = buildSets(S, { id: '0047', mode: 'reps', sets: 4, reps: 8, weight: 125, warmupSets: 3 }, { step: 5 })
    expect(rows.map(r => r.w)).toEqual([60, 90, 105, 125, 125, 125, 125])
    const next = cascadeWeight(rows, 0, 70)   // the caller writes the edited row itself
    expect(next.map(r => r.w)).toEqual([60, 90, 105, 125, 125, 125, 125])
    const later = cascadeWeight(rows, 1, 100)
    expect(later.map(r => r.w)).toEqual([60, 90, 105, 125, 125, 125, 125])
    // a work-set edit still carries through the work sets and never reaches back into the ramp
    expect(cascadeWeight(rows, 3, 130).map(r => r.w)).toEqual([60, 90, 105, 125, 130, 130, 130])
  })

  it('cascadeWeight leaves later one-side warm-up rungs alone too', () => {
    const rows = [
      { ...makeSideSet({ w: 10, r: 16 }), phase: 'warmup' },
      { ...makeSideSet({ w: 15, r: 16 }), phase: 'warmup' },
      makeSideSet({ w: 25, r: 16 }),
    ]
    const next = cascadeWeight(rows, 0, 5, 'L')
    expect(next[1].sides.L.w).toBe(15)
    expect(next[1].sides.R.w).toBe(15)
    expect(next[2].sides.L.w).toBe(25)
  })

  it('cascadeWeight deleting the weight removes the key from following undone rows only', () => {
    const rows = [
      { w: 60, done: true },
      { w: 60, done: false },
      { w: 60, done: false },
    ]
    const next = cascadeWeight(rows, 0, null)
    expect(next[0].w).toBe(60)             // done set untouched
    expect('w' in next[1]).toBe(false)
    expect('w' in next[2]).toBe(false)
  })

  it('cascadeWeight lowers inherited rows but keeps an explicitly edited heavier row and done rows', () => {
    const rows = [
      { w: 100, done: false },
      { w: 100, done: false },
      { w: 120, weightOrigin: WEIGHT_ORIGIN_MANUAL, done: false },
      { w: 100, done: true },
      { w: 100, done: false },
    ]
    const next = cascadeWeight(rows, 0, 80)
    expect(next[1].w).toBe(80)             // inherited rows follow downward corrections
    expect(next[2].w).toBe(120)             // only explicit manual edits are protected
    expect(next[3].w).toBe(100)             // performed work is immutable
    expect(next[4].w).toBe(80)
  })

  it('cascadeWeight cascades one per-side lane, preserving manual and completed limbs', () => {
    const inherited = makeSideSet({ w: 20, r: 16 })
    const manualRight = setSideField(makeSideSet({ w: 20, r: 16 }), 'R', 'w', 25)
    manualRight.sides.R.weightOrigin = WEIGHT_ORIGIN_MANUAL
    const partial = toggleSide(makeSideSet({ w: 20, r: 16 }), 'L')
    const rows = [makeSideSet({ w: 20, r: 16 }), inherited, manualRight, partial]
    const next = cascadeWeight(rows, 0, 15, 'L')

    expect(next[1].sides.L.w).toBe(15)
    expect(next[1].sides.R.w).toBe(20)
    expect(next[2].sides.L.w).toBe(15)
    expect(next[2].sides.R.w).toBe(25)      // an explicit right-side edit is independent
    expect(next[3].sides.L.w).toBe(20)      // completed left side is immutable
    expect(next[3].sides.R.w).toBe(20)       // the edit was for the left-side lane only
  })

  it('insertWarmupRow inserts before the first work row, ramping toward the work weight', () => {
    const rows = [
      { warmup: true, w: 20, r: 8, done: true },
      { warmup: true, w: 30, r: 8, done: false },
      { w: 60, r: 8, done: false },
    ]
    const next = insertWarmupRow(rows, 'reps', { reps: 8 }, 2.5)
    expect(next.length).toBe(4)
    expect(next[2].warmup).toBe(true)
    expect(next[2].w).toBe(45)             // halfway from the last warm-up (30) to the work set (60)
    expect(next[3].w).toBe(60)             // work row still after the warm-up block
  })

  // The first warm-up is the case that was broken: `at` is 0, so the old code read rows[-1],
  // fell through to `rows[rows.length - 1]` — the heaviest work set — and handed you a
  // "warm-up" at your full working weight.
  it('gives the first warm-up half the working weight, not the working weight itself', () => {
    const next = insertWarmupRow([{ w: 100, r: 5, done: false }], 'reps', { reps: 5 }, 2.5)
    expect(next.length).toBe(2)
    expect(next[0]).toMatchObject({ w: 50, r: 5, phase: 'warmup', warmup: true, done: false })
    expect(next[1].w).toBe(100)
  })

  it('rounds the ramp to the exercise loading step', () => {
    // 0 -> 95 halves to 47.5, which is not loadable in 5 kg steps: 45 is.
    expect(insertWarmupRow([{ w: 95, r: 5 }], 'reps', { reps: 5 }, 5)[0].w).toBe(45)
  })

  it('keeps bodyweight warm-ups at zero and never exceeds the work set', () => {
    expect(insertWarmupRow([{ w: 0, r: 12 }], 'reps', { reps: 12 }, 2.5)[0].w).toBe(0)
    // A warm-up already at the working weight cannot ramp any further.
    const at100 = insertWarmupRow([{ warmup: true, w: 100, r: 5 }, { w: 100, r: 5 }], 'reps', { reps: 5 }, 2.5)
    expect(at100[1].w).toBe(100)
  })

  it('ramps a timed hold the same way and leaves cardio on the work row values', () => {
    expect(insertWarmupRow([{ sec: 45, w: 40, done: false }], 'time', { sec: 45 }, 2.5)[0])
      .toMatchObject({ sec: 45, w: 20, phase: 'warmup' })
    expect(insertWarmupRow([{ min: 20, speed: 10, done: false }], 'cardio', { min: 20 }, 2.5)[0])
      .toMatchObject({ min: 20, speed: 10, phase: 'warmup' })
  })

  it('removeRowAt never empties an entry below one row', () => {
    expect(removeRowAt([{ w: 60 }], 0).length).toBe(1)
    const rows = [{ w: 60 }, { w: 70 }]
    const next = removeRowAt(rows, 0)
    expect(next.length).toBe(1)
    expect(next[0].w).toBe(70)
  })
})

// The importer writes `phase: 'warmup'` and no `warmup` boolean (import-csv.js), so anything
// reading the raw flag counts an imported warm-up as work. Read through the model instead.
describe('warm-up rows identified by phase alone', () => {
  const imported = { w: 40, r: 10, done: true, phase: 'warmup' }
  const work = { w: 100, r: 5, done: true }

  it('workSetsDone does not count a phase-only warm-up', () => {
    expect(workSetsDone({ entries: [{ sets: [imported, work] }] })).toBe(1)
  })

  it('cascadeWeight treats a phase-only warm-up as a warm-up: the edit stays on its row', () => {
    const rows = [
      { w: 40, r: 10, phase: 'warmup' },
      { w: 45, r: 10, phase: 'warmup' },
      { w: 100, r: 5 },
    ]
    const next = cascadeWeight(rows, 0, 50)
    expect(next[1].w).toBe(45)
    expect(next[2].w).toBe(100)
  })
})

describe('nextTrainingDay', () => {
  // 2026-08-18 is a Tuesday; the week map is keyed by getDay(), so 0 is Sunday.
  const TUE = '2026-08-18'
  const base = (over = {}) => ({
    dayPlan: {},
    routines: [{ id: 'r1', name: 'A', ex: [{ id: '0001' }] }, { id: 'r2', name: 'B', ex: [{ id: '0002' }] }],
    week: {},
    ...over
  })

  it('finds the next scheduled day and names its routine', () => {
    const S = base({ week: { 4: 'r2' } })                 // Thursday
    expect(nextTrainingDay(S, TUE)).toMatchObject({ iso: '2026-08-20', weekday: 4 })
    expect(nextTrainingDay(S, TUE).routine.name).toBe('B')
  })

  it('looks forward only — today itself is never the answer', () => {
    // Only Tuesday is scheduled and today is Tuesday, so the next one is a week out. (The UI
    // cannot reach this: a day with a session takes the other branch and never asks.)
    const S = base({ week: { 2: 'r1' } })
    expect(nextTrainingDay(S, TUE)).toMatchObject({ iso: '2026-08-25', weekday: 2 })
  })

  it('wraps around the end of the week', () => {
    const S = base({ week: { 1: 'r1' } })                 // Monday, six days on
    expect(nextTrainingDay(S, TUE)).toMatchObject({ iso: '2026-08-24', weekday: 1 })
  })

  it('is null when every day is rest', () => {
    expect(nextTrainingDay(base(), TUE)).toBeNull()
  })

  it('skips a day whose routine no longer exists', () => {
    const S = base({ week: { 3: 'gone', 5: 'r1' } })
    expect(nextTrainingDay(S, TUE)).toMatchObject({ iso: '2026-08-21', weekday: 5 })
  })

  it('skips a routine with no exercises — starting it would open an empty session', () => {
    const S = base({ routines: [{ id: 'r1', name: 'A', ex: [] }, { id: 'r2', name: 'B', ex: [{ id: '1' }] }], week: { 3: 'r1', 5: 'r2' } })
    expect(nextTrainingDay(S, TUE)).toMatchObject({ weekday: 5 })
  })

  it('respects a per-date override in both directions', () => {
    const moved = base({ week: {}, dayPlan: { '2026-08-19': 'r1' } })
    expect(nextTrainingDay(moved, TUE)).toMatchObject({ iso: '2026-08-19' })
    const off = base({ week: { 3: 'r1', 5: 'r2' }, dayPlan: { '2026-08-19': 'rest' } })
    expect(nextTrainingDay(off, TUE)).toMatchObject({ weekday: 5 })
  })

  it('finds a coach week waiting on its start day (lib/queue.js)', () => {
    // effectiveRoutineIds defaults `today` to the clock, so this one case is pinned relative
    // to the real today: a queue that starts in three days is found three days out.
    const today = todayISO()
    const d = new Date(today + 'T12:00:00'); d.setDate(d.getDate() + 3)
    const startsOn = isoOf(d)
    const S = base({ workouts: [], queue: { ids: ['r2'], since: Date.now(), startsOn, label: 'W2' } })
    expect(nextTrainingDay(S, today)).toMatchObject({ iso: startsOn })
    expect(nextTrainingDay(S, today).routine.name).toBe('B')
  })
})

describe('pinnedNoteFor', () => {
  const S = {
    workouts: [
      { d: '2026-08-01', entries: [{ id: '0025', note: 'felt heavy', notePin: true }] },
      { d: '2026-08-08', entries: [{ id: '0025', note: 'just a diary line' }] },
      { d: '2026-08-15', entries: [{ id: '0025', note: 'go narrower', notePin: true }] },
      { d: '2026-08-22', entries: [{ id: '0293', note: 'other exercise', notePin: true }] },
    ],
  }

  it('returns only the newest pinned note for that exercise', () => {
    expect(pinnedNoteFor(S, '0025')).toEqual({ note: 'go narrower', d: '2026-08-15' })
  })

  it('ignores notes that were not pinned', () => {
    expect(pinnedNoteFor({ workouts: [{ d: '2026-08-08', entries: [{ id: '0025', note: 'diary' }] }] }, '0025')).toBeNull()
  })

  it('skips the workout being edited, whose note the editor already shows', () => {
    const ws = [
      { id: 'w1', d: '2026-08-01', entries: [{ id: '0025', note: 'older pin', notePin: true }] },
      { id: 'w2', d: '2026-08-15', entries: [{ id: '0025', note: 'its own pin', notePin: true }] },
    ]
    expect(pinnedNoteFor({ workouts: ws, active: { editingWorkoutId: 'w2' } }, '0025')).toEqual({ note: 'older pin', d: '2026-08-01' })
    expect(pinnedNoteFor({ workouts: ws, active: { editingWorkoutId: 'w1' } }, '0025')).toEqual({ note: 'its own pin', d: '2026-08-15' })
    // a workout logged before ids is keyed by day and start
    const legacy = [{ d: '2026-08-15', start: 1000, entries: [{ id: '0025', note: 'its own pin', notePin: true }] }]
    expect(pinnedNoteFor({ workouts: legacy, active: { editingWorkoutId: '2026-08-15|1000' } }, '0025')).toBeNull()
  })

  it('is null for an exercise with no notes, and safe on empty state', () => {
    expect(pinnedNoteFor(S, '9999')).toBeNull()
    expect(pinnedNoteFor({}, '0025')).toBeNull()
  })
})

describe('exNoteFor', () => {
  it('reads the standing note and trims it away when blank', () => {
    expect(exNoteFor({ exNotes: { '0025': ' seat 4, pin 7 ' } }, '0025')).toBe('seat 4, pin 7')
    expect(exNoteFor({ exNotes: { '0025': '   ' } }, '0025')).toBeNull()
    expect(exNoteFor({}, '0025')).toBeNull()
  })
})

describe('nextTrainingDay', () => {
  // 2026-08-18 is a Tuesday; the week map is keyed by getDay(), so 0 is Sunday.
  const TUE = '2026-08-18'
  const base = (over = {}) => ({
    dayPlan: {},
    routines: [{ id: 'r1', name: 'A', ex: [{ id: '0001' }] }, { id: 'r2', name: 'B', ex: [{ id: '0002' }] }],
    week: {},
    ...over
  })

  it('finds the next scheduled day and names its routine', () => {
    const S = base({ week: { 4: 'r2' } })                 // Thursday
    expect(nextTrainingDay(S, TUE)).toMatchObject({ iso: '2026-08-20', weekday: 4 })
    expect(nextTrainingDay(S, TUE).routine.name).toBe('B')
  })

  it('looks forward only — today itself is never the answer', () => {
    // Only Tuesday is scheduled and today is Tuesday, so the next one is a week out. (The UI
    // cannot reach this: a day with a session takes the other branch and never asks.)
    const S = base({ week: { 2: 'r1' } })
    expect(nextTrainingDay(S, TUE)).toMatchObject({ iso: '2026-08-25', weekday: 2 })
  })

  it('wraps around the end of the week', () => {
    const S = base({ week: { 1: 'r1' } })                 // Monday, six days on
    expect(nextTrainingDay(S, TUE)).toMatchObject({ iso: '2026-08-24', weekday: 1 })
  })

  it('is null when every day is rest', () => {
    expect(nextTrainingDay(base(), TUE)).toBeNull()
  })

  it('skips a day whose routine no longer exists', () => {
    const S = base({ week: { 3: 'gone', 5: 'r1' } })
    expect(nextTrainingDay(S, TUE)).toMatchObject({ iso: '2026-08-21', weekday: 5 })
  })

  it('skips a routine with no exercises — starting it would open an empty session', () => {
    const S = base({ routines: [{ id: 'r1', name: 'A', ex: [] }, { id: 'r2', name: 'B', ex: [{ id: '1' }] }], week: { 3: 'r1', 5: 'r2' } })
    expect(nextTrainingDay(S, TUE)).toMatchObject({ weekday: 5 })
  })

  it('respects a per-date override in both directions', () => {
    const moved = base({ week: {}, dayPlan: { '2026-08-19': 'r1' } })
    expect(nextTrainingDay(moved, TUE)).toMatchObject({ iso: '2026-08-19' })
    const off = base({ week: { 3: 'r1', 5: 'r2' }, dayPlan: { '2026-08-19': 'rest' } })
    expect(nextTrainingDay(off, TUE)).toMatchObject({ weekday: 5 })
  })
})

/* ---------- one-sided (unilateral) sets, logged per side (issue #60) ---------- */

// A per-side row carries its two sides and a scalar aggregate. These pin that the display shows
// both sides, and — crucially — that every aggregate-reading consumer (volume, best weight, the
// x/y-sets counters) treats the row correctly without knowing sides exist.
describe('setLabel — per side', () => {
  it('shows both sides so an asymmetry is visible, not a single combined total', () => {
    const s = setSideField(setSideField(makeSideSet({ w: 15, r: 16 }), 'R', 'r', 7), 'L', 'r', 8)
    expect(setLabel(LIFT, s, { id: LIFT, side: true })).toBe('L 15×8 · R 15×7')
  })

  it('keeps each side effort tail and reads bodyweight sides as reps alone', () => {
    let s = makeSideSet({ w: 0, r: 16 })
    s = setSideField(s, 'L', 'rir', 1)
    expect(setLabel(BW, s, { id: BW, side: true })).toBe('L 8 (RIR 1) · R 8')
  })
})

describe('per-side aggregate stays readable by existing consumers', () => {
  it('workoutVolume counts both sides via the row total, unchanged from a straight set', () => {
    // 15×8 per side = 15×16 total = 240, exactly what a straight {w:15,r:16} would score.
    const side = { ...makeSideSet({ w: 15, r: 16 }), done: true }
    const synced = toggleSide(toggleSide(makeSideSet({ w: 15, r: 16 }), 'L'), 'R') // both done
    const w = { entries: [{ id: LIFT, sets: [synced] }] }
    expect(synced.done).toBe(true)
    expect(workoutVolume(w)).toBe(240)
    // and a straight equivalent scores the same
    expect(workoutVolume({ entries: [{ id: LIFT, sets: [{ w: 15, r: 16, done: true }] }] })).toBe(240)
  })

  it('bestWeightForEntry reads the aggregate weight of a completed per-side set', () => {
    const s = toggleSide(toggleSide(setSideField(makeSideSet({ w: 15, r: 16 }), 'R', 'w', 17.5), 'L'), 'R')
    expect(bestWeightForEntry({ id: LIFT, target: { id: LIFT, side: true }, sets: [s] })).toBe(17.5)
  })

  it('uses only completed side loads and reps when the other limb is unfinished', () => {
    const partial = {
      id: LIFT,
      target: { id: LIFT, mode: 'reps', side: true },
      sets: [{ phase: 'work', w: 200, r: 10, done: false,
        sides: { L: { w: 100, r: 5, done: true }, R: { w: 200, r: 5, done: false } } }],
    }
    expect(bestWeightForEntry(partial)).toBe(100)
    expect(completedRepsOf(metricRowsForEntry(partial, 'reps')[0])).toBe(5)
  })
})

describe('per-side set counters', () => {
  it('setUnits counts a per-side row as two, a straight row as one', () => {
    expect(setUnits(makeSideSet({ w: 15, r: 16 }))).toBe(2)
    expect(setUnits({ w: 15, r: 16 })).toBe(1)
  })

  it('doneUnits counts each finished side independently', () => {
    const none = makeSideSet({ w: 15, r: 16 })
    expect(doneUnits(none)).toBe(0)
    expect(doneUnits(toggleSide(none, 'L'))).toBe(1)
    expect(doneUnits(toggleSide(toggleSide(none, 'L'), 'R'))).toBe(2)
    expect(doneUnits({ w: 15, r: 16, done: true })).toBe(1)
  })

  it('setUnitsTotal / setsDoneActive account for both sides across the session', () => {
    const A = { entries: [
      { id: LIFT, sets: [toggleSide(makeSideSet({ w: 15, r: 16 }), 'L'), makeSideSet({ w: 15, r: 16 })] }, // 2 rows × 2 sides = 4 units, 1 side done
      { id: LIFT, sets: [{ w: 60, r: 8, done: true }] },                                                    // 1 straight, done
    ] }
    expect(setUnitsTotal(A.entries)).toBe(5)
    expect(setsDoneActive(A)).toBe(2)
    expect(setsDone({ entries: A.entries })).toBe(2)
  })
})

// ---- combine routines: plural planner resolver + per-entry noProg (ENG-9) ----
describe('effectiveRoutineIds / effectiveRoutines', () => {
  const routines = [{ id: 'r1', name: 'A', ex: [{ id: '1' }] }, { id: 'r2', name: 'B', ex: [{ id: '2' }] }]
  const S = (week, dayPlan = {}) => ({ routines, week, dayPlan })
  const ISO = '2026-08-19'                       // a Wednesday → getDay() 3

  it('reads a bare-string weekday value as a one-element list (tolerant reader)', () => {
    expect(effectiveRoutineIds(S({ 3: 'r1' }), ISO)).toEqual(['r1'])
  })
  it('resolves a multi-id array and filters out routines that no longer exist', () => {
    expect(effectiveRoutineIds(S({ 3: ['r1', 'gone', 'r2'] }), ISO)).toEqual(['r1', 'r2'])
    expect(effectiveRoutines(S({ 3: ['r1', 'r2'] }), ISO).map(r => r.name)).toEqual(['A', 'B'])
  })
  it('treats [], a stray empty array and an absent key all as rest', () => {
    expect(effectiveRoutineIds(S({ 3: [] }), ISO)).toEqual([])
    expect(effectiveRoutineIds(S({}), ISO)).toEqual([])
  })
  it('a scalar dayPlan override wins and stays scalar; "rest" is empty', () => {
    expect(effectiveRoutineIds(S({ 3: ['r1', 'r2'] }, { [ISO]: 'r2' }), ISO)).toEqual(['r2'])
    expect(effectiveRoutineIds(S({ 3: ['r1', 'r2'] }, { [ISO]: 'rest' }), ISO)).toEqual([])
  })
  it('the singular wrappers return [0] ?? null', () => {
    expect(effectiveRoutineId(S({ 3: ['r1', 'r2'] }), ISO)).toBe('r1')
    expect(effectiveRoutine(S({ 3: ['r1', 'r2'] }), ISO).name).toBe('A')
    expect(effectiveRoutineId(S({}), ISO)).toBe(null)
    expect(effectiveRoutine(S({}), ISO)).toBe(null)
  })
})

// ---- coach queue: the week's sessions in order, the first undone one is today's (lib/queue.js) ----
describe('effectiveRoutineIds — coach queue', () => {
  const routines = [
    { id: 'd1', name: 'US W1 D1', ex: [{ id: '1' }] }, { id: 'd2', name: 'US W1 D2', ex: [{ id: '1' }] },
    { id: 'own', name: 'Core', ex: [{ id: '2' }] },
  ]
  const TODAY = '2026-09-09'                     // a Wednesday → getDay() 3
  const SINCE = Date.parse('2026-09-07T08:00:00')
  const S = (over = {}) => ({
    routines, week: {}, dayPlan: {}, workouts: [],
    queue: { ids: ['d1', 'd2'], since: SINCE, startsOn: '2026-09-07', label: 'US W1' },
    ...over,
  })
  const done = id => ({ id: 'w' + id, d: '2026-09-08', start: SINCE + 3600000, routineIds: [id], routineId: id, name: routines.find(r => r.id === id).name })

  it('today gets the first undone session; other days get nothing from the queue', () => {
    expect(effectiveRoutineIds(S(), TODAY, TODAY)).toEqual(['d1'])
    expect(effectiveRoutineIds(S(), '2026-09-10', TODAY)).toEqual([])
    expect(effectiveRoutineIds(S({ workouts: [done('d1')] }), TODAY, TODAY)).toEqual(['d2'])
  })

  it('before startsOn the session sits on that day, not on today', () => {
    const s = S({ queue: { ...S().queue, startsOn: '2026-09-14' } })
    expect(effectiveRoutineIds(s, TODAY, TODAY)).toEqual([])
    expect(effectiveRoutineIds(s, '2026-09-14', TODAY)).toEqual(['d1'])
  })

  it('a complete week hands the day back to the weekday plan', () => {
    const s = S({ workouts: [done('d1'), done('d2')], week: { 3: ['own'] } })
    expect(effectiveRoutineIds(s, TODAY, TODAY)).toEqual(['own'])
    expect(effectiveRoutineIds(S({ workouts: [done('d1'), done('d2')] }), TODAY, TODAY)).toEqual([])
  })

  it('a per-date override still wins over the queue', () => {
    expect(effectiveRoutineIds(S({ dayPlan: { [TODAY]: 'rest' } }), TODAY, TODAY)).toEqual([])
    expect(effectiveRoutineIds(S({ dayPlan: { [TODAY]: 'own' } }), TODAY, TODAY)).toEqual(['own'])
  })

  it('own routines on the weekday ride along behind the session', () => {
    expect(effectiveRoutineIds(S({ week: { 3: ['own'] } }), TODAY, TODAY)).toEqual(['d1', 'own'])
  })

  it('legacy coach weekday pointers are hidden behind the queue', () => {
    expect(effectiveRoutineIds(S({ week: { 3: ['d2', 'own'] } }), TODAY, TODAY)).toEqual(['d1', 'own'])
    expect(effectiveRoutineIds(S({ week: { 3: 'd1' } }), TODAY, TODAY)).toEqual(['d1'])
  })

  it('without a queue the weekday plan answers as before', () => {
    expect(effectiveRoutineIds(S({ queue: null, week: { 3: ['own'] } }), TODAY, TODAY)).toEqual(['own'])
  })

  // ---- pins: an override naming a queue session re-dates it (lib/queue.js pinState) ----
  it('a session pinned to a later day is that day\'s, with the weekday\'s own routine riding along; today floats past it', () => {
    const s = S({ dayPlan: { '2026-09-11': 'd1' }, week: { 5: ['own'] } })
    expect(effectiveRoutineIds(s, '2026-09-11', TODAY)).toEqual(['d1', 'own'])
    expect(effectiveRoutineIds(s, TODAY, TODAY)).toEqual(['d2'])
    // Pinned to today: it is today's session, ahead of the floating order.
    expect(effectiveRoutineIds(S({ dayPlan: { [TODAY]: 'd2' } }), TODAY, TODAY)).toEqual(['d2'])
  })

  it('a fulfilled pin reads as no override: the day goes back to the floating rule or the weekday', () => {
    const s = S({ dayPlan: { '2026-09-11': 'd1' }, workouts: [done('d1')], week: { 5: ['own'] } })
    expect(effectiveRoutineIds(s, '2026-09-11', TODAY)).toEqual(['own'])
    expect(effectiveRoutineIds(s, TODAY, TODAY)).toEqual(['d2'])
    // Done early on the pinned day itself: today's answer is the next floating session.
    expect(effectiveRoutineIds(S({ dayPlan: { [TODAY]: 'd1' }, workouts: [done('d1')] }), TODAY, TODAY)).toEqual(['d2'])
  })

  it('with every remaining session pinned to other days, today shows only your own routines — a coach pointer on the weekday stays hidden', () => {
    const s = S({ dayPlan: { '2026-09-11': 'd1', '2026-09-12': 'd2' }, week: { 3: ['d2', 'own'] } })
    expect(effectiveRoutineIds(s, TODAY, TODAY)).toEqual(['own'])
    expect(effectiveRoutineIds(S({ dayPlan: { '2026-09-11': 'd1', '2026-09-12': 'd2' }, week: { 3: 'd1' } }), TODAY, TODAY)).toEqual([])
  })

  it('a plain routine override is still single-pick, and \'rest\' still wins over a pin', () => {
    expect(effectiveRoutineIds(S({ dayPlan: { [TODAY]: 'own' }, week: { 3: ['own'] } }), TODAY, TODAY)).toEqual(['own'])
    expect(effectiveRoutineIds(S({ dayPlan: { [TODAY]: 'rest', '2026-09-11': 'd1' } }), TODAY, TODAY)).toEqual([])
  })
})

describe('nextTrainingDay on a combined day', () => {
  const TUE = '2026-08-18'
  it('is trainable when any one routine of the day has exercises; return shape carries routines', () => {
    const S = {
      routines: [{ id: 'r1', name: 'A', ex: [] }, { id: 'r2', name: 'B', ex: [{ id: '1' }] }],
      week: { 3: ['r1', 'r2'] }, dayPlan: {},
    }
    const nd = nextTrainingDay(S, TUE)
    expect(nd).toMatchObject({ weekday: 3 })
    expect(nd.routines.map(r => r.name)).toEqual(['A', 'B'])
    expect(nd.routine.name).toBe('A')
  })
  it('skips a day whose every routine is empty', () => {
    const S = {
      routines: [{ id: 'r1', name: 'A', ex: [] }, { id: 'r2', name: 'B', ex: [] }, { id: 'r3', name: 'C', ex: [{ id: '1' }] }],
      week: { 3: ['r1', 'r2'], 5: ['r3'] }, dayPlan: {},
    }
    expect(nextTrainingDay(S, TUE)).toMatchObject({ weekday: 5 })
  })
})

describe('lastEntryFor / buildSets skip a noProg entry', () => {
  const LIFT2 = EXDB.find(e => e.bp !== 'cardio' && e.eq !== 'body weight').id
  const wk = (d, w, r, extra) => ({ d, entries: [{ id: LIFT2, target: { sets: 1, reps: r, weight: w }, sets: [{ w, r, done: true }], ...extra }] })

  it('lastEntryFor returns the prior counting session, not a later noProg one', () => {
    const S = { workouts: [wk('2026-01-01', 60, 8), wk('2026-01-05', 30, 12, { noProg: true })] }
    expect(lastEntryFor(S, LIFT2).d).toBe('2026-01-01')
  })
  it('lastEntryFor skips a legacy whole-workout excludeFromProgression session', () => {
    const S = { workouts: [wk('2026-01-01', 60, 8), { d: '2026-01-05', excludeFromProgression: true, entries: [{ id: LIFT2, target: { sets: 1, reps: 12, weight: 30 }, sets: [{ w: 30, r: 12, done: true }] }] }] }
    expect(lastEntryFor(S, LIFT2).d).toBe('2026-01-01')
  })
  it('buildSets seeds opening rows from the last counting session', () => {
    const S = { exWeights: {}, workouts: [wk('2026-01-01', 60, 8), wk('2026-01-05', 30, 12, { noProg: true })] }
    expect(buildSets(S, { id: LIFT2, sets: 1, reps: 5, weight: 50 })).toEqual([{ w: 60, r: 8, done: false }])
  })
  it('buildSets with only noProg history falls back to the routine target', () => {
    const S = { exWeights: {}, workouts: [wk('2026-01-05', 30, 12, { noProg: true })] }
    expect(buildSets(S, { id: LIFT2, sets: 1, reps: 5, weight: 50 })).toEqual([{ w: 50, r: 5, done: false }])
  })
  it('freestyleConfig ignores a noProg entry', () => {
    const S = { exWeights: {}, workouts: [wk('2026-01-05', 30, 12, { noProg: true })] }
    expect(freestyleConfig(S, { id: LIFT2, mode: 'reps', sets: 3, reps: 10, weight: 0 })).toEqual({ id: LIFT2, mode: 'reps', sets: 3, reps: 10, weight: 0 })
  })
  it('bestWeightFor is unchanged — a heavy noProg set still counts toward Best', () => {
    const S = { workouts: [wk('2026-01-01', 60, 8), wk('2026-01-05', 140, 3, { noProg: true })] }
    expect(bestWeightFor(S, LIFT2)).toBe(140)
  })
})

// Issue #216: the same exercise in two routines — a heavy day and a light day — is two lines of
// history. Each routine reads its own, and one that has none reads the exercise's.
describe('routine slots: lastEntryFor / buildSets read the routine\'s own history (#216)', () => {
  const LIFT3 = EXDB.find(e => e.bp !== 'cardio' && e.eq !== 'body weight').id
  const session = (d, rid, w, r, extra = {}) => ({ id: LIFT3, ...(rid ? { rid } : {}), target: { sets: 2, reps: r, weight: w }, sets: [{ w, r, done: true }, { w, r, done: true }], ...extra })
  const S = {
    exWeights: { [LIFT3]: { w: 60 } },
    workouts: [
      { d: '2026-01-01', routineIds: ['A'], entries: [session('2026-01-01', 'A', 60, 10)] },
      { d: '2026-01-03', routineIds: ['B'], entries: [session('2026-01-03', 'B', 40, 15)] },
    ],
  }

  it('takes the routine\'s own last session, not the latest one of the exercise', () => {
    expect(lastEntryFor(S, LIFT3, 'A')).toMatchObject({ d: '2026-01-01', rid: 'A' })
    expect(lastEntryFor(S, LIFT3, 'B')).toMatchObject({ d: '2026-01-03', rid: 'B' })
    expect(lastEntryFor(S, LIFT3).d).toBe('2026-01-03')
  })

  it('falls back to the exercise\'s last session for a routine that never trained it', () => {
    expect(lastEntryFor(S, LIFT3, 'C')).toMatchObject({ d: '2026-01-03', rid: 'B' })
  })

  it('reads a combined day by the entry that belongs to the routine, not the first one', () => {
    const combined = { exWeights: {}, workouts: [{ d: '2026-01-05', routineIds: ['A', 'B'], entries: [session('', 'A', 60, 10), session('', 'B', 40, 15)] }] }
    expect(lastEntryFor(combined, LIFT3, 'B').sets.map(s => [s.w, s.r])).toEqual([[40, 15], [40, 15]])
    expect(lastEntryFor(combined, LIFT3, 'A').sets.map(s => [s.w, s.r])).toEqual([[60, 10], [60, 10]])
  })

  it('opens each routine\'s rows from its own line', () => {
    const cfg = { id: LIFT3, sets: 2, reps: 10, weight: 0 }
    expect(buildSets(S, cfg, { rid: 'A' }).map(s => s.w)).toEqual([60, 60])
    expect(buildSets(S, cfg, { rid: 'B' }).map(s => s.w)).toEqual([40, 40])
  })

  it('gives a session saved before per-entry routine ids to the workout\'s routine', () => {
    const legacy = { d: '2026-01-01', routineId: 'A', entries: [session('', null, 60, 10)] }
    expect(entryRoutineId(legacy, legacy.entries[0])).toBe('A')
    expect(entryRoutineId({ routineIds: ['B'], entries: [] }, { id: LIFT3 })).toBe('B')
    expect(lastEntryFor({ workouts: [legacy] }, LIFT3, 'A')).toMatchObject({ rid: 'A' })
  })

  it('leaves an exercise added to a freestyle session without a routine', () => {
    // "Add routine" on a freestyle session: the routine's entries carry its id, the exercise
    // picked before it does not — it was never part of that routine's plan.
    const w = { routineIds: ['A'], entries: [{ id: LIFT3 }, { id: 'x', rid: 'A' }] }
    expect(entryRoutineId(w, w.entries[0])).toBeNull()
    expect(entryRoutineId({ routineIds: [], entries: [{ id: LIFT3 }] }, { id: LIFT3 })).toBeNull()
  })
})

describe('per-side volume and legacy timed sets (QA round 2026-09-12)', () => {
  it('sums each side of a unilateral set on its own instead of max weight × total reps', () => {
    const w = { entries: [{ id: 'x', sets: [
      { done: true, sides: { L: { w: 14, r: 10, done: true }, R: { w: 12.5, r: 6, done: true } }, w: 14, r: 16 },
      { done: true, w: 100, r: 10 }
    ] }] }
    expect(workoutVolume(w)).toBe(14 * 10 + 12.5 * 6 + 1000)
  })
  it('reads a timed or cardio set saved without a target from the set itself', () => {
    expect(setLabel('0001', { sec: 45, done: true })).toBe('0:45')
    expect(setLabel('0001', { min: 20, speed: 8, done: true })).toBe('20 min @ 8 km/h')
    expect(setLabel('0025', { w: 60, r: 10, done: true })).toBe('60×10')
  })
})

describe('a rotation day and a fixed weekday day are one combined day', () => {
  const routines = [{ id: 'a', name: 'A', ex: [] }, { id: 'core', name: 'Core', ex: [] }]
  const TODAY = '2026-09-14'   // a Monday
  const S = over => ({
    routines, workouts: [], dayPlan: {}, week: { 1: ['core'] },
    queue: { ids: ['a'], since: Date.parse('2026-09-13T08:00:00'), startsOn: '2026-09-13', label: 'My split', rotationId: 'r1' },
    rotation: { id: 'r1', sequence: ['a'], label: 'My split' }, ...over,
  })

  it('the queue session comes first, the weekday routine rides along', () => {
    expect(effectiveRoutineIds(S(), TODAY, TODAY)).toEqual(['a', 'core'])
  })

  it('a malformed queue falls back to the plain weekday plan', () => {
    expect(effectiveRoutineIds(S({ queue: { ids: ['gone'], since: 1 } }), TODAY, TODAY)).toEqual(['core'])
  })

  it('a repeated queue id does not repeat the day', () => {
    const dup = S({ queue: { ids: ['a', 'a'], since: Date.parse('2026-09-13T08:00:00'), startsOn: '2026-09-13', label: 'My split' } })
    expect(effectiveRoutineIds(dup, TODAY, TODAY)).toEqual(['a', 'core'])
  })
})

describe('switching a row between warm-up and work', () => {
  it('makeWarmupAt gives the warm-up shape, keeps the numbers and the tick, and moves it in front of the work', () => {
    const rows = [{ w: 40, r: 8, phase: 'warmup', warmup: true, done: true }, { w: 100, r: 5, done: true, at: 7 }, { w: 100, r: 5, done: false, type: 'dropset', drops: [{ w: 80, r: 4 }], rir: 2 }]
    const plain = [...rows.slice(0, 2), { w: 100, r: 5, done: false, rir: 2 }]
    const next = makeWarmupAt(plain, 2)
    expect(next).toEqual([rows[0], { w: 100, r: 5, done: false, phase: 'warmup', warmup: true }, rows[1]])
    expect(makeWarmupAt(rows, 1)[1]).toEqual({ w: 100, r: 5, done: true, phase: 'warmup', warmup: true, at: 7 })
    expect(makeWarmupAt(rows, 0)).toBe(rows)
  })

  it('makeWarmupAt leaves drop, rest-pause and per-side rows as they are', () => {
    const drop = [{ w: 60, r: 8, done: true }, { w: 100, r: 5, done: true, type: 'dropset', drops: [{ w: 80, r: 4 }] }]
    expect(makeWarmupAt(drop, 1)).toBe(drop)
    const rp = [{ w: 60, r: 8, done: true }, { w: 100, r: 12, done: true, type: 'restpause', clusters: [{ r: 4, rest: 15 }] }]
    expect(makeWarmupAt(rp, 1)).toBe(rp)
    const side = [{ w: 30, r: 6, done: true }, { w: 30, r: 11, done: false, sides: { L: { w: 30, r: 5, done: true }, R: { w: 0, r: 6, done: false } } }]
    expect(makeWarmupAt(side, 1)).toBe(side)
    expect([canBeWarmup(drop[1]), canBeWarmup(rp[1]), canBeWarmup(side[1]), canBeWarmup(drop[0])]).toEqual([false, false, false, true])
  })

  it('a warm-up made one is left out of the best weight and the work-set count', () => {
    const e = { id: 'x', sets: makeWarmupAt([{ w: 60, r: 5, done: true }, { w: 120, r: 3, done: true }], 1) }
    expect(bestWeightForEntry(e)).toBe(60)
    expect(workSetsDone({ entries: [e] })).toBe(1)
  })

  it('makeWorkAt makes it the first work set', () => {
    const rows = [{ w: 40, r: 8, phase: 'warmup', warmup: true }, { w: 60, r: 8, phase: 'warmup', warmup: true, done: true }, { w: 100, r: 5 }]
    expect(makeWorkAt(rows, 0)).toEqual([rows[1], { w: 40, r: 8 }, rows[2]])
    expect(makeWorkAt(rows, 2)).toBe(rows)
  })
})

describe('timed per-side pairs come off as a pair', () => {
  const pairs = n => Array.from({ length: n }, (_, k) => [{ sec: 30, side: 'L', k }, { sec: 30, side: 'R', k }]).flat()

  it('removeLastSet pops the last L/R pair, so a later add keeps the pairs in step', () => {
    const next = removeLastSet(pairs(3))
    expect(next.map(r => r.side + r.k)).toEqual(['L0', 'R0', 'L1', 'R1'])
    expect(removeLastSet(pairs(1))).toEqual(pairs(1))
    expect(removeLastSet([{ w: 50, r: 5 }, { w: 50, r: 5 }])).toEqual([{ w: 50, r: 5 }])
  })

  it('removeRowAt takes a half out together with its partner', () => {
    expect(removeRowAt(pairs(3), 2).map(r => r.side + r.k)).toEqual(['L0', 'R0', 'L2', 'R2'])
    expect(removeRowAt(pairs(3), 3).map(r => r.side + r.k)).toEqual(['L0', 'R0', 'L2', 'R2'])
    expect(setSpanAt([{ sec: 30, side: 'L' }, { sec: 30 }], 0)).toEqual([0, 1])
  })
})
