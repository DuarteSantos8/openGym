import { describe, it, expect } from 'vitest'
import { EXIDX, EXDB, smOf } from './exercises.js'
import { LANGS, DERIVED_LOCALES } from './i18n-core.js'
import {
  MUSCLE_NAME, exerciseMuscleSnapshot, hasExplicitMuscleMetadata, levelsOf, loadOf,
  loadOfWorkouts, loadOfWeeklyPlan, matchesMuscleGroups, muscleBalanceWindow, muscleGroupsOf,
  musclesOf, muscleWeightsOf, rankOf, mainMusclesOf, loadOfRoutine
} from './muscles.js'

describe('multi-muscle exercise metadata', () => {
  it('normalizes legacy primary/secondary fields and removes duplicate groups', () => {
    const ex = { tg: 'pectorals', mg: 'triceps', sm: ['triceps', 'chest'] }
    expect(muscleGroupsOf(ex)).toEqual(['chest', 'triceps'])
    expect(musclesOf(ex)).toEqual({ chest: 1, triceps: 0.4 })
  })

  it('uses explicit multi-group metadata when present and supports legacy single groups', () => {
    expect(muscleGroupsOf({ muscleGroups: ['chest', 'pectorals', 'triceps'] })).toEqual(['chest', 'triceps'])
    expect(muscleGroupsOf({ tg: 'chest' })).toEqual(['chest'])
    expect(MUSCLE_NAME.chest).toBe('Chest')
  })

  // Since 1.4.5 the lats are their own muscle (#638), apart from the upper back (#607 named them
  // together while the map had one region for both).
  it('counts the lats as the lats and names them', () => {
    expect(muscleGroupsOf({ tg: 'lats', sm: ['latissimus dorsi'] })).toEqual(['lats'])
    expect(loadOf([{ id: 'inline', ex: { primaries: ['lats'] }, sets: 3 }])).toEqual({ lats: 3 })
    expect(MUSCLE_NAME.lats).toBe('Lats')
  })

  it('falls back to the legacy body-part map when an optional multi-group field is empty', () => {
    expect(muscleGroupsOf({ bp: 'back', muscleGroups: [] })).toEqual(['lats', 'upper-back', 'lower-back'])
    expect(matchesMuscleGroups({ bp: 'back', muscleGroups: [] }, ['lower-back'])).toBe(true)
  })

  it('falls back consistently when explicit groups contain only unknown names', () => {
    const ex = { bp: 'back', muscleGroups: ['not-a-drawable-name'] }
    expect(muscleGroupsOf(ex)).toEqual(['lats', 'upper-back', 'lower-back'])
    expect(musclesOf(ex)).toEqual({ lats: 0.4, 'upper-back': 0.4, 'lower-back': 0.2 })
  })

  it('matches an exercise when any requested muscle group matches', () => {
    const ex = { muscleGroups: ['chest', 'triceps'] }
    expect(matchesMuscleGroups(ex, ['hamstring', 'triceps'])).toBe(true)
    expect(matchesMuscleGroups(ex, ['hamstring', 'gluteal'])).toBe(false)
    expect(matchesMuscleGroups(ex, [])).toBe(true)
  })

  it('counts one effective set per unique group instead of double counting duplicates', () => {
    expect(loadOf([{ id: 'inline', ex: { tg: 'chest', sm: ['chest', 'triceps'] }, sets: 2 }]))
      .toEqual({ chest: 2, triceps: 0.8 })
  })

  it('uses multi-muscle metadata carried by a history entry when its catalogue id is unavailable', () => {
    expect(loadOfWorkouts([{ entries: [{
      id: 'deleted-custom', muscleGroups: ['chest', 'chest', 'triceps'],
      sets: [{ done: true }]
    }] }])).toEqual({ chest: 1, triceps: 1 })
  })
})

describe('explicit muscle weights', () => {
  const complete = { chest: 1, 'front-delts': 0.4, triceps: 0 }

  it('preserves every finite explicit weight from zero through one', () => {
    expect(muscleWeightsOf({ muscleWeights: complete })).toEqual(complete)
  })

  it('keeps effective stimulus positive-only', () => {
    expect(musclesOf({ muscleWeights: complete })).toEqual({ chest: 1, 'front-delts': 0.4 })
  })

  it('treats a recognized all-zero map as authoritative instead of using body-part defaults', () => {
    const ex = { bp: 'chest', muscleWeights: { chest: 0, triceps: 0 } }
    expect(muscleWeightsOf(ex)).toEqual({ chest: 0, triceps: 0 })
    expect(musclesOf(ex)).toEqual({})
  })

  it('preserves complete weights in history snapshots', () => {
    expect(exerciseMuscleSnapshot({ n: 'Press', bp: 'chest', muscleWeights: complete }))
      .toMatchObject({ n: 'Press', bp: 'chest', muscleWeights: complete })
  })

  it('keeps legacy primary and secondary fallback weights', () => {
    expect(muscleWeightsOf({ tg: 'pectorals', mg: 'triceps' })).toEqual({ chest: 1, triceps: 0.4 })
  })
})

