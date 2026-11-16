import { describe, expect, it } from 'vitest'
import { editPlan } from './prescription/index.js'
import { applyFailurePlan, applyIntensifierPlan } from './history.js'
import { buildSessionExposures } from './session-start.js'
import { entriesForExposures } from './session-ui-adapter.js'
import { buildPlanBundle, parsePlan, planPrintHTML } from './plan-share.js'
import { migratedFixture, ruleOccurrence } from './test-fixtures.js'
import { failureFieldsOf, failureSetRange, failureSetSelected, failureSetsOf, failureSuffix, hasFailurePlan } from './failure-selection.js'

// Sets to failure beyond the last one: `failureSets` is 'all' or the 1-based numbers of the sets,
// beside v1.4.0's `lastToFailure` flag, which is "last". Neither written means none.
const work = rows => rows.filter(s => s.phase !== 'warmup')
const marks = rows => work(rows).map(s => !!s.failure)
const rows3 = () => [{ w: 60, r: 5 }, { w: 60, r: 5 }, { w: 60, r: 5 }]

describe('what a plan says', () => {
  it('reads the flag as last, the field as written, and nothing as none', () => {
    expect(failureSetsOf({})).toEqual([])
    expect(failureSetsOf({ lastToFailure: true })).toBe('last')
    expect(failureSetsOf({ lastToFailure: false })).toEqual([])
    expect(failureSetsOf({ failureSets: 'all' })).toBe('all')
    expect(failureSetsOf({ failureSets: [3, 1, 3] })).toEqual([1, 3])
    // the field wins over a flag left beside it
    expect(failureSetsOf({ failureSets: [2], lastToFailure: true })).toEqual([2])
  })

  it('cleans what an import brings instead of throwing at it', () => {
    expect(failureSetsOf({ failureSets: [0, -1, 1.5, 'x', 2, 999] })).toEqual([2])
    expect(failureSetsOf({ failureSets: 'sometimes' })).toEqual([])
    expect(failureSetsOf({ failureSets: 7 })).toEqual([])
    expect(failureSetsOf(null)).toEqual([])
  })

  it('knows whether any set goes to failure', () => {
    expect([{}, { failureSets: [] }, { lastToFailure: true }, { failureSets: 'all' }, { failureSets: [2] }].map(hasFailurePlan)).toEqual([false, false, true, true, true])
  })

  it('selects a set by its place among the sets there are', () => {
    const at = (cfg, count) => Array.from({ length: count }, (_, i) => failureSetSelected(cfg, i, count))
    expect(at({ failureSets: 'all' }, 3)).toEqual([true, true, true])
    expect(at({ lastToFailure: true }, 3)).toEqual([false, false, true])
    expect(at({ lastToFailure: true }, 5)).toEqual([false, false, false, false, true])
    expect(at({ failureSets: [1, 3] }, 4)).toEqual([true, false, true, false])
    expect(at({ failureSets: [4] }, 3)).toEqual([false, false, false])
    expect(failureSetSelected({ failureSets: 'all' }, 3, 3)).toBe(false)
    expect(failureSetSelected({ failureSets: 'all' }, -1, 3)).toBe(false)
  })

  it('summarises it as + for every set and (+) for some', () => {
    expect(failureSuffix({}, 3)).toBe('')
    expect(failureSuffix({ failureSets: 'all' }, 3)).toBe('+')
    expect(failureSuffix({ lastToFailure: true }, 3)).toBe('(+)')
    expect(failureSuffix({ lastToFailure: true }, 1)).toBe('+')
    expect(failureSuffix({ failureSets: [1, 2, 3] }, 3)).toBe('+')
  })

  it('stores last as the flag and the rest as failureSets, and nothing for none', () => {
    expect(failureFieldsOf('last')).toEqual({ lastToFailure: true })
    expect(failureFieldsOf('all')).toEqual({ failureSets: 'all' })
    expect(failureFieldsOf([1, 3])).toEqual({ failureSets: [1, 3] })
    expect(failureFieldsOf([2, 9], 3)).toEqual({ failureSets: [2] })
    expect(failureFieldsOf([9], 3)).toEqual({})
    expect(failureFieldsOf([])).toEqual({})
  })
})

describe('how many sets a rule plans', () => {
  it('is its sets, as a range when the progression may add some', () => {
    expect(failureSetRange(editPlan(ruleOccurrence('0025', { preset: 'linear' }).rule, { sets: { min: 4, max: 4 } }))).toEqual({ min: 4, max: 4 })
    expect(failureSetRange(editPlan(ruleOccurrence('0025', { preset: 'double' }).rule, { sets: { min: 3, max: 5 } }))).toEqual({ min: 3, max: 5 })
  })

  it('counts a top set and its back-off sets together', () => {
    const rule = editPlan(ruleOccurrence('0025', { preset: 'top_set_backoff' }).rule, { backoff: { sets: 3, reps: 8, percent: 80, restSeconds: 90 } })
    expect(failureSetRange(rule)).toEqual({ min: 4, max: 4 })
  })
})

