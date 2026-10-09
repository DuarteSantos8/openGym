import { describe, expect, it } from 'vitest'
import {
  createIntervalFlow,
  isIntervalDone,
  currentIntervalDuration,
  advanceInterval,
  intervalStateFromRoutine,
  completedIntervalExercises,
  INTERVAL_PHASE_WORK,
  INTERVAL_PHASE_REST,
  INTERVAL_PHASE_DONE,
} from './intervalFlow.js'

describe('intervalFlow', () => {
  it('starts at the first exercise of the first round', () => {
    const flow = createIntervalFlow({
      rounds: 2,
      exerciseCount: 3,
      workSec: 30,
      restSec: 15,
    })

    expect(flow).toMatchObject({
      round: 0,
      exercise: 0,
      phase: 'work',
      rounds: 2,
      exerciseCount: 3,
      workSec: 30,
      restSec: 15,
    })

    expect(currentIntervalDuration(flow)).toBe(30)
    expect(isIntervalDone(flow)).toBe(false)
  })

  it('moves from work to rest', () => {
    const flow = createIntervalFlow({
      rounds: 1,
      exerciseCount: 2,
      workSec: 30,
      restSec: 15,
    })

    const next = advanceInterval(flow)

    expect(next).toMatchObject({
      round: 0,
      exercise: 0,
      phase: 'rest',
    })

    expect(currentIntervalDuration(next)).toBe(15)
  })

  it('moves from rest to the next exercise', () => {
    const flow = createIntervalFlow({
      rounds: 1,
      exerciseCount: 2,
      workSec: 30,
      restSec: 15,
    })

    const next = advanceInterval(advanceInterval(flow))

    expect(next).toMatchObject({
      round: 0,
      exercise: 1,
      phase: 'work',
    })
  })

  it('starts the next round after the last exercise rest', () => {
    const config = {
      rounds: 2,
      exerciseCount: 2,
      workSec: 30,
      restSec: 15,
    }

    let flow = createIntervalFlow(config)

    flow = advanceInterval(flow) // work 1 -> rest 1
    flow = advanceInterval(flow) // rest 1 -> work 2
    flow = advanceInterval(flow) // work 2 -> rest 2
    flow = advanceInterval(flow) // rest 2 -> round 2

    expect(flow).toMatchObject({
      round: 1,
      exercise: 0,
      phase: 'work',
    })
  })

  it('finishes after the final rest', () => {
    const config = {
      rounds: 1,
      exerciseCount: 2,
      workSec: 30,
      restSec: 15,
    }

    let flow = createIntervalFlow(config)

    flow = advanceInterval(flow) // work 1 -> rest 1
    flow = advanceInterval(flow) // rest 1 -> work 2
    flow = advanceInterval(flow) // work 2 -> rest 2
    flow = advanceInterval(flow) // rest 2 -> done

    expect(flow.phase).toBe('done')
    expect(isIntervalDone(flow)).toBe(true)
    expect(currentIntervalDuration(flow)).toBe(0)
  })

  it('allows zero rest', () => {
    const flow = createIntervalFlow({
      rounds: 1,
      exerciseCount: 2,
      workSec: 30,
      restSec: 0,
    })

    const next = advanceInterval(flow)

    expect(next.phase).toBe('rest')
    expect(currentIntervalDuration(next)).toBe(0)
  })
})

describe('intervalStateFromRoutine', () => {
  it('builds interval state from an interval routine', async () => {
    const { intervalStateFromRoutine } = await import('./intervalFlow.js')

    const flow = intervalStateFromRoutine({
      id: 'hiit',
      type: 'interval',
      interval: {
        rounds: 4,
        workSec: 30,
        restSec: 15,
      },
      ex: [
        { id: 'burpees' },
        { id: 'squats' },
        { id: 'pushups' },
      ],
    })

    expect(flow).toMatchObject({
      round: 0,
      exercise: 0,
      phase: 'work',
      rounds: 4,
      exerciseCount: 3,
      workSec: 30,
      restSec: 15,
    })
  })

  it('returns null for a normal routine', async () => {
    const { intervalStateFromRoutine } = await import('./intervalFlow.js')

    expect(intervalStateFromRoutine({
      id: 'normal',
      ex: [{ id: 'squat' }],
    })).toBeNull()
  })

  it('returns null for an interval routine without exercises', async () => {
    const { intervalStateFromRoutine } = await import('./intervalFlow.js')

    expect(intervalStateFromRoutine({
      id: 'empty',
      type: 'interval',
      interval: {
        rounds: 4,
        workSec: 30,
        restSec: 15,
      },
      ex: [],
    })).toBeNull()
  })
})

it('counts completed work intervals', () => {
  expect(completedIntervalExercises({
    round: 0,
    exercise: 0,
    phase: INTERVAL_PHASE_WORK,
    rounds: 4,
    exerciseCount: 3,
  })).toBe(0)

  expect(completedIntervalExercises({
    round: 0,
    exercise: 0,
    phase: INTERVAL_PHASE_REST,
    rounds: 4,
    exerciseCount: 3,
  })).toBe(1)

  expect(completedIntervalExercises({
    round: 1,
    exercise: 1,
    phase: INTERVAL_PHASE_WORK,
    rounds: 4,
    exerciseCount: 3,
  })).toBe(4)

  expect(completedIntervalExercises({
    round: 1,
    exercise: 1,
    phase: INTERVAL_PHASE_REST,
    rounds: 4,
    exerciseCount: 3,
  })).toBe(5)

  expect(completedIntervalExercises({
    round: 3,
    exercise: 2,
    phase: INTERVAL_PHASE_DONE,
    rounds: 4,
    exerciseCount: 3,
  })).toBe(12)
})