describe('catalogue secondary muscles', () => {
  it('maps a bench press to chest, triceps and the front delts', () => {
    expect(musclesOf(EXIDX['0025'])).toMatchObject({
      chest: 1,
      triceps: 0.4,
      'front-delts': 0.4,
    })
  })

  it('maps a squat to glutes, quads and hamstrings', () => {
    expect(musclesOf(EXIDX['0043'])).toMatchObject({
      gluteal: 1,
      quadriceps: 1,
      hamstring: 0.4,
    })
  })

  it('maps common row variations to the upper back, lats, biceps and rear delts', () => {
    for (const id of ['0027', '0293', '0499', '0861']) {
      expect(musclesOf(EXIDX[id])).toMatchObject({
        'upper-back': 1,
        biceps: 0.4,
        'rear-delts': 0.4,
      })
      expect(musclesOf(EXIDX[id]).lats).toBeGreaterThan(0)
    }
  })
})

describe('leg press and hack squat calves (#1034)', () => {
  const legWork = EXDB.filter(e => /\b(leg press|hack squat)\b/i.test(e.n) && !/calf|calves|good morning|deadlift/i.test(e.n))
  it('credits no calves to a leg press or hack squat', () => {
    expect(legWork.length).toBeGreaterThan(30)
    expect(legWork.filter(e => musclesOf(EXIDX[e.id]).calves).map(e => e.id)).toEqual([])
  })

  it('still credits calves to a calf press on the leg press machine', () => {
    for (const id of ['0738', '1391', '1392', '2289']) expect(musclesOf(EXIDX[id]).calves).toBe(1)
  })
})


describe('catalogue secondary additions', () => {
  it('enriches the muscle map without mutating the raw dataset', () => {
    const raw = EXDB.find(e => e.id === '0027')
    expect(raw.sm).not.toContain('rear deltoids')
    expect(smOf(raw)).toContain('rear deltoids')
    // the alias lands on the rear head in the canonical muscle map
    expect(musclesOf(raw)).toHaveProperty('rear-delts')
  })

  it('credits the lower back on the deadlift variants the muscle map does not carry (#693)', () => {
    for (const id of ['4133', '10189']) {
      const raw = EXDB.find(e => e.id === id)
      // the generated rows name no back muscle at all
      expect([...raw.sm, raw.tg, raw.mg].join(' ')).not.toMatch(/back|spine|lats|traps/)
      expect(smOf(raw)).toContain('lower back')
      expect(muscleGroupsOf(EXIDX[id])).toContain('lower-back')
      expect(musclesOf(EXIDX[id])).toHaveProperty('lower-back', 0.4)
    }
  })
})


describe('explicit multi-primary metadata', () => {
  it('gives every primary full weight and secondaries supporting weight', () => {
    const ex = {
      bp: 'chest', tg: 'abs', mg: 'triceps', sm: ['lower back'],
      primaries: ['chest', 'triceps', 'chest'], secondaries: ['deltoids', 'triceps']
    }
    expect(muscleGroupsOf(ex)).toEqual(['chest', 'triceps', 'deltoids'])
    // A generic shoulder is all three heads, the front most.
    expect(musclesOf(ex)).toEqual({ chest: 1, triceps: 1, 'front-delts': 0.4, 'side-delts': 0.24, 'rear-delts': 0.16 })
  })

  it('keeps the body-part fallback when primaries are absent or explicitly empty', () => {
    const expected = { lats: 0.4, 'upper-back': 0.4, 'lower-back': 0.2 }
    expect(musclesOf({ bp: 'back' })).toEqual(expected)
    expect(musclesOf({ bp: 'back', primaries: [] })).toEqual(expected)
  })

  it('keeps legacy metadata when a new array field is present but empty', () => {
    expect(exerciseMuscleSnapshot({ bp: 'chest', tg: 'abs', primaries: [] })).toMatchObject({
      muscleGroups: ['abs']
    })
  })

  it('provides a conservative Full body fallback for legacy custom exercises', () => {
    expect(muscleGroupsOf({ bp: 'full body' })).toEqual(['chest', 'lats', 'upper-back', 'gluteal', 'quadriceps', 'hamstring', 'abs'])
    expect(musclesOf({ bp: 'full body' })).toEqual({
      chest: 0.2, lats: 0.1, 'upper-back': 0.1, gluteal: 0.2, quadriceps: 0.2, hamstring: 0.1, abs: 0.1
    })
  })

  it('preserves explicit primary and secondary arrays in history snapshots', () => {
    expect(exerciseMuscleSnapshot({
      n: 'Deadlift', bp: 'full body', primaries: ['gluteal', 'lower-back'], secondaries: ['hamstring']
    })).toMatchObject({
      n: 'Deadlift', bp: 'full body', primaries: ['gluteal', 'lower-back'], secondaries: ['hamstring'],
      muscleGroups: ['gluteal', 'lower-back', 'hamstring']
    })
  })
})


