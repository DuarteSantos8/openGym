import { describe, expect, it } from 'vitest'
import { buildPlanBundle, mergePlan, parsePlan, planPrintHTML } from './plan-share.js'
import { canonicalProfile, ruleOccurrence } from './test-fixtures.js'

// There was no test file for plan sharing at all, which is how a whole prescription field
// went missing without anyone noticing.
const occ = (over = {}) => ({ ...ruleOccurrence(over.exerciseId || '0025', { occurrenceId: over.occurrenceId || 'o1' }), ...over })
const stateWith = (exOver = {}) => ({
  unit: 'kg', week: {}, customEx: [],
  routines: [{ id: 'r1', name: 'Push', ex: [occ(exOver)] }],
})
const roundTrip = exOver => parsePlan(JSON.stringify(buildPlanBundle(stateWith(exOver), 'Plan'))).routines[0].ex[0]

describe('PLAN_FMT 3 and export scoping', () => {
  it('bumps the format and serializes rules', () => {
    const bundle = buildPlanBundle(canonicalProfile(), 'My plan')
    expect(bundle.opengym_plan).toBe(3)
    expect(bundle.routines[0].ex[0].rule.preset).toBe('linear')
    expect(bundle.routines[0].ex[0].occurrenceId).toBeTruthy()
  })
  it('carries no prescriptions, 1RMs or engine records', () => {
    const p = canonicalProfile({ prescriptions: { p1: {} }, oneRepMaxes: { '0025': [{ value: 100 }] } })
    const bundle = buildPlanBundle(p, 'My plan')
    for (const k of ['prescriptions', 'oneRepMaxes', 'progression']) expect(bundle).not.toHaveProperty(k)
  })
  it('leaks no workout history', () => {
    const bundle = buildPlanBundle(canonicalProfile(), 'My plan')
    expect(bundle.workouts).toBeUndefined()
    expect(JSON.stringify(bundle)).not.toContain('performance')
  })
  it('round-trips rules and gives merged occurrences fresh identity', () => {
    const S = canonicalProfile()
    const bundle = buildPlanBundle(S, 'Push')
    const parsed = parsePlan(JSON.stringify(bundle), 'kg')
    const merged = { routines: [], customEx: [], week: {} }
    mergePlan(merged, parsed)
    const o = merged.routines[0].ex[0]
    expect(o.occurrenceId).not.toBe('occ1')
    expect(o.rule).toMatchObject({ id: o.occurrenceId, revision: 1, routineId: merged.routines[0].id, preset: 'linear' })
  })
  it('refuses a bundle whose rule is invalid', () => {
    const bundle = buildPlanBundle(canonicalProfile(), 'x')
    bundle.routines[0].ex[0].rule.parameters.reps = { min: 9, max: 1 }
    expect(() => parsePlan(JSON.stringify(bundle), 'kg')).toThrow(/min is above max/)
  })
  it('refuses a bundle whose rule preset is unknown', () => {
    const bundle = buildPlanBundle(canonicalProfile(), 'x')
    bundle.routines[0].ex[0].rule.preset = 'nope'
    expect(() => parsePlan(JSON.stringify(bundle), 'kg')).toThrow()
  })
  it('refuses a rule whose exerciseId differs from its occurrence', () => {
    const bundle = buildPlanBundle(canonicalProfile(), 'x')
    bundle.routines[0].ex[0].rule.exerciseId = '0031'
    expect(() => parsePlan(JSON.stringify(bundle), 'kg')).toThrow()
  })
  it('drops a rule-less occurrence instead of importing an unstartable one', () => {
    const bundle = buildPlanBundle(canonicalProfile(), 'x')
    delete bundle.routines[0].ex[0].rule
    const parsed = parsePlan(JSON.stringify(bundle), 'kg')
    expect(parsed.dropped).toBe(1)
    expect(parsed.routines[0].ex).toEqual([])
  })
  it('keeps rule.exerciseId equal to the remapped custom exercise id after merge', () => {
    const S = canonicalProfile({ customEx: [{ id: 'cx1', n: 'Zorb', bp: 'chest' }] })
    S.routines[0].ex = [ruleOccurrence('cx1', { occurrenceId: 'o9' })]
    const parsed = parsePlan(JSON.stringify(buildPlanBundle(S, 'x')), 'kg')
    const target = { routines: [], customEx: [], week: {} }
    mergePlan(target, parsed)
    const o = target.routines[0].ex[0]
    expect(o.exerciseId).not.toBe('cx1')
    expect(o.rule.exerciseId).toBe(o.exerciseId)
    expect(target.customEx.map(c => c.id)).toContain(o.exerciseId)
  })
  it('refuses PLAN_FMT 1 and 2 files with a clear message rather than importing them as empty', () => {
    expect(() => parsePlan(JSON.stringify({ opengym_plan: 1, routines: [] }))).toThrow()
    expect(() => parsePlan(JSON.stringify({ opengym_plan: 2, routines: [] }))).toThrow()
  })
})

