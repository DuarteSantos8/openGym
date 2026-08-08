import { describe, it, expect, vi } from 'vitest'
import {
  normalizeRestSettings,
  restSecondsFor,
  prepSecondsFor,
  resolveTargetLoad,
  prependWarmupSets,
  timerDurationFor,
  timerDurationForSet,
  canApplyTimedResult,
  sessionConfigFor,
  sessionPlanFor,
  bestFullSetWeight,
  setTableColumnsForMode,
  tableModesForEntry,
  tableModesRequirePerRowHeaders,
  isAmrapEntry,
  isAmrapResult,
  amrapCapFor,
  amrapResultFor,
  workRowsForMode,
  shouldConfirmWorkingWeight,
  warmupDraftForEditor,
  warmupConfigForEntry,
  applyWarmupConfigToEntry,
  addSetForEntry,
  removeActiveSet,
  navigateActiveExercise,
  REST_PRESETS
} from './workout-runtime.js'
import { normalizeState } from './state.js'
import { stampCompletedWorkout, workoutVolumeFromEntries, isProgressionEligible, is1RMEligible } from './workout-model.js'

const STATE_DEF = {
  schemaVersion: 2, unit: 'kg', routines: [], workouts: [], active: null,
  customEx: [], programmes: [], reminder: { on: false }
}

describe('independent rest settings', () => {
  it('publishes an exact zero-second global rest preset', () => {
    expect(REST_PRESETS).toContain(0)
  })

  it('uses set, exercise, routine, then global precedence for each phase', () => {
    const routine = normalizeRestSettings({ warmupRestSec: 35, workRestSec: 95 })
    const exercise = normalizeRestSettings({ warmupRestSec: 40 })
    expect(restSecondsFor({ phase: 'warmup', restSec: 12 }, exercise, routine, 90)).toBe(12)
    expect(restSecondsFor({ phase: 'warmup' }, exercise, routine, 90)).toBe(40)
    expect(restSecondsFor({ phase: 'work' }, exercise, routine, 90)).toBe(95)
    expect(restSecondsFor({ phase: 'warmup' }, {}, {}, 90)).toBe(90)
    expect(restSecondsFor({ phase: 'warmup' }, { warmupRestSec: 0 }, routine, 90)).toBe(0)
    expect(restSecondsFor({ warmup: true }, exercise, routine, 90)).toBe(40)
    expect(restSecondsFor({ phase: 'work', warmup: true }, exercise, routine, 90)).toBe(95)
  })

  it('resolves timed preparation independently and allows it to be disabled', () => {
    expect(prepSecondsFor({}, { prepSec: 3 }, { prepSec: 8 }, 5)).toBe(3)
    expect(prepSecondsFor({ prepSec: 0 }, { prepSec: 3 }, {}, 5)).toBe(0)
  })
})