describe('map load with warm-up phases', () => {
  it('excludes warm-up sets from the by-sets-worked map', () => {
    const w = {
      id: 'w1', d: '2026-08-01', start: Date.UTC(2026, 7, 1, 10), unit: 'kg',
      entries: [{
        id: '0025',
        sets: [
          { done: true, phase: 'warmup', w: 20, r: 8 },
          { done: true, phase: 'work', w: 60, r: 8 },
        ],
      }],
    }
    const load = loadOfWorkouts([w], null)
    expect(load.chest).toBe(1)
  })
})

describe('planned weekly muscle volume', () => {
  const state = {
    customEx: [
      { id: 'press', primaries: ['chest'], secondaries: ['triceps'] },
      { id: 'curl', primaries: ['biceps'], secondaries: [] },
    ],
    routines: [
      { id: 'push', ex: [{ id: 'press', sets: 2 }] },
      { id: 'arms', ex: [{ id: 'curl', sets: 3 }] },
    ],
    week: { 0: 'arms', 1: ['push', 'missing'], 3: ['push'] },
    dayPlan: { '2026-08-18': 'arms' },
    workouts: [{ entries: [{ id: 'snapshot-only', muscleSnapshot: { muscleWeights: { quadriceps: 1 } } }] }],
  }

  it('aggregates arrays and legacy scalar assignments, including routines repeated in the week', () => {
    expect(loadOfWeeklyPlan(state)).toEqual({ chest: 4, triceps: 1.6, biceps: 3 })
  })

  it('ignores stale routine ids, date overrides, and completed-workout snapshots', () => {
    const load = loadOfWeeklyPlan(state)
    expect(load).not.toHaveProperty('quadriceps')
    expect(load.biceps).toBe(3)
  })

  it('counts a floating week once per session, beside the weekday routines it does not cover', () => {
    const queued = { ...state, queue: { ids: ['push', 'push', 'gone'], since: 0, startsOn: '2026-08-17' } }
    // weekday 'arms' (3) + the queue's 'push' once (2 chest, 0.8 triceps); the weekday 'push' rows
    // are the queue's session, not a second plan of their own.
    expect(loadOfWeeklyPlan(queued)).toEqual({ chest: 2, triceps: 0.8, biceps: 3 })
  })

  it('returns an empty projection for missing or empty plans', () => {
    expect(loadOfWeeklyPlan()).toEqual({})
    expect(loadOfWeeklyPlan({ routines: [], week: { 1: ['missing'] } })).toEqual({})
  })
})

// A custom exercise that was deleted from the catalogue survives in history only as the
// muscleSnapshot finish-workout wrote. Reading it back is what keeps those sessions in the
// body map and in Stats instead of silently contributing nothing.
describe('deleted custom exercises', () => {
  const snapshotEntry = {
    id: 'gone-custom-1',
    sets: [{ w: 60, r: 8, done: true }],
    muscleSnapshot: { n: 'Deleted custom', bp: 'chest', muscleGroups: ['chest'], muscleWeights: { chest: 1 } },
  }

  it('reads muscle load back out of the snapshot', () => {
    expect(loadOfWorkouts([{ d: '2026-08-01', entries: [snapshotEntry] }])).toEqual({ chest: 1 })
  })

  it('reports the snapshot groups as explicit metadata', () => {
    expect(hasExplicitMuscleMetadata(snapshotEntry)).toBe(true)
    expect(muscleGroupsOf(snapshotEntry)).toEqual(['chest'])
  })

  it('still prefers the entry\'s own metadata when it has any', () => {
    const withOwn = { ...snapshotEntry, tg: 'quadriceps' }
    expect(muscleGroupsOf(withOwn)).toEqual(['quadriceps'])
  })
})

