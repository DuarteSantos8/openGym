// v1.4.5 skill ladder: a rep more after a session where every set made the target, up to the top
// of the range; a miss repeats; no load of its own and no deload.
import { describe, expect, it } from 'vitest'
import { advanceProgression, defaultPlanRule, generatePrescription, summarizeActual, presetForPolicy, policyOfPreset, editPlan } from './index.js'

const NOW = '2026-11-10T10:00:00.000Z'
const rule = editPlan(defaultPlanRule('skill_ladder', { id: 'r', exerciseId: '0662', unit: 'kg' }), { reps: { min: 5, max: 7 } })
// One session at `reps` per set (an array), then the next prescription's reps.
function after(p, reps, state = null) {
  const actual = summarizeActual(p, p.rows.map((r, row) => ({ row, reps: reps[row] ?? reps.at(-1), load: null })))
  const next = advanceProgression({ state, prescription: p, log: { id: 'l' + p.id, actual }, now: NOW })
  return { state: next, p: generatePrescription({ id: p.id + '+', now: NOW, trackId: 't', rule, state: next, lastPrescription: p, lastLog: { id: 'l' + p.id, actual } }) }
}

describe('the skill ladder preset', () => {
  it('is v1\'s "ladder" policy', () => {
    expect(presetForPolicy('ladder', 'reps', true)).toBe('skill_ladder')
    expect(policyOfPreset('skill_ladder')).toBe('ladder')
  })
  it('starts at the bottom, climbs a rep per clean session, repeats a miss, holds at the top', () => {
    const p0 = generatePrescription({ id: 'p', now: NOW, trackId: 't', rule })
    expect(p0.prefill.reps).toBe(5)
    expect(p0.rows.every(r => !r.load)).toBe(true)
    let { state, p } = after(p0, [5, 5, 5])
    expect(p.prefill.reps).toBe(6)
    ;({ state, p } = after(p, [6, 6, 4], state))
    expect(p.prefill.reps).toBe(6)
    ;({ state, p } = after(p, [6], state))
    ;({ state, p } = after(p, [7], state))
    expect(p.prefill.reps).toBe(7)
    ;({ state, p } = after(p, [7], state))
    expect(p.prefill.reps).toBe(7)
  })
})
