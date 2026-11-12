// What the Hevy API import brings over beyond the sets: the routine a workout was done from (so it
// is filed under that routine here) and the routine folders (as the app's own folders on Plan).
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  parseHevyWorkouts, parseHevyRoutines, mergeHevyRoutines, linkHevyRoutines, linkableHevyWorkouts,
  importHevyData, parseHevyAccount,
} from './import-hevy.js'
import { mergeImport } from './import-csv.js'
import { groupRoutines, FOLDER_MAX } from './routine-folders.js'

const kg = { unit: 'kg' }
// 4E5257DE is in HEVY_ID_MAP (a lat pulldown), so nothing here becomes a custom exercise.
const T = [{ id: '4E5257DE', title: 'Lat Pulldown - Close Grip (Cable)', type: 'weight_reps', primary_muscle_group: 'lats' }]
const lat = () => ({ exercise_template_id: '4E5257DE', title: 'Latzug', sets: [{ type: 'normal', weight_kg: 50, reps: 8 }] })
const hevyWorkout = (o = {}) => ({
  id: 'w1', title: 'Pull', routine_id: 'r1',
  start_time: '2026-10-14T16:27:30Z', end_time: '2026-10-14T17:40:00Z', exercises: [lat()], ...o,
})
const hevyRoutine = (id, title, folder_id, o = {}) => ({ id, title, folder_id, exercises: [lat()], ...o })
const empty = () => ({ workouts: [], routines: [], customEx: [], bodyweight: [], exWeights: {} })
const reply = body => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => body })