// muscles.js counts completed work, so its warm-up boundary has to agree with the one the
// session runtime uses — including the legacy spellings phaseForSet normalises.
describe('warm-up boundary', () => {
  it('excludes every phase spelling the workout model treats as a warm-up', () => {
    const entries = spelling => [{ id: '0025', sets: [{ w: 100, r: 5, done: true, phase: spelling }] }]
    for (const spelling of ['warmup', 'warm-up', 'warm_up', 'Warmup', ' warmup ']) {
      expect(loadOfWorkouts([{ d: '2026-08-01', entries: entries(spelling) }]), spelling).toEqual({})
    }
  })
})

describe('muscle balance windows and ranking', () => {
  const now = new Date('2026-08-27T12:00:00').getTime()
  const workouts = [
    { id: 'monday', d: '2026-08-24', start: new Date('2026-08-24T12:00:00').getTime() },
    { id: 'sunday', d: '2026-08-23', start: new Date('2026-08-23T12:00:00').getTime() },
    { id: 'boundary', d: '2026-07-28', start: now - 30 * 86400000 },
    { id: 'inside', d: '2026-07-29', start: now - 29 * 86400000 },
  ]

  it('preserves calendar-week, strict trailing-day, and all-history semantics', () => {
    expect(muscleBalanceWindow(workouts, 7, now, '2026-08-27').map(w => w.id)).toEqual(['monday'])
    expect(muscleBalanceWindow(workouts, 30, now, '2026-08-27').map(w => w.id)).toEqual(['monday', 'sunday', 'inside'])
    expect(muscleBalanceWindow(workouts, 0, now, '2026-08-27')).toEqual(workouts)
  })

  it('uses relative levels and canonical order to break load ties', () => {
    const load = { chest: 2, 'side-delts': 2, biceps: 1 }
    expect(rankOf(load).worked).toEqual(['side-delts', 'chest', 'biceps'])
    expect(levelsOf(load)).toMatchObject({ 'side-delts': 4, chest: 4, biceps: 2, abs: 0 })
  })

  it('keeps catalogue precedence and deleted-custom snapshot weights', () => {
    const known = { id: '0025', muscleGroups: ['quadriceps'], sets: [{ done: true }] }
    const deleted = { id: 'deleted', muscleSnapshot: { muscleWeights: { chest: 1 } }, sets: [{ done: true }] }
    expect(loadOfWorkouts([{ entries: [known] }])).toEqual({ chest: 1, triceps: 0.4, 'front-delts': 0.4 })
    expect(loadOfWorkouts([{ entries: [deleted] }])).toEqual({ chest: 1 })
  })
})

// MUSCLE_NAME values are the i18n keys — a value no pack defines renders English in every
// language. The Library list showed "Cardiovascular system" untranslated for every cardio
// exercise (QA copy): the packs only ever had the dataset's own lowercase spelling.
describe('MUSCLE_NAME as i18n keys', () => {
  const packs = import.meta.glob('../locales/*.js', { eager: true })
  // One pack per non-English language, except a derived locale such as de-CH — counted from
  // LANGS rather than hardcoded, so adding a language cannot silently shrink this check.
  const packCount = Object.keys(LANGS).filter(code => code !== 'en' && !DERIVED_LOCALES[code]).length
  it('every display name is a key in every locale pack', () => {
    expect(Object.keys(packs).length).toBe(packCount)
    for (const [file, mod] of Object.entries(packs)) {
      const missing = Object.values(MUSCLE_NAME).filter(name => !(name in mod.default))
      expect(missing, file).toEqual([])
    }
  })
})

// Catalogue answers are remembered for Stats (muscleWeightsOf/musclesOf run per entry of every
// workout); what a caller gets is still its own object, and anything not built in is read fresh.
describe('remembered catalogue muscles', () => {
  it('hands out an equal copy each time, so a caller changing it changes nothing', () => {
    const ex = EXIDX['0025']
    const a = musclesOf(ex), b = muscleWeightsOf(ex)
    expect(Object.keys(a).length).toBeGreaterThan(0)
    a.chest = 99; b.chest = 99; a.made_up = 1
    expect(musclesOf(ex)).not.toBe(a)
    expect(musclesOf(ex)).toEqual(musclesOf({ ...ex }))
    expect(muscleWeightsOf(ex)).toEqual(muscleWeightsOf({ ...ex }))
  })

  it('reads an exercise of your own again after you edit it', () => {
    const own = { id: 'c-q1', n: 'Mine', tg: 'pectorals' }
    expect(Object.keys(musclesOf(own))).toEqual(['chest'])
    own.tg = 'biceps'
    expect(Object.keys(musclesOf(own))).toEqual(['biceps'])
  })
})

