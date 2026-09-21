import { describe, expect, it } from 'vitest'
import { parseWorkoutCSV, mergeImport } from './import-csv.js'
import { workoutVolume } from './history.js'

const CSV = [
  'Date,Exercise,Weight,Reps,Set Type',
  '2026-08-08,Bench Press,100,5,Warm-up',
  '2026.08.08,Bench Press,80,5,Working',
  '8 Aug 2026,Bench Press,80,5,Working',
  '2026/08/08,Bench Press,85,3,Working',
].join('\n')

describe('CSV warm-up provenance', () => {
  it('retains the imported warm-up phase and excludes it from topW', () => {
    const parsed = parseWorkoutCSV(CSV, { unit: 'kg' })
    const entry = parsed.workouts[0].entries[0]

    expect(parsed.warmups).toBe(1)
    expect(entry.sets).toEqual([
      { w: 100, r: 5, done: true, phase: 'warmup' },
      { w: 80, r: 5, done: true },
      { w: 80, r: 5, done: true },
      { w: 85, r: 3, done: true },
    ])
    expect(entry.topW).toBe(85)
  })
})

// gravl writes its units in parentheses ("Weight (kg)", "Set Duration (sec)"). Header text is
// normalised before it is matched, so the alias table has to hold the normalised form — an alias
// written with the parentheses can never match. Sample rows are from the gravl export in !21.
const GRAVL = [
  'Date,Start Date,Workout,Source,Workout Duration (min),Energy,Exercise,Superset,Set,Set Type,Reps,Weight (kg),Distance (km),Set Duration (sec),Incline,Steps,Effort,Workout Notes',
  '2026/01/01,1:11 PM,Push Day,,11,11,Chin Up,No,1,Normal,11,11,0,,,,Ideal,felt strong',
  '2026/01/22,2:22 PM,External Something,APP,21,22,Walking,No,0,Normal,0,0,0,22,,,,',
].join('\n')

describe('gravl export', () => {
  it('reads slash dates, parenthesised weight and per-set duration', () => {
    const parsed = parseWorkoutCSV(GRAVL, { unit: 'kg' })

    expect(parsed.skipped).toBe(0)
    expect(parsed.from).toBe('2026-01-01')
    expect(parsed.to).toBe('2026-01-22')

    const [lift, cardio] = parsed.workouts
    expect(lift.name).toBe('Push Day')
    expect(lift.entries[0].sets).toEqual([{ w: 11, r: 11, done: true }])

    // "Set Duration (sec)" is seconds, not minutes: read as `time` it would land as 22 minutes.
    expect(cardio.entries[0].sets).toEqual([{ min: 0.4, speed: 0, done: true }])
  })
})

// A finished workout stores `vol = workoutVolume(w)`, which leaves warm-ups out; an imported one
// wrote the sum of every set, so the History row, the heatmap and the month totals read a number
// the app's own arithmetic never produces — and it stays wrong forever (QA C14).
const HEVY_WARMUPS = [
  'title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_index,set_type,weight_kg,reps,distance_km,duration_seconds,rpe',
  '"QA","03 Mar 2025, 18:00","03 Mar 2025, 19:00","","Bench Press (Barbell)",,"",0,warmup,20,10,,,',
  '"QA","03 Mar 2025, 18:00","03 Mar 2025, 19:00","","Bench Press (Barbell)",,"",1,normal,60,5,,,',
  '"QA","03 Mar 2025, 18:00","03 Mar 2025, 19:00","","Bench Press (Barbell)",,"",2,normal,60,5,,,',
  '"QA","03 Mar 2025, 18:00","03 Mar 2025, 19:00","","Squat (Barbell)",,"",0,warmup,40,5,,,',
  '"QA","03 Mar 2025, 18:00","03 Mar 2025, 19:00","","Squat (Barbell)",,"",1,normal,100,5,,,',
].join('\n')

describe('imported volume', () => {
  it('stores the work-set volume, the same number workoutVolume computes', () => {
    const [w] = parseWorkoutCSV(HEVY_WARMUPS, { unit: 'kg' }).workouts
    expect(w.vol).toBe(1100)
    expect(w.vol).toBe(workoutVolume(w))
  })
})

// Two exports of the same account, the second one a week later. Each parse invents fresh ids for
// the names it cannot match, so the merge has to find the custom exercise the first import created
// — otherwise the Library lists "Zorb Roller" twice with half the history each (QA C12).
const hevyDay = (title, day, name, w, r) =>
  `"${title}","${day} Mar 2025, 18:00","${day} Mar 2025, 19:00","","${name}",,"",0,normal,${w},${r},,,`
const HEVY_HEAD = HEVY_WARMUPS.split('\n')[0]
const EXPORT_A = [HEVY_HEAD, hevyDay('Day A', '02', 'Zorb Roller', 49, 8), hevyDay('Day A', '02', 'Bench Press (Barbell)', 80, 5)].join('\n')
const EXPORT_B = [HEVY_HEAD, hevyDay('Day A', '02', 'Zorb Roller', 49, 8), hevyDay('Day B', '09', 'Zorb Roller', 30, 15)].join('\n')

describe('mergeImport and custom exercises', () => {
  const fresh = () => ({ workouts: [], customEx: [], exWeights: {}, bodyweight: [] })

  it('reuses the custom exercise an earlier import created for the same name', () => {
    const S = fresh()
    mergeImport(S, parseWorkoutCSV(EXPORT_A, { unit: 'kg' }))
    const [zorb] = S.customEx
    expect(zorb.n).toBe('zorb roller')

    expect(mergeImport(S, parseWorkoutCSV(EXPORT_B, { unit: 'kg' }))).toEqual({ added: 1, skipped: 1 })
    expect(S.customEx).toHaveLength(1)
    // The new day points at the existing exercise, so its history is one line, not two.
    expect(S.workouts.map(w => w.entries[0].id)).toEqual([zorb.id, zorb.id])
    expect(S.exWeights[zorb.id]).toEqual({ w: 30, d: '2025-03-09' })
  })

  it('matches the name regardless of case and spacing, including one the user made by hand', () => {
    const S = fresh()
    S.customEx.push({ id: 'mine', n: 'Zorb  Roller ', bp: 'waist', custom: true })
    mergeImport(S, parseWorkoutCSV(EXPORT_A, { unit: 'kg' }))
    expect(S.customEx).toHaveLength(1)
    expect(S.workouts[0].entries.map(e => e.id)).toEqual(['mine', '0025'])
  })
})
