import { describe, test, expect } from 'vitest'
import { z } from 'zod'
import { createRoutineTool, updateRoutineTool } from '../src/routine-tools.js'

describe('routine cardio target contract', () => {
  test('create and update accept minutes, speed and incline for cardio slots', () => {
    const exercise = { exercise: 'treadmill', minutes: 10, speed: 3.5, incline: 7 }
    expect(z.object(createRoutineTool.schema).parse({ name: 'Warm-up', exercises: [exercise], speed_unit: 'mph' })).toMatchObject({
      exercises: [exercise], speed_unit: 'mph'
    })
    expect(z.object(updateRoutineTool.schema).parse({ routine_id: 'r1', exercises: [exercise], speed_unit: 'kmh' })).toMatchObject({
      exercises: [exercise], speed_unit: 'kmh'
    })
  })
})