describe('routine links', () => {
  it('keeps the Hevy routine a workout was done from, as text, and only an id', () => {
    const [w] = parseHevyWorkouts([hevyWorkout()], T, kg).workouts
    expect(w).toMatchObject({ hevyRoutineId: 'r1', routineId: null })
    const ids = [null, '', { toString: () => 'r1' }, ['r1'], true, NaN, 'x'.repeat(101)]
    for (const routine_id of ids) {
      const [bare] = parseHevyWorkouts([hevyWorkout({ routine_id })], T, kg).workouts
      expect('hevyRoutineId' in bare, String(routine_id)).toBe(false)
    }
    expect(parseHevyWorkouts([hevyWorkout({ routine_id: 42 })], T, kg).workouts[0].hevyRoutineId).toBe('42')
  })

  it('files an imported workout under its routine once the routine is here, stamped for sync', () => {
    const p = parseHevyWorkouts([hevyWorkout()], T, kg)
    const S = empty()
    mergeImport(S, p)
    mergeHevyRoutines(S, parseHevyRoutines([hevyRoutine('r1', 'Pull')], T, kg))
    expect(linkableHevyWorkouts(S, { workouts: p.workouts })).toBe(1)
    expect(S.workouts[0].routineId).toBe(null)         // counting changes nothing
    expect(S.workouts[0]._ts).toBeUndefined()
    expect(linkHevyRoutines(S, p.workouts, 5000)).toBe(1)
    expect(S.workouts[0]).toMatchObject({ routineId: S.routines[0].id, _ts: 5000 })
    expect(linkHevyRoutines(S, p.workouts, 6000)).toBe(0)  // done once
    expect(S.workouts[0]._ts).toBe(5000)
  })

  it('gives an earlier import’s workout of the same session its routine, and leaves a routine set in the app alone', () => {
    const p = parseHevyWorkouts([hevyWorkout()], T, kg)
    const api = p.workouts[0]
    const csv = { id: 'iwcsv', d: api.d, start: api.start - 90000, routineId: null, name: 'Pull', entries: [] }   // the CSV has minutes only
    const late = { id: 'iwlate', d: api.d, start: api.start + 3 * 60000, routineId: null, name: 'Evening', entries: [] }
    const mine = { id: 'mine', d: api.d, start: api.start + 60000, routineId: 'picked', name: 'Pull', entries: [] }
    const S = { workouts: [csv, late, mine], routines: [{ id: 'R', hevyId: 'r1', name: 'Pull', ex: [] }] }
    expect(linkHevyRoutines(S, p.workouts, 7)).toBe(1)
    expect(csv).toMatchObject({ routineId: 'R', hevyRoutineId: 'r1', _ts: 7 })
    expect(late.routineId).toBe(null)
    expect(late._ts).toBeUndefined()
    expect(mine).toEqual({ id: 'mine', d: api.d, start: api.start + 60000, routineId: 'picked', name: 'Pull', entries: [] })
  })

  it('links nothing while the routine is not here, and links it once it comes', () => {
    const p = parseHevyWorkouts([hevyWorkout()], T, kg)
    const csv = { id: 'iwcsv', d: p.workouts[0].d, start: p.workouts[0].start, routineId: null, entries: [] }
    const S = { workouts: [csv], routines: [{ id: 'R0', hevyId: 'other', ex: [] }] }
    expect(linkableHevyWorkouts(S, { workouts: p.workouts })).toBe(0)
    expect(linkHevyRoutines(S, p.workouts, 1)).toBe(0)
    expect(csv.routineId).toBe(null)
    expect(csv.hevyRoutineId).toBe('r1')                   // remembered for when it comes
    S.routines.push({ id: 'R2', hevyId: 'r1', ex: [] })
    expect(linkHevyRoutines(S, [], 2)).toBe(1)
    expect(csv).toMatchObject({ routineId: 'R2', _ts: 2 })
  })

  it('counts the workouts and routines about to be imported, not those already here or that become activities', () => {
    const p = parseHevyWorkouts([
      hevyWorkout(),
      hevyWorkout({ id: 'w2', start_time: '2026-10-16T16:00:00Z', end_time: '2026-10-16T17:00:00Z' }),
    ], T, kg)
    const routines = parseHevyRoutines([hevyRoutine('r1', 'Pull')], T, kg).routines
    // The 16th is already here with another session: Hevy's workout of that day is not imported.
    const S = { workouts: [{ id: 'x', d: p.workouts[1].d, start: p.workouts[1].start + 3600000, routineId: null, entries: [] }], routines: [] }
    const before = JSON.stringify(S)
    expect(linkableHevyWorkouts(S, { workouts: p.workouts })).toBe(0)       // the routine is not coming
    expect(linkableHevyWorkouts(S, { workouts: p.workouts, routines })).toBe(1)
    expect(linkableHevyWorkouts(S, { routines })).toBe(0)                  // workouts switched off
    expect(JSON.stringify(S)).toBe(before)
    // A session that was only sport comes in as an activity, so it is no workout to link.
    const padel = { id: 'cpad', n: 'padel', custom: true, bp: 'cardio' }
    const sport = { id: 'iwp', d: '2026-10-20', start: 1, routineId: null, hevyRoutineId: 'r1', entries: [{ id: 'cpad', sets: [{ min: 60, speed: 0, done: true }] }] }
    expect(linkableHevyWorkouts({ workouts: [], routines: [] }, { workouts: [sport], routines, customEx: [padel] })).toBe(0)
  })

  it('links only the workouts you chose: none outside the days, none whose exercises you all left out', () => {
    const raw = {
      templates: T, routines: [hevyRoutine('r1', 'Pull')], routineFolders: [],
      workouts: [hevyWorkout(), hevyWorkout({ id: 'w2', start_time: '2026-09-01T16:00:00Z', end_time: '2026-09-01T17:00:00Z' })],
    }
    const S = { workouts: [], routines: [{ id: 'R', hevyId: 'r1', ex: [] }] }
    const all = parseHevyAccount(raw, kg).workouts.workouts
    expect(linkableHevyWorkouts(S, { workouts: all })).toBe(2)
    const inOctober = parseHevyAccount(raw, { ...kg, from: '2026-10-01' }).workouts.workouts
    expect(linkableHevyWorkouts(S, { workouts: inOctober })).toBe(1)
    const none = parseHevyAccount(raw, { ...kg, skip: new Set(['lat pulldown - close grip (cable)']) }).workouts.workouts
    expect(none).toEqual([])
    // An earlier CSV import of the September session is not linked when September is left out.
    const csv = { id: 'c', d: '2026-09-01', start: all.find(w => w.d === '2026-09-01').start, routineId: null, entries: [] }
    const S2 = { workouts: [csv], routines: S.routines }
    expect(linkHevyRoutines(S2, inOctober, 1)).toBe(0)
    expect(csv).toEqual({ id: 'c', d: '2026-09-01', start: csv.start, routineId: null, entries: [] })
  })

  it('compares hostile ids as text, never through a plain object', () => {
    const S = {
      workouts: [
        { id: 'a', d: '2026-10-01', hevyRoutineId: '__proto__', routineId: null },
        { id: 'b', d: '2026-10-01', hevyRoutineId: 'constructor', routineId: null },
        { id: 'c', d: '2026-10-01', hevyRoutineId: { toString: () => 'r1' }, routineId: null },
        null,
      ],
      routines: [
        { id: 'P', hevyId: '__proto__' }, { id: 'O', hevyId: { toString: () => 'r1' } }, { id: 'N', hevyId: 7 }, null,
      ],
    }
    expect(linkHevyRoutines(S, [{ d: '2026-10-01', start: 0, hevyRoutineId: { r: 1 } }, null], 1)).toBe(1)
    expect(S.workouts[0].routineId).toBe('P')
    expect(S.workouts[1].routineId).toBe(null)
    expect(S.workouts[2].routineId).toBe(null)
    const n = { workouts: [{ id: 'd', d: '2026-10-02', hevyRoutineId: '7', routineId: null }], routines: S.routines }
    expect(linkHevyRoutines(n, [], 1)).toBe(1)
    expect(n.workouts[0].routineId).toBe('N')
    expect(linkHevyRoutines({}, null)).toBe(0)
    expect(linkableHevyWorkouts(undefined)).toBe(0)
  })
})

