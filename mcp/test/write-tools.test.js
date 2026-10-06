import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { z } from 'zod'
import { _seedStateForTests } from '../src/state.js'
import { createTrainingPlan, searchExercises, listExercises, editRoutine, deleteRoutine, getProfileState, previewExerciseHistoryMerge, mergeExerciseHistory, undoExerciseHistoryMerge } from '../src/write-tools.js'
import { allExercises } from '../../frontend/src/lib/exercises.js'

const existing = () => ({ _rev: 4, routines: [{ id: 'old', name: 'Existing', ex: [] }], workouts: [] })
const json = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data })
const input = { expected_version: 4, routines: [{ name: 'New', exercises: [{ id: '0001', sets: 3, reps: 10 }] }] }
beforeEach(() => {
  _seedStateForTests(existing())
  process.env.OPENGYM_API_TOKEN = 'test-paired-token'
  process.env.OPENGYM_API_URL = 'http://127.0.0.1:8080'
})
afterEach(() => { vi.unstubAllGlobals(); delete process.env.OPENGYM_API_TOKEN; delete process.env.OPENGYM_API_URL })
function mockApi(response = { rev: 5 }, status = 200) {
  const calls = vi.fn(async (url, options) => {
    if (String(url).endsWith('/api/me')) return json({ user: { id: 'test-uid' } })
    if (options.method === 'GET') return json({ state: existing(), rev: 4 })
    return json(response, status)
  })
  vi.stubGlobal('fetch', calls)
  return calls
}
test('reads the API profile and revision used for confirmation', async () => {
  const calls = mockApi()
  expect(await getProfileState.handler({})).toEqual({ state: existing(), state_version: 4 })
  expect(calls).toHaveBeenCalledTimes(2)
})
test('reads local state without a write credential', async () => {
  delete process.env.OPENGYM_API_TOKEN
  expect((await getProfileState.handler({})).state_version).toBe(4)
})
test('forwards operations with the caller-confirmed revision, never a whole profile', async () => {
  const calls = mockApi()
  for (const [tool, operation, args] of [
    [createTrainingPlan, 'create', input],
    [editRoutine, 'edit', { expected_version: 4, routine_id: 'old', name: 'New' }],
    [deleteRoutine, 'delete', { expected_version: 4, routine_id: 'old', confirm: true }]
  ]) {
    const parsed = z.object(tool.schema).parse(args)
    expect((await tool.handler(parsed)).rev).toBe(5)
    const [url, options] = calls.mock.calls.at(-1)
    expect(String(url)).toBe('http://127.0.0.1:8080/api/routines/mutate')
    const { expected_version, ...params } = parsed
    expect(JSON.parse(options.body)).toEqual({ operation, baseRev: expected_version, input: params })
    expect(options.headers.Authorization).toBe('Bearer test-paired-token')
  }
  expect(calls.mock.calls.filter(([, options]) => options.method === 'GET')).toHaveLength(3)
})
test('conflicts return current state and require fresh confirmation without any retry', async () => {
  const fresh = { ...existing(), _rev: 5, workouts: [{ id: 'concurrent' }] }
  const calls = mockApi({ error: 'conflict', rev: 5, state: fresh }, 409)
  await expect(deleteRoutine.handler({ expected_version: 4, routine_id: 'old', confirm: true })).rejects.toMatchObject({ code: 'ECONFLICT', rev: 5, state: fresh })
  expect(calls).toHaveBeenCalledTimes(2)
  expect(calls.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(1)
})
test('creation conflicts are not automatically retried either', async () => {
  const calls = mockApi({ error: 'conflict', rev: 5 }, 409)
  await expect(createTrainingPlan.handler(input)).rejects.toMatchObject({ code: 'ECONFLICT' })
  expect(calls).toHaveBeenCalledTimes(2)
})
test('missing or invalid expected revisions and missing delete confirmation are refused by schemas', async () => {
  for (const revision of [undefined, -1, 1.5, '4', Number.MAX_SAFE_INTEGER + 1]) {
    expect(() => z.object(createTrainingPlan.schema).parse({ ...input, expected_version: revision })).toThrow()
    await expect(createTrainingPlan.handler({ ...input, expected_version: revision })).rejects.toMatchObject({ code: 'EINVAL' })
  }
  expect(() => z.object(deleteRoutine.schema).parse({ expected_version: 4, routine_id: 'old' })).toThrow()
})
test('a token for another selected profile never reads or writes state', async () => {
  const calls = vi.fn(async () => json({ user: { id: 'someone-else' } }))
  vi.stubGlobal('fetch', calls)
  await expect(createTrainingPlan.handler(input)).rejects.toMatchObject({ code: 'EAUTH' })
  await expect(getProfileState.handler({})).rejects.toMatchObject({ code: 'EAUTH' })
  expect(calls).toHaveBeenCalledTimes(2)
})
test('catalogue search and pagination remain local and include custom exercises', () => {
  const state = { ...existing(), customEx: [{ id: 'c1', n: 'My exercise', bp: 'chest' }] }
  _seedStateForTests(state)
  const ids = []; let offset = 0
  do {
    const page = listExercises.handler({ offset, limit: 200 })
    ids.push(...page.exercises.map(ex => ex.id)); offset = page.next_offset
  } while (offset !== null)
  expect(ids).toEqual(allExercises(state).map(ex => ex.id))
  expect(searchExercises.handler({ query: 'barbell bench press' }).exercises.length).toBeGreaterThan(0)
})

describe('history migration tools', () => {
  test('preview and commit call the dedicated API with the confirmed revision', async () => {
    const calls = vi.fn(async (url, options) => String(url).endsWith('/api/me')
      ? json({ user: { id: 'test-uid' } }) : json({ rev: 5, undo_id: 'id', workouts_updated: 1 }))
    vi.stubGlobal('fetch', calls)
    const args = { source_exercise_id: '0001', target_exercise_id: '0027', update_routines: true }
    await previewExerciseHistoryMerge.handler(args)
    expect(JSON.parse(calls.mock.calls[1][1].body)).toEqual({ ...args, dry_run: true })
    await mergeExerciseHistory.handler({ ...args, preview_revision: 4 })
    expect(String(calls.mock.calls[3][0])).toMatch(/api\/history\/merge$/)
    expect(JSON.parse(calls.mock.calls[3][1].body)).toEqual({ ...args, baseRev: 4 })
    await undoExerciseHistoryMerge.handler({ undo_id: 'id', merge_revision: 5 })
    expect(JSON.parse(calls.mock.calls[5][1].body)).toEqual({ undo_id: 'id', baseRev: 5 })
  })
  test('missing preview revision is invalid and stale preview is not retried', async () => {
    expect(() => z.object(mergeExerciseHistory.schema).parse({ source_exercise_id: '0001', target_exercise_id: '0027' })).toThrow()
    const calls = vi.fn(async url => String(url).endsWith('/api/me')
      ? json({ user: { id: 'test-uid' } }) : json({ error: 'conflict' }, 409))
    vi.stubGlobal('fetch', calls)
    await expect(mergeExerciseHistory.handler({ source_exercise_id: '0001', target_exercise_id: '0027', preview_revision: 4 })).rejects.toMatchObject({ code: 'ECONFLICT' })
    expect(calls).toHaveBeenCalledTimes(2)
  })
  test('history calls refuse tokens belonging to another profile', async () => {
    const calls = vi.fn(async () => json({ user: { id: 'someone-else' } }))
    vi.stubGlobal('fetch', calls)
    await expect(previewExerciseHistoryMerge.handler({ source_exercise_id: '0001', target_exercise_id: '0027' })).rejects.toMatchObject({ code: 'EAUTH' })
    expect(calls).toHaveBeenCalledTimes(1)
  })
})