describe('percentage load resolution and warm-up sets', () => {
  it('resolves a percentage of theoretical 1RM from completed work history', () => {
    expect(resolveTargetLoad({ weightPrescription: { kind: 'percentage', percent: 50 } }, [
      { phase: 'warmup', done: true, w: 20, r: 10 },
      { phase: 'work', done: true, w: 60, r: 5 }
    ], 2.5)).toBe(35)
  })

  it('does not resolve a percentage load from a timed set with stale reps', () => {
    expect(resolveTargetLoad({ weightPrescription: { kind: 'percentage', percent: 50 } }, [
      { mode: 'time', phase: 'work', done: true, sec: 60, w: 200, r: 12 }
    ], 2.5)).toBe(0)
  })

  it('does not resolve a percentage load from an unannotated row under a timed parent', () => {
    expect(resolveTargetLoad({ mode: 'time', weightPrescription: { kind: 'percentage', percent: 50 } }, [
      { phase: 'work', done: true, w: 200, r: 12 }
    ], 2.5)).toBe(0)
  })

  it('freezes a safe explicit fallback when no eligible history exists', () => {
    expect(resolveTargetLoad({ weightPrescription: { kind: 'percentage', percent: 50, fallbackWeight: 15 } }, [
      { phase: 'warmup', done: true, w: 20, r: 10 }
    ], 2.5)).toBe(15)
    expect(resolveTargetLoad({ weightPrescription: { kind: 'percentage', percent: 50 } }, [], 2.5)).toBe(0)
  })

  it('resolves a work-set percentage from this session, then history, then config', () => {
    const target = { weightPrescription: { kind: 'workset_percent', percent: 50, fallbackWeight: 10 } }
    expect(resolveTargetLoad(target, [{ phase: 'work', w: 80 }], 2.5, {
      workSets: [{ phase: 'work', w: 100 }, { phase: 'work', w: 90 }]
    })).toBe(50)
    expect(resolveTargetLoad(target, [{ phase: 'warmup', w: 20 }, { phase: 'work', w: 80 }], 2.5, { workSets: [] }))
      .toBe(40)
    expect(resolveTargetLoad(target, { sets: [{ phase: 'warmup', w: 20 }, { phase: 'work', w: 80 }] }, 2.5))
      .toBe(40)
    expect(resolveTargetLoad(target, [{ phase: 'warmup', w: 20 }], 2.5, { workSets: [] })).toBe(10)
  })

  it('resolves a 50% work-set warm-up against the current work rows', () => {
    const sets = prependWarmupSets({
      warmup: [{ mode: 'reps', reps: 8, weightPrescription: { kind: 'workset_percent', percent: 50, fallbackWeight: 5 } }]
    }, [{ phase: 'work', mode: 'reps', r: 5, w: 100, done: false }], [], 2.5)
    expect(sets[0]).toMatchObject({ phase: 'warmup', mode: 'reps', w: 50, r: 8, done: false })
  })

  it('uses an explicit zero-weight work row instead of falling back to older load', () => {
    const target = { weightPrescription: { kind: 'workset_percent', percent: 50, fallbackWeight: 10 } }
    expect(resolveTargetLoad(target, [{ phase: 'work', w: 80 }], 2.5, {
      workSets: [{ phase: 'work', w: 0 }]
    })).toBe(0)
  })

  it('prepends explicit warm-up sets and keeps their phase and resolved load', () => {
    const sets = prependWarmupSets({
      warmup: [
        { mode: 'reps', reps: 8, weightPrescription: { kind: 'fixed', weight: 20 } },
        { mode: 'time', sec: 30, weight: 0 }
      ]
    }, [{ mode: 'reps', r: 5, w: 60, done: false }], [{ phase: 'work', done: true, w: 60, r: 5 }], 2.5)
    expect(sets).toEqual([
      { phase: 'warmup', mode: 'reps', w: 20, r: 8, done: false },
      { phase: 'warmup', mode: 'time', w: 0, sec: 30, done: false },
      { phase: 'work', mode: 'reps', r: 5, w: 60, done: false }
    ])
  })

  it('uses persisted grouped legacy warm-up values instead of work-entry values', () => {
    const sets = prependWarmupSets({
      phases: ['warmup', 'work'], mode: 'time', sec: 45, weight: 100,
      warmupSets: 2, warmupMode: 'reps', warmupReps: 8, warmupWeight: 20,
      warmupRestSec: 0
    }, [{ phase: 'work', mode: 'time', sec: 45, w: 100, done: false }])
    expect(sets.slice(0, 2)).toEqual([
      { phase: 'warmup', mode: 'reps', w: 20, r: 8, done: false, restSec: 0 },
      { phase: 'warmup', mode: 'reps', w: 20, r: 8, done: false, restSec: 0 }
    ])
  })

  it('preserves an independently configured fixed warm-up load through editor migration', () => {
    expect(warmupDraftForEditor({ mode: 'reps', reps: 8, weight: 20 }, { mode: 'time', sec: 45, weight: 100 }))
      .toMatchObject({ mode: 'reps', reps: 8, weight: 20, loadMode: 'fixed' })
  })

  it('keeps a work-set percentage prescription in the editor shape', () => {
    expect(warmupDraftForEditor({ mode: 'reps', reps: 8,
      weightPrescription: { kind: 'workset_percent', percent: 50, fallbackWeight: 10 } },
    { mode: 'reps', reps: 8, weight: 100 })).toMatchObject({
      mode: 'reps', reps: 8, loadMode: 'workset', loadPercent: 50, loadFallback: 10
    })
  })

  it('derives warm-up editor rows from active sets when the target has no warm-up config', () => {
    const target = warmupConfigForEntry({
      target: { mode: 'reps', weight: 100 },
      sets: [{ phase: 'warmup', mode: 'reps', w: 25, r: 8, restSec: 30 }, { phase: 'work', w: 100, r: 5 }]
    })
    expect(target.warmup).toEqual([{
      phase: 'warmup', mode: 'reps', reps: 8, weightPrescription: { kind: 'fixed', weight: 25 }, restSec: 30
    }])
  })

  it('uses the last configured warm-up prescription for an added active row', () => {
    const target = warmupConfigForEntry({
      target: { mode: 'reps', warmup: [{ mode: 'reps', reps: 8,
        weightPrescription: { kind: 'workset_percent', percent: 50, fallbackWeight: 5 } }] },
      sets: [{ phase: 'warmup', mode: 'reps', w: 50, r: 8 }, { phase: 'warmup', mode: 'reps', w: 50, r: 8 }]
    })
    expect(target.warmup).toHaveLength(2)
    expect(target.warmup[1].weightPrescription).toEqual({ kind: 'workset_percent', percent: 50, fallbackWeight: 5 })
  })

  it('applies phase settings to an active entry without changing work rows', () => {
    const entry = {
      target: { mode: 'reps', weight: 100, warmup: [{ mode: 'reps', reps: 8,
        weightPrescription: { kind: 'fixed', weight: 20 } }] },
      sets: [
        { phase: 'warmup', mode: 'reps', w: 20, r: 8, done: false },
        { phase: 'work', mode: 'reps', w: 100, r: 5, done: false }
      ]
    }
    const updated = applyWarmupConfigToEntry(entry, {
      warmup: [{ phase: 'warmup', mode: 'reps', reps: 8,
        weightPrescription: { kind: 'workset_percent', percent: 50, fallbackWeight: 5 }, restSec: 30 }]
    }, [], 2.5)
    expect(updated.sets).toEqual([
      { phase: 'warmup', mode: 'reps', w: 50, r: 8, done: false, restSec: 30 },
      { phase: 'work', mode: 'reps', w: 100, r: 5, done: false }
    ])
    expect(updated.target).toMatchObject({ mode: 'reps', weight: 100, warmup: [{ restSec: 30 }] })
  })

  it('keeps a completed warm-up row while rebuilding pending rows from phase settings', () => {
    const updated = applyWarmupConfigToEntry({
      target: { mode: 'reps', weight: 100 },
      sets: [
        { phase: 'warmup', mode: 'reps', w: 20, r: 8, done: true },
        { phase: 'warmup', mode: 'reps', w: 20, r: 8, done: false },
        { phase: 'work', mode: 'reps', w: 100, r: 5, done: false }
      ]
    }, {
      warmup: [{ mode: 'reps', reps: 8, weightPrescription: { kind: 'fixed', weight: 30 } },
        { mode: 'reps', reps: 10, weightPrescription: { kind: 'fixed', weight: 40 } }]
    })
    expect(updated.sets.slice(0, 2)).toEqual([
      { phase: 'warmup', mode: 'reps', w: 20, r: 8, done: true },
      { phase: 'warmup', mode: 'reps', w: 40, r: 10, done: false }
    ])
  })

  it('does not ask for a working-weight confirmation for a warm-up-only session', () => {
    expect(shouldConfirmWorkingWeight({ target: { mode: 'reps' }, sets: [
      { phase: 'warmup', mode: 'reps', w: 20, r: 8, done: true }
    ] })).toBe(false)
    expect(shouldConfirmWorkingWeight({ target: { mode: 'reps' }, sets: [
      { phase: 'warmup', mode: 'reps', w: 20, r: 8, done: true },
      { phase: 'work', mode: 'reps', w: 60, r: 5, done: true }
    ] })).toBe(true)
  })

  it('keeps timed work loads out of reps working-weight state in mixed entries', () => {
    const entry = {
      target: { mode: 'reps', weight: 60 },
      sets: [
        { phase: 'work', mode: 'time', sec: 60, w: 200, done: true },
        { phase: 'work', mode: 'reps', r: 5, w: 60, done: true }
      ]
    }
    expect(workRowsForMode(entry, 'time')).toEqual([entry.sets[0]])
    expect(workRowsForMode(entry, 'reps')).toEqual([entry.sets[1]])
    expect(Math.max(...workRowsForMode(entry, 'reps').filter(set => set.done).map(set => set.w))).toBe(60)
    expect(shouldConfirmWorkingWeight(entry, 'reps')).toBe(true)
    expect(shouldConfirmWorkingWeight({
      target: { mode: 'reps' },
      sets: [{ phase: 'work', mode: 'time', sec: 60, w: 200, done: true }]
    }, 'reps')).toBe(false)
  })

  it('does not let an unannotated rep-shaped row under a timed parent enter strength state', () => {
    const entry = {
      target: { mode: 'time', sec: 60 },
      sets: [{ phase: 'work', w: 200, r: 12, done: true }]
    }
    expect(workRowsForMode(entry, 'time')).toEqual([entry.sets[0]])
    expect(workRowsForMode(entry, 'reps')).toEqual([])
    expect(shouldConfirmWorkingWeight(entry, 'reps')).toBe(false)
  })

  it('keeps each warm-up row independent, including zero rest and an explicit phase', () => {
    const sets = prependWarmupSets({
      warmup: [
        { phase: 'warmup', mode: 'reps', reps: 10, weightPrescription: { kind: 'fixed', weight: 20 }, restSec: 0 },
        { phase: 'work', mode: 'time', sec: 30, weight: 5, restSec: 25 }
      ]
    }, [{ mode: 'reps', r: 5, w: 60, done: false }], [], 2.5)
    expect(sets.slice(0, 2)).toEqual([
      { phase: 'warmup', mode: 'reps', w: 20, r: 10, done: false, restSec: 0 },
      { phase: 'work', mode: 'time', w: 5, sec: 30, done: false, restSec: 25 }
    ])
  })

  it('honours an explicit work-only routine phase selector without deleting the saved warm-up plan', () => {
    const sets = prependWarmupSets({ phases: ['work'], warmup: [{ mode: 'reps', reps: 8, restSec: 0 }] },
      [{ phase: 'work', mode: 'reps', r: 5, w: 60, done: false }])
    expect(sets).toHaveLength(1)
    expect(sets[0].phase).toBe('work')
  })

  it('keeps a resolved percentage load authoritative over a progression weight', () => {
    const target = { mode: 'reps', weight: 50, resolvedWeight: 50, weightPrescription: { kind: 'percentage', percent: 75 } }
    const plan = { kind: 'up', weight: 55, reps: 6 }
    expect(sessionConfigFor(target, plan)).toMatchObject({ weight: 50, resolvedWeight: 50, reps: 6 })
    expect(sessionPlanFor(target, plan)).toMatchObject({ kind: 'up', reps: 6 })
    expect(sessionPlanFor(target, plan).weight).toBeUndefined()
  })

  it('still applies progression weight to fixed-load targets', () => {
    expect(sessionConfigFor({ mode: 'reps', weight: 50 }, { kind: 'up', weight: 55 })).toMatchObject({ weight: 55 })
    expect(sessionPlanFor({ mode: 'reps', weight: 50 }, { kind: 'up', weight: 55 }).weight).toBe(55)
  })

  it('does not carry work load fields into a warm-up-only session target', () => {
    const target = sessionConfigFor({
      phases: ['warmup'], mode: 'reps', sets: 3, reps: 5, weight: 60,
      resolvedWeight: 60,
      weightPrescription: { kind: 'percentage', percent: 75, fallbackWeight: 20 },
      warmup: [{ phase: 'warmup', mode: 'reps', reps: 8, weightPrescription: { kind: 'fixed', weight: 20 }, restSec: 0 }]
    }, { kind: 'up', weight: 65, resolvedWeight: 65 })
    expect(target).not.toHaveProperty('weight')
    expect(target).not.toHaveProperty('weightPrescription')
    expect(target).not.toHaveProperty('resolvedWeight')
    expect(sessionPlanFor({ phases: ['warmup'] }, { kind: 'up', weight: 65 })).not.toHaveProperty('weight')
    expect(prependWarmupSets(target, [], [], 2.5)).toEqual([
      { phase: 'warmup', mode: 'reps', w: 20, r: 8, done: false, restSec: 0 }
    ])
  })

  it('keeps the work prescription and row-specific warm-up load in mixed sessions', () => {
    const target = sessionConfigFor({
      phases: ['warmup', 'work'], mode: 'reps', sets: 1, reps: 5, weight: 60,
      warmup: [{ phase: 'warmup', mode: 'reps', reps: 8, weightPrescription: { kind: 'fixed', weight: 20 }, restSec: 15 }]
    }, { kind: 'up', weight: 65 })
    expect(target.weight).toBe(65)
    expect(prependWarmupSets(target, [{ phase: 'work', mode: 'reps', w: 65, r: 5, done: false }])).toEqual([
      { phase: 'warmup', mode: 'reps', w: 20, r: 8, done: false, restSec: 15 },
      { phase: 'work', mode: 'reps', w: 65, r: 5, done: false }
    ])
    expect(addSetForEntry({ target, sets: [
      { phase: 'warmup', mode: 'reps', w: 20, r: 8, restSec: 15, done: true },
      { phase: 'work', mode: 'reps', w: 65, r: 5, done: true }
    ] })).toMatchObject({ phase: 'work', w: 65, r: 5, done: false })
  })

  it('removes nested work loads while retaining nested warm-up row loads', () => {
    const target = sessionConfigFor({
      phases: ['warmup'], mode: 'reps', sets: 1, reps: 8, weight: 60,
      weightPrescription: { kind: 'percentage', percent: 75, fallbackWeight: 20 },
      work: {
        mode: 'reps', weight: 60, resolvedWeight: 60,
        weightPrescription: { kind: 'fixed', weight: 60 },
        nested: { weight: 61, load: { weight: 62 } }
      },
      warmup: [{ phase: 'warmup', mode: 'reps', reps: 8, weight: 20,
        weightPrescription: { kind: 'fixed', weight: 20 }, restSec: 15 }]
    }, { kind: 'up', weight: 65 })

    expect(target).not.toHaveProperty('weight')
    expect(target).not.toHaveProperty('weightPrescription')
    expect(target.work?.weight).toBeUndefined()
    expect(target.work?.resolvedWeight).toBeUndefined()
    expect(target.work?.weightPrescription).toBeUndefined()
    expect(target.work?.nested?.weight).toBeUndefined()
    expect(target.warmup[0]).toMatchObject({ weight: 20, restSec: 15,
      weightPrescription: { kind: 'fixed', weight: 20 } })
  })

  it('adds another warm-up row from the last row without borrowing the work target', () => {
    const entry = {
      target: {
        phases: ['warmup'], mode: 'reps', reps: 8, weight: 60,
        warmup: [{ phase: 'warmup', mode: 'reps', reps: 8, weight: 20, restSec: 15 }]
      },
      sets: [{ phase: 'warmup', mode: 'time', sec: 30, w: 15, restSec: 10, done: true }]
    }

    expect(addSetForEntry(entry)).toEqual({
      phase: 'warmup', mode: 'time', sec: 30, w: 15, restSec: 10, done: false
    })
  })

  it('keeps a warm-up-only session work-free through normalization, Add Set, and history', () => {
    const sessionTarget = sessionConfigFor({
      phases: ['warmup'], mode: 'reps', sets: 1, reps: 8, weight: 60,
      warmup: [{ phase: 'warmup', mode: 'reps', reps: 8,
        weightPrescription: { kind: 'fixed', weight: 20 }, restSec: 15 }]
    }, { kind: 'up', weight: 65 })
    const sourceSets = prependWarmupSets(sessionTarget, [])
    const normalized = normalizeState({
      unit: 'kg',
      active: { id: 'active', unit: 'kg', entries: [{
        id: 'squat', target: { ...sessionTarget, unit: 'kg' }, sets: sourceSets
      }] }
    }, STATE_DEF)
    const entry = normalized.active.entries[0]

    expect(entry.target).not.toHaveProperty('weight')
    const added = addSetForEntry(entry)
    entry.sets.push(added)
    expect(entry.sets).toHaveLength(2)
    expect(entry.sets.every(set => set.phase === 'warmup')).toBe(true)
    expect(added).toMatchObject({ phase: 'warmup', w: 20, r: 8, restSec: 15, done: false })

    const completed = stampCompletedWorkout({
      unit: 'kg',
      entries: [{ ...entry, sets: entry.sets.map(set => ({ ...set, done: true })) }]
    }, 'kg')
    expect(completed.entries[0].target).not.toHaveProperty('weight')
    expect(completed.entries[0].sets.every(set => set.phase === 'warmup')).toBe(true)
    expect(workoutVolumeFromEntries(completed, 'kg')).toBe(320)
    expect(isProgressionEligible(completed.entries[0].sets[0], completed.entries[0].target, 'kg')).toBe(false)
    expect(is1RMEligible(completed.entries[0].sets[0], completed.entries[0].target, 'kg')).toBe(false)
  })
})

