import { describe, it, expect } from 'vitest'
import { nextTrainingDay, modeOf, isTimed, fmtSec, setLabel, defaultConfig, buildSets, freestyleConfig, exLine, workoutVolume, bestWeightFor, bestWeightForEntry, effortOf, stepEffort, capEffort, isBw, isPerSide, sideReps, repStep, cascadeWeight, insertWarmupRow, removeRowAt, workSetsDone, setsDone, setsDoneActive, setUnits, doneUnits, setUnitsTotal, pairAdjacent, unpairSuperset, supersetUnits, applyIntensifierPlan, pinnedNoteFor, exNoteFor, effectiveRoutineIds, effectiveRoutines, effectiveRoutineId, effectiveRoutine, lastEntryFor, entryExcluded } from './history.js'
import { makeSideSet, setSideField, toggleSide } from './workout-model.js'
import { EXDB } from './exercises.js'

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

describe('exLine — per side never reaches a timed hold', () => {
  it('ignores a stale side flag on a hold, which has no reps to split', () => {
    expect(exLine({ id: LIFT, sets: 3, sec: 45, mode: 'time', side: true }, 'kg')).toBe('3 × 0:45')
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

  it('still prefers the confirmed working weight for reps sets', () => {
    const S = { exWeights: { [LIFT]: { w: 75 } }, workouts: [{ d: '2026-01-01', entries: [{ id: LIFT, sets: [{ w: 60, r: 10, done: true }] }] }] }
    expect(buildSets(S, { id: LIFT, sets: 1, reps: 8, weight: 50 })).toEqual([{ w: 75, r: 10, done: false }])
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

  it('cascadeWeight keeps phase-only warm-ups in their own lane', () => {
    const rows = [
      { w: 40, r: 10, phase: 'warmup' },
      { w: 45, r: 10, phase: 'warmup' },
      { w: 100, r: 5 },
    ]
    const next = cascadeWeight(rows, 0, 50)
    expect(next[1].w).toBe(50)
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
