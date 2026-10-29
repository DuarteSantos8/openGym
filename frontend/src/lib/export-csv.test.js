import { describe, expect, it } from 'vitest'
import { csvField, workoutsCSV, workoutRows, bodyCSV, WORKOUT_COLUMNS } from './export-csv.js'
import { parseCSV, parseWorkoutCSV, parseBodyweight, parseImport, mergeImport } from './import-csv.js'

// Local times, the way the app stores a workout's start and end.
const at = (d, h, m = 0) => new Date(`${d}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`).getTime()

const state = (extra = {}) => ({
  unit: 'kg',
  customEx: [{ id: 'cx1', n: 'Grip Trainer, "Heavy"', bp: 'lower arms', custom: true, eq: 'custom' }],
  workouts: [
    {
      id: 'w1', d: '2026-03-02', start: at('2026-03-02', 18, 5), end: at('2026-03-02', 19, 10),
      name: 'Push, day A', note: 'Felt "fresh"\nslept 8 h', routineId: 'r1', prs: [],
      entries: [
        { id: '0025', note: 'Paused, 1 s', sets: [
          { w: 40, r: 10, done: true, phase: 'warmup' },
          { w: 62.5, r: 8, done: true, rpe: 8.5 },
          { w: 62.5, r: 6, done: true, failure: true, rir: 0 },
          { w: 60, r: 8, done: false },
        ] },
        { id: '0334', sg: 'sgA', sets: [{ w: 10, r: 12, done: true }, { w: 10, r: 12, done: true }] },
        { id: '0294', sg: 'sgA', sets: [
          { w: 14, r: 10, done: true, type: 'dropset', drops: [{ w: 10, r: 8 }, { w: 6, r: 6 }] },
          { done: true, w: 14, r: 15, rir: 1, sides: { L: { w: 14, r: 8, done: true, rir: 2 }, R: { w: 12, r: 7, done: true, rir: 1 } } },
        ] },
        { id: '0463', sets: [{ sec: 60, w: 0, done: true }, { sec: 45, w: 10, done: true }] },
        { id: 'cx1', sets: [{ w: 30, r: 20, done: true }] },
      ],
    },
    {
      id: 'w2', d: '2026-03-02', start: at('2026-03-02', 20), end: at('2026-03-02', 20, 40),
      name: 'Cardio', entries: [{ id: '3666', sets: [{ min: 22.5, speed: 6.4, incline: 8, done: true }, { min: 10, speed: 0, done: true }] }],
    },
    { id: 'w3', d: '2026-03-05', start: at('2026-03-05', 7), end: at('2026-03-05', 7), name: '=HYPERLINK("x")', entries: [{ id: '0043', sets: [{ w: 100, r: 5, done: true }] }] },
  ],
  bodyweight: [{ d: '2026-03-01', w: 80.4, t: at('2026-03-01', 8) }, { d: '2026-03-04', w: 80.1, t: at('2026-03-04', 8) }],
  measurements: [{ d: '2026-03-04', waist: 84.5, bodyFat: 17.2, upperArmLeft: 36, other: [{ id: 'm1', name: 'Neck, relaxed', value: 39 }] }],
  ...extra,
})

const fresh = () => ({ workouts: [], bodyweight: [], customEx: [], exWeights: {} })

describe('csvField', () => {
  it('quotes commas, quotes and line breaks the RFC 4180 way', () => {
    expect(csvField('plain')).toBe('plain')
    expect(csvField('a, b')).toBe('"a, b"')
    expect(csvField('say "hi"')).toBe('"say ""hi"""')
    expect(csvField('two\nlines')).toBe('"two\nlines"')
    expect(csvField(' padded ')).toBe('" padded "')
    expect(csvField(null)).toBe('')
    expect(csvField(62.5)).toBe('62.5')
  })
  it('keeps a spreadsheet from running a name as a formula, but leaves negative numbers alone', () => {
    expect(csvField('=1+1')).toBe("'=1+1")
    expect(csvField('@cmd')).toBe("'@cmd")
    expect(csvField('-5')).toBe('-5')
  })
})

