import { describe, it, expect } from 'vitest'
import { parseWorkoutCSV } from './import-csv.js'
import { setLabel, effortOf } from './history.js'

// Headers as the real exports write them, trimmed to the columns that matter here.
const HEVY = 'title,start_time,end_time,exercise_title,set_index,set_type,weight_kg,reps,rpe'
const STRONG = 'Date,Workout Name,Exercise Name,Set Order,Weight,Reps,Seconds,RPE'
const FITNOTES = 'Date,Exercise,Category,Weight,Reps,Distance,Distance Unit,Time'

const rows = (head, ...lines) => parseWorkoutCSV([head, ...lines].join('\n'), { unit: 'kg' })
// every set of the first workout, in file order
const setsOf = p => p.workouts.flatMap(w => w.entries.flatMap(e => e.sets))

describe('importing effort from another app', () => {
  it('reads the RPE Hevy writes per set', () => {
    const p = rows(HEVY,
      'Push,"12 Jan 2026, 18:00","12 Jan 2026, 19:00",Bench Press (Barbell),0,normal,60,10,8',
      'Push,"12 Jan 2026, 18:00","12 Jan 2026, 19:00",Bench Press (Barbell),1,normal,60,8,9.5')
    expect(p.error).toBeUndefined()
    expect(setsOf(p).map(s => s.rpe)).toEqual([8, 9.5])
    expect(p.rpeSets).toBe(2)
    expect(p.rirSets).toBe(0)
  })

  it('reads the RPE Strong writes per set', () => {
    const p = rows(STRONG,
      '2026-01-12 18:00:00,Push,Bench Press (Barbell),1,60,10,0,7.5')
    expect(setsOf(p)[0].rpe).toBe(7.5)
    expect(p.rpeSets).toBe(1)
  })

  it('reads an RIR column when a file has one', () => {
    const p = rows('Date,Exercise,Weight,Reps,RIR',
      '2026-01-12,Bench Press,60,10,2',
      '2026-01-12,Bench Press,60,6,0')      // 0 RIR is a real rating: taken to failure
    expect(setsOf(p).map(s => s.rir)).toEqual([2, 0])
    expect(p.rirSets).toBe(2)
    expect(setsOf(p).every(s => s.rpe === undefined)).toBe(true)
  })

  it('treats a blank rating as not rated, not as zero', () => {
    const p = rows(HEVY,
      'Push,"12 Jan 2026, 18:00",,Bench Press (Barbell),0,normal,60,10,',
      'Push,"12 Jan 2026, 18:00",,Bench Press (Barbell),1,normal,60,10,8')
    const s = setsOf(p)
    expect('rpe' in s[0]).toBe(false)         // the key is absent, so the set reads as unrated
    expect(s[1].rpe).toBe(8)
    expect(p.rpeSets).toBe(1)
  })

  it('does not read a written-out 0 as an RPE', () => {
    // RPE runs 1–10, so a 0 in that column is an app saying "nothing here". Reading it as a
    // rating would stamp an effort on every unrated set in the file.
    const p = rows(STRONG, '2026-01-12 18:00:00,Push,Bench Press (Barbell),1,60,10,0,0')
    expect('rpe' in setsOf(p)[0]).toBe(false)
    expect(p.rpeSets).toBe(0)
  })

  it('caps a rating that overruns the scale instead of dropping the set', () => {
    const p = rows(STRONG, '2026-01-12 18:00:00,Push,Bench Press (Barbell),1,60,10,0,12')
    expect(setsOf(p)[0].rpe).toBe(10)
  })

  it('ignores junk in the rating column', () => {
    const p = rows(STRONG,
      '2026-01-12 18:00:00,Push,Bench Press (Barbell),1,60,10,0,hard',
      '2026-01-12 18:00:00,Push,Bench Press (Barbell),2,60,10,0,-3')
    expect(setsOf(p).every(s => !('rpe' in s))).toBe(true)
    expect(p.rpeSets).toBe(0)
    expect(p.sets).toBe(2)                    // the sets still import, just unrated
  })

  it('keeps one scale per set when a file carries both columns', () => {
    const p = rows('Date,Exercise,Weight,Reps,RPE,RIR',
      '2026-01-12,Bench Press,60,10,8,2')
    const s = setsOf(p)[0]
    expect(s.rir).toBe(2)
    expect('rpe' in s).toBe(false)
    // and it reads back on the scale it was stored with
    expect(setLabel('0025', s)).toBe('60×10 (RIR 2)')
  })

  it('puts no effort on a cardio row', () => {
    // a treadmill row has no third stepper to show it in
    const p = rows('Date,Exercise,Distance,Distance Unit,Time,RPE',
      '2026-01-12,Running,5,km,00:30:00,7')
    const s = setsOf(p)[0]
    expect(s.min).toBe(30)
    expect('rpe' in s).toBe(false)
    expect(p.rpeSets).toBe(0)
  })

  it('leaves a file without any rating column exactly as it was', () => {
    const p = rows(FITNOTES, '2026-01-12,Bench Press,Chest,60,10,,,')
    const s = setsOf(p)[0]
    // the legacy profile-unit path now stamps the resolved unit so the record stays compatible
    expect(s).toEqual({ w: 60, r: 10, done: true, unit: 'kg' })
    expect(p.rpeSets + p.rirSets).toBe(0)
  })

  it('carries the rating through the unit conversion', () => {
    // lb -> kg rewrites the weight; the rating must survive that pass untouched
    const p = parseWorkoutCSV([
      'Date,Exercise,Weight,Weight Unit,Reps,RPE',
      '2026-01-12,Bench Press,135,lbs,10,8',
    ].join('\n'), { unit: 'kg' })
    const s = setsOf(p)[0]
    expect(s.w).toBe(61.2)
    expect(s.rpe).toBe(8)
    expect('u' in s).toBe(false)              // the row's unit marker never reaches the set
  })
})

// The backup is the whole state serialised, so effort travels with it by construction. This
// pins that it stays true — a set losing its rating on a backup round trip would be silent.
describe('effort in a backup', () => {
  // what Settings does on import: the file spread over the defaults. DEF cannot be imported
  // here (the store reaches for `navigator` at load), so its shape is reproduced literally.
  const DEF_LIKE = { unit: 'kg', workouts: [], routines: [], effort: null }
  const roundTrip = S => Object.assign({ ...DEF_LIKE }, JSON.parse(JSON.stringify(S)))

  it('exports and re-imports both scales and the setting', () => {
    const S = {
      unit: 'kg', effort: 'rpe', routines: [],
      workouts: [{
        d: '2026-01-12', entries: [{ id: '0025', sets: [
          { w: 60, r: 10, rpe: 8, done: true },
          { w: 60, r: 8, rir: 1, done: true },
          { w: 60, r: 12, done: true },
        ] }],
      }],
    }
    const back = roundTrip(S)
    expect(effortOf(back)).toBe('rpe')
    const [a, b, c] = back.workouts[0].entries[0].sets
    expect(a.rpe).toBe(8)
    expect(b.rir).toBe(1)
    expect('rpe' in c || 'rir' in c).toBe(false)
    expect(setLabel('0025', a)).toBe('60×10 (RPE 8)')
    expect(setLabel('0025', b)).toBe('60×8 (RIR 1)')
    expect(setLabel('0025', c)).toBe('60×12')
  })

  it('restores a backup written before the setting existed', () => {
    // the old flag survives the round trip and still decides the column
    expect(effortOf(roundTrip({ showRir: true, workouts: [], routines: [] }))).toBe('rir')
    expect(effortOf(roundTrip({ workouts: [], routines: [] }))).toBe('none')
  })
})