describe('what survives a shared plan', () => {
  it('carries progression exclusion on a routine through export and merge', () => {
    const source = stateWith({})
    source.routines[0].excludeFromProgression = true
    const bundle = parsePlan(buildPlanBundle(source, 'Plan'))
    const target = { routines: [], week: {}, customEx: [] }

    expect(bundle.routines[0].excludeFromProgression).toBe(true)
    mergePlan(target, bundle)
    expect(target.routines[0].excludeFromProgression).toBe(true)
  })

  // Issue #10: the rest an exercise prescribes is part of the prescription. A shared 5x5 whose
  // rests arrive as the recipient's 60 s default is a different session than the one written.
  it('carries a per-exercise rest', () => {
    expect(roundTrip({ restSec: 180 }).restSec).toBe(180)
  })

  // The absence has to survive too: writing a 0 would pin the recipient's timer to "off"
  // instead of letting the exercise keep inheriting whatever their own default is.
  it('leaves an exercise that set no rest free of the field', () => {
    expect('restSec' in roundTrip({})).toBe(false)
    expect('restSec' in roundTrip({ restSec: 0 })).toBe(false)
  })

  // A reordered, grouped routine (drag a superset around) is only really carried if the
  // occurrences keep their relative order AND their sg grouping — RoutineEdit.move.test.jsx
  // used to be the only place this got asserted; it's a plan-share behaviour, not a move one.
  it('preserves occurrence order and superset grouping through export and import', () => {
    const source = stateWith()
    source.routines[0].ex = [
      occ({ occurrenceId: 'o1', exerciseId: '0025', order: 30 }),
      occ({ occurrenceId: 'o2', exerciseId: '0031', order: 10, sg: 'g1' }),
      occ({ occurrenceId: 'o3', exerciseId: '0043', order: 20, sg: 'g1' }),
    ]
    const bundle = parsePlan(JSON.stringify(buildPlanBundle(source, 'Plan')))
    const target = { routines: [], customEx: [], week: {} }
    mergePlan(target, bundle)
    const ex = target.routines[0].ex

    expect(ex.map(e => e.order)).toEqual([30, 10, 20])
    expect(ex[0].sg).toBeUndefined()
    expect(ex[1].sg).toBe(ex[2].sg)
    expect(ex[1].sg).toBeTruthy()
  })

  it('carries the rest onto the routine mergePlan adds', () => {
    const bundle = parsePlan(JSON.stringify(buildPlanBundle(stateWith({ restSec: 180 }), 'Plan')))
    const s = { routines: [], customEx: [], week: {} }
    mergePlan(s, bundle, { schedule: false })
    expect(s.routines[0].ex[0].restSec).toBe(180)
  })

  // A plan file is someone else's data: a rest that arrives as a string would reach the timer's
  // arithmetic as one, and a negative or garbage one has no meaning to keep.
  it('normalises a hand-edited rest to a positive whole number or drops it', () => {
    const withRest = restSec => ({
      opengym_plan: 3, name: 'x', week: {}, customEx: [],
      routines: [{ id: 'r', name: 'R', ex: [occ({ occurrenceId: 'o1', restSec })] }],
    })
    expect(parsePlan(withRest('120')).routines[0].ex[0].restSec).toBe(120)
    expect(parsePlan(withRest(90.6)).routines[0].ex[0].restSec).toBe(91)
    expect('restSec' in parsePlan(withRest(-30)).routines[0].ex[0]).toBe(false)
    expect('restSec' in parsePlan(withRest('abc')).routines[0].ex[0]).toBe(false)
  })
})

