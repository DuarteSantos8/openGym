// Away from the gym (1.4.5): starter plans for no kit, dumbbells, bands and a hotel room.
import { describe, expect, it } from 'vitest'
import { AWAY_PLANS, buildStarterPlan, starterPlanOptions } from './starter.js'
import { planPhase } from './prescription/index.js'
import { EXIDX } from './exercises.js'
import { eqAvailable } from './equipment.js'

const NEEDS = { 'home-bw': [], hotel: [], dumbbells: ['dumbbell'], bands: ['band'] }

describe('away-from-the-gym starter plans', () => {
  it('are offered, every exercise is in the catalogue', () => {
    const ids = starterPlanOptions().map(o => o.id)
    for (const id of AWAY_PLANS) {
      expect(ids).toContain(id)
      for (const r of buildStarterPlan(id).routines) for (const e of r.ex) expect(EXIDX[e.exerciseId], e.exerciseId).toBeTruthy()
    }
  })
  it('need nothing but their own kit: no bench, no bar, nothing swapped when fitted to it', () => {
    for (const id of AWAY_PLANS) {
      const plan = buildStarterPlan(id, NEEDS[id])
      expect(plan.fit, id).toEqual({ swapped: 0, dropped: 0 })
      for (const r of plan.routines) for (const e of r.ex) expect(eqAvailable(NEEDS[id], EXIDX[e.exerciseId]), EXIDX[e.exerciseId].n).toBe(true)
    }
  })
  it('plans holds as timed sets', () => {
    // v2: a hold's seconds are its rule's; v1 never progressed a timed starter hold ('off').
    const plank = buildStarterPlan('hotel').routines[0].ex.find(e => e.exerciseId === '0463')
    expect(plank.rule.preset).toBe('autoregulated')
    expect(planPhase(plank.rule).parameters.durationSeconds).toEqual({ min: 45, max: 45 })
  })
})