// Weekly sets per muscle counted by main muscles only (muscle-targets.js, S.muscleSetsMain): the
// muscles an exercise mainly trains keep their credit, the supporting ones get none.
describe('main muscles only', () => {
  const BENCH = '0025'

  it('drops the supporting muscles, however the exercise names them', () => {
    expect(mainMusclesOf({ tg: 'pectorals', mg: 'triceps', sm: ['triceps', 'chest'] })).toEqual({ chest: 1 })
    expect(mainMusclesOf({ primaries: ['chest'], secondaries: ['triceps', 'biceps'] })).toEqual({ chest: 1 })
    expect(mainMusclesOf({ primaries: ['chest', 'triceps'] })).toEqual({ chest: 1, triceps: 1 })
  })

  it('keeps a broad target whole: a generic shoulder is still all of its heads', () => {
    const heads = musclesOf({ primaries: ['deltoids'] })
    expect(Object.keys(heads).length).toBe(3)
    expect(mainMusclesOf({ primaries: ['deltoids'], secondaries: ['triceps'] })).toEqual(heads)
  })

  it('a list of groups does not say which muscle only helps, so each counts', () => {
    const ex = { muscleGroups: ['chest', 'triceps'] }
    expect(mainMusclesOf(ex)).toEqual(musclesOf(ex))
  })

  it('falls back to the body part only when nothing at all is named', () => {
    expect(mainMusclesOf({ bp: 'chest' })).toEqual(musclesOf({ bp: 'chest' }))
    // Only a supporting muscle is named: nothing is mainly trained, and the body part is not guessed.
    expect(musclesOf({ bp: 'chest', secondaries: ['triceps'] })).toEqual({ triceps: 0.4 })
    expect(mainMusclesOf({ bp: 'chest', secondaries: ['triceps'] })).toEqual({})
  })

  it('reads a saved weights snapshot by its lists, else by full credit', () => {
    const weights = { chest: 1, triceps: 0.4, biceps: 0.7 }
    expect(mainMusclesOf({ muscleWeights: weights, primaries: ['chest'], secondaries: ['triceps'] })).toEqual({ chest: 1 })
    expect(mainMusclesOf({ muscleWeights: weights, secondaries: ['triceps'] })).toEqual({ chest: 1, biceps: 0.7 })
    expect(mainMusclesOf({ muscleWeights: { calves: 1, quadriceps: 0.4 } })).toEqual({ calves: 1 })
    // Nothing at full credit and nothing named: a spread over a body part, kept as it is.
    const spread = { quadriceps: 0.4, gluteal: 0.35 }
    expect(mainMusclesOf({ muscleWeights: spread })).toEqual(spread)
  })

  it('hands out a copy of a catalogue exercise, and leaves musclesOf as it was', () => {
    const before = musclesOf(EXIDX[BENCH])
    const main = mainMusclesOf(EXIDX[BENCH])
    expect(main.chest).toBe(1)
    expect(main.triceps).toBeUndefined()
    main.chest = 99
    expect(mainMusclesOf(EXIDX[BENCH]).chest).toBe(1)
    expect(musclesOf(EXIDX[BENCH])).toEqual(before)
    expect(before.triceps).toBeCloseTo(0.4)
  })

  it('is asked for with { main: true }, and nothing else, through the load helpers', () => {
    const items = [{ id: BENCH, sets: 3 }]
    const full = loadOf(items)
    expect(full.triceps).toBeCloseTo(1.2)
    expect(loadOf(items, { main: true })).toEqual({ chest: 3 })
    for (const opts of [undefined, null, {}, { main: false }, { main: 'yes' }, { main: 1 }]) expect(loadOf(items, opts)).toEqual(full)
    const workouts = [{ entries: [{ id: BENCH, sets: [{ done: true }, { done: true }, { done: false }] }] }]
    expect(loadOfWorkouts(workouts, null, { main: true })).toEqual({ chest: 2 })
    expect(loadOfRoutine({ ex: [{ id: BENCH, sets: 4 }] }, {}, { main: true })).toEqual({ chest: 4 })
  })
})
