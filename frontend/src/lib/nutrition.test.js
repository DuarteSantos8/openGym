import { describe, it, expect } from 'vitest'
import { targets, planInputs, dailyGoal, weightKg, splitOf, workoutKcal } from './nutrition.js'

const man = { kg: 90, cm: 180, sex: 'male', age: 40, activity: 'moderate' }

describe('nutrition targets', () => {
  it('computes BMR (Mifflin-St Jeor), TDEE and a 0.5 kg a week deficit', () => {
    const t = targets({ ...man, rate: -0.5 })
    expect(t.bmr).toBe(1830)                 // 900 + 1125 - 200 + 5
    expect(t.tdee).toBe(2837)                // x 1.55
    expect(t.kcal).toBe(2287)                // - 550 a day
    expect(t).toMatchObject({ p: 180, f: 64, capped: false, floored: false })
    expect(t.c).toBe(Math.round((2287 - 180 * 4 - 64 * 9) / 4))
  })

  it('holds the rate to 1% of body weight a week', () => {
    const t = targets({ ...man, rate: -2 })
    expect(t.rate).toBe(-0.9)
    expect(t.capped).toBe(true)
  })

  it('never goes under the floor, nor the floor over maintenance', () => {
    const woman = { kg: 60, cm: 165, sex: 'female', age: 30, activity: 'sedentary', rate: -0.6 }
    const t = targets(woman)
    expect(t.floored).toBe(true)
    expect(t.kcal).toBe(Math.max(t.bmr, 1200))
    const tiny = targets({ kg: 42, cm: 150, sex: 'female', age: 70, activity: 'sedentary', rate: -0.4 })
    expect(tiny.kcal).toBe(tiny.tdee)
  })

  it('adds a surplus for a gain and eats a bit less protein', () => {
    const t = targets({ ...man, rate: 0.25 })
    expect(t.kcal).toBe(2837 + 275)
    expect(t.p).toBe(162)
  })

  it('reads the profile, lb included, and names what is missing', () => {
    const S = { unit: 'lb', bodyweight: [{ d: '2026-11-09', w: 198.4 }], sex: 'male', birthYear: 1986, foodPlan: { heightCm: 180 } }
    expect(weightKg(S)).toBeCloseTo(90, 0)
    expect(planInputs(S).missing).toEqual(['activity'])
    expect(dailyGoal({ ...S, foodGoal: 2000 })).toMatchObject({ kcal: 2000, auto: false })
    expect(dailyGoal({ ...S, foodPlan: { heightCm: 180, activity: 'light', rate: -0.5 } }).auto).toBe(true)
    expect(dailyGoal({})).toBeNull()
  })

  it('applies an own macro split to either goal, and ignores one that does not add up', () => {
    expect(dailyGoal({ foodGoal: 2000, foodSplit: { p: 30, c: 40, f: 30 } })).toMatchObject({ kcal: 2000, p: 150, c: 200, f: 67, split: true })
    expect(splitOf({ foodSplit: { p: 30, c: 30, f: 30 } })).toBeNull()
    expect(dailyGoal({ foodGoal: 2000, foodSplit: { p: 30, c: 30, f: 30 } }).p).toBeNull()
  })

  it('estimates workout calories from the time trained and the weight', () => {
    const at = h => Date.UTC(2026, 10, 9, h)
    const S = { bodyweight: [{ d: '2026-11-09', w: 80 }], workouts: [
      { d: '2026-11-09', start: at(9), end: at(10) + 1800000 },
      { d: '2026-11-08', start: at(9), end: at(10) },
      { d: '2026-11-09', start: at(12), end: at(12) + 10 * 3600000 },
    ] }
    expect(workoutKcal(S, '2026-11-09')).toBe(Math.round(4 * 80 * (1.5 + 3)))
    expect(workoutKcal({ workouts: S.workouts }, '2026-11-09')).toBe(0)
  })
})

describe('a measured burn', () => {
  it('replaces the activity guess and keeps the planned deficit', () => {
    const base = { kg: 80, cm: 180, sex: 'male', age: 38, activity: 'moderate', rate: -0.5 }
    const t = targets({ ...base, burn: 2900 })
    expect(t.tdee).toBe(2900)
    expect(t.kcal).toBe(Math.round(2900 - 0.5 * 7700 / 7))
    expect(targets(base).tdee).not.toBe(2900)
  })
})

