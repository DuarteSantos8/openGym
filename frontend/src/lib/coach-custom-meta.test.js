/* #1250: the Coach's custom exercises keep their equipment, muscles and aliases, from the model's
   answer (api/coach/core/validate.js) to the profile (applyCreatedPlan → mergePlan → cleanCustom).
   The core keeps its own copy of the gate, since the API image cannot import the frontend; these
   tests hold the two copies together. */
import { describe, it, expect } from 'vitest'
import { applyCreatedPlan, CONSENT_VERSION } from './coach.js'
import { MUSCLES, MUSCLE_MODEL } from './muscles.js'
import { ALL_EQUIPMENT } from './equipment.js'
import { validatePlan, CUSTOM_MUSCLES, customEquipment } from '../../../api/coach/core/validate.js'

describe('the core\'s custom-exercise gate matches the app\'s', () => {
  it('names the same muscles as plan-share.js cleanCustom', () => {
    expect([...CUSTOM_MUSCLES].sort()).toEqual([...MUSCLES, 'deltoids', 'cardiovascular system'].sort())
  })
  it('knows the same equipment as the custom-exercise form', () => {
    expect([...customEquipment()].sort()).toEqual([...ALL_EQUIPMENT].sort())
  })
  it('writes the current muscle model', () => {
    const r = validatePlan({ routines: [{ name: 'A', ex: [{ id: 'cx1', sets: 3, reps: 8 }] }], customEx: [{ id: 'cx1', n: 'X', bp: 'back', primaries: ['lats'] }] })
    expect(r.bundle.customEx[0].mv).toBe(MUSCLE_MODEL)
  })
})

describe('a Coach plan with its own exercise, accepted', () => {
  it('lands with its equipment, muscles and aliases, editable like one made in the form', () => {
    const answer = {
      coach_contract: 1, opengym_plan: 1, name: 'Plan', summary: 's',
      week: { 0: 'rest', 1: 'r1', 2: 'rest', 3: 'rest', 4: 'rest', 5: 'rest', 6: 'rest' },
      routines: [{ id: 'r1', name: 'A', ex: [{ id: 'cx1', sets: 3, reps: 8, mode: 'reps' }] }],
      customEx: [{ id: 'cx1', n: 'Upper-back row on rings', bp: 'back', desc: 'Lean back, pull.', eq: 'suspension trainer', primaries: ['upper-back'], secondaries: ['biceps', 'rear-delts'], aliases: ['Ring row'] }]
    }
    const v = validatePlan(answer)
    expect(v.ok).toBe(true)
    const s = {
      unit: 'kg', lang: 'en', customEx: [], workouts: [], bodyweight: [], exWeights: {}, dayPlan: {}, routines: [], week: {},
      coach: { consent: { agreedAt: '2026-07-01T00:00:00Z', version: CONSENT_VERSION }, log: [], snapshots: [], cadence: 'off' }
    }
    applyCreatedPlan(s, { id: 'p1', kind: 'create', bundle: v.bundle }, { schedule: false })
    const c = s.customEx[0]
    expect(c).toMatchObject({ n: 'Upper-back row on rings', eq: 'suspension trainer', primaries: ['upper-back'], tg: 'upper-back', secondaries: ['rear-delts', 'biceps'], sm: ['rear-delts', 'biceps'], aliases: ['Ring row'], mv: MUSCLE_MODEL, custom: true })
    // in the new model already: upper-back is not split into lats + upper-back a second time
    expect(c.primaries).not.toContain('lats')
    expect(s.routines[0].ex[0].id).toBe(c.id)
  })
})
