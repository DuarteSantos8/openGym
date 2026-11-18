import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { activeKcal, bodyKgFor, FALLBACK_KG, MAX_HOURS, MET, workoutKcal } from './active-energy.js'
import { kcalSoFar } from './live-tiles.js'
import { healthRecords } from './health-connect.js'

// #724, D#917: a workout logged on the phone reached Apple Health and Health Connect with no
// active energy at all. It now carries an estimate: (MET - 1) × kg × hours.
const at = (h, m = 0) => new Date(2026, 8, 17, h, m).getTime()
const strength = { id: '0025', target: { mode: 'reps' }, sets: [{ w: 60, r: 8, done: true }] }
const treadmill = (min, extra = {}) => ({ id: '3666', target: { mode: 'cardio' }, sets: [{ min, speed: 5, done: true, ...extra }] })
const workout = (entries, extra = {}) => ({ id: 'w1', d: '2026-09-17', start: at(18), end: at(19), name: 'Push', entries, ...extra })

describe('activeKcal', () => {
  it('counts an hour of lifting at the strength MET, minus resting', () => {
    expect(activeKcal(workout([strength]), 80)).toBe(Math.round((MET.strength_training - 1) * 80))
  })
  it('counts logged cardio minutes at their own MET and the rest at strength', () => {
    const kcal = activeKcal(workout([treadmill(20), strength]), 80)
    const want = (MET.walking - 1) * 80 * (20 / 60) + (MET.strength_training - 1) * 80 * (40 / 60)
    expect(kcal).toBe(Math.round(want))
  })
  it('takes the session type for an all-cardio workout', () => {
    expect(activeKcal(workout([treadmill(60)]), 70)).toBe(Math.round((MET.walking - 1) * 70))
  })
  it('lets how hard it felt nudge the cardio MET', () => {
    const easy = activeKcal(workout([treadmill(60, { rpe: 2 })]), 70)
    const hard = activeKcal(workout([treadmill(60, { rpe: 9 })]), 70)
    expect(hard).toBeGreaterThan(activeKcal(workout([treadmill(60)]), 70))
    expect(easy).toBeLessThan(hard)
  })
  it('caps a workout left running overnight', () => {
    const long = activeKcal(workout([strength], { end: at(18) + 10 * 3600e3 }), 80)
    expect(long).toBe(Math.round((MET.strength_training - 1) * 80 * MAX_HOURS))
  })
  it('is null without a real start and end', () => {
    expect(activeKcal(workout([strength], { end: at(17) }), 80)).toBeNull()
    expect(activeKcal(workout([strength], { start: undefined }), 80)).toBeNull()
  })
  it('takes a stand-in type for the time not logged yet, unless something was lifted', () => {
    expect(activeKcal(workout([]), 70, { restType: 'walking' })).toBe(Math.round((MET.walking - 1) * 70))
    expect(activeKcal(workout([strength]), 70, { restType: 'walking' })).toBe(Math.round((MET.strength_training - 1) * 70))
  })
})

// #1368: the live Calories tile counted every session at strength's MET, so an hour's walk read
// 300 kcal live and 188 in Apple Health. It now runs the same estimate over the time gone.
describe('kcalSoFar (the live tile)', () => {
  const S = { unit: 'kg' }
  const walk = (sets = [{ min: 60, speed: 4 }]) => ({ id: '2258', target: { mode: 'cardio' }, sets })
  const lift = (done = false) => ({ id: '0025', target: { mode: 'reps' }, sets: [{ w: 60, r: 8, done }] })
  const live = (entries, extra = {}) => ({ start: at(18), entries, bw: 70, ...extra })

  it('reads a walk in progress as walking, not strength training', () => {
    expect(kcalSoFar(S, live([walk()]), at(19))).toBe(Math.round((MET.walking - 1) * 70))
  })
  it('agrees with what the finished walk is saved with', () => {
    const sets = [{ min: 60, speed: 4, done: true }]
    const finished = { ...live([walk(sets)]), end: at(19) }
    expect(kcalSoFar(S, live([walk(sets)]), at(19))).toBe(activeKcal(finished, 70))
  })
  it('counts at strength before the first set of a lifting session', () => {
    expect(kcalSoFar(S, live([lift()]), at(19))).toBe(Math.round((MET.strength_training - 1) * 70))
  })
  it('runs every cardio type at its own MET', () => {
    const run = { id: '0685', target: { mode: 'cardio' }, sets: [{ min: 60 }] }
    expect(kcalSoFar(S, live([run]), at(19))).toBe(Math.round((MET.running - 1) * 70))
  })
  // workout-pause.js: resuming moves `start` on by the pause and adds it to `pausedMs` for the
  // record, so the pause is already out of the window; an open pause stops it at `pausedAt`.
  it('leaves out a pause that was resumed, once', () => {
    const resumed = live([walk()], { start: at(18, 30), pausedMs: 30 * 60e3 })   // 18:00, paused 30 min
    expect(kcalSoFar(S, resumed, at(19, 30))).toBe(Math.round((MET.walking - 1) * 70))
  })
  it('stops the clock while paused', () => {
    const paused = live([walk()], { pausedAt: at(18, 30) })
    expect(kcalSoFar(S, paused, at(20))).toBe(Math.round((MET.walking - 1) * 70 / 2))
  })
  it('switches to the saved estimate\'s type once a set is done', () => {
    // A 20-minute walk logged, the lift after it not done yet: the rest of the hour counts as the
    // saved workout would count it (walking), not as the planned lift.
    const entries = [walk([{ min: 20, speed: 4, done: true }]), lift()]
    const saved = activeKcal({ start: at(18), end: at(19), entries }, 70)
    expect(kcalSoFar(S, live(entries), at(19))).toBe(saved)
    expect(saved).toBe(Math.round((MET.walking - 1) * 70))
  })
  it('is null before the start, or with no time trained', () => {
    expect(kcalSoFar(S, live([walk()]), at(18))).toBeNull()
    expect(kcalSoFar(S, live([walk()], { pausedAt: at(18) }), at(19))).toBeNull()
  })
})

