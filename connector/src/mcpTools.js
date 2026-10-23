import { createReadModel } from './readModel.js'

const TOOLS = [
  ['list_routines', 'listRoutines'],
  ['get_routine', 'getRoutine'],
  ['preview_session', 'previewSession'],
  ['get_week_plan', 'getWeek'],
  ['list_workouts', 'listWorkouts'],
  ['get_workout', 'getWorkout'],
  ['get_bodyweight', 'getBodyweight'],
  ['estimate_1rm', 'estimateOneRm'],
  ['muscle_balance', 'muscleBalance']
]

export function createMcpTools(readProfile) {
  if (typeof readProfile !== 'function') throw new TypeError('readProfile required')
  return TOOLS.map(([name, method]) => ({
    name,
    handler: async (bearer, args = {}) => createReadModel(await readProfile(bearer))[method](args)
  }))
}