describe('row-specific workout table headings', () => {
  it('describes each row mode rather than borrowing the entry mode', () => {
    const entry = {
      target: { mode: 'time' },
      sets: [
        { phase: 'warmup', mode: 'reps', w: 20, r: 8 },
        { phase: 'work', mode: 'time', w: 0, sec: 45 }
      ]
    }
    expect(tableModesForEntry(entry)).toEqual(['reps', 'time'])
    expect(tableModesRequirePerRowHeaders(entry)).toBe(true)
    expect(setTableColumnsForMode('reps', 'kg')).toMatchObject({
      primary: { field: 'w', label: 'Weight' }, secondary: { field: 'r', label: 'Reps' }, timed: false
    })
    expect(setTableColumnsForMode('time', 'kg')).toMatchObject({
      primary: { field: 'sec', label: 'Seconds' }, secondary: { field: 'w', label: 'Weight' }, timed: true
    })
  })

  it('requires row headings for an explicit reps row under a timed parent', () => {
    expect(tableModesRequirePerRowHeaders({
      target: { mode: 'time' },
      sets: [{ phase: 'work', mode: 'reps', w: 40, r: 8 }]
    })).toBe(true)
  })

  it('requires row headings for an explicit time row under a reps parent', () => {
    expect(tableModesRequirePerRowHeaders({
      target: { mode: 'reps' },
      sets: [{ phase: 'work', mode: 'time', w: 0, sec: 45 }]
    })).toBe(true)
  })

  it('keeps the shared heading for an ordinary single-mode entry', () => {
    expect(tableModesRequirePerRowHeaders({
      target: { mode: 'reps' },
      sets: [{ phase: 'work', mode: 'reps', w: 40, r: 8 }]
    })).toBe(false)
  })
})