describe('routine folders', () => {
  const FOLDERS = [{ id: 7, title: 'Push Pull Legs', index: 1 }, { id: '3', title: '  Rehab  ', index: 0 }]
  const parse = (routines, folders = FOLDERS) => parseHevyRoutines(routines, T, { ...kg, folders })
  const byHevy = (S, id) => S.routines.find(r => r.hevyId === id)

  it('puts new routines into their Hevy folders, grouped in Hevy’s folder order, those in no folder first', () => {
    const S = { routines: [{ id: 'mine', name: 'Mine', ex: [] }], customEx: [] }
    const res = mergeHevyRoutines(S, parse([
      hevyRoutine('a', 'Push', 7), hevyRoutine('b', 'Calf', 3), hevyRoutine('c', 'Loose', null),
      hevyRoutine('d', 'Pull', '7'), hevyRoutine('e', 'Lost', 99),
    ]))
    expect(res).toEqual({ added: 5, updated: 0 })
    expect(byHevy(S, 'a')).toMatchObject({ folder: 'Push Pull Legs', hevyFolder: 'Push Pull Legs' })
    expect(byHevy(S, 'b')).toMatchObject({ folder: 'Rehab', hevyFolder: 'Rehab' })
    expect(byHevy(S, 'c').folder).toBeUndefined()
    expect(byHevy(S, 'c').hevyFolder).toBe('')
    expect(byHevy(S, 'e').hevyFolder).toBe('')                 // a folder Hevy did not list is none
    expect(S.routines.map(r => r.name)).toEqual(['Mine', 'Loose', 'Lost', 'Calf', 'Push', 'Pull'])
    expect(groupRoutines(S.routines).map(g => g.folder)).toEqual(['', 'Rehab', 'Push Pull Legs'])
    expect('hevyFolderAt' in byHevy(S, 'a')).toBe(false)       // the order is not stored
  })

  it('on a re-import follows Hevy only where the folder was not changed in the app', () => {
    const S = { routines: [], customEx: [] }
    mergeHevyRoutines(S, parse([hevyRoutine('a', 'Push', 7), hevyRoutine('b', 'Calf', 3), hevyRoutine('c', 'Legs', 7), hevyRoutine('d', 'Arms', 3)]))
    byHevy(S, 'b').folder = 'My rehab'                           // moved in the app
    delete byHevy(S, 'c').folder                                 // taken out of its folder in the app
    const res = mergeHevyRoutines(S, parse([
      hevyRoutine('a', 'Push', 3), hevyRoutine('b', 'Calf', 7), hevyRoutine('c', 'Legs', 3), hevyRoutine('d', 'Arms', null),
    ]))
    expect(res).toEqual({ added: 0, updated: 4 })
    expect(S.routines).toHaveLength(4)
    expect(byHevy(S, 'a')).toMatchObject({ folder: 'Rehab', hevyFolder: 'Rehab' })
    expect(byHevy(S, 'b')).toMatchObject({ folder: 'My rehab', hevyFolder: 'Push Pull Legs' })
    expect(byHevy(S, 'c').folder).toBeUndefined()
    expect(byHevy(S, 'd').folder).toBeUndefined()               // moved out of every folder in Hevy
    expect(byHevy(S, 'd').hevyFolder).toBe('')
    // Hevy moves "Calf" again: the app's own folder still holds.
    mergeHevyRoutines(S, parse([hevyRoutine('b', 'Calf', 3)]))
    expect(byHevy(S, 'b').folder).toBe('My rehab')
  })

  it('treats a routine imported before folders came over as given none', () => {
    const S = { routines: [
      { id: 'x', name: 'Old', hevyId: 'a', ex: [] },
      { id: 'y', name: 'Filed', hevyId: 'b', folder: 'Mine', ex: [] },
    ], customEx: [] }
    mergeHevyRoutines(S, parse([hevyRoutine('a', 'Old', 7), hevyRoutine('b', 'Filed', 3)]))
    expect(byHevy(S, 'a').folder).toBe('Push Pull Legs')
    expect(byHevy(S, 'b').folder).toBe('Mine')
  })

  it('leaves folders alone when Hevy’s could not be read', () => {
    const p = parse([hevyRoutine('a', 'Push', 7)], null)
    expect('hevyFolder' in p.routines[0]).toBe(false)
    const S = { routines: [{ id: 'x', name: 'Push', hevyId: 'a', folder: 'Rehab', hevyFolder: 'Rehab', ex: [] }], customEx: [] }
    mergeHevyRoutines(S, p)
    expect(S.routines[0]).toMatchObject({ folder: 'Rehab', hevyFolder: 'Rehab' })
    const fresh = { routines: [], customEx: [] }
    mergeHevyRoutines(fresh, parseHevyRoutines([hevyRoutine('a', 'Push', 7)], T, kg))
    expect(fresh.routines[0].folder).toBeUndefined()
    expect('hevyFolder' in fresh.routines[0]).toBe(false)
  })

  it('cleans hostile folder titles, ids and indexes', () => {
    const folders = [
      { id: 1, title: 'Push\u0000\u001b[31m\nDay', index: 'first' },
      { id: 2, title: 'x'.repeat(500), index: 2 },
      { id: 3, title: { toString: () => 'Evil' }, index: 0 },
      { id: 4, title: 12, index: 0 },
      { id: { toString: () => '5' }, title: 'Object id', index: 0 },
      { id: '__proto__', title: 'Proto', index: 3 },
      { id: 6, title: '   ', index: 0 },
      null, 'folder', { title: 'No id' },
      { id: 2, title: 'Second with the same id', index: 9 },
    ]
    const p = parse([
      hevyRoutine('a', 'A', 1), hevyRoutine('b', 'B', 2), hevyRoutine('c', 'C', 3), hevyRoutine('d', 'D', 4),
      hevyRoutine('e', 'E', '5'), hevyRoutine('f', 'F', '__proto__'), hevyRoutine('g', 'G', 6), hevyRoutine('h', 'H', { id: 2 }),
    ], folders)
    const got = Object.fromEntries(p.routines.map(r => [r.hevyId, [r.hevyFolder, r.hevyFolderAt]]))
    expect(got).toEqual({
      a: ['Push [31m Day', -1], b: ['x'.repeat(FOLDER_MAX), 2], c: ['', -1], d: ['', -1],
      e: ['', -1], f: ['Proto', 3], g: ['', -1], h: ['', -1],
    })
    for (const r of p.routines) expect(/[\u0000-\u001f\u007f]/.test(r.hevyFolder)).toBe(false)
    expect(parse([hevyRoutine('a', 'A', 1)], 'folders').routines[0].hevyFolder).toBeUndefined()
    const S = { routines: [], customEx: [] }
    mergeHevyRoutines(S, p)
    expect(S.routines.map(r => r.hevyId)).toEqual(['a', 'c', 'd', 'e', 'g', 'h', 'b', 'f'])
  })
})

