import { describe, it, expect } from 'vitest'
import { mergeStates, stampChange } from './sync-merge.js'
import { withFood, withWater } from './food.js'

const clone = o => JSON.parse(JSON.stringify(o))
const item = (n, d) => ({ n, d, m: 'lunch', per: [100, 0, 0, 0], g: 100 })

// Two devices start from one copy and each change the food diary and its settings.
function twoDevices() {
  const base = { _ts: 100, foodLog: {}, foodMeals: {}, foodWater: {}, foodFasts: {} }
  const a = clone(base), b = clone(base)
  a.foodLog = withFood(a.foodLog, 'a', item('rice', '2026-11-09'), 200)
  a.foodWater = withWater(a.foodWater, '2026-11-09', 500, 200)
  a.foodPlan = { heightCm: 180 }; a.foodEatBack = true; a.waterGoal = 3000; a.fast = { start: 5, hours: 16 }
  a._ts = 200
  stampChange(base, a, 200)
  b.foodLog = withFood(b.foodLog, 'b', item('eggs', '2026-11-09'), 300)
  b.foodWater = withWater(b.foodWater, '2026-11-10', 250, 300)
  b.foodNudge = false; b.fastShow = true; b.foodSplit = { p: 30, c: 40, f: 30 }; b.foodGoal = 2000
  b._ts = 300
  stampChange(base, b, 300)
  return [a, b]
}

describe('food data in a merge', () => {
  it('keeps every item and water day, and every plain food setting, whichever copy is merged first', () => {
    const [a, b] = twoDevices()
    for (const m of [mergeStates(a, b), mergeStates(b, a)]) {
      expect(Object.keys(m.foodLog).sort()).toEqual(['a', 'b'])
      expect(m.foodWater['2026-11-09'].ml).toBe(500)
      expect(m.foodWater['2026-11-10'].ml).toBe(250)
      expect(m.foodPlan).toEqual({ heightCm: 180 })
      expect(m).toMatchObject({ foodEatBack: true, waterGoal: 3000, fast: { start: 5, hours: 16 }, foodNudge: false, fastShow: true, foodGoal: 2000, foodSplit: { p: 30, c: 40, f: 30 } })
    }
  })

  it('lets the newest edit of a setting win, an ended fast and a removed item included', () => {
    const [a, b] = twoDevices()
    const m1 = mergeStates(a, b)
    const stored = clone(m1)
    const phone = clone(m1)
    phone.waterGoal = 2500
    delete phone.fast
    phone.foodLog.a = { _ts: 1 }
    stampChange(stored, phone, 400)
    phone._ts = 400
    const m2 = mergeStates(stored, phone)
    expect(m2.waterGoal).toBe(2500)
    expect('fast' in m2).toBe(false)
    expect(Object.keys(m2.foodLog.a)).toEqual(['_ts'])
    expect(m2.foodLog.b.n).toBe('eggs')
  })
})
