// What a broken or hostile Hevy API response can do to the importer. The key is the user's, the
// JSON is not: every field is read as if the server could put anything in it. Same two rules as
// the CSV side — a bad item is skipped, and nothing reaches the store the app cannot render — and
// the merge rule that routines are added or replace their own earlier copy, never anything else.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseHevyWorkouts, parseHevyRoutines, parseHevyBodyweight, mergeHevyRoutines, fetchHevyPages, importHevyData } from './import-hevy.js'

const BODY_PARTS = new Set(['chest', 'back', 'shoulders', 'upper arms', 'lower arms', 'upper legs', 'lower legs', 'waist', 'cardio', 'neck'])
const kg = { unit: 'kg' }
// 4E5257DE is in HEVY_ID_MAP (a lat pulldown); ZZZ1 / DEADBEEF are not, so they become customs.
const T_LAT = { id: '4E5257DE', title: 'Lat Pulldown - Close Grip (Cable)', type: 'weight_reps', primary_muscle_group: 'lats' }
const T_MINE = { id: 'DEADBEEF', title: 'My Invented Landmine Twist', type: 'weight_reps', primary_muscle_group: 'abdominals' }
const set = (o = {}) => ({ type: 'normal', weight_kg: 50, reps: 5, distance_meters: null, duration_seconds: null, rpe: null, ...o })
const lat = (...sets) => ({ exercise_template_id: '4E5257DE', title: 'Latzug', sets: sets.length ? sets : [set()] })
const workout = (o = {}) => ({ id: 'w1', title: 'Push', start_time: '2024-03-07T12:00:00Z', end_time: '2024-03-07T13:00:00Z', exercises: [lat()], ...o })
const routines = (r = {}, templates = [T_LAT, T_MINE]) => parseHevyRoutines([{ id: 'r1', title: 'Push', exercises: [lat()], ...r }], templates, kg)
const reply = body => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => body })

describe('a template whose muscle group spells a prototype property', () => {
  it('still gets a real body part', () => {
    for (const g of ['__proto__', 'constructor']) {
      const tpl = [{ id: 'ZZZ1', title: 'Zorb', primary_muscle_group: g }]
      const p = parseHevyWorkouts([workout({ exercises: [{ exercise_template_id: 'ZZZ1', sets: [set()] }] })], tpl, kg)
      expect(p.customEx).toHaveLength(1)
      expect(typeof p.customEx[0].bp, `group "${g}" gave bp ${String(p.customEx[0].bp)}`).toBe('string')
      expect(BODY_PARTS.has(p.customEx[0].bp)).toBe(true)
      const r = parseHevyRoutines([{ id: 'r1', title: 'Push', exercises: [{ exercise_template_id: 'ZZZ1', sets: [set()] }] }], tpl, kg)
      expect(typeof r.customEx[0].bp, `routine group "${g}"`).toBe('string')
    }
  })
})

describe('a workout title that is not text', () => {
  it('never reaches the stored name — WorkoutRow renders it as a React child', () => {
    for (const title of [{}, ['a', { b: 1 }], 12345, true, null, undefined]) {
      const p = parseHevyWorkouts([workout({ title })], [T_LAT], kg)
      expect(p.workouts).toHaveLength(1)
      expect(typeof p.workouts[0].name, `title ${JSON.stringify(title)}`).toBe('string')
    }
  })

  it('a later session on the same day lends its title only if it is text', () => {
    const p = parseHevyWorkouts([workout({ title: '' }), workout({ id: 'w2', title: {}, start_time: '2024-03-07T18:00:00Z' })], [T_LAT], kg)
    expect(p.workouts[0].name).toBe('Imported')
  })
})

describe('paging through whatever the server sends', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('a string where the list should be is spread into characters, which then import as nothing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply({ page_count: 1, workouts: 'hello' })))
    const items = await fetchHevyPages('/v1/workouts', 'k', { resultKey: 'workouts' })
    expect(items).toEqual(['h', 'e', 'l', 'l', 'o'])
    const p = parseHevyWorkouts(items, [], kg)
    expect(p.workouts).toEqual([])
    expect(p.skipped).toBe(5)
  })

  it('a number or an object where the list should be, or a null body, throws — the sheet turns that into a toast', async () => {
    for (const body of [{ page_count: 1, workouts: 5 }, { page_count: 1, workouts: { a: 1 } }, null]) {
      vi.stubGlobal('fetch', vi.fn(async () => reply(body)))
      await expect(fetchHevyPages('/v1/workouts', 'k', { resultKey: 'workouts' }), JSON.stringify(body)).rejects.toBeInstanceOf(TypeError)
    }
  })

  it('page_count as text or NaN, and a page count that is a lie', async () => {
    let calls = []
    vi.stubGlobal('fetch', vi.fn(async url => { calls.push(new URL(url).searchParams.get('page')); return reply({ page_count: '3', workouts: calls.length < 3 ? [{}] : [] }) }))
    expect(await fetchHevyPages('/v1/workouts', 'k', { resultKey: 'workouts' })).toHaveLength(2)
    expect(calls).toEqual(['1', '2', '3'])
    calls = []
    vi.stubGlobal('fetch', vi.fn(async () => { calls.push(1); return reply({ page_count: NaN, workouts: [{}] }) }))
    expect(await fetchHevyPages('/v1/workouts', 'k', { resultKey: 'workouts' })).toHaveLength(1)
    expect(calls).toHaveLength(1)
  })

  it('a template that is not an object makes the whole import fail', async () => {
    const pages = { exercise_templates: [null], workouts: [], routines: [], body_measurements: [] }
    vi.stubGlobal('fetch', vi.fn(async url => { const u = String(url); const k = Object.keys(pages).find(k => u.includes('/v1/' + k)); return reply({ page_count: 1, [k]: pages[k] }) }))
    await expect(importHevyData('k', kg)).rejects.toBeInstanceOf(TypeError)
  })
})

