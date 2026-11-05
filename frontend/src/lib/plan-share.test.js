import { describe, expect, it } from 'vitest'
import { editPlan, planOptions, planPhase, validateProgramme } from './prescription/index.js'
import { buildPlanBundle, buildProgrammeBundle, mergePlan, parsePlan, planPrintHTML } from './plan-share.js'
import { canonicalProfile, migratedFixture, ruleOccurrence } from './test-fixtures.js'
import { IMPORT_MAX_SEQUENCE, IMPORT_MAX_TARGETS, importedProgramme, legacyWeeksOf, pauseProgramme, setLegacyWeeks, startProgramme } from './programmes.js'
import { validateCanonicalProfile } from '../../../api/migration/profile-validation.js'

// There was no test file for plan sharing at all, which is how a whole prescription field
// went missing without anyone noticing.
const occ = (over = {}) => ({ ...ruleOccurrence(over.exerciseId || '0025', { occurrenceId: over.occurrenceId || 'o1' }), ...over })
const stateWith = (exOver = {}) => ({
  unit: 'kg', week: {}, customEx: [],
  routines: [{ id: 'r1', name: 'Push', ex: [occ(exOver)] }],
})
const roundTrip = exOver => parsePlan(JSON.stringify(buildPlanBundle(stateWith(exOver), 'Plan'))).routines[0].ex[0]

