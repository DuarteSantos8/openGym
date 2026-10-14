import { test, expect } from 'vitest'
import { z } from 'zod'
import { createTrainingTools } from '../src/tools.js'
import { createNutritionTools } from '../src/nutrition.js'
import http from 'node:http'
import { createHttpMcp } from '../src/http.js'

test('request-scoped training preserves same-ID custom exercise ownership', async () => {
  const state = name => ({ unit: 'kg', routines: [{ id: 'r', name: 'Routine', ex: [{ id: 'custom', sets: 3, reps: 8 }] }],
    customEx: [{ id: 'custom', n: name, bp: 'chest' }], workouts: [] })
  const alice = createTrainingTools({ getState: () => state('Alice exercise') })
  const bob = createTrainingTools({ getState: () => state('Bob exercise') })
  const routine = tools => tools.find(tool => tool.name === 'get_routine').handler({ routine_id: 'r' })
  const [first, second] = await Promise.all([Promise.resolve().then(() => routine(alice)), Promise.resolve().then(() => routine(bob))])
  expect(first.exercises[0].name).toBe('Alice exercise')
  expect(second.exercises[0].name).toBe('Bob exercise')
  expect(routine(alice).exercises[0].name).toBe('Alice exercise')
})

test('HTTP MCP validates writes and reports unknown outcomes without changing retry IDs', async ({ onTestFinished }) => {
  let entrance
  const listener = http.createServer((req, res) => entrance.handle(req, res))
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${listener.address().port}`
  const calls = []
  let failure = { code: 'nutrition_unavailable', status: 503, uncertain: true }
  const principal = { user: { id: 'alice' }, clientId: 'client', scopes: ['nutrition.write'] }
  entrance = createHttpMcp({ oauth: { resource: new URL(base + '/mcp'),
    verify: async () => principal, nutritionCredential: () => 'ogn.internal' }, readState: () => null,
    takeBudget: () => 0, json: (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) },
    requestNutrition: async (...args) => { calls.push(args); throw Object.assign(new Error('Upstream failed'), failure) } })
  onTestFinished(async () => { await entrance.close(); listener.closeAllConnections(); await new Promise(resolve => listener.close(resolve)) })
  const rpc = async args => {
    const response = await fetch(base + '/mcp', { method: 'POST', headers: { Authorization: 'Bearer test',
      'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'nutrition_create_entry', arguments: args } }) })
    expect(response.status).toBe(200)
    const text = await response.text()
    return JSON.parse(response.headers.get('content-type')?.startsWith('text/event-stream') ? /^data: (.+)$/m.exec(text)[1] : text)
  }
  const args = { entry_id: 'a164d2ef-8b28-4db5-93ac-f06b721ef935', product_id: '397b3f7a-1d7e-441d-8d5c-dcce22c1ba84',
    quantity_grams: 200, date: '2026-10-13' }
  const invalid = await rpc({ ...args, quantity_grams: 0 })
  expect(invalid.result.isError).toBe(true)
  expect(calls).toHaveLength(0)
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await rpc(args)
    expect(result.result.isError).toBe(true)
    expect(result.result.structuredContent).toEqual({ code: 'nutrition_unavailable', status: 503, outcome: 'unknown', retry_same_id: true })
  }
  expect(calls).toHaveLength(2)
  expect(calls[0]).toEqual(['POST', '/api/nutrition/entries', {}, { id: args.entry_id, productId: args.product_id,
    quantityGrams: 200, date: args.date, time: null }, 'ogn.internal'])
  expect(calls[1]).toEqual(calls[0])
  failure = { code: 'idempotency_conflict', status: 409 }
  const conflict = await rpc(args)
  expect(conflict.result.structuredContent).toEqual({ code: 'idempotency_conflict', status: 409 })
})

test('Nutrition tools preserve API payloads, retry IDs and historical snapshots', async () => {
  const calls = []
  const tools = createNutritionTools(async (...args) => { calls.push(args); return { id: 'saved' } })
  const call = (name, args) => {
    const tool = tools.find(tool => tool.name === name)
    return tool.handler(z.object(tool.schema).strict().parse(args))
  }
  const id = 'a164d2ef-8b28-4db5-93ac-f06b721ef935'
  const product = '397b3f7a-1d7e-441d-8d5c-dcce22c1ba84'
  const payload = { entry_id: id, product_id: product, quantity_grams: 200.125, date: '2026-10-13', time: '08:30' }
  await call('nutrition_create_entry', payload)
  await call('nutrition_create_entry', payload)
  expect(calls[0]).toEqual(['POST', '/api/nutrition/entries', {}, {
    id, productId: product, quantityGrams: 200.125, date: '2026-10-13', time: '08:30'
  }])
  expect(calls[1]).toEqual(calls[0])
  await call('nutrition_update_entry', { entry_id: id, quantity_grams: 100, date: '2026-10-13' })
  expect(calls[2][3].productId).toBeNull()
  await call('nutrition_update_entry', payload)
  expect(calls[3][3].productId).toBe(product)
  await call('nutrition_search_products', { search: 'rice', offset: 50 })
  expect(calls[4]).toEqual(['GET', '/api/nutrition/products', { search: 'rice', offset: 50 }])
  await call('nutrition_get_product', { product_id: product })
  expect(calls[5]).toEqual(['GET', '/api/nutrition/products/' + product])
  await call('nutrition_get_diary', { date: '2026-10-13' })
  expect(calls[6]).toEqual(['GET', '/api/nutrition/diary', { date: '2026-10-13' }])
  await call('nutrition_get_entry', { entry_id: id })
  expect(calls[7]).toEqual(['GET', '/api/nutrition/entries/' + id])
  expect(() => call('nutrition_delete_entry', { entry_id: id })).toThrow()
  await call('nutrition_delete_entry', { entry_id: id, confirmed: true })
  expect(calls[8]).toEqual(['DELETE', '/api/nutrition/entries/' + id])
  expect(() => call('nutrition_create_entry', { ...payload, date: '2026-02-30' })).toThrow()
  expect(() => call('nutrition_create_entry', { ...payload, quantity_grams: 0 })).toThrow()
  expect(() => call('nutrition_create_entry', { ...payload, quantity_grams: 2.1234 })).toThrow()
  expect(() => call('nutrition_get_entry', { entry_id: id, user_id: 'bob' })).toThrow()
})
