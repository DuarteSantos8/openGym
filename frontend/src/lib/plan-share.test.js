import { describe, expect, it } from 'vitest'
import { buildPlanBundle, mergePlan, parsePlan } from './plan-share.js'

// There was no test file for plan sharing at all, which is how a whole prescription field
// went missing without anyone noticing.
const stateWith = ex => ({
  routines: [{ id: 'r1', name: 'Push', ex: [{ id: '0025', sets: 3, reps: 5, weight: 100, ...ex }] }],
  week: {}, customEx: [],
})
const roundTrip = ex => parsePlan(JSON.stringify(buildPlanBundle(stateWith(ex), 'Plan'))).routines[0].ex[0]

describe('plan-share units', () => {
  it('exports a unit and converts every load prescription at the import boundary', () => {
    const source = {
      unit: 'kg', week: {}, customEx: [],
      routines: [{ id: 'r', name: 'Strength', ex: [
        { id: '0025', mode: 'reps', sets: 3, reps: 5, weight: 60, inc: 2.5 },
        { id: '0007', mode: 'time', sets: 1, sec: 30, weight: 20, inc: 5 },
      ] }],
    }
    const bundle = buildPlanBundle(source, 'Strength')
    expect(bundle.unit).toBe('kg')
    const imported = parsePlan(bundle, 'lb')
    expect(imported.unit).toBe('lb')
    expect(imported.routines[0].ex[0]).toMatchObject({ weight: 132.5, inc: 5.5 })
    expect(imported.routines[0].ex[1]).toMatchObject({ weight: 44, inc: 5 })
  })

  it('converts pounds back to kilograms and merges the converted prescription', () => {
    const source = {
      unit: 'lb', week: {}, customEx: [],
      routines: [{ id: 'r', name: 'Strength', ex: [{ id: '0025', sets: 3, reps: 5, weight: 135, inc: 10 }] }],
    }
    const bundle = buildPlanBundle(source, 'Strength')
    const target = { unit: 'kg', routines: [], customEx: [], week: {} }
    mergePlan(target, bundle)
    expect(target.routines[0].ex[0]).toMatchObject({ weight: 61.25, inc: 4.5 })
  })

  it('keeps valid legacy bundles without a unit in their destination-unit semantics', () => {
    const legacy = {
      opengym_plan: 1, name: 'Legacy', summary: 'old export',
      week: { 1: 'r' }, customEx: [],
      routines: [{ id: 'r', name: 'Strength', ex: [{ id: '0025', sets: 3, reps: 5, weight: 60, inc: 2.5 }] }],
    }
    const parsed = parsePlan(legacy, 'lb')
    expect(parsed.unit).toBe('lb')
    expect(parsed.routines[0].ex[0]).toMatchObject({ weight: 60, inc: 2.5 })
  })

  it('accepts legacy root omissions and the older weightUnit marker', () => {
    const legacy = {
      opengym_plan: 1, weightUnit: 'lbs', legacyNote: 'kept as metadata',
      routines: [{ id: 'r', name: 'Strength', ex: [{ id: '0025', sets: 3, reps: 5, weight: 135, inc: 10 }] }],
    }
    const parsed = parsePlan(legacy, 'kg')
    expect(parsed.routines[0].ex[0]).toMatchObject({ weight: 61.25, inc: 4.5 })
    expect(parsed.week).toEqual({})
    expect(parsed.customEx).toEqual([])
  })
})

