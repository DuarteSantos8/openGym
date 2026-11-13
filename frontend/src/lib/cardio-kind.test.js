// P6 (1.4.5 UX round): "Walking on treadmill" opened at 8 km/h in a new routine, a jog. A new
// cardio slot now starts at a pace that fits what it is; running stays where it was.
import { describe, it, expect } from 'vitest'
import { cardioStartSpeed, kindOfName } from './cardio-kind.js'
import { defaultConfig, pickedExerciseConfig } from './history.js'
import { toSpeed } from './speed.js'
import { EXDB } from './exercises-data.js'

const byName = n => EXDB.find(e => e.n === n)

describe('the pace a new cardio exercise starts at', () => {
  it('walking walks: treadmill, incline treadmill, backwards, plain', () => {
    for (const n of ['walking on treadmill', 'walking on incline treadmill', 'walking backward on a treadmill', 'walking', 'walk (equipment)', 'briskly walking']) {
      const ex = byName(n)
      expect(ex, n).toBeTruthy()
      expect(defaultConfig(ex.id), n).toEqual({ sets: 1, min: 20, speed: 5 })
    }
  })
  it('running stays at 8 km/h, and so do the machines whose speed means something else', () => {
    for (const n of ['run on treadmill', 'run', 'rowing (with rowing machine)', 'walking on stepmill', 'elliptical machine walk', 'walk elliptical cross trainer', 'lever stepper', 'mountain climber', 'marching on spot', 'walk (high knees)', 'aquabike']) {
      const ex = byName(n)
      expect(ex, n).toBeTruthy()
      expect(defaultConfig(ex.id).speed, n).toBe(8)
    }
  })
  it('a bike rides: 20 km/h instead of a crawl', () => {
    for (const n of ['stationary bike walk', 'riding outdoor bicycle', 'assault bike run', 'bicycle recline walk']) {
      expect(defaultConfig(byName(n).id).speed, n).toBe(20)
    }
  })
  it('an mph profile reads round numbers: 3 mph for a walk, 12 for a bike', () => {
    const walk = byName('walking on treadmill').id
    const lb = { unit: 'lb' }
    expect(toSpeed(defaultConfig(walk, undefined, lb).speed, 'mph')).toBe(3)
    expect(toSpeed(pickedExerciseConfig(walk, undefined, lb).speed, 'mph')).toBe(3)
    expect(toSpeed(pickedExerciseConfig(byName('riding outdoor bicycle').id, undefined, { unit: 'kg', speedUnit: 'mph' }).speed, 'mph')).toBe(12)
    // km/h is the profile's pick even in pounds
    expect(pickedExerciseConfig(walk, undefined, { unit: 'lb', speedUnit: 'kmh' }).speed).toBe(5)
    // the run is untouched in either unit
    expect(pickedExerciseConfig(byName('run on treadmill').id, undefined, lb).speed).toBe(8)
  })
  it('your own exercises in your own language get it too', () => {
    expect(cardioStartSpeed('Spazieren gehen', '')).toBe(5)
    expect(cardioStartSpeed('Caminhada na passadeira', '')).toBe(5)
    expect(cardioStartSpeed('Wandern', '')).toBe(5)
    expect(cardioStartSpeed('Rennvelo', '')).toBe(20)
    expect(cardioStartSpeed('Schwimmen', '')).toBe(3)
    expect(cardioStartSpeed('Laufband', '')).toBe(8)
    expect(cardioStartSpeed('Burpees', 'body weight')).toBe(8)
    expect(cardioStartSpeed(undefined, undefined)).toBe(8)
  })
  it('the kinds are what the cardio goals always read', () => {
    expect(kindOfName('walking on stepmill')).toBe('stairs')
    expect(kindOfName('elliptical machine walk')).toBe('elliptical')
    expect(kindOfName('high knee run')).toBe(null)
  })
  it('strength and holds are what they were', () => {
    const lift = EXDB.find(e => e.bp !== 'cardio' && e.eq === 'barbell').id
    expect(defaultConfig(lift)).toEqual({ sets: 3, reps: 10, weight: 0, mode: 'reps' })
    expect(defaultConfig(lift, 'cardio').speed).toBe(8)
  })
})