describe('the workout CSV', () => {
  const text = workoutsCSV(state())
  const rows = parseCSV(text)
  const col = name => WORKOUT_COLUMNS.indexOf(name)
  const body = rows.slice(1)

  it('has one header and one row per completed set, CRLF and a BOM for Excel', () => {
    expect(text.startsWith('﻿')).toBe(true)
    expect(text).toContain('\r\n')
    expect(rows[0]).toEqual(WORKOUT_COLUMNS)
    // 3 bench (the unticked one is left out) + 2 raises + 1 curl, 2 drops, 2 sides + 2 holds + 1 grip + 2 cardio + 1 squat
    expect(body.length).toBe(16)
  })

  it('writes ISO dates, dot decimals and English names next to the catalogue id', () => {
    const bench = body.find(r => r[col('exercise_id')] === '0025' && r[col('set')] === '2')
    expect(bench[col('date')]).toBe('2026-03-02')
    expect(bench[col('start_time')]).toBe('2026-03-02 18:05')
    expect(bench[col('end_time')]).toBe('2026-03-02 19:10')
    expect(bench[col('exercise')]).toBe('Barbell Bench Press')
    expect(bench[col('weight')]).toBe('62.5')
    expect(bench[col('unit')]).toBe('kg')
    expect(bench[col('rpe')]).toBe('8.5')
  })

  it('marks warm-ups, failure sets, drops, sides and supersets', () => {
    const types = body.filter(r => r[col('exercise_id')] === '0025').map(r => r[col('set_type')])
    expect(types).toEqual(['warmup', 'normal', 'failure'])
    const curl = body.filter(r => r[col('exercise_id')] === '0294')
    expect(curl.map(r => [r[col('set')], r[col('set_type')], r[col('side')], r[col('weight')], r[col('reps')]])).toEqual([
      ['1', 'normal', '', '14', '10'], ['1', 'drop', '', '10', '8'], ['1', 'drop', '', '6', '6'],
      ['2', 'normal', 'L', '14', '8'], ['2', 'normal', 'R', '12', '7'],
    ])
    expect(curl[3][col('rir')]).toBe('2')
    const ss = body.filter(r => r[col('superset_id')]).map(r => r[col('superset_id')])
    expect(new Set(ss)).toEqual(new Set(['1']))
  })

  it('writes cardio as distance and seconds, a hold as seconds only', () => {
    const run = body.find(r => r[col('exercise_id')] === '3666')
    expect(run[col('seconds')]).toBe('1350')
    expect(run[col('distance_km')]).toBe('2.4')
    expect(run[col('incline')]).toBe('8')
    expect(run[col('weight')]).toBe('')
    const hold = body.find(r => r[col('exercise_id')] === '0463')
    expect(hold[col('seconds')]).toBe('60')
    expect(hold[col('distance_km')]).toBe('')
    expect(hold[col('reps')]).toBe('')
  })

  it('rounds the distance instead of writing float noise, but never so far the speed changes', () => {
    const km = sets => parseCSV(workoutsCSV({ unit: 'kg', workouts: [{ id: 'c', d: '2026-03-04', start: 1, entries: [{ id: '3666', sets }] }] }))
      .slice(1).map(r => r[col('distance_km')])
    // 25 min at 11.3 km/h is 4.708333 km; a one-minute set at 9.4 needs four to read 9.4 again.
    expect(km([{ min: 25, speed: 11.3, done: true }, { min: 1, speed: 9.4, done: true }, { min: 30, speed: 10, done: true }]))
      .toEqual(['4.71', '0.1567', '5'])
    const back = parseWorkoutCSV(workoutsCSV({ unit: 'kg', workouts: [{ id: 'c', d: '2026-03-04', start: 1, entries: [{ id: '3666', sets: [{ min: 25, speed: 11.3, done: true }, { min: 1, speed: 9.4, done: true }, { min: 0.5, speed: 12.5, done: true }] }] }] }), { unit: 'kg' })
    expect(back.workouts[0].entries[0].sets.map(s => s.speed)).toEqual([11.3, 9.4, 12.5])
  })

  it('survives commas, quotes and line breaks in names and notes', () => {
    const grip = body.find(r => r[col('exercise_id')] === 'cx1')
    expect(grip[col('exercise')]).toBe('Grip Trainer, "Heavy"')
    const first = body[0]
    expect(first[col('workout')]).toBe('Push, day A')
    expect(first[col('workout_note')]).toBe('Felt "fresh"\nslept 8 h')
    expect(first[col('note')]).toBe('Paused, 1 s')
    // The note rides on the entry's first row only.
    expect(body.filter(r => r[col('note')]).length).toBe(1)
  })

  it('writes the profile unit and limits to a range of days', () => {
    const lb = parseCSV(workoutsCSV(state({ unit: 'lb' })))
    expect(lb[1][col('unit')]).toBe('lb')
    expect(workoutRows(state(), { from: '2026-03-03', to: '2026-03-31' }).length).toBe(1)
  })

  it('is a header and nothing else for an empty history', () => {
    const empty = parseCSV(workoutsCSV({ unit: 'kg', workouts: [] }))
    expect(empty).toEqual([WORKOUT_COLUMNS])
    expect(parseWorkoutCSV(workoutsCSV({ unit: 'kg' })).error).toBe('empty')
  })
})