describe('what survives a shared plan', () => {
  it('carries Per side on a timed hold, and on reps work; never on cardio', () => {
    const hold = roundTrip({ mode: 'time', sec: 30, sets: 2, reps: undefined, weight: undefined, side: true })
    expect(hold).toMatchObject({ mode: 'time', sec: 30, sets: 2, side: true })
    expect(roundTrip({ side: true }).side).toBe(true)
    const cardio = parsePlan(JSON.stringify(buildPlanBundle({ routines: [{ id: 'r1', name: 'Run', ex: [{ id: '0025', sets: 1, mode: 'cardio', min: 20, side: true }] }], week: {}, customEx: [] }, 'Plan'))).routines[0].ex[0]
    expect(cardio.side).toBeUndefined()
  })

  it('carries cardio set on a non-cardio exercise, mode and all (#640)', () => {
    expect(roundTrip({ mode: 'cardio', min: 15, speed: 10, sets: 2, reps: undefined, weight: undefined }))
      .toMatchObject({ mode: 'cardio', min: 15, speed: 10, sets: 2 })
  })

  it('carries a drop-set prescription', () => {
    expect(roundTrip({ intensifier: { type: 'dropset', count: 2, pct: 20 } }).intensifier)
      .toEqual({ type: 'dropset', count: 2, pct: 20 })
  })

  it('carries a rest-pause prescription', () => {
    expect(roundTrip({ intensifier: { type: 'restpause', totalReps: 12, restSec: 15 } }).intensifier)
      .toEqual({ type: 'restpause', totalReps: 12, restSec: 15 })
  })

  it('carries planned warm-ups', () => {
    expect(roundTrip({ warmupSets: 3 }).warmupSets).toBe(3)
  })

  it('carries a non-default Epley deload factor and omits the default', () => {
    expect(roundTrip({ deloadFactor: 0.8 }).deloadFactor).toBe(0.8)
    expect('deloadFactor' in roundTrip({ deloadFactor: 0.9 })).toBe(false)
  })

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

  // Discord (lajawi): an exercise's own "No timer" is part of the prescription too.
  it('carries an exercise’s "No timer", and only a real one', () => {
    expect(roundTrip({ restOff: true })).toMatchObject({ restOff: true })
    expect('restSec' in roundTrip({ restOff: true })).toBe(false)
    expect(roundTrip({ restOff: true, restSec: 120 })).toMatchObject({ restSec: 120 })
    expect('restOff' in roundTrip({ restOff: true, restSec: 120 })).toBe(false)
    for (const e of [{}, { restOff: false }, { restOff: 'yes' }]) expect('restOff' in roundTrip(e), JSON.stringify(e)).toBe(false)
  })

  // The ramp's own rest is the same kind of prescription: a shared plan whose warm-up sets
  // arrive resting the full working rest is not the plan that was written.
  it('carries a per-exercise warm-up rest, and leaves it out when unset', () => {
    expect(roundTrip({ restSec: 150, warmupRestSec: 45 }).warmupRestSec).toBe(45)
    expect('warmupRestSec' in roundTrip({})).toBe(false)
    expect('warmupRestSec' in roundTrip({ warmupRestSec: 0 })).toBe(false)
  })

  // The warm-ups' "no timer" and the break between sides (Discord "set-specific rest timers").
  it('carries the warm-ups\' "no timer" and the break between sides, and leaves them out when unset', () => {
    expect(roundTrip({ warmupRestOff: true, warmupRestSec: 45 })).toMatchObject({ warmupRestOff: true })
    expect('warmupRestSec' in roundTrip({ warmupRestOff: true, warmupRestSec: 45 })).toBe(false)
    expect(roundTrip({ side: true, sideRestSec: 20 }).sideRestSec).toBe(20)
    for (const e of [{}, { warmupRestOff: false }, { warmupRestOff: 'yes' }, { side: true, sideRestSec: 0 }, { sideRestSec: 20 }]) {
      const out = roundTrip(e)
      expect('warmupRestOff' in out || 'sideRestSec' in out, JSON.stringify(e)).toBe(false)
    }
  })

  it('carries a hold\'s "no timer" between sides, over a time, and only on a per-side exercise (#636)', () => {
    const out = roundTrip({ side: true, mode: 'time', sec: 30, sideRestOff: true, sideRestSec: 20 })
    expect(out.sideRestOff).toBe(true)
    expect('sideRestSec' in out).toBe(false)
    for (const e of [{ sideRestOff: true }, { side: true, sideRestOff: 'yes' }]) expect('sideRestOff' in roundTrip(e), JSON.stringify(e)).toBe(false)
  })

  // The absence has to survive too: writing a 0 would pin the recipient's timer to "off"
  // instead of letting the exercise keep inheriting whatever their own default is.
  it('leaves an exercise that set no rest free of the field', () => {
    expect('restSec' in roundTrip({})).toBe(false)
    expect('restSec' in roundTrip({ restSec: 0 })).toBe(false)
  })

  it('carries the rest onto the routine mergePlan adds', () => {
    const bundle = parsePlan(JSON.stringify(buildPlanBundle(stateWith({ restSec: 180 }), 'Plan')))
    const s = { routines: [], customEx: [], week: {} }
    mergePlan(s, bundle, { schedule: false })
    expect(s.routines[0].ex[0].restSec).toBe(180)
  })

  it('drops an intensifier it does not recognise rather than passing it on', () => {
    expect(roundTrip({ intensifier: { type: 'nonsense', count: 3 } }).intensifier).toBeUndefined()
  })

  it('clamps a hand-edited warm-up count instead of showing it verbatim', () => {
    const bundle = { opengym_plan: 1, name: 'x', routines: [{ id: 'r', name: 'R', ex: [{ id: '0025', sets: 3, reps: 5, warmupSets: 999 }] }], week: {}, customEx: [] }
    expect(parsePlan(bundle).routines[0].ex[0].warmupSets).toBe(5)
  })

  // A plan file is someone else's data: a rest that arrives as a string would reach the timer's
  // arithmetic as one, and a negative or garbage one has no meaning to keep.
  it('normalises a hand-edited rest to a positive whole number or drops it', () => {
    const withRest = restSec => ({ opengym_plan: 1, name: 'x', routines: [{ id: 'r', name: 'R', ex: [{ id: '0025', sets: 3, reps: 5, restSec }] }], week: {}, customEx: [] })
    expect(parsePlan(withRest('120')).routines[0].ex[0].restSec).toBe(120)
    expect(parsePlan(withRest(90.6)).routines[0].ex[0].restSec).toBe(91)
    expect('restSec' in parsePlan(withRest(-30)).routines[0].ex[0]).toBe(false)
    expect('restSec' in parsePlan(withRest('abc')).routines[0].ex[0]).toBe(false)
  })

  // The floors are the config sheet's own (count >= 1, pct >= 5); a value that is present but
  // out of range is pulled up to the floor, while a missing one falls back to the default.
  it('clamps out-of-range intensifier numbers to the floors the app enforces', () => {
    const bundle = { opengym_plan: 1, name: 'x', routines: [{ id: 'r', name: 'R', ex: [{ id: '0025', sets: 3, reps: 5, intensifier: { type: 'dropset', count: 0, pct: -5 } }] }], week: {}, customEx: [] }
    expect(parsePlan(bundle).routines[0].ex[0].intensifier).toEqual({ type: 'dropset', count: 1, pct: 5 })
  })

  it('falls back to the default drop percentage when the file omits it', () => {
    const bundle = { opengym_plan: 1, name: 'x', routines: [{ id: 'r', name: 'R', ex: [{ id: '0025', sets: 3, reps: 5, intensifier: { type: 'dropset' } }] }], week: {}, customEx: [] }
    expect(parsePlan(bundle).routines[0].ex[0].intensifier).toEqual({ type: 'dropset', count: 1, pct: 20 })
  })
})

