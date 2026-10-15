import { expect, it } from 'vitest'
import { workoutEnergy, newerWorkoutEnergy } from './workout-energy.js'
import { buildCompletedWorkout } from './finish-workout.js'
const measured = { activeKcal: 12.345, basalKcal: 3.21, sampledAt: 1000, final: true }
it('preserves measured precision and distinguishes unavailable resting energy from zero', () => {
  expect(workoutEnergy(measured)).toEqual(measured)
  expect(workoutEnergy({ ...measured, basalKcal: undefined })).not.toHaveProperty('basalKcal')
  expect(workoutEnergy({ ...measured, basalKcal: 0 }).basalKcal).toBe(0)
})
it('rejects nonfinite, negative, missing or coerced energy values', () => {
  for (const activeKcal of [undefined, null, '12', NaN, Infinity, -1]) expect(workoutEnergy({ ...measured, activeKcal })).toBeNull()
  expect(workoutEnergy({ ...measured, sampledAt: 0 })).toBeNull()
})
it('does not downgrade finalized energy or accept delayed older samples', () => {
  expect(newerWorkoutEnergy(measured, { ...measured, sampledAt: 900 })).toBeNull()
  expect(newerWorkoutEnergy(measured, { ...measured, final: false, sampledAt: 1100 })).toBeNull()
  expect(newerWorkoutEnergy({ ...measured, final: false }, { ...measured, sampledAt: 1100 })).toEqual({ ...measured, sampledAt: 1100 })
})
it('keeps measured energy when finishing a session without inventing energy for phone-only sessions', () => {
  const active = { id: 'one', start: 1, entries: [], healthMetrics: measured }
  expect(buildCompletedWorkout(active).healthMetrics).toEqual(measured)
  expect(buildCompletedWorkout({ ...active, healthMetrics: undefined })).not.toHaveProperty('healthMetrics')
})