describe('AMRAP result boundaries', () => {
  const entry = {
    target: { mode: 'reps', kind: 'amrap', amrapMinReps: 5, cap: 12 },
    sets: [
      { phase: 'warmup', w: 20, r: 20, done: false },
      { phase: 'work', w: 40, r: 5, done: false },
      { phase: 'work', w: 40, r: 12, done: false }
    ]
  }

  it('identifies only the final work row as the AMRAP result', () => {
    expect(isAmrapEntry(entry)).toBe(true)
    expect(isAmrapResult(entry, 0)).toBe(false)
    expect(isAmrapResult(entry, 1)).toBe(false)
    expect(isAmrapResult(entry, 2)).toBe(true)
    expect(amrapCapFor(entry, 0)).toBeNull()
    expect(amrapCapFor(entry, 2)).toBeNull()
  })

  it('returns the completed final AMRAP actual without losing phase or target metadata', () => {
    const entry = {
      target: { phase: 'work', mode: 'reps', kind: 'amrap', amrapMinReps: 5, cap: 12 },
      sets: [
        { phase: 'warmup', mode: 'reps', w: 20, r: 8, done: true },
        { phase: 'work', mode: 'reps', w: 40, r: 5, done: true },
        { phase: 'work', mode: 'reps', w: 40, r: 11, done: true }
      ]
    }
    expect(amrapResultFor(entry)).toEqual({
      index: 2, phase: 'work', mode: 'reps', actual: 11, target: 5, amrapMinReps: 5
    })
  })

  it('does not treat a legacy rep cap as a maximum and only marks the final work row timed AMRAP', () => {
    const reps = {
      target: { mode: 'reps', kind: 'amrap', amrapMinReps: 5, cap: 6 },
      sets: [{ phase: 'work', mode: 'reps', r: 10, w: 40, done: true }]
    }
    expect(amrapCapFor(reps, 0)).toBeNull()
    expect(amrapResultFor(reps)).toMatchObject({ actual: 10, amrapMinReps: 5 })

    const timed = {
      target: { mode: 'time', kind: 'amrap', sec: 30, amrapMaxSec: 90 },
      sets: [
        { phase: 'warmup', mode: 'time', sec: 30, done: false },
        { phase: 'work', mode: 'time', sec: 30, done: false },
        { phase: 'work', mode: 'time', sec: 30, done: false }
      ]
    }
    expect(isAmrapResult(timed, 0)).toBe(false)
    expect(isAmrapResult(timed, 1)).toBe(false)
    expect(isAmrapResult(timed, 2)).toBe(true)
    expect(timerDurationForSet(timed, 1)).toBe(30)
    expect(timerDurationForSet(timed, 2)).toBe(90)
  })

  it('does not report an unchecked AMRAP prescription as an actual result', () => {
    expect(amrapResultFor({
      target: { mode: 'time', kind: 'amrap', sec: 30, amrapMaxSec: 90 },
      sets: [{ phase: 'work', mode: 'time', sec: 30, done: false }]
    })).toBeNull()
  })

  it('canonicalizes a routine Greyskull policy as an AMRAP session target unless fixed is explicit', () => {
    expect(sessionConfigFor({ phase: 'work', mode: 'reps', reps: 5 }, { policy: 'greyskull' }))
      .toMatchObject({ phase: 'work', mode: 'reps', kind: 'amrap' })
    expect(sessionConfigFor({ phase: 'work', mode: 'reps', reps: 5, kind: 'fixed' }, { policy: 'greyskull' }).kind)
      .toBe('fixed')
  })
})

