import { describe, it, expect } from 'vitest'
import { matchExercise, matchHevyTitle, parseWorkoutCSV, detectSource } from './import-csv.js'
import { EXIDX } from './exercises.js'

// The names other apps actually export, and the catalogue entry each has to land on.
// Everything here was reported as arriving in the app as a *custom* exercise (issue #74):
// the alias table is the intended place to fix that, so these pin it.
const MAPS = {
  Treadmill: '3666',
  'Goblet Squat': '1760',
  Cycling: '2331',
  'Cable Core Pallof Press': '0979',
  Elliptical: '2141',
  'Stationary Bike': '2138',
  // Hevy's vocabulary, from a real export. It writes the equipment in parentheses and says
  // "bicep"/"chest fly" where the catalogue says "biceps"/"fly", so the word-bag lands one
  // word off on every one of these and they arrived as custom exercises.
  'Bicep Curl (Dumbbell)': '0294',
  'Bicep Curl (Cable)': '0868',
  'Chest Fly (Machine)': '0596',
  'Butterfly (Pec Deck)': '0596',
  'Incline Chest Fly (Dumbbell)': '0319',
  'Rear Delt Reverse Fly (Dumbbell)': '0383',
  'Face Pull': '0203',
  'Battle Ropes': '0128',
  'Hack Squat (Machine)': '0743',
  'Seated Cable Row - Bar Grip': '0218',
  'Single Arm Lateral Raise (Cable)': '0192',
}

describe('foreign exercise names resolve to the catalogue', () => {
  for (const [name, id] of Object.entries(MAPS)) {
    it(`maps "${name}" to ${id}`, () => {
      expect(matchExercise(name)).toBe(id)
      expect(EXIDX[id]).toBeTruthy()   // an alias pointing at a dropped id is worse than no alias
    })
  }

  // Equipment qualifiers must still beat the bare alias, or an import files years of
  // dumbbell work under the barbell lift.
  it('keeps the qualified variants distinct', () => {
    expect(matchExercise('Kettlebell Goblet Squat')).toBe('0534')
    expect(matchExercise('Dumbbell Goblet Squat')).toBe('1760')
  })

  // The word-bag is order-insensitive, which is what lets one alias cover the two ways
  // exporters write the same movement.
  it('ignores word order and case', () => {
    expect(matchExercise('Squat (Barbell)')).toBe(matchExercise('Barbell Squat'))
  })

  // Regression guard for the aliases added above: the common lifts must not have moved.
  it('leaves the established aliases alone', () => {
    expect(matchExercise('Bench Press')).toBe('0025')
    expect(matchExercise('Squat')).toBe('0043')
    expect(matchExercise('Barbell Row')).toBe('0027')
    expect(matchExercise('Deadlift')).toBe('0032')
  })

  // SYN rewrote 'machine' -> 'lever' before it ever reached 'smith machine' -> 'smith',
  // so every Smith-machine name arrived as "smith lever ..." and could not match anything
  // in the catalogue. The two rules are order-dependent; this pins the order.
  it('resolves Smith-machine names rather than leaving a stray "lever"', () => {
    expect(matchExercise('Bench Press (Smith Machine)')).toBe('0748')
    expect(matchExercise('Overhead Press (Smith Machine)')).toBe('0766')
    expect(matchExercise('Smith Machine Bench Press')).toBe('0748')
  })

  // The generic machine -> lever rule still has to work on its own.
  it('keeps the plain machine alias working', () => {
    expect(matchExercise('Seated Fly (Machine)')).toBe('0596')
  })

  it('still refuses to guess', () => {
    expect(matchExercise('Some Movement I Invented')).toBe(null)
    expect(matchExercise('')).toBe(null)
  })
})