describe('the folders through the fetch and the summary’s re-read', () => {
  afterEach(() => { vi.unstubAllGlobals() })
  const stub = (folders) => vi.stubGlobal('fetch', vi.fn(async url => {
    const path = new URL(String(url)).pathname
    if (path === '/v1/routine_folders') return folders()
    const key = path.split('/').pop()
    const pages = { exercise_templates: T, workouts: [hevyWorkout()], routines: [hevyRoutine('r1', 'Pull', 7)], body_measurements: [] }
    return reply({ page_count: 1, [key]: pages[key] })
  }))

  it('fetches the folders with the routines, and the re-read after a choice keeps them', async () => {
    stub(() => reply({ page_count: 1, routine_folders: [{ id: 7, title: 'Push Pull Legs', index: 0 }] }))
    const data = await importHevyData('k', kg)
    expect(data.raw.routineFolders).toHaveLength(1)
    expect(data.routines.routines[0]).toMatchObject({ hevyFolder: 'Push Pull Legs' })
    const again = parseHevyAccount(data.raw, { ...kg, from: '2026-10-01' })
    expect(again.routines.routines[0]).toMatchObject({ hevyFolder: 'Push Pull Legs', hevyFolderAt: 0 })
    expect(again.workouts.workouts[0].hevyRoutineId).toBe('r1')
  })

  it('imports the routines without folders when the folders can’t be read', async () => {
    for (const folders of [
      () => ({ ok: false, status: 500, headers: { get: () => null }, json: async () => ({}) }),
      () => ({ ok: false, status: 403, headers: { get: () => null }, json: async () => ({}) }),
      () => { throw new TypeError('network') },
    ]) {
      stub(folders)
      const data = await importHevyData('k', kg)
      expect(data.raw.routineFolders).toBe(null)
      expect(data.routines.routines).toHaveLength(1)
      expect('hevyFolder' in data.routines.routines[0]).toBe(false)
      const S = { routines: [], customEx: [] }
      mergeHevyRoutines(S, data.routines)
      expect(S.routines[0].folder).toBeUndefined()
    }
  })

  it('does not ask for folders when there are no routines', async () => {
    const seen = []
    vi.stubGlobal('fetch', vi.fn(async url => {
      const key = new URL(String(url)).pathname.split('/').pop()
      seen.push(key)
      return reply({ page_count: 1, [key]: key === 'exercise_templates' ? T : [] })
    }))
    await importHevyData('k', kg)
    expect(seen).not.toContain('routine_folders')
  })
})