describe('PLAN_FMT 3 and export scoping', () => {
  it('carries a program of several phases through a shared plan unchanged', () => {
    const accumulation = ruleOccurrence('0025', { preset: 'accumulation_intensification', occurrenceId: 'o1', options: { trainingMax: { mode: 'direct', value: 100, unit: 'kg' } } })
    expect(roundTrip({ rule: accumulation.rule }).rule.program).toEqual(accumulation.rule.program)
  })
  it('refuses a schema-3 bundle whose rule has no program (a development export)', () => {
    const bundle = buildPlanBundle(stateWith(), 'Plan')
    const rule = bundle.routines[0].ex[0].rule
    delete rule.program
    rule.parameters = { sets: { min: 3, max: 3 }, reps: { min: 5, max: 5 }, load: { mode: 'empty' }, restSeconds: 90 }
    expect(() => parsePlan(JSON.stringify(bundle))).toThrow()
  })

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
    bundle.routines[0].ex[0].rule = editPlan(bundle.routines[0].ex[0].rule, { reps: { min: 9, max: 1 } })
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
  it('A11: converts PLAN_FMT 1 with its own policies, units, custom metadata and schedule', () => {
    const parsed = parsePlan({ opengym_plan: 1, unit: 'lb', week: { 1: 'r' }, customEx: [{ id: 'custom', n: 'Hold', bp: 'back', eq: 'body weight' }],
      routines: [{ id: 'r', prog: 'double', ex: [
        { id: '0025', sets: 3, reps: 10, repsMin: 8, weight: 100 },
        { id: 'custom', sets: 1, mode: 'time', sec: 30, prog: 'time', inc: 5 }
      ] }] }, 'kg')
    expect(parsed.routines[0].ex.map(o => o.rule.preset)).toEqual(['double', 'hold_seconds'])
    const target = { unit: 'kg', routines: [], customEx: [], week: {} }
    mergePlan(target, parsed, { schedule: true })
    expect(planPhase(target.routines[0].ex[0].rule).parameters.load.value).toBe(45.25)
    expect(planPhase(target.routines[0].ex[0].rule).parameters.load.unit).toBe('kg')
    expect(planOptions(target.routines[0].ex[1].rule).step).toEqual({ type: 'seconds', value: 5 })
    expect(target.week[1]).toEqual([target.routines[0].id])
    expect(target.customEx[0].eq).toBe('body weight')
  })
  it('refuses PLAN_FMT 2 files with a clear message rather than importing them as empty', () => {
    expect(() => parsePlan(JSON.stringify({ opengym_plan: 2, routines: [] }))).toThrow()
  })
  it('keeps a legacy plan audit visible after merge under the new routine identities', () => {
    const parsed = parsePlan({ opengym_plan: 1, routines: [{ id: 'r', prog: 'wave', ex: [{ id: '0025', weight: 60 }] }] })
    const target = { unit: 'kg', routines: [], customEx: [], week: {} }
    mergePlan(target, parsed)
    const routine = target.routines[0]
    expect(target.migrationAudit.unsupported).toContainEqual({ routineId: routine.id, occurrenceId: routine.ex[0].occurrenceId, exerciseId: '0025', field: 'prog', value: 'wave' })
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

  // Discord (lajawi): an exercise's own "No timer" is part of the plan, not the default rest.
  it('carries an exercise\u2019s "No timer", and only a real one', () => {
    expect(roundTrip({ restOff: true })).toMatchObject({ restOff: true })
    expect('restSec' in roundTrip({ restOff: true, restSec: 45 })).toBe(false)
    expect('restOff' in roundTrip({ restOff: false })).toBe(false)
    expect(roundTrip({ side: true, sideRestOff: true })).toMatchObject({ sideRestOff: true })
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

  // The ramp's own rest and the break between sides are part of how the exercise is prescribed.
  it('carries a per-exercise warm-up rest, "no timer" and the break between sides, and leaves them out when unset', () => {
    expect(roundTrip({ warmupRestSec: 45 }).warmupRestSec).toBe(45)
    expect(roundTrip({ warmupRestOff: true, warmupRestSec: 45 })).toMatchObject({ warmupRestOff: true })
    expect('warmupRestSec' in roundTrip({ warmupRestOff: true, warmupRestSec: 45 })).toBe(false)
    expect(roundTrip({ side: true, sideRestSec: 20 }).sideRestSec).toBe(20)
    for (const e of [{}, { warmupRestOff: false }, { warmupRestOff: 'yes' }, { warmupRestSec: 0 }, { side: true, sideRestSec: 0 }, { sideRestSec: 20 }]) {
      const out = roundTrip(e)
      expect('warmupRestOff' in out || 'warmupRestSec' in out || 'sideRestSec' in out, JSON.stringify(e)).toBe(false)
    }
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

// A superset's name and rest between rounds (#292) live on every member of the group. The
// export used to copy `sg` alone, so a shared superset arrived nameless and resting the default.
describe('superset meta in a shared plan', () => {
  const superset = {
    unit: 'kg',
    routines: [{ id: 'r1', name: 'Arms', ex: [
      occ({ occurrenceId: 'o1', exerciseId: '0025', sg: 'a', sgName: 'Arms finisher', sgRest: 90 }),
      occ({ occurrenceId: 'o2', exerciseId: '0007', sg: 'a', sgName: 'Arms finisher', sgRest: 90 }),
      occ({ occurrenceId: 'o3', exerciseId: '0025' }),
    ] }],
    week: {}, customEx: [],
  }
  const withEx = ex => ({ opengym_plan: 3, name: 'x', routines: [{ id: 'r', name: 'R', ex }], week: {}, customEx: [] })

  it('carries the name and rest through export, parsePlan and mergePlan', () => {
    const bundle = buildPlanBundle(superset, 'Plan')
    expect(bundle.routines[0].ex[0]).toMatchObject({ sg: 'a', sgName: 'Arms finisher', sgRest: 90 })
    const parsed = parsePlan(JSON.stringify(bundle))
    const s = { unit: 'kg', routines: [], customEx: [], week: {} }
    mergePlan(s, parsed, { schedule: false })
    const [a, b, lone] = s.routines[0].ex
    expect(a).toMatchObject({ sg: 'a', sgName: 'Arms finisher', sgRest: 90 })
    expect(b).toMatchObject({ sg: 'a', sgName: 'Arms finisher', sgRest: 90 })
    expect('sgName' in lone || 'sgRest' in lone).toBe(false)
  })

  it('leaves the fields out when the superset has neither', () => {
    const plain = { ...superset, routines: [{ id: 'r1', name: 'A', ex: [occ({ occurrenceId: 'o1', sg: 'a' })] }] }
    const e = parsePlan(JSON.stringify(buildPlanBundle(plain, 'Plan'))).routines[0].ex[0]
    expect(e.sg).toBe('a')
    expect('sgName' in e || 'sgRest' in e).toBe(false)
  })

  // A plan file is someone else's data: the name is trimmed and capped the way setSupersetMeta
  // writes it, the rest becomes a positive whole number of seconds or nothing.
  it('normalises a hand-edited name and rest, or drops them', () => {
    const long = '  ' + 'x'.repeat(100) + '  '
    const [e] = parsePlan(withEx([occ({ sg: 'a', sgName: long, sgRest: '75.4' })])).routines[0].ex
    expect(e.sgName).toBe('x'.repeat(40))
    expect(e.sgRest).toBe(75)
    const [bad] = parsePlan(withEx([occ({ sg: 'a', sgName: { evil: 1 }, sgRest: -30 })])).routines[0].ex
    expect('sgName' in bad || 'sgRest' in bad).toBe(false)
    const [blank] = parsePlan(withEx([occ({ sg: 'a', sgName: '   ', sgRest: 'abc' })])).routines[0].ex
    expect('sgName' in blank || 'sgRest' in blank).toBe(false)
  })

  it('drops the meta from an exercise that is not in a superset', () => {
    const [e] = parsePlan(withEx([occ({ sgName: 'Orphan', sgRest: 60 })])).routines[0].ex
    expect('sgName' in e || 'sgRest' in e).toBe(false)
    // and the export never writes it there either
    const out = buildPlanBundle(stateWith({ sgName: 'Orphan', sgRest: 60 }), 'Plan').routines[0].ex[0]
    expect('sgName' in out || 'sgRest' in out).toBe(false)
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

describe('plan-share links and media (#246)', () => {
  const photo = { kind: 'image', hash: 'a'.repeat(64), mime: 'image/webp', size: 10, width: 4, height: 3, at: 1 }
  const withCustom = c => ({
    unit: 'kg', week: {},
    routines: [{ id: 'r1', name: 'Push', ex: [ruleOccurrence('cx1')] }],
    customEx: [{ id: 'cx1', n: 'Landmine press', bp: 'shoulders', custom: true, ...c }]
  })

  it('a link travels with the plan and arrives on the new exercise; the photo never travels', () => {
    const bundle = buildPlanBundle(withCustom({ url: 'https://youtu.be/abc', media: photo }), 'Plan')
    expect(bundle.customEx[0].url).toBe('https://youtu.be/abc')
    expect(JSON.stringify(bundle)).not.toContain('media')
    expect(JSON.stringify(bundle)).not.toContain('a'.repeat(64))
    const s = { unit: 'kg', week: {}, routines: [], customEx: [], dayPlan: {} }
    mergePlan(s, parsePlan(JSON.stringify(bundle)))
    expect(s.customEx[0]).toMatchObject({ n: 'Landmine press', url: 'https://youtu.be/abc', custom: true })
    expect(s.customEx[0].media).toBeUndefined()
  })

  it('a link that is not a web address is dropped on the way in, and never backfilled onto an exercise you have', () => {
    const file = buildPlanBundle(withCustom({}), 'Plan')
    file.customEx[0].url = 'javascript:alert(document.cookie)'
    file.customEx[0].media = photo
    const s = { unit: 'kg', week: {}, routines: [], customEx: [], dayPlan: {} }
    mergePlan(s, parsePlan(JSON.stringify(file)))
    expect(s.customEx[0].url).toBeUndefined()
    expect(s.customEx[0].media).toBeUndefined()

    const mine = { unit: 'kg', week: {}, routines: [], dayPlan: {}, customEx: [{ id: 'mine', n: 'Landmine press', bp: 'shoulders', custom: true }] }
    mergePlan(mine, parsePlan(JSON.stringify(buildPlanBundle(withCustom({ url: 'https://youtu.be/abc' }), 'Plan'))))
    expect(mine.customEx).toHaveLength(1)
    expect(mine.customEx[0].url).toBeUndefined()
  })
})

describe('parsePlan refuses a file that is not a plan in words', () => {
  it('text that is not JSON says it is not a plan file, not the parser message', () => {
    expect(() => parsePlan('hello there')).toThrow('this isn’t an openGym plan file')
    try { parsePlan('{oops') } catch (e) { expect(e.code).toBe('not-plan') }
  })
})

describe('programmes in a plan file', () => {
  const ADVANCE = { onFailure: 'advance', onSkipped: 'advance' }
  // A running programme with every private record a profile can hold: a run, its events, a review, Config.
  function running() {
    const s = migratedFixture({ unit: 'kg', weekStart: 1, routines: [{ id: 'A', name: 'Push', ex: [{ id: '0025', sets: 3, reps: 5, weight: 60 }] }, { id: 'B', name: 'Legs', ex: [{ id: '0043', sets: 3, reps: 5, weight: 80 }] }], workouts: [] })
    Object.assign(s, { week: { 1: ['A'] }, customEx: [], refUpdates: 'keep', programmeEnd: 'extend', refReviews: { 'occ:A:o0': { candidateId: 'c', decision: 'keep', at: 1 } } })
    s.programmes = { P: setLegacyWeeks({ id: 'P', name: 'Block', at: 1, rev: 1, end: 'stop', refs: 'inherit' }, [{ rpe: 7, t: { '0025': { pct: 75 } } }, { deload: true }], s, { days: { 1: ['A'], 4: ['B'] } }) }
    s.programmes.P.tracks[0].policy = { onFailure: 'repeat', onSkipped: 'advance' }
    startProgramme(s, 'P', { policies: Object.fromEntries(s.programmes.P.tracks.map(t => [t.id, ADVANCE])), end: 'stop', today: '2026-10-19' })
    pauseProgramme(s, Date.parse('2026-10-20T10:00:00Z'))
    return s
  }

  it('plan file format 2 carries no run state or consent; format 1 imports through the converter', () => {
    const s = running()
    const file = JSON.parse(JSON.stringify(buildProgrammeBundle(s, 'P')))
    expect(file).toMatchObject({ opengym_plan: 3, programme_fmt: 2, week: { 1: ['A'], 4: ['B'] } })
    const text = JSON.stringify(file)
    for (const k of ['programmeRuns', 'programmeEvents', 'refReviews', 'refUpdates', 'programmeEnd', '"ack"', '"runId"', '"ref"', '"src"']) expect(text).not.toContain(k)
    expect(Object.keys(file.programmes[0]).sort()).toEqual(['duration', 'end', 'id', 'name', 'refs', 'schedule', 'tracks'])
    // The proposed choices travel; the friend still has to acknowledge them at their own start.
    expect(file.programmes[0].tracks[0].policy).toEqual({ onFailure: 'repeat', onSkipped: 'advance' })
    const friend = { unit: 'kg', routines: [], week: { 2: ['mine'] }, customEx: [], programmes: {} }
    expect(mergePlan(friend, parsePlan(text, 'kg')).programmes).toBe(1)
    const [p] = Object.values(friend.programmes)
    const [a, b] = friend.routines
    expect(p.id).not.toBe('P')
    expect(p.schedule.appts).toEqual([{ rid: a.id, day: 1 }, { rid: b.id, day: 4 }])
    expect(p.tracks.map(t => t.slots[0])).toEqual([{ rid: a.id, oid: a.ex[0].occurrenceId }, { rid: b.id, oid: b.ex[0].occurrenceId }])
    expect(Object.keys(p.tracks[0].stages[0].targets)).toEqual([a.ex[0].occurrenceId])
    expect(validateProgramme(p, { routines: friend.routines }).ok).toBe(true)
    expect(friend.programme).toBeUndefined()
    expect(friend.programmeRuns).toBeUndefined()
    expect(friend.week).toEqual({ 2: ['mine'] })
    // Format 1, today's weeks of targets: converted over the routines it brought.
    const legacy = { ...file, programme_fmt: 1, programmes: [{ name: 'Old', days: { 1: ['A'] }, weeks: [{ rpe: 8, t: { '0025': { pct: 80 } } }] }] }
    const other = { unit: 'kg', routines: [], week: {}, customEx: [], programmes: {} }
    expect(mergePlan(other, parsePlan(JSON.stringify(legacy), 'kg')).programmes).toBe(1)
    const [q] = Object.values(other.programmes)
    const oid = other.routines[0].ex[0].occurrenceId
    expect(q.tracks[0].stages[0].targets[oid]).toMatchObject({ own: 'set', effort: { mode: 'advisory', rpe: 8 }, phase: { parameters: { load: { mode: 'percent_1rm', percent: 80 } } } })
    expect(validateProgramme(q, { routines: other.routines }).ok).toBe(true)
    // A newer programme format is left out; the routines still come in.
    expect(parsePlan({ ...file, programme_fmt: 3 }).programmes).toEqual([])
  })

  // A file is someone else's (spec 17): a format-2 programme comes in whole, with only the keys a
  // definition has, or the file is refused before anything is imported.
  const fileOf = mut => { const f = JSON.parse(JSON.stringify(buildProgrammeBundle(running(), 'P'))); mut(f.programmes[0], f); return JSON.stringify(f) }
  const refused = mut => expect(() => parsePlan(fileOf(mut), 'kg')).toThrow('this isn’t an openGym plan file')

  it('a format-2 programme that does not compile, names what the file lacks, or says more than a definition does is refused, never cut down', () => {
    refused(p => { p.tracks[0].stages = Array(17).fill(p.tracks[0].stages[0]) })        // over the bounds
    refused(p => { p.tracks[0].stages[0].kind = 'bogus' })                                // a kind the profile check refuses
    refused(p => { p.tracks[0].stages[0].close = 'x' })
    refused(p => { p.tracks[0].slots[0].oid = 'nowhere' })                                // a slot on an occurrence the file lacks
    refused(p => { p.schedule.appts.push({ rid: 'gone', day: 2 }) })
    refused(p => { const [oid] = Object.keys(p.tracks[0].stages[0].targets); p.tracks[0].stages[0].targets = JSON.parse(`{"__proto__":{"own":"inherit"},"${oid}":{"own":"inherit"}}`) })
    refused(p => { p.tracks = Array(51).fill(p.tracks[0]) })
    refused((p, f) => { f.programmes.push({ ...p, schedule: { mode: 'weeks', appts: Array(65).fill(p.schedule.appts[0]) } }) })
    // A key no definition has is left behind; the rest comes in and the friend's profile validates.
    const text = fileOf(p => {
      p.blob = 'x'.repeat(1000); p.run = { startedOn: '2026-01-01' }; p.tracks[0].ack = 'user'
      const t = Object.values(p.tracks[0].stages[0].targets)[0]
      Object.assign(t, { blob: 'x', ref: { value: 1 } }); t.phase.blob = 'x'; t.effort.blob = 'x'
    })
    const friend = { ...migratedFixture({ unit: 'kg', routines: [], workouts: [] }), week: {}, customEx: [], programmes: {} }
    expect(mergePlan(friend, parsePlan(text, 'kg')).programmes).toBe(1)
    const [p] = Object.values(friend.programmes)
    expect(JSON.stringify(p)).not.toMatch(/blob|startedOn|"ack"|"ref"/)
    expect(Object.keys(p).sort()).toEqual(['at', 'duration', 'end', 'id', 'name', 'refs', 'rev', 'schedule', 'tracks'])
    expect(validateCanonicalProfile({ ...friend, engineContractRevision: 1 }).ok).toBe(true)
    // More programmes than anyone makes: the first ones come.
    expect(parsePlan(fileOf((q, f) => { f.programmes = Array(40).fill(q) }), 'kg').programmes).toHaveLength(32)
  })

  it('a plan export leaves out a programme waiting on a repair, so the routines still import; a runnable one round-trips', () => {
    const s = running()
    s.programmes.Q = { ...s.programmes.P, id: 'Q', name: 'Broken', needs: ['repair'] }
    const file = JSON.parse(JSON.stringify(buildPlanBundle(s, 'Mine')))
    expect(file.programmes.map(p => p.name)).toEqual(['Block'])
    // A routine edit since (rule B) marks the only programme for repair: the file carries none, and imports.
    s.programmes.P = { ...s.programmes.P, needs: ['repair'] }
    const bare = JSON.parse(JSON.stringify(buildPlanBundle(s, 'Mine')))
    expect(bare.programmes).toBeUndefined()
    const friend = { unit: 'kg', routines: [], week: {}, customEx: [], programmes: {} }
    expect(mergePlan(friend, parsePlan(JSON.stringify(bare), 'kg'))).toMatchObject({ routines: 2, programmes: 0 })
    const other = { unit: 'kg', routines: [], week: {}, customEx: [], programmes: {} }
    expect(mergePlan(other, parsePlan(JSON.stringify(file), 'kg'))).toMatchObject({ routines: 2, programmes: 1 })
  })

  it('a format-2 programme keeps no nested blob: no target off its slots, nothing on a rest stage, a seed of metrics, a numeric TM step', () => {
    const blob = { deep: { blob: 'x'.repeat(200000) } }
    const text = fileOf((p, f) => {
      const [bench, squat] = p.tracks
      const [oid] = Object.keys(bench.stages[0].targets), other = squat.slots[0].oid
      bench.stages[0].targets[other] = { own: 'set', phase: { parameters: blob, groups: [blob] }, seed: blob, options: blob }
      bench.stages[0].targets[oid].seed = { load: 70, blob: 1, reps: 5 }
      bench.stages[1] = { id: 'r', kind: 'rest', targets: { [oid]: { own: 'inherit', seed: blob, options: blob } } }
      bench.tm = { value: 100, unit: 'kg', increment: blob }
      squat.tm = { value: 120, unit: 'kg', increment: 5 }
      void f
    })
    expect(text.length).toBeGreaterThan(800000)
    const friend = { unit: 'kg', routines: [], week: {}, customEx: [], programmes: {} }
    expect(mergePlan(friend, parsePlan(text, 'kg')).programmes).toBe(1)
    const [p] = Object.values(friend.programmes)
    expect(JSON.stringify(p).length).toBeLessThan(20000)
    const [bench, squat] = p.tracks
    expect(Object.keys(bench.stages[0].targets)).toEqual([bench.slots[0].oid])
    expect(bench.stages[0].targets[bench.slots[0].oid].seed).toEqual({ load: 70, reps: 5 })
    expect(bench.stages[1]).toEqual({ id: 'r', kind: 'rest', targets: { [bench.slots[0].oid]: { own: 'inherit' } } })
    expect(bench.tm).toEqual({ value: 100, unit: 'kg' })
    expect(squat.tm).toEqual({ value: 120, unit: 'kg', increment: 5 })
  })

  it('a format-1 file brings only what a programme is, at a size a programme has', () => {
    const file = JSON.parse(`{"name":"Block","days":{"1":["A"]},"weeks":[{"t":{"__proto__":{"pct":80},"constructor":{"pct":75},"A:toString":{"pct":70},"0025":{"pct":72.5}}}],
      "src":"strength-4","run":{"startedOn":"2026-01-01"},"blob":"${'x'.repeat(1000)}"}`)
    const S = migratedFixture({ unit: 'kg', weekStart: 1, routines: [{ id: 'a1', name: 'Push', ex: [{ id: '0025', sets: 3, reps: 5, weight: 60 }] }], workouts: [] })
    const got = importedProgramme(file, { ridMap: { A: 'a1' } }, S, 7)
    expect(Object.keys(got).sort()).toEqual(['at', 'duration', 'end', 'id', 'name', 'refs', 'rev', 'schedule', 'tracks'])
    expect(got).toMatchObject({ at: 7, name: 'Block', schedule: { appts: [{ rid: 'a1', day: 1 }] } })
    expect(legacyWeeksOf(got)).toEqual([{ t: { '0025': { pct: 72.5 } } }])
    expect(importedProgramme({ ...file, days: { 1: ['constructor'] } }, { ridMap: { A: 'a1' } }, S)).toBeNull()
    // A loop and its targets only as long as anyone writes one.
    const long = importedProgramme({ name: 'Loop', sequence: Array(500).fill('A'), weeks: [{ t: Object.fromEntries(Array.from({ length: 900 }, (_, i) => ['e' + i, { pct: 70 }])) }] }, { ridMap: { A: 'a1' } }, S)
    expect(long.src.sequence).toHaveLength(IMPORT_MAX_SEQUENCE)
    expect(Object.keys(long.src.weeks[0].t)).toHaveLength(IMPORT_MAX_TARGETS)
    expect(validateCanonicalProfile({ ...S, programmes: { [got.id]: got, [long.id]: long } }).ok).toBe(true)
  })
})
