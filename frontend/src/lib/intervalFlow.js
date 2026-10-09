export const INTERVAL_PHASE_WORK = 'work'
export const INTERVAL_PHASE_REST = 'rest'
export const INTERVAL_PHASE_DONE = 'done'

export function createIntervalFlow({
  rounds,
  exerciseCount,
  workSec,
  restSec,
}) {
  const totalRounds = Math.max(1, Number(rounds) || 1)
  const totalExercises = Math.max(1, Number(exerciseCount) || 1)

  return {
    round: 0,
    exercise: 0,
    phase: INTERVAL_PHASE_WORK,
    rounds: totalRounds,
    exerciseCount: totalExercises,
    workSec: Math.max(1, Number(workSec) || 1),
    restSec: Math.max(0, Number(restSec) || 0),
  }
}

export function isIntervalDone(flow) {
  return flow?.phase === INTERVAL_PHASE_DONE
}

export function currentIntervalDuration(flow) {
  if (!flow || isIntervalDone(flow)) return 0
  return flow.phase === INTERVAL_PHASE_WORK
    ? flow.workSec
    : flow.restSec
}

export function advanceInterval(flow) {
  if (!flow || isIntervalDone(flow)) return flow

  if (flow.phase === INTERVAL_PHASE_WORK) {
    return {
      ...flow,
      phase: INTERVAL_PHASE_REST,
    }
  }

  const nextExercise = flow.exercise + 1

  if (nextExercise < flow.exerciseCount) {
    return {
      ...flow,
      exercise: nextExercise,
      phase: INTERVAL_PHASE_WORK,
    }
  }

  const nextRound = flow.round + 1

  if (nextRound < flow.rounds) {
    return {
      ...flow,
      round: nextRound,
      exercise: 0,
      phase: INTERVAL_PHASE_WORK,
    }
  }

  return {
    ...flow,
    phase: INTERVAL_PHASE_DONE,
  }
}

export function intervalStateFromRoutine(routine) {
  if (!routine || routine.type !== 'interval') return null

  const cfg = routine.interval || {}
  const exerciseCount = Array.isArray(routine.ex) ? routine.ex.length : 0

  if (!exerciseCount) return null

  return createIntervalFlow({
    rounds: cfg.rounds,
    exerciseCount,
    workSec: cfg.workSec,
    restSec: cfg.restSec,
  })
}
export function completedIntervalExercises(flow) {
  if (!flow) return 0
  if (flow.phase === INTERVAL_PHASE_DONE) {
    return flow.rounds * flow.exerciseCount
  }

  const base = flow.round * flow.exerciseCount

  return flow.phase === INTERVAL_PHASE_REST
    ? base + flow.exercise + 1
    : base + flow.exercise
}