// A superset's name and rest between rounds (#292) live on every member of the group. The
// export used to copy `sg` alone, so a shared superset arrived nameless and resting the default.
describe('superset meta in a shared plan', () => {
  const superset = {
    routines: [{ id: 'r1', name: 'Arms', ex: [
      { id: '0025', sets: 3, reps: 10, sg: 'a', sgName: 'Arms finisher', sgRest: 90 },
      { id: '0007', sets: 3, reps: 12, sg: 'a', sgName: 'Arms finisher', sgRest: 90 },
      { id: '0025', sets: 2, reps: 8 },
    ] }],
    week: {}, customEx: [],
  }
  const withEx = ex => ({ opengym_plan: 1, name: 'x', routines: [{ id: 'r', name: 'R', ex }], week: {}, customEx: [] })

  it('carries the name and rest through export, parsePlan and mergePlan', () => {
    const bundle = buildPlanBundle(superset, 'Plan')
    expect(bundle.routines[0].ex[0]).toMatchObject({ sg: 'a', sgName: 'Arms finisher', sgRest: 90 })
    const parsed = parsePlan(JSON.stringify(bundle))
    const s = { routines: [], customEx: [], week: {} }
    mergePlan(s, parsed, { schedule: false })
    const [a, b, lone] = s.routines[0].ex
    expect(a).toMatchObject({ sg: 'a', sgName: 'Arms finisher', sgRest: 90 })
    expect(b).toMatchObject({ sg: 'a', sgName: 'Arms finisher', sgRest: 90 })
    expect('sgName' in lone || 'sgRest' in lone).toBe(false)
  })

  it('leaves the fields out when the superset has neither', () => {
    const plain = { ...superset, routines: [{ id: 'r1', name: 'A', ex: [{ id: '0025', sets: 3, reps: 10, sg: 'a' }] }] }
    const e = parsePlan(JSON.stringify(buildPlanBundle(plain, 'Plan'))).routines[0].ex[0]
    expect(e.sg).toBe('a')
    expect('sgName' in e || 'sgRest' in e).toBe(false)
  })

  // A plan file is someone else's data: the name is trimmed and capped the way setSupersetMeta
  // writes it, the rest becomes a positive whole number of seconds or nothing.
  it('normalises a hand-edited name and rest, or drops them', () => {
    const long = '  ' + 'x'.repeat(100) + '  '
    const [e] = parsePlan(withEx([{ id: '0025', sets: 3, reps: 5, sg: 'a', sgName: long, sgRest: '75.4' }])).routines[0].ex
    expect(e.sgName).toBe('x'.repeat(40))
    expect(e.sgRest).toBe(75)
    const [bad] = parsePlan(withEx([{ id: '0025', sets: 3, reps: 5, sg: 'a', sgName: { evil: 1 }, sgRest: -30 }])).routines[0].ex
    expect('sgName' in bad || 'sgRest' in bad).toBe(false)
    const [blank] = parsePlan(withEx([{ id: '0025', sets: 3, reps: 5, sg: 'a', sgName: '   ', sgRest: 'abc' }])).routines[0].ex
    expect('sgName' in blank || 'sgRest' in blank).toBe(false)
  })

  it('drops the meta from an exercise that is not in a superset', () => {
    const [e] = parsePlan(withEx([{ id: '0025', sets: 3, reps: 5, sgName: 'Orphan', sgRest: 60 }])).routines[0].ex
    expect('sgName' in e || 'sgRest' in e).toBe(false)
    // and the export never writes it there either
    const out = buildPlanBundle(stateWith({ sgName: 'Orphan', sgRest: 60 }), 'Plan').routines[0].ex[0]
    expect('sgName' in out || 'sgRest' in out).toBe(false)
  })
})

