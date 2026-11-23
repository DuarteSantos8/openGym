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
      expect(props.exercises.items.properties.speed.description).toContain('speed_unit')
      expect(props.exercises.items.properties.incline.description).toContain('incline-capable')
      expect(tool.description).toContain('numeric targets')
    }
    expect(tools.find(item => item.name === 'get_routine').description).toContain('minutes')
  } finally {
    await client.close()
    await server.close()
  }
})