describe('workout fields of the wrong type', () => {
  const one = (...sets) => parseHevyWorkouts([workout({ exercises: [lat(...sets)] })], [T_LAT], kg)

  it('a null workout throws (the sheet toasts); a string list of exercises or sets imports nothing', () => {
    expect(() => parseHevyWorkouts([null], [T_LAT], kg)).toThrow(TypeError)
    expect(parseHevyWorkouts([workout({ exercises: 'abc' })], [T_LAT], kg).workouts).toEqual([])
    expect(parseHevyWorkouts([workout({ exercises: [{ exercise_template_id: '4E5257DE', sets: 'abc' }] })], [T_LAT], kg).workouts).toEqual([])
  })

  it('an exercise whose sets all have nothing measured leaves no empty entry behind, and is not counted as matched', () => {
    const p = parseHevyWorkouts([workout({ exercises: [lat(set({ weight_kg: null, reps: null })), { exercise_template_id: 'DEADBEEF', sets: [set()] }] })], [T_LAT, T_MINE], kg)
    expect(p.workouts).toHaveLength(1)
    expect(p.workouts[0].entries).toHaveLength(1)
    expect(p.workouts.flatMap(w => w.entries).filter(e => !e.sets.length)).toEqual([])
    expect(p.matched).toBe(0)
    expect(p.created).toBe(1)
  })

  it('an unmatched exercise that never landed a set is not invented, counted or listed', () => {
    const none = { exercise_template_id: 'ZZZ1', sets: [set({ weight_kg: null, reps: null })] }
    const tpl = [T_LAT, { id: 'ZZZ1', title: 'Zorb', primary_muscle_group: 'abs' }]
    const p = parseHevyWorkouts([workout({ exercises: [lat(), none] })], tpl, kg)
    expect([p.customEx, p.created, p.unmatchedNames, p.matched]).toEqual([[], 0, [], 1])
    const r = parseHevyRoutines([{ id: 'r1', title: 'Push', exercises: [lat(), { exercise_template_id: 'ZZZ1', sets: [] }] }], tpl, kg)
    expect([r.customEx, r.created, r.unmatchedNames, r.matched]).toEqual([[], 0, [], 1])
    expect(r.routines[0].ex).toHaveLength(1)
    // Same exercise with a set: invented once, counted once, listed once.
    const q = parseHevyWorkouts([workout({ exercises: [lat(), { ...none, sets: [set()] }] })], tpl, kg)
    expect([q.customEx.length, q.created, q.unmatchedNames]).toEqual([1, 1, ['Zorb']])
  })

  it('a session with nothing measured is not imported as an empty workout that blocks a real one later', () => {
    expect(one(set({ weight_kg: 'abc', reps: 'abc' })).workouts).toEqual([])
    expect(one(set({ weight_kg: null, reps: null })).workouts).toEqual([])
  })

  it('numbers that are not numbers', () => {
    expect(one(set({ weight_kg: 'abc', reps: 'abc' })).sets).toBe(0)
    expect(one(set({ weight_kg: '52.5', reps: '5' })).workouts[0].entries[0].sets[0]).toMatchObject({ w: 52.5, r: 5 })
    expect(one(set({ rpe: 'abc' })).rpeSets).toBe(0)
    expect(one(set({ rpe: -1 })).rpeSets).toBe(0)
    expect(one(set({ rpe: 1e9 })).workouts[0].entries[0].sets[0].rpe).toBe(10)
    expect(one(set({ weight_kg: null, reps: null, duration_seconds: 'abc', distance_meters: 'abc' })).sets).toBe(0)
    const timed = one(set({ weight_kg: null, reps: null, duration_seconds: 600, distance_meters: 'abc' })).workouts[0].entries[0].sets[0]
    expect(timed.min).toBe(10)
    expect(Number.isFinite(timed.speed), `speed ${timed.speed}`).toBe(true)
  })

  it('a start that is not a timestamp skips the session — null included, which Date would read as 1970', () => {
    for (const start_time of ['garbage', {}, [], null, 0, false, undefined, '', NaN]) {
      const p = parseHevyWorkouts([workout({ start_time })], [T_LAT], kg)
      expect(p.workouts, `start ${JSON.stringify(start_time)}`).toEqual([])
      expect(p.skipped).toBe(1)
    }
  })

  it('an end that is not a timestamp falls back to the start', () => {
    for (const end_time of ['garbage', null, {}, undefined]) {
      const p = parseHevyWorkouts([workout({ end_time })], [T_LAT], kg)
      expect(p.workouts[0].end, `end ${JSON.stringify(end_time)}`).toBe(p.workouts[0].start)
    }
  })
})

