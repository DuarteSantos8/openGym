// Labels the MCP tools hand to an LLM: they read a plan the way the app shows it.
import { describe, test, expect } from 'vitest'
import { exLine, policyName } from '../src/labels.js'

describe('labels', () => {
  test('triple progression has its name and reads its set range', () => {
    expect(policyName('triple')).toBe('Triple progression')
    expect(exLine({ id: '0025', sets: 3, setsMax: 5, reps: 12, repsMin: 8, mode: 'reps', weight: 60 }, 'kg')).toBe('3–5 × 8–12 · 60 kg')
    // Without a set range above the sets it reads as it always did.
    expect(exLine({ id: '0025', sets: 3, reps: 12, repsMin: 8, mode: 'reps' }, 'kg')).toBe('3 × 8–12')
  })

  test('cardio reads by its length: minutes, distance or calories', () => {
    expect(exLine({ id: '1161', sets: 1, min: 20, speed: 8, mode: 'cardio' }, 'kg')).toBe('1 × 20 min @ 8 km/h')
    expect(exLine({ id: '1161', sets: 4, km: 0.5, speed: 12, mode: 'cardio' }, 'kg')).toBe('4 × 0.5 km @ 12 km/h')
    expect(exLine({ id: '1161', sets: 4, kcal: 50, speed: 12, mode: 'cardio' }, 'kg')).toBe('4 × 50 kcal @ 12 km/h')
  })
})
