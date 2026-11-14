// Measured energy only; missing permission/data is not a zero-calorie measurement.
export function workoutEnergy(value) {
  if (!value || typeof value.activeKcal !== 'number' || !Number.isFinite(value.activeKcal) || value.activeKcal < 0 ||
      typeof value.sampledAt !== 'number' || !Number.isFinite(value.sampledAt) || value.sampledAt <= 0 || value.sampledAt > Number.MAX_SAFE_INTEGER) return null
  const result = { activeKcal: value.activeKcal, sampledAt: value.sampledAt, final: value.final === true }
  if (typeof value.basalKcal === 'number' && Number.isFinite(value.basalKcal) && value.basalKcal >= 0) result.basalKcal = value.basalKcal
  return result
}
export function newerWorkoutEnergy(current, incoming) {
  const next = workoutEnergy(incoming), old = workoutEnergy(current)
  if (!next || (old?.final && !next.final) || (old && next.sampledAt <= old.sampledAt)) return null
  return next
}
export const workoutEnergyKey = value => JSON.stringify(workoutEnergy(value))