describe('workoutKcal (the workout detail)', () => {
  it('is the number the health records get, with the weight it used', () => {
    const w = workout([treadmill(60)], { bw: 70 })
    expect(workoutKcal({ unit: 'kg' }, w)).toEqual({ kcal: activeKcal(w, 70), kg: 70, weight: 70 })
  })
  it('uses the fallback body weight without a weigh-in, and says so', () => {
    const w = workout([strength])
    expect(workoutKcal({ unit: 'kg' }, w)).toEqual({ kcal: activeKcal(w, FALLBACK_KG), kg: FALLBACK_KG, weight: FALLBACK_KG })
  })
  it('gives the weight in pounds for a profile in pounds', () => {
    const w = workout([strength], { bw: 176 })   // lb
    const got = workoutKcal({ unit: 'lb' }, w)
    expect(got.weight).toBe(176)
    expect(got.kcal).toBe(activeKcal(w, got.kg))
  })
  it('shows nothing for a session with nothing done, or no times', () => {
    expect(workoutKcal({ unit: 'kg' }, workout([{ ...strength, sets: [{ w: 60, r: 8 }] }]))).toBeNull()
    expect(workoutKcal({ unit: 'kg' }, workout([strength], { start: undefined }))).toBeNull()
  })
})

describe('bodyKgFor', () => {
  it('takes the workout\'s own body weight, in kg', () => {
    expect(bodyKgFor({ unit: 'kg' }, { bw: 82 })).toBe(82)
    expect(bodyKgFor({ unit: 'lb' }, { bw: 220.46226218 })).toBeCloseTo(100, 5)
  })
  it('else the nearest weigh-in, however old', () => {
    const S = { unit: 'kg', bodyweight: [{ d: '2025-01-01', w: 90, t: new Date(2025, 0, 1).getTime() }] }
    expect(bodyKgFor(S, { start: at(18) })).toBe(90)
  })
  it('else a sane grown-up', () => {
    expect(bodyKgFor({}, { start: at(18) })).toBe(FALLBACK_KG)
  })
})

describe('in the health records', () => {
  const S = { unit: 'kg', workouts: [workout([strength], { bw: 80 })], bodyweight: [] }
  it('rides on each session when the hub allows it', () => {
    expect(healthRecords(S, { nameOf: e => e.id, kcal: true }).sessions[0].kcal).toBe(320)
  })
  it('stays off otherwise, so the record is what it was', () => {
    expect(healthRecords(S, { nameOf: e => e.id }).sessions[0]).not.toHaveProperty('kcal')
  })
})

describe('the native sides', () => {
  const swift = readFileSync(new URL('../../ios/App/App/AppleHealthPlugin.swift', import.meta.url), 'utf8')
  const java = readFileSync(new URL('../../android/app/src/main/java/ch/duartesantos/opengym/HealthWrite.java', import.meta.url), 'utf8')
  const manifest = readFileSync(new URL('../../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8')
  it('Apple Health adds the estimate to the workout under its own sync id', () => {
    expect(swift).toMatch(/activeEnergyBurned/)
    expect(swift).toMatch(/builder\.add\(\[sample\]\)/)
    expect(swift).toMatch(/syncMetadata\(id \+ "-kcal"\)/)
  })
  it('Apple Health takes what a watch measured over the estimate (idea from #434)', () => {
    expect(swift).toMatch(/let measured = await measuredEnergy\(type, from: start, to: end\)[\s\S]*?HealthWriteCore\.kcal\(measured \?\? estimate\)/)
    // Not its own earlier estimates.
    expect(swift).toMatch(/func measuredEnergy[\s\S]*?bundleIdentifier != me/)
  })
  it('Health Connect writes an ActiveCaloriesBurnedRecord beside the session', () => {
    expect(java).toMatch(/new ActiveCaloriesBurnedRecord\(/)
    expect(java).toMatch(/"-kcal"/)
    expect(manifest).toMatch(/android\.permission\.health\.WRITE_ACTIVE_CALORIES_BURNED/)
  })
})