// ---- combine routines: a weekday holds a routine-id list (ENG-9 §5) ----
describe('week schedule as a routine-id list', () => {
  const twoRoutines = {
    unit: 'kg',
    routines: [
      { id: 'a', name: 'A', ex: [occ({ occurrenceId: 'oa', exerciseId: '0025' })] },
      { id: 'b', name: 'B', ex: [occ({ occurrenceId: 'ob', exerciseId: '0031' })] },
    ],
    customEx: [],
  }

  it('build → parse → merge round-trips an array week with arrays intact', () => {
    const src = { ...twoRoutines, week: { 1: ['a', 'b'], 3: ['a'] } }
    const parsed = parsePlan(JSON.stringify(buildPlanBundle(src, 'Plan')))
    expect(parsed.scheduledDays).toBe(2)

    const target = { routines: [], week: {}, customEx: [] }
    mergePlan(target, parsed, { schedule: true })
    const [idA, idB] = target.routines.map(r => r.id)
    expect(target.week[1]).toEqual([idA, idB])
    expect(target.week[3]).toEqual([idA])
  })

  it('tolerates a hand-edited scalar week value', () => {
    const bundle = { opengym_plan: 3, name: 'x', customEx: [], week: { 1: 'a' }, routines: twoRoutines.routines }
    const parsed = parsePlan(bundle)
    expect(parsed.scheduledDays).toBe(1)
    const target = { routines: [], week: {}, customEx: [] }
    mergePlan(target, parsed, { schedule: true })
    expect(target.week[1]).toEqual([target.routines[0].id])
  })

  it('mergePlan drops an element whose id did not survive parsing, never writes undefined', () => {
    // 'gone' is not among the bundle routines → ridMap has no entry → filtered out
    const bundle = { routines: [{ id: 'a', name: 'A', ex: [occ({ occurrenceId: 'oa' })] }], week: { 1: ['a', 'gone'], 2: ['gone'] }, customEx: [] }
    const target = { routines: [], week: {}, customEx: [] }
    mergePlan(target, bundle, { schedule: true })
    expect(target.week[1]).toEqual([target.routines[0].id])
    expect(target.week[2]).toBeUndefined()             // emptied → left absent, not stored as []
  })

  it('scheduledDays counts a populated array day as 1 and a [] / absent day as 0', () => {
    expect(parsePlan({ opengym_plan: 3, routines: [], customEx: [], week: { 1: ['a'], 2: [], 4: 'b' } }).scheduledDays).toBe(2)
  })
})