describe('the round trip: our export through our own importer', () => {
  const S = state()
  const parsed = parseWorkoutCSV(workoutsCSV(S), { unit: 'kg' })
  const into = fresh()
  mergeImport(into, parsed)
  // Compared without what an import cannot know (ids, the routine link, PRs) and with the
  // superset tags read as "which entries go together".
  const shape = w => ({
    d: w.d, start: w.start, end: w.end, name: w.name, note: w.note,
    entries: w.entries.map(e => ({ id: e.id, note: e.note, sets: e.sets.filter(s => s.done || s.sides).map(s => {
      const { phase, ...rest } = s
      return { ...rest, ...(phase === 'warmup' ? { phase } : {}) }
    }) })),
    groups: w.entries.map(e => (e.sg ? w.entries.filter(x => x.sg === e.sg).map(x => x.id).join('+') : null)),
  })

  it('is recognised as ours', () => {
    expect(parsed.source).toBe('openGym')
    expect(parsed.skipped).toBe(0)
  })

  it('brings back every workout, set, note and superset as it was', () => {
    expect(into.workouts.map(shape)).toEqual(S.workouts.map(shape))
  })

  it('keeps two sessions on one day apart and the volume the app would count', () => {
    expect(into.workouts.filter(w => w.d === '2026-03-02').map(w => w.name)).toEqual(['Push, day A', 'Cardio'])
    // bench 62.5*8 + 62.5*6, raises 2*120, curls 140 + 80 + 36 and 112 + 84, plank 0, grip 600
    expect(into.workouts[0].vol).toBe(500 + 375 + 240 + 140 + 80 + 36 + 112 + 84 + 600)
  })

  it('makes the custom exercise again under its own id and name on a fresh device', () => {
    expect(into.customEx).toEqual([expect.objectContaining({ id: 'cx1', n: 'Grip Trainer, "Heavy"', bp: 'lower arms', custom: true })])
  })

  it('files the sets under the custom exercise the device already has', () => {
    const p = parseWorkoutCSV(workoutsCSV(S), { unit: 'kg', customEx: S.customEx })
    expect(p.customEx).toEqual([])
    expect(p.workouts[0].entries.some(e => e.id === 'cx1')).toBe(true)
  })

  it('converts to the profile unit, drops and sides included', () => {
    const lb = parseWorkoutCSV(workoutsCSV(S), { unit: 'lb' })
    const curl = lb.workouts[0].entries.find(e => e.id === '0294')
    expect(curl.sets[0].w).toBe(30.86)
    expect(curl.sets[0].drops[0].w).toBe(22.05)
    expect(curl.sets[1].sides.R.w).toBe(26.46)
    expect(lb.converted).toBe(true)
  })

  it('drops the formula guard again on the way back in', () => {
    expect(into.workouts[2].name).toBe('=HYPERLINK("x")')
  })

  it('ignores an id that is a key of Object.prototype and matches by name instead', () => {
    const csv = WORKOUT_COLUMNS.join(',') + '\n' + '2026-03-02,2026-03-02 18:00,,X,,Barbell Bench Press,constructor,chest,,1,normal,,60,kg,5,,,,,,'
    const p = parseWorkoutCSV(csv, { unit: 'kg' })
    expect(p.workouts[0].entries[0].id).toBe('0025')
  })
})

describe('the body CSV', () => {
  const text = bodyCSV(state())
  const rows = parseCSV(text)

  it('has a row per day with weight and measurements, in cm and percent', () => {
    expect(rows[0]).toEqual(['date', 'weight_kg', 'waist_cm', 'upper_arm_left_cm', 'body_fat_percent', 'Neck, relaxed (cm)'])
    expect(rows.slice(1)).toEqual([
      ['2026-03-01', '80.4', '', '', '', ''],
      ['2026-03-04', '80.1', '84.5', '36', '17.2', '39'],
    ])
  })

  it('says the unit in the header, so our importer reads it back in any profile', () => {
    expect(parseCSV(bodyCSV(state({ unit: 'lb' })))[0][1]).toBe('weight_lb')
    const back = parseBodyweight(text, { unit: 'kg' })
    expect(back.bodyweight.map(b => [b.d, b.w])).toEqual([['2026-03-01', 80.4], ['2026-03-04', 80.1]])
    expect(parseImport(text, { unit: 'kg' }).kind).toBe('bodyweight')
  })

  it('is just the header with nothing logged', () => {
    expect(parseCSV(bodyCSV({ unit: 'kg' }))).toEqual([['date', 'weight_kg']])
  })
})