// Hevy exports no category column, so every invented exercise took the 'upper legs' default
// and a third of an imported history was attributed to the legs in the muscle map. With no
// category to read, the body part comes off the name instead.
describe('invented exercises get a body part from their name', () => {
  const HEAD = 'title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_index,set_type,weight_kg,reps,distance_km,duration_seconds,rpe'
  const row = name => `W,"09 Oct 2025, 19:22","09 Oct 2025, 20:22",,"${name}",,,0,normal,40,10,,,`
  const bpOf = name => {
    const r = parseWorkoutCSV([HEAD, row(name)].join('\n'), { unit: 'kg' })
    return r.customEx[0] && r.customEx[0].bp
  }

  it('reads the body part off names the catalogue does not have', () => {
    expect(bpOf('Kirk Shrug Machine Thing')).toBe('back')
    expect(bpOf('Bicep Curl Contraption')).toBe('upper arms')
    expect(bpOf('Standing Calf Thing')).toBe('lower legs')
  })

  it('no longer files everything under the legs', () => {
    expect(bpOf('Some Chest Contraption')).not.toBe('upper legs')
    expect(bpOf('Some Chest Contraption')).toBe('chest')
  })

  it('leaves a genuine leg movement on the legs', () => {
    expect(bpOf('Bulgarian Split Squat Machine v9')).toBe('upper legs')
  })

  it('still prefers an explicit category column when the file has one', () => {
    const head = 'Date,Exercise,Category,Weight,Reps'
    const r = parseWorkoutCSV([head, '2025-10-09,Some Invented Lift,Shoulders,40,10'].join('\n'), { unit: 'kg' })
    expect(r.customEx[0].bp).toBe('shoulders')
  })
})

describe('Hevy CSV uses the generated title map', () => {
  const HEVY_CSV = [
    'title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_index,set_type,weight_kg,reps,distance_km,duration_seconds,rpe',
    'Push,2026-08-01 10:00:00,2026-08-01 11:00:00,,Bulgarian Split Squat (Dumbbell),,,0,normal,40,10,0,,',
    'Push,2026-08-01 10:00:00,2026-08-01 11:00:00,,Lat Pulldown - Close Grip (Cable),,,0,warmup,25,15,0,,',
    'Push,2026-08-01 10:00:00,2026-08-01 11:00:00,,Lat Pulldown - Close Grip (Cable),,,1,normal,52,12,0,,8',
    'Push,2026-08-01 10:00:00,2026-08-01 11:00:00,,Reverse Lunge (Dumbbell),,,0,normal,20,10,0,,',
  ].join('\n')

  it('detects the Hevy export dialect', () => {
    expect(detectSource(HEVY_CSV.split('\n')[0].split(','))).toBe('Hevy')
  })

  it('resolves English Hevy titles through HEVY_TITLE_MAP before the word-bag', () => {
    expect(matchHevyTitle('Bulgarian Split Squat (Dumbbell)')).toBe('0410')
    expect(matchHevyTitle('Lat Pulldown - Close Grip (Cable)')).toBe('2616')
    expect(matchHevyTitle('Reverse Lunge (Dumbbell)')).toBe('0381')
    // Word-bag alone still misses these — the title map is what makes CSV work.
    expect(matchExercise('Bulgarian Split Squat (Dumbbell)')).toBeNull()
  })

  it('imports a Hevy CSV onto catalogue ids, not customs', () => {
    const parsed = parseWorkoutCSV(HEVY_CSV, { unit: 'kg' })
    expect(parsed.source).toBe('Hevy')
    expect(parsed.created).toBe(0)
    const ids = parsed.workouts[0].entries.map(e => e.id).sort()
    expect(ids).toEqual(['0410', '0381', '2616'].sort())
    const pull = parsed.workouts[0].entries.find(e => e.id === '2616')
    expect(pull.sets[0]).toMatchObject({ w: 25, r: 15, phase: 'warmup' })
    expect(pull.sets[1]).toMatchObject({ w: 52, r: 12, rpe: 8 })
  })
})
