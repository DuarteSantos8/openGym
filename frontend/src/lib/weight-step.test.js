// One weight step for every exercise (Settings → Weight step): "do I have to change the step to
// 0.25 for every exercise in my routines or can I apply it to every exercise at once?"
import { afterEach, describe, expect, it } from 'vitest'
import { STEPS, profileStep, nextStep, applyProfileSteps, stepOverrides, applyStepToAll, fmtStepLabel } from './weight-step.js'
import { defaultIncrement, weightIncrement, addStep, snapWeight, stepWeight, roundToStep, stepPlaces, deloadTo } from './progression.js'
import { rerampWarmups } from './history.js'
import { convertStateUnit, convertStep } from './units.js'

afterEach(() => applyProfileSteps({}))

describe('the profile step', () => {
  it('offers the fine steps in both units', () => {
    for (const u of ['kg', 'lb']) for (const v of [0.1, 0.25, 0.5, 1, 1.25, 2, 2.5, 5]) expect(STEPS[u]).toContain(v)
  })

  it('is kept per unit and only a sane number counts', () => {
    expect(profileStep({ unit: 'kg', wstep: { kg: 0.25, lb: 1 } })).toBe(0.25)
    expect(profileStep({ unit: 'lb', wstep: { kg: 0.25, lb: 1 } })).toBe(1)
    expect(profileStep({ unit: 'kg', wstep: { lb: 1 } })).toBe(null)
    expect(profileStep({ unit: 'kg', wstep: { kg: 'x' } })).toBe(null)
    expect(profileStep({ unit: 'kg', wstep: { kg: -1 } })).toBe(null)
    expect(profileStep({ unit: 'kg' })).toBe(null)
  })

  it('stands in for each lift\'s default, and an exercise\'s own step still wins', () => {
    expect(defaultIncrement('0025', 'kg')).toBeGreaterThan(1)
    applyProfileSteps({ wstep: { kg: 0.25 } })
    expect(defaultIncrement('0025', 'kg')).toBe(0.25)
    expect(defaultIncrement('0025', 'lb')).toBe(5)   // the other unit keeps its own default
    expect(weightIncrement({ id: '0025' }, 'kg')).toBe(0.25)
    expect(weightIncrement({ id: '0025', inc: 2.5 }, 'kg')).toBe(2.5)
  })

  it('the Step stepper walks the list, also down to 0.1', () => {
    expect(nextStep(2.5, 1, 'kg')).toBe(5)
    expect(nextStep(2.5, -1, 'kg')).toBe(2)
    expect(nextStep(0.25, -1, 'kg')).toBe(0.1)
    expect(nextStep(0.1, -1, 'kg')).toBe(0.1)
    expect(nextStep(5, 1, 'lb')).toBe(10)
    expect(nextStep(1.3, 1, 'kg')).toBe(2)   // a typed step goes to the next one on the list
  })

  it('labels a step with all its places', () => {
    expect(fmtStepLabel(0.25, 'kg')).toMatch(/^0[.,]25 kg$/)
    expect(fmtStepLabel(10, 'lb')).toBe('10 lb')
  })
})

describe('apply to all exercises', () => {
  const S = () => ({
    unit: 'kg',
    routines: [
      { id: 'a', ex: [{ id: '0025', sets: 3, reps: 5, inc: 2.5 }, { id: '0007', mode: 'time', sec: 30, inc: 5 }, { id: '0031', sets: 3, reps: 8 }] },
      { id: 'b', ex: [{ id: '0032', sets: 3, reps: 8, inc: 0.25, subs: ['0033'], subCfg: { '0033': { sets: 3, reps: 8, inc: 1 } } }] },
    ],
    active: { id: 'w', entries: [{ id: '0025', target: { sets: 3, reps: 5, inc: 2.5 } }, { id: '0007', target: { mode: 'time', sec: 30, inc: 5 } }] },
  })

  it('counts the exercises whose own step differs, never a timed one (its step is seconds)', () => {
    expect(stepOverrides(S(), 0.25)).toBe(2)   // 2.5 and the backup's 1; 0.25 is already it
    expect(stepOverrides(S(), 0.5)).toBe(3)
    expect(stepOverrides({}, 0.5)).toBe(0)
  })

  it('clears the own steps so they follow the profile, and leaves the rest alone', () => {
    const before = S()
    const frozen = JSON.stringify(before)
    const out = applyStepToAll(before)
    expect(JSON.stringify(before)).toBe(frozen)   // a new copy, the store's draft is not written into
    expect(out.routines[0].ex[0]).toEqual({ id: '0025', sets: 3, reps: 5 })
    expect(out.routines[0].ex[1]).toEqual({ id: '0007', mode: 'time', sec: 30, inc: 5 })
    expect(out.routines[1].ex[0]).toEqual({ id: '0032', sets: 3, reps: 8, subs: ['0033'], subCfg: { '0033': { sets: 3, reps: 8 } } })
    expect(out.active.entries[0].target).toEqual({ sets: 3, reps: 5 })
    expect(out.active.entries[1].target.inc).toBe(5)
    expect(stepOverrides({ ...before, ...out }, 0.25)).toBe(0)
  })
})

describe('fine steps do not leave float dust', () => {
  it('snaps and steps on a 0.1 grid', () => {
    expect(snapWeight(52.300000000000004, 0.1)).toBe(52.3)
    expect(stepWeight(52.2, 0.1, 1)).toBe(52.3)
    let w = 50
    for (let i = 0; i < 23; i++) w = stepWeight(w, 0.1, 1)
    expect(w).toBe(52.3)
    for (let i = 0; i < 23; i++) w = stepWeight(w, 0.1, -1)
    expect(w).toBe(50)
  })

  it('keeps the quarter on a 0.25 grid (one place used to store 52.25 as 52.3)', () => {
    expect(stepWeight(52, 0.25, 1)).toBe(52.25)
    expect(stepWeight(52.25, 0.25, 1)).toBe(52.5)
    expect(snapWeight(61.25, 1.25)).toBe(61.25)
    // one stored as 52.3 before still counts as on the grid
    expect(addStep(52.3, 0.25, 0.25)).toBe(52.5)
    expect(stepPlaces(0.25)).toBe(2)
    expect(stepPlaces(5)).toBe(1)
    expect(roundToStep(0.1 + 0.2, 0.1)).toBe(0.3)
  })

  it('deloads and ramps warm-ups on the fine grid', () => {
    const d = deloadTo(52.3, 0.1)
    expect(String(d)).toMatch(/^\d+(\.\d)?$/)
    const rows = rerampWarmups([{ w: 0, r: 5, warmup: true }, { w: 0, r: 3, warmup: true }, { w: 52.3, r: 5 }], 0.1)
    for (const r of rows) expect(String(r.w)).toMatch(/^\d+(\.\d{1,3})?$/)
  })

  it('a fine step survives a unit switch instead of turning into 0 lb', () => {
    expect(convertStep(0.1, 'kg', 'lb', 2)).toBe(0.25)
    expect(convertStep(0.25, 'lb', 'kg', 2)).toBe(0.1)
    const out = convertStateUnit({ unit: 'kg', routines: [{ id: 'r', ex: [{ id: '0025', sets: 3, reps: 5, weight: 50, inc: 0.1 }] }] }, 'lb')
    expect(out.routines[0].ex[0].inc).toBe(0.25)
  })
})
