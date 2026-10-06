import { describe, expect, it } from 'vitest'
import { parseWorkoutCSV } from './import-csv.js'

// Rows from a real Strong export (QA sample). Strong writes the workout's length in Duration
// ("1h 5m", "52m") on every row and a set's own time in Seconds; the session note is
// "Workout Notes", the per-set one "Notes".
const STRONG = [
  'Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE',
  '2026-04-02 18:05:00,"Upper A",1h 5m,"Bench Press (Barbell)",1,60,8,0,0,"","Good day",8',
  '2026-04-02 18:05:00,"Upper A",1h 5m,"Bench Press (Barbell)",2,60,8,0,0,"Paused reps","Good day",8.5',
  '2026-04-02 18:05:00,"Upper A",1h 5m,"Bent Over Row (Barbell)",1,50,10,0,0,"","Good day",',
  '2026-04-02 18:05:00,"Upper A",1h 5m,"Plank",1,0,0,0,60,"","Good day",',
  '2026-04-05 17:00:00,"Legs",52m,"Squat (Barbell)",1,80,5,0,0,"","",',
  '2026-04-05 17:00:00,"Legs",52m,"Running (Treadmill)",1,0,0,3,1200,"","",',
].join('\n')

// Strong 6.x changed the export: semicolon-delimited, a "Workout #" column ahead of the
// name, the workout length in seconds ("Duration (sec)"), and distances in metres
// ("Distance (meters)"). Issue #394.
const STRONG6 = [
  '"Workout #";"Date";"Workout Name";"Duration (sec)";"Exercise Name";"Set Order";"Weight (kg)";"Reps";"RPE";"Distance (meters)";"Seconds";"Notes";"Workout Notes"',
  '"1";"2026-05-01 18:00:00";"Back and Biceps";"3300";"Bench Press (Barbell)";"1";"60";"8";"8";"0";"0";"";"Good day"',
  '"1";"2026-05-01 18:00:00";"Back and Biceps";"3300";"Bent Over Row (Barbell)";"1";"50";"10";"";"0";"0";"";"Good day"',
  '"2";"2026-05-03 17:00:00";"Cardio";"780";"Running (Treadmill)";"1";"0";"0";"";"8000";"780";"";""',
].join('\n')

const HEVY = [
  '"title","start_time","end_time","description","exercise_title","superset_id","exercise_notes","set_index","set_type","weight_kg","reps","distance_km","duration_seconds","rpe"',
  '"Push","3 févr. 2026, 18:00","3 févr. 2026, 19:10","Felt fresh","Bench Press (Barbell)",,"",0,"normal",62.5,8,,,8',
  '"Push","3 févr. 2026, 18:00","3 févr. 2026, 19:10","Felt fresh","Lateral Raise (Dumbbell)",0,"",0,"normal",10,12,,,',
  '"Push","3 févr. 2026, 18:00","3 févr. 2026, 19:10","Felt fresh","Triceps Pushdown",0,"",0,"normal",25,12,,,',
  '"Push","3 févr. 2026, 18:00","3 févr. 2026, 19:10","Felt fresh","Lateral Raise (Dumbbell)",0,"",1,"normal",10,12,,,',
  '"Push","3 févr. 2026, 18:00","3 févr. 2026, 19:10","Felt fresh","Triceps Pushdown",0,"",1,"normal",25,12,,,',
].join('\n')

const minutes = w => (w.end - w.start) / 60000

describe('a Strong export', () => {
  const parsed = parseWorkoutCSV(STRONG, { unit: 'kg' })
  const [upper, legs] = parsed.workouts

  it('takes Duration as the length of the workout, not as a set time', () => {
    expect(parsed.source).toBe('Strong')
    expect(minutes(upper)).toBe(65)
    expect(minutes(legs)).toBe(52)
    expect(new Date(upper.start).getHours()).toBe(18)
    expect(new Date(upper.start).getMinutes()).toBe(5)
    // No set picks up the workout's hour as its own time.
    expect(upper.entries.flatMap(e => e.sets).some(s => s.min === 65)).toBe(false)
  })

  it('keeps the workout note, and a set note on its exercise', () => {
    expect(upper.note).toBe('Good day')
    expect(legs.note).toBeUndefined()
    expect(upper.entries[0].note).toBe('Paused reps')
    expect(upper.entries[1].note).toBeUndefined()
  })

  it('imports a timed hold as seconds, and cardio with a distance as cardio', () => {
    const plank = upper.entries.find(e => e.sets[0].sec != null)
    expect(plank).toBeTruthy()
    expect(plank.sets).toEqual([{ sec: 60, w: 0, done: true }])
    expect(legs.entries[1].sets).toEqual([{ min: 20, speed: 9, done: true }])
  })
})

describe('a Strong 6.x export (semicolons)', () => {
  const parsed = parseWorkoutCSV(STRONG6, { unit: 'kg' })
  const [back, cardio] = parsed.workouts

  it('reads the semicolon delimiter and detects Strong', () => {
    expect(parsed.error).toBeUndefined()
    expect(parsed.source).toBe('Strong')
    expect(parsed.workouts).toHaveLength(2)
  })

  it('takes Workout Name as the name, not Workout #', () => {
    expect(back.name).toBe('Back and Biceps')
    expect(cardio.name).toBe('Cardio')
  })

  it('reads Duration (sec) as a length in seconds', () => {
    expect(minutes(back)).toBe(55)
    expect(minutes(cardio)).toBe(13)
  })

  it('reads Distance (meters) as metres, not kilometres', () => {
    const [run] = cardio.entries[0].sets
    expect(run.min).toBe(13)
    expect(run.speed).toBeCloseTo(36.9, 1)
  })
})

describe('a Hevy export with a superset', () => {
  it('puts the exercises sharing a superset_id in one superset, and reads the description as the note', () => {
    const [w] = parseWorkoutCSV(HEVY, { unit: 'kg' }).workouts
    const [bench, raise, pushdown] = w.entries
    expect(bench.sg).toBeUndefined()
    expect(raise.sg).toBeTruthy()
    expect(pushdown.sg).toBe(raise.sg)
    expect(raise.sets).toHaveLength(2)
    expect(w.note).toBe('Felt fresh')
  })

  it('reads a Hevy timed hold as seconds too', () => {
    const csv = [HEVY.split('\n')[0], '"Core","3 févr. 2026, 18:00","3 févr. 2026, 18:30","","Plank",,"",0,"normal",,,,45,'].join('\n')
    const [w] = parseWorkoutCSV(csv, { unit: 'kg' }).workouts
    expect(w.entries[0].sets).toEqual([{ sec: 45, w: 0, done: true }])
  })
})
