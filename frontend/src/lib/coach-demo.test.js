import { describe, it, expect } from 'vitest'
import { buildReview, buildDebrief, demoCohort } from './coach-demo.js'
import { canonicalProfile, ruleOccurrence, loggedExposure } from './test-fixtures.js'

const S = () => {
  const s = canonicalProfile()
  s.routines[0].ex.push(ruleOccurrence('0009', { occurrenceId: 'occ2' }))
  s.routines.push({ id: 'r2', name: 'Pull', ex: [ruleOccurrence('0007', { occurrenceId: 'occ3', routineId: 'r2' })] })
  s.workouts[0].exposures[0] = loggedExposure('0025', [{ role: 'warmup', r: 5, w: 20 }, { r: 5, w: 60 }, { r: 5, w: 60 }], { exposureId: 'exp0' })
  return s
}
describe('coach demo on a v2 profile', () => {
  it('proposes changes aimed at real exercise ids', () => {
    const p = buildReview(S())
    expect(p.changes.filter(c => c.target.exId).every(c => ['0025', '0009'].includes(c.target.exId))).toBe(true)
    expect(p.changes.find(c => c.type === 'sets').before).toBe(3)
  })
  it('debrief counts work sets only', () => {
    expect(buildDebrief(S(), 'w0').workout.sets).toBe(2)
  })
  it('cohort names the planned exercises', () => {
    expect(demoCohort(S()).exercises.map(e => e.id)).toEqual(['0025', '0009', '0007'])
  })
})
