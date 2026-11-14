import { describe, expect, it } from 'vitest'
import { parseWorkoutCSV } from './import-csv.js'

// Hand-written from the header GymMane's code writes (services/local_store.dart, read for #647);
// no real export yet, so the values are made up and only the columns are theirs.
const GYMMANE = [
  'date,exercise,muscle,set,reps,weight_kg,volume_kg,est_1rm_kg,distance_km,duration_s,rpe',
  '2026-05-04,Bench Press,Chest,1,8,60,480,75.2,,,8',
  '2026-05-04,Bench Press,Chest,2,7,60,420,73.1,,,9',
  '2026-05-04,Cable Kickback Thing,Glutes,1,12,15,180,21,,,',
  '2026-05-04,Running,Cardio,1,0,0,0,0,3.2,1200,',
].join('\n')

describe('a GymMane CSV', () => {
  const p = parseWorkoutCSV(GYMMANE, { unit: 'kg' })
  const [w] = p.workouts

  it('is recognised and read as one workout', () => {
    expect(p.source).toBe('GymMane')
    expect(p.workouts.length).toBe(1)
    expect(p.skipped).toBe(0)
  })

  it('reads weight, reps and RPE, not the volume or 1RM columns', () => {
    const bench = w.entries.find(e => e.id === '0025')
    expect(bench.sets).toEqual([{ w: 60, r: 8, done: true, rpe: 8 }, { w: 60, r: 7, done: true, rpe: 9 }])
  })

  it('takes duration_s as the set time and muscle as the body part of a new exercise', () => {
    const run = w.entries.find(e => e.sets[0].min)
    expect(run.sets[0]).toMatchObject({ min: 20, speed: 9.6 })
    expect(p.customEx.find(c => c.n === 'cable kickback thing').bp).toBe('upper legs')
  })
})