// ---- custom exercises travel whole (QA C7) ----
// The bundle used to carry only {id, n, bp} and mergePlan stored exactly that: the recipient's copy
// showed an empty equipment tag, no muscle credit, and — without `custom: true` — no Edit or Delete,
// so a wrong import could only be fixed by hand-editing localStorage.
describe('custom exercises in a shared plan', () => {
  // The shape CustomExForm writes, in the map's order.
  const landmine = {
    id: 'c1', n: 'QA Landmine Row', bp: 'back', desc: 'Bar in the corner', tg: 'upper-back', sm: ['biceps'],
    muscleGroups: ['upper-back', 'biceps'], primaries: ['upper-back'], secondaries: ['biceps'], eq: 'barbell', custom: true,
  }
  const source = {
    unit: 'kg',
    routines: [{ id: 'r', name: 'Back day', ex: [occ({ occurrenceId: 'oc1', exerciseId: 'c1' })] }],
    week: {}, customEx: [landmine],
  }

  it('exports equipment, muscles and description with the custom exercise', () => {
    expect(buildPlanBundle(source, 'Plan').customEx[0]).toEqual({
      id: 'c1', n: 'QA Landmine Row', bp: 'back', desc: 'Bar in the corner', eq: 'barbell', tg: 'upper-back',
      primaries: ['upper-back'], secondaries: ['biceps'], muscleGroups: ['upper-back', 'biceps'],
    })
  })

  it('stores the imported custom exercise the way the form would have created it', () => {
    const parsed = parsePlan(JSON.stringify(buildPlanBundle(source, 'Plan')))
    const target = { routines: [], week: {}, customEx: [] }
    mergePlan(target, parsed)
    const stored = target.customEx[0]
    expect(stored).toMatchObject({ ...landmine, id: stored.id })
    expect(stored.id).not.toBe('c1')
    expect(target.routines[0].ex[0].exerciseId).toBe(stored.id)
  })

  // A file written before the metadata travelled has only a name and a body part; it still imports,
  // and the recipient can now add the equipment and muscles themselves.
  it('keeps importing an old name-plus-body-part custom, editable at the other end', () => {
    const bundle = {
      opengym_plan: 3, week: {},
      routines: [{ id: 'r', name: 'R', ex: [occ({ occurrenceId: 'ox', exerciseId: 'x' })] }],
      customEx: [{ id: 'x', n: 'Old one', bp: 'legs' }],
    }
    const target = { routines: [], week: {}, customEx: [] }
    mergePlan(target, parsePlan(bundle))
    expect(target.customEx[0]).toEqual({ id: target.customEx[0].id, n: 'Old one', bp: 'legs', custom: true })
    expect(target.routines[0].ex[0].exerciseId).toBe(target.customEx[0].id)
  })

  // A plan file is someone else's data: only muscles the map can draw are kept, and a muscle listed
  // as both primary and secondary counts once, as the form itself enforces.
  it('drops muscles it cannot draw and a secondary that repeats a primary', () => {
    const bundle = {
      opengym_plan: 3, routines: [], week: {},
      customEx: [{ id: 'x', n: 'Odd', bp: 'back', eq: 'barbell', primaries: ['upper-back', 'wings'], secondaries: ['upper-back', 'biceps', 7] }],
    }
    const target = { routines: [], week: {}, customEx: [] }
    mergePlan(target, parsePlan(bundle))
    expect(target.customEx[0]).toMatchObject({ primaries: ['upper-back'], secondaries: ['biceps'], muscleGroups: ['upper-back', 'biceps'], tg: 'upper-back', sm: ['biceps'] })
  })

  it('still reuses a custom the recipient already has under the same name and body part', () => {
    const parsed = parsePlan(JSON.stringify(buildPlanBundle(source, 'Plan')))
    const mine = { id: 'mine', n: 'qa landmine row', bp: 'back', eq: 'landmine', custom: true }
    const target = { routines: [], week: {}, customEx: [mine] }
    mergePlan(target, parsed)
    expect(target.customEx).toEqual([mine])
    expect(target.routines[0].ex[0].exerciseId).toBe('mine')
  })
})

describe('warm-up in shared plans', () => {
  // No dedicated fixture helper existed yet — built from the same `stateWith`/round-trip shape
  // the file's other parsePlan tests already use (see `roundTrip` above).
  const validBundle = () => buildPlanBundle(stateWith(), 'Plan')
  const stateWithOccurrence = patch => stateWith(patch)
  const withWarmup = (bundle, warmup) => ({ ...bundle, routines: bundle.routines.map(r => ({ ...r, ex: r.ex.map(e => ({ ...e, ...warmup })) })) })
  it('round-trips a valid recipe', () => {
    const w = { warmup: { mode: 'template', steps: [{ percent: 50, reps: 5 }, { percent: 75, reps: 2 }] } }
    const parsed = parsePlan(withWarmup(validBundle(), w))
    expect(parsed.routines[0].ex[0].warmup).toEqual(w.warmup)
  })
  it('converts a legacy count', () => {
    expect(parsePlan(withWarmup(validBundle(), { warmupSets: 2 })).routines[0].ex[0]).toMatchObject({ warmup: { mode: 'smart', count: 2 } })
    expect(parsePlan(withWarmup(validBundle(), { warmupSets: 2 })).routines[0].ex[0].warmupSets).toBeUndefined()
  })
  it('rejects a malformed recipe instead of dropping it', () => {
    expect(() => parsePlan(withWarmup(validBundle(), { warmup: { mode: 'smart', count: 9 } }))).toThrow()
    expect(() => parsePlan(withWarmup(validBundle(), { warmup: { mode: 'smart', count: 2, steps: [] } }))).toThrow()
  })
  it('export carries warmup', () => {
    const S = stateWithOccurrence({ warmup: { mode: 'smart', count: 3 } })
    expect(buildPlanBundle(S, 'x').routines[0].ex[0].warmup).toEqual({ mode: 'smart', count: 3 })
  })
})

describe('printable plan on v2 routines', () => {
  it('names the exercise and its scheme', () => {
    const html = planPrintHTML(canonicalProfile(), 'me')
    expect(html).not.toContain('Unknown exercise')
    expect(html).toContain('3 × 5 · 60 kg')
  })
})