// ---- combine routines: a weekday holds a routine-id list (ENG-9 §5) ----
describe('week schedule as a routine-id list', () => {
  const twoRoutines = {
    routines: [
      { id: 'a', name: 'A', ex: [{ id: '0025', sets: 3, reps: 5 }] },
      { id: 'b', name: 'B', ex: [{ id: '0031', sets: 3, reps: 8 }] },
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

  it('tolerates a legacy scalar bundle value', () => {
    const legacy = { opengym_plan: 1, name: 'x', customEx: [], week: { 1: 'a' }, routines: twoRoutines.routines }
    const parsed = parsePlan(legacy)
    expect(parsed.scheduledDays).toBe(1)
    const target = { routines: [], week: {}, customEx: [] }
    mergePlan(target, parsed, { schedule: true })
    expect(target.week[1]).toEqual([target.routines[0].id])
  })

  it('mergePlan drops an element whose id did not survive parsing, never writes undefined', () => {
    // 'gone' is not among the bundle routines → ridMap has no entry → filtered out
    const bundle = { routines: [{ id: 'a', name: 'A', ex: [{ id: '0025', sets: 3, reps: 5 }] }], week: { 1: ['a', 'gone'], 2: ['gone'] }, customEx: [] }
    const target = { routines: [], week: {}, customEx: [] }
    mergePlan(target, bundle, { schedule: true })
    expect(target.week[1]).toEqual([target.routines[0].id])
    expect(target.week[2]).toBeUndefined()             // emptied → left absent, not stored as []
  })

  it('scheduledDays counts a populated array day as 1 and a [] / absent day as 0', () => {
    expect(parsePlan({ opengym_plan: 1, routines: [], customEx: [], week: { 1: ['a'], 2: [], 4: 'b' } }).scheduledDays).toBe(2)
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
    routines: [{ id: 'r', name: 'Back day', ex: [{ id: 'c1', sets: 3, reps: 8, weight: 40 }] }],
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
    expect(target.routines[0].ex[0].id).toBe(stored.id)
  })

  // A file written before the metadata travelled has only a name and a body part; it still imports,
  // and the recipient can now add the equipment and muscles themselves.
  it('keeps importing an old name-plus-body-part file, editable at the other end', () => {
    const legacy = { opengym_plan: 1, routines: [{ id: 'r', name: 'R', ex: [{ id: 'x', sets: 3, reps: 5 }] }], customEx: [{ id: 'x', n: 'Old one', bp: 'legs' }] }
    const target = { routines: [], week: {}, customEx: [] }
    mergePlan(target, parsePlan(legacy))
    expect(target.customEx[0]).toEqual({ id: target.customEx[0].id, n: 'Old one', bp: 'legs', custom: true })
    expect(target.routines[0].ex[0].id).toBe(target.customEx[0].id)
  })

  // A plan file is someone else's data: only muscles the map can draw are kept, and a muscle listed
  // as both primary and secondary counts once, as the form itself enforces.
  it('drops muscles it cannot draw and a secondary that repeats a primary', () => {
    const bundle = { opengym_plan: 1, routines: [], customEx: [{ id: 'x', n: 'Odd', bp: 'back', eq: 'barbell', primaries: ['upper-back', 'wings'], secondaries: ['upper-back', 'biceps', 7] }] }
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
    expect(target.routines[0].ex[0].id).toBe('mine')
  })
})

describe('plan-share links and media (#246)', () => {
  const photo = { kind: 'image', hash: 'a'.repeat(64), mime: 'image/webp', size: 10, width: 4, height: 3, at: 1 }
  const withCustom = c => ({
    unit: 'kg', week: {},
    routines: [{ id: 'r1', name: 'Push', ex: [{ id: 'cx1', sets: 3, reps: 5 }] }],
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

describe('the video a routine came from', () => {
  it('travels in the plan file, cleaned; a hostile link does not', () => {
    const S = { unit: 'kg', week: {}, customEx: [], routines: [
      { id: 'r1', name: 'HIIT', emoji: 'timer', sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', videoId: 'dQw4w9WgXcQ', ex: [{ id: '1160', sets: 3, mode: 'time', sec: 40, restSec: 20 }] },
      { id: 'r2', name: 'Bad', emoji: 'timer', sourceUrl: 'javascript:alert(1)', ex: [{ id: '1160', sets: 1, mode: 'time', sec: 30 }] }
    ] }
    const bundle = buildPlanBundle(S, 'x')
    expect(bundle.routines[0].sourceUrl).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(bundle.routines[0].videoId).toBeUndefined()   // re-import matching is the importer's, not the friend's
    expect(bundle.routines[1].sourceUrl).toBeUndefined()
    const dest = { unit: 'kg', week: {}, routines: [], customEx: [] }
    mergePlan(dest, parsePlan(JSON.stringify({ ...bundle, routines: [{ ...bundle.routines[0] }, { ...bundle.routines[1], sourceUrl: 'javascript:alert(1)' }] })))
    expect(dest.routines[0].sourceUrl).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(dest.routines[1].sourceUrl).toBeUndefined()
  })
})