describe('time AMRAP runtime', () => {
  it('uses only the optional timed duration and never caps reps', () => {
    expect(timerDurationFor({ mode: 'time', kind: 'amrap', sec: 30, amrapMaxSec: 90 })).toBe(90)
    expect(timerDurationFor({ mode: 'time', kind: 'amrap', sec: 30, amrapMaxSec: 20 })).toBe(30)
    expect(timerDurationFor({ mode: 'time', kind: 'fixed', sec: 30, amrapMaxSec: 90 })).toBe(30)
  })
})

describe('stale timed callbacks', () => {
  it('does not apply a callback after the active workout or set was deleted', () => {
    const active = { id: 'w1', entries: [{ sets: [{ done: false }] }] }
    expect(canApplyTimedResult(active, 'w1', 0, 0)).toBe(true)
    expect(canApplyTimedResult(null, 'w1', 0, 0)).toBe(false)
    expect(canApplyTimedResult(active, 'w2', 0, 0)).toBe(false)
    expect(canApplyTimedResult(active, 'w1', 1, 0)).toBe(false)
    expect(canApplyTimedResult(active, 'w1', 0, 1)).toBe(false)
  })

  it('invokes the real removal helper before removing the final set/exercise', () => {
    const active = { id: 'w1', cur: 0, entries: [{ id: 'lift', sets: [{ done: false }] }] }
    const stop = vi.fn(() => expect(active.entries).toHaveLength(1))
    expect(removeActiveSet(active, 0, 0, stop)).toMatchObject({ removed: true, removedExercise: true })
    expect(active.entries).toEqual([])
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('stops timer lifecycle before navigating while preserving the active exercise state', () => {
    const entries = [
      { id: 'first', sets: [{ w: 20, r: 8, done: false }] },
      { id: 'second', sets: [{ w: 40, r: 5, done: false }] }
    ]
    const active = { id: 'w1', cur: 0, entries }
    const stopTimers = vi.fn(() => expect(active.cur).toBe(0))

    expect(navigateActiveExercise(active, 1, stopTimers)).toBe(true)
    expect(stopTimers).toHaveBeenCalledTimes(1)
    expect(active.cur).toBe(1)
    expect(active.entries).toBe(entries)
    expect(active.entries[0].sets[0]).toMatchObject({ w: 20, r: 8, done: false })
  })
})

describe('bestFullSetWeight', () => {
  const mk = rows => ({ target: { sets: rows.length, reps: 5 }, sets: rows.map(([w, r, done]) => ({ w, r, done, phase: 'work' })) })
  it('uses the heaviest set lifted to the full target', () => {
    const e = mk([[60, 5, true], [70, 5, true], [75, 4, true]])
    expect(bestFullSetWeight(e)).toBe(70)
  })
  it('ignores a missed final set (below target reps)', () => {
    const e = mk([[60, 5, true], [75, 3, true]])
    expect(bestFullSetWeight(e)).toBe(60)
  })
  it('falls back to all done sets when nothing hit the target', () => {
    const e = mk([[60, 3, true], [75, 4, true]])
    expect(bestFullSetWeight(e)).toBe(75)
  })
  it('ignores unchecked sets', () => {
    const e = mk([[60, 5, true], [90, 5, false]])
    expect(bestFullSetWeight(e)).toBe(60)
  })
})
