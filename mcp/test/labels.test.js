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
})
