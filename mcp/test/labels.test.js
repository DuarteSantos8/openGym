// Labels the MCP tools hand to an LLM: they read a plan the way the app shows it.
import { describe, test, expect } from 'vitest'
import { ruleSummary, presetLabel } from '../src/labels.js'
import { defaultPlanRule } from '../../api/engine/index.js'

describe('labels', () => {
  test('triple progression has its name and reads its set range', () => {
    expect(presetLabel('triple')).toBe('Triple progression')
    expect(ruleSummary(defaultPlanRule('triple', { sets: { min: 3, max: 5 }, reps: { min: 8, max: 12 }, load: { mode: 'absolute', value: 60, unit: 'kg' } }))).toBe('3-5 × 8-12 · 60 kg')
    // Without a set range above the sets it reads as it always did.
    expect(ruleSummary(defaultPlanRule('triple', { sets: { min: 3, max: 3 }, reps: { min: 8, max: 12 }, load: { mode: 'bodyweight' } }))).toBe('3 × 8-12')
  })
})