describe('routine fields of the wrong type', () => {
  it('a routine with no usable exercise is dropped, never saved with an empty list', () => {
    expect(routines({ exercises: 'abc' }).routines).toEqual([])
    expect(routines({ exercises: [] }).routines).toEqual([])
    expect(routines({ exercises: [{ exercise_template_id: '4E5257DE', sets: [] }] }).routines).toEqual([])
    expect(routines({ exercises: [{ exercise_template_id: '4E5257DE' }] }).routines).toEqual([])
    expect(routines({ exercises: [{ sets: [set()] }] }).routines).toEqual([])       // no id, no title: nothing to resolve
  })

  it('a superset partner that never arrives is not a superset', () => {
    const r = routines({ exercises: [
      { exercise_template_id: '4E5257DE', superset_id: 0, sets: [set()] },
      { exercise_template_id: 'DEADBEEF', sets: [set()] },
      { exercise_template_id: '4E5257DE', superset_id: 0, sets: [set()] },      // same group, not adjacent
      { exercise_template_id: 'DEADBEEF', superset_id: 'x', sets: [set()] },
      { exercise_template_id: 'DEADBEEF', superset_id: 'x', sets: [set()] },
      { exercise_template_id: 'DEADBEEF', superset_id: 'ghost', sets: [set()] },
    ] }).routines[0]
    expect(r.ex.map(e => e.sg === undefined)).toEqual([true, true, true, false, false, true])
    expect(r.ex[3].sg).toBe(r.ex[4].sg)
  })

})

describe('body measurements of the wrong type', () => {
  it('skips what is not a dated positive weight', () => {
    const p = parseHevyBodyweight([
      { date: 12345, weight_kg: 80 }, { date: 'garbage', weight_kg: 80 }, { date: '2024-03-07', weight_kg: 'abc' },
      { date: '2024-03-08', weight_kg: -1 }, { date: '2024-03-09', weight_kg: 0 }, { date: '2024-03-10', weight_kg: null },
      { date: '2024-03-11T09:00:00Z', weight_kg: '80.5', created_at: 'garbage' }, {},
    ], kg)
    expect(p.bodyweight.map(b => [b.d, b.w])).toEqual([['2024-03-11', 80.5]])
    expect(Number.isFinite(p.bodyweight[0].t)).toBe(true)
  })

  it('two readings on one day: the last one wins', () => {
    const p = parseHevyBodyweight([{ date: '2024-03-07', weight_kg: 80 }, { date: '2024-03-07', weight_kg: 81 }], kg)
    expect(p.bodyweight.map(b => b.w)).toEqual([81])
  })
})

describe('mergeHevyRoutines adds and only replaces its own', () => {
  it('never touches a routine it did not import, and reuses a custom that already exists by name and body part', () => {
    const S = {
      routines: [{ id: 'mine', name: 'Mine', ex: [{ id: '0025', sets: 3 }] }, { id: 'old', name: 'Old Hevy', hevyId: 'r1', ex: [] }],
      customEx: [{ id: 'cu1', n: 'zorb', bp: 'waist' }],
    }
    const parsed = parseHevyRoutines([
      { id: 'r1', title: 'Push', exercises: [{ exercise_template_id: 'ZZZ1', sets: [set()] }] },
      { id: 'r2', title: 'Pull', exercises: [lat()] },
    ], [T_LAT, { id: 'ZZZ1', title: 'Zorb', primary_muscle_group: 'abs' }], kg)
    expect(mergeHevyRoutines(S, parsed)).toEqual({ added: 1, updated: 1 })
    expect(S.routines.map(r => r.name)).toEqual(['Mine', 'Push', 'Pull'])
    expect(S.routines[0]).toEqual({ id: 'mine', name: 'Mine', ex: [{ id: '0025', sets: 3 }] })
    expect(S.routines[1].id).toBe('old')                   // replaced in place, id kept
    expect(S.routines[1].ex[0].id).toBe('cu1')             // "zorb" / waist already existed
    expect(S.customEx).toHaveLength(1)
    for (const r of S.routines.slice(1)) {
      expect(Array.isArray(r.ex)).toBe(true)
      expect(r.ex.length).toBeGreaterThan(0)
      for (const e of r.ex) { expect(typeof e.id).toBe('string'); expect(e.sets).toBeGreaterThan(0) }
    }
  })
})