describe('applyFailurePlan', () => {
  it('marks only the sets chosen, and builds a plan without any exactly as before', () => {
    expect(marks(applyFailurePlan(rows3(), { id: '0025', failureSets: [1, 3] }))).toEqual([true, false, true])
    expect(marks(applyFailurePlan(rows3(), { id: '0025', failureSets: 'all' }))).toEqual([true, true, true])
    expect(marks(applyFailurePlan(rows3(), { id: '0025', lastToFailure: true }))).toEqual([false, false, true])
    const none = rows3()
    expect(applyFailurePlan(none, { id: '0025' })).toBe(none)
    expect(applyFailurePlan(none, { id: '0025', failureSets: [] })).toBe(none)
  })

  it('counts the work sets, not the warm-ups, and never marks a warm-up', () => {
    const rows = [{ w: 20, r: 8, phase: 'warmup' }, ...rows3()]
    const out = applyFailurePlan(rows, { id: '0025', failureSets: [1] })
    expect(out.map(s => !!s.failure)).toEqual([false, true, false, false])
  })

  it('takes both halves of a timed per-side hold as one set', () => {
    const hold = [{ sec: 30, side: 'L' }, { sec: 30, side: 'R' }, { sec: 30, side: 'L' }, { sec: 30, side: 'R' }, { sec: 30, side: 'L' }, { sec: 30, side: 'R' }]
    const cfg = { id: '0025', mode: 'time', side: true }
    expect(applyFailurePlan(hold, { ...cfg, failureSets: [1, 3] }).map(s => !!s.failure)).toEqual([true, true, false, false, true, true])
    expect(applyFailurePlan(hold, { ...cfg, lastToFailure: true }).map(s => !!s.failure)).toEqual([false, false, false, false, true, true])
  })

  it('leaves a logged row and cardio alone', () => {
    const logged = applyFailurePlan([{ w: 60, r: 5 }, { w: 60, r: 5, done: true }], { id: '0025', failureSets: 'all' })
    expect([logged[0].failure, logged[1].failure]).toEqual([true, undefined])
    const cardio = [{ min: 20, speed: 8 }]
    expect(applyFailurePlan(cardio, { id: '0025', mode: 'cardio', failureSets: 'all' })).toBe(cardio)
  })

  it('runs inside applyIntensifierPlan, so a drop set built on the row keeps the mark', () => {
    const out = applyIntensifierPlan(rows3(), { id: '0025', failureSets: [2], intensifier: { type: 'dropset', count: 1, pct: 20 } })
    expect(marks(out)).toEqual([false, true, false])
    expect(out[1].drops).toHaveLength(1)
  })
})

describe('from the routine to the workout', () => {
  const ctx = { now: Date.UTC(2026, 8, 24), newId: seed => seed, unit: 'kg' }
  const profile = () => ({ unit: 'kg', workouts: [], prescriptions: {}, oneRepMaxes: {}, progression: {} })
  const start = fields => {
    const occ = ruleOccurrence('0025')
    occ.rule = editPlan(occ.rule, { sets: { min: 4, max: 4 }, reps: { min: 5, max: 5 }, load: { mode: 'absolute', value: 60, unit: 'kg' } })
    const S = profile()
    const exposures = buildSessionExposures(S, { id: 'r', ex: [{ ...occ, ...fields }] }, ctx)
    return { exposures, entries: entriesForExposures(exposures, S.prescriptions) }
  }

  it('builds the sets chosen as failure sets and carries the choice on the exposure and the entry', () => {
    const { exposures, entries } = start({ failureSets: [2, 4] })
    expect(exposures[0].failureSets).toEqual([2, 4])
    expect(marks(entries[0].sets)).toEqual([false, true, false, true])
    expect(entries[0].target.failureSets).toEqual([2, 4])
  })

  it('builds all of them for All, and still the last one for the flag', () => {
    expect(marks(start({ failureSets: 'all' }).entries[0].sets)).toEqual([true, true, true, true])
    expect(marks(start({ lastToFailure: true }).entries[0].sets)).toEqual([false, false, false, true])
  })

  it('writes nothing for a plan without it', () => {
    const { exposures, entries } = start({})
    expect('failureSets' in exposures[0]).toBe(false)
    expect(entries[0].sets.some(s => 'failure' in s)).toBe(false)
    expect('failureSets' in entries[0].target).toBe(false)
  })
})

describe('in a shared plan', () => {
  const state = fields => migratedFixture({ unit: 'kg', week: {}, customEx: [], routines: [{ id: 'r1', name: 'Push', ex: [{ id: '0025', sets: 3, reps: 5, weight: 100 }] }] })
  const withFields = fields => {
    const S = state()
    S.routines[0].ex[0] = { ...S.routines[0].ex[0], ...fields }
    return S
  }
  const through = fields => parsePlan(JSON.stringify(buildPlanBundle(withFields(fields), 'Plan'))).routines[0].ex[0]

  it('travels as the numbers, as all, or as the flag', () => {
    expect(through({ failureSets: [1, 3] }).failureSets).toEqual([1, 3])
    expect(through({ failureSets: 'all' }).failureSets).toBe('all')
    expect(through({ lastToFailure: true }).lastToFailure).toBe(true)
    expect('failureSets' in through({})).toBe(false)
  })

  it('arrives cleaned, whatever a hand-edited file said', () => {
    const edited = through({ failureSets: [0, 2, 2, 'x', 99999] })
    expect(edited.failureSets).toEqual([2])
    expect('failureSets' in through({ failureSets: 'sometimes' })).toBe(false)
    const last = through({ failureSets: 'last' })
    expect(last.lastToFailure).toBe(true)
    expect('failureSets' in last).toBe(false)
  })

  it('reads on the printout', () => {
    const html = fields => planPrintHTML(withFields(fields), 'Me')
    expect(html({ failureSets: 'all' })).toContain('All sets to failure')
    expect(html({ failureSets: [1, 3] })).toContain('Sets to failure: 1, 3')
    expect(html({ lastToFailure: true })).toContain('Last set to failure')
    expect(html({})).not.toContain('to failure')
  })
})
