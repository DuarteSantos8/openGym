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
    expect(z.object(createRoutineTool.schema).safeParse({ name: 'Warm-up', exercises: [{ exercise: 'treadmill', minutes: 10, speed: 0 }] }).success).toBe(false)
  })
})

test('published MCP tool descriptions expose the cardio fields to clients', async () => {
  const { buildServer } = await import('../src/server.js')
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js')
  const server = buildServer()
  const client = new Client({ name: 'routine-schema-test', version: '1' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  try {
    const tools = (await client.listTools()).tools
    for (const name of ['create_routine', 'update_routine']) {
      const tool = tools.find(item => item.name === name)
      const props = tool.inputSchema.properties
      expect(props.speed_unit).toBeDefined()
      expect(props.exercises.items.properties.minutes.description).toContain('whole')
      expect(props.exercises.items.properties.speed.description).toContain('Positive')
      expect(props.exercises.items.properties.incline.description).toContain('Distance-mode')
      expect(tool.description).toContain('numeric targets')
    }
    expect(tools.find(item => item.name === 'get_routine').description).toContain('minutes')
  } finally {
    await client.close()
    await server.close()
  }
})

describe('rep range, policy, supersets and bands in the routine schema (#1257, #1258, #1371)', () => {
  test('create and update accept them, and refuse what is not a rule', () => {
    const exercises = [
      { exercise: 'bench press', reps_min: 8, reps: 12, policy: 'double', superset: 'A' },
      { exercise: '0784', bands: ['Red'], superset: 'A' },
    ]
    expect(z.object(createRoutineTool.schema).parse({ name: 'Home', policy: 'triple', exercises })).toMatchObject({ policy: 'triple', exercises })
    expect(z.object(updateRoutineTool.schema).parse({ routine_id: 'r1', policy: 'default', exercises })).toMatchObject({ policy: 'default', exercises })
    expect(z.object(createRoutineTool.schema).safeParse({ name: 'X', exercises: [{ exercise: 'squat', policy: 'sometimes' }] }).success).toBe(false)
    expect(z.object(createRoutineTool.schema).safeParse({ name: 'X', policy: 'time', exercises: [{ exercise: 'squat' }] }).success).toBe(false)
  })
  test('update_routine with only a policy is a change', async () => {
    // No api configured: anything past the "nothing to change" guard fails on the missing token.
    await expect(updateRoutineTool.handler({ routine_id: 'r1', policy: 'double' }, { env: {} })).rejects.toThrow()
    expect(await updateRoutineTool.handler({ routine_id: 'r1' }, { env: {} })).toMatchObject({ saved: false })
  })
})
