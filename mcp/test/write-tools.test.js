import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { z } from 'zod'
import { _seedStateForTests } from '../src/state.js'
import { createTrainingPlan, searchExercises, listExercises, editRoutine, deleteRoutine } from '../src/write-tools.js'
import { allExercises } from '../../frontend/src/lib/exercises.js'

const existing = () => ({
  _rev: 4, _ts: 100, workouts: [{ id: 'w1', d: '2026-09-01' }],
  routines: [{ id: 'old', name: 'Existing', ex: [{ id: '0001', sets: 3, reps: 8 }] }],
  week: { 1: 'old', 3: 'old' }, bodyweight: [{ d: '2026-09-01', w: 80 }]
})
const json = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data })
const input = {
  routines: [{ name: 'New Push', exercises: [{ id: '0001', sets: 3, reps: 10, weight: 40, rest_sec: 90 }] }],
  weekdays: [{ weekday: 1, routine_indexes: [0] }]
}

beforeEach(() => {
  _seedStateForTests(existing())
  process.env.OPENGYM_API_TOKEN = 'test-paired-token'
  process.env.OPENGYM_API_URL = 'http://127.0.0.1:8080'
})
afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.OPENGYM_API_TOKEN
  delete process.env.OPENGYM_API_URL
})

describe('ChatGPT plan tools', () => {
  function mockState(before = existing()) {
    let sent
    const calls = vi.fn(async (url, options) => {
      if (String(url).endsWith('/api/me')) return json({ user: { id: 'test-uid' } })
      if (options.method === 'GET') return json({ state: before, rev: 4 })
      sent = JSON.parse(options.body)
      return json({ ok: true, rev: 5 })
    })
    vi.stubGlobal('fetch', calls)
    return { calls, saved: () => sent }
  }

  test('lists the complete catalogue across pages, including custom exercises', () => {
    const state = { ...existing(), customEx: [{ id: 'custom-1', n: 'My exercise', bp: 'chest', eq: 'band' }] }
    _seedStateForTests(state)
    const ids = []
    let offset = 0
    do {
      const page = listExercises.handler({ offset, limit: 200 })
      expect(page.total).toBe(allExercises(state).length)
      ids.push(...page.exercises.map(ex => ex.id))
      offset = page.next_offset
    } while (offset !== null)
    expect(ids).toEqual(allExercises(state).map(ex => ex.id))
    expect(listExercises.handler({ offset: ids.length + 10 }).exercises).toEqual([])
    expect(listExercises.handler({ offset: ids.length }).next_offset).toBeNull()
  })

  test('renames a routine without changing its configuration or history', async () => {
    const before = existing(), mock = mockState(before)
    const result = await editRoutine.handler(z.object(editRoutine.schema).parse({ routine_id: 'old', name: 'Renamed', policy: 'off' }))
    const saved = mock.saved()
    expect(result.rev).toBe(5)
    expect(saved.baseRev).toBe(4)
    expect(saved.state.routines[0]).toEqual({ ...before.routines[0], name: 'Renamed', prog: 'off' })
    expect(saved.state.workouts).toEqual(before.workouts)
    expect(saved.state.week).toEqual(before.week)
  })

  test('replaces exercise order, preserves retained settings and cleans orphan supersets', async () => {
    const before = existing()
    before.routines[0].ex = [
      { id: '0001', mode: 'reps', sets: 3, reps: 8, weight: 40, prog: 'double', inc: 2, sg: 'pair' },
      { id: '0027', mode: 'reps', sets: 3, reps: 8, sg: 'pair' }
    ]
    const mock = mockState(before)
    await editRoutine.handler({ routine_id: 'old', exercises: [{ id: '0001', mode: 'time', sets: 2, sec: 30, rest_sec: 0 }] })
    expect(mock.saved().state.routines[0].ex).toEqual([
      { id: '0001', mode: 'time', sets: 2, sec: 30, weight: 40, prog: 'double', inc: 2 }
    ])
  })

  test('deletes routine and scalar/combined schedule references while preserving history', async () => {
    const before = existing()
    before.routines.push({ id: 'other', name: 'Other', ex: [] })
    before.week = { 1: 'old', 2: ['old', 'other'], 3: ['other'], 4: ['old'] }
    before.dayPlan = { '2026-09-02': 'old', '2026-09-03': 'other', '2026-09-04': 'rest' }
    const mock = mockState(before)
    const result = await deleteRoutine.handler({ routine_id: 'old' })
    expect(result.changed_weekdays).toEqual([1, 2, 4])
    expect(result.changed_dates).toEqual(['2026-09-02'])
    expect(mock.saved().state.routines).toEqual([before.routines[1]])
    expect(mock.saved().state.week).toEqual({ 2: ['other'], 3: ['other'] })
    expect(mock.saved().state.dayPlan).toEqual({ '2026-09-03': 'other', '2026-09-04': 'rest' })
    expect(mock.saved().state.workouts).toEqual(before.workouts)
    expect(mock.saved().state.bodyweight).toEqual(before.bodyweight)
  })

  test('rejects empty edits, missing routines, and unknown or duplicate exercises without a PUT', async () => {
    const mock = mockState()
    await expect(editRoutine.handler({ routine_id: 'old' })).rejects.toMatchObject({ code: 'EINVAL' })
    await expect(editRoutine.handler({ routine_id: 'missing', name: 'New' })).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(deleteRoutine.handler({ routine_id: 'missing' })).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(editRoutine.handler({ routine_id: 'old', exercises: [{ id: 'nope', sets: 3, reps: 8 }] })).rejects.toMatchObject({ code: 'EINVAL' })
    await expect(editRoutine.handler({ routine_id: 'old', exercises: [{ id: '0001', sets: 3, reps: 8 }, { id: '0001', sets: 2, reps: 5 }] })).rejects.toMatchObject({ code: 'EINVAL' })
    expect(mock.calls.mock.calls.every(([, options]) => options.method !== 'PUT')).toBe(true)
  })

  test('deletion retries against fresh state and keeps concurrent routines and workouts', async () => {
    let gets = 0, puts = 0, sent
    const fresh = existing()
    fresh.routines.push({ id: 'new', name: 'Concurrent', ex: [] })
    fresh.workouts.push({ id: 'w2', d: '2026-09-02' })
    vi.stubGlobal('fetch', vi.fn(async (url, options) => {
      if (String(url).endsWith('/api/me')) return json({ user: { id: 'test-uid' } })
      if (options.method === 'GET') return json({ state: gets++ ? fresh : existing(), rev: gets + 3 })
      sent = JSON.parse(options.body)
      return ++puts === 1 ? json({ error: 'conflict' }, 409) : json({ rev: 6 })
    }))
    await deleteRoutine.handler({ routine_id: 'old' })
    expect(puts).toBe(2)
    expect(sent.state.routines).toEqual([fresh.routines[1]])
    expect(sent.state.workouts).toEqual(fresh.workouts)
  })

  test('exercise search returns real IDs without touching the API', () => {
    const found = searchExercises.handler({ query: 'barbell bench press', limit: 10 })
    expect(found.exercises.length).toBeGreaterThan(0)
    expect(found.exercises[0].id).toMatch(/^\d+$/)
  })

  test('adds routines and patches one weekday while preserving the rest of state', async () => {
    const before = existing()
    let sent
    vi.stubGlobal('fetch', vi.fn(async (url, options) => {
      if (String(url).endsWith('/api/me')) return json({ user: { id: 'test-uid' } })
      if (options.method === 'GET') return json({ state: before, rev: 4 })
      sent = JSON.parse(options.body)
      return json({ ok: true, rev: 5 })
    }))
    const args = z.object(createTrainingPlan.schema).parse(input)
    const result = await createTrainingPlan.handler(args)
    expect(result.rev).toBe(5)
    expect(sent.baseRev).toBe(4)
    expect(sent.state.workouts).toEqual(before.workouts)
    expect(sent.state.bodyweight).toEqual(before.bodyweight)
    expect(sent.state.routines[0]).toEqual(before.routines[0])
    expect(sent.state.routines[1].name).toBe('New Push')
    expect(sent.state.routines[1].ex).toEqual([{ id: '0001', mode: 'reps', sets: 3, reps: 10, weight: 40, restSec: 90 }])
    expect(sent.state.week[1]).toEqual([sent.state.routines[1].id])
    expect(sent.state.week[3]).toBe('old')
    expect(sent.state._ts).toBeGreaterThan(before._ts)
  })

  test('refuses a token for a different OpenGym profile', async () => {
    const calls = vi.fn(async () => json({ user: { id: 'someone-else' } }))
    vi.stubGlobal('fetch', calls)
    await expect(createTrainingPlan.handler(input)).rejects.toMatchObject({ code: 'EAUTH' })
    expect(calls).toHaveBeenCalledTimes(1)
  })

  test('unknown exercise IDs fail before any PUT', async () => {
    const calls = vi.fn(async (url) => String(url).endsWith('/api/me')
      ? json({ user: { id: 'test-uid' } }) : json({ state: existing(), rev: 4 }))
    vi.stubGlobal('fetch', calls)
    await expect(createTrainingPlan.handler({ routines: [{ name: 'Bad', exercises: [{ id: 'not-real', sets: 3, reps: 10 }] }] })).rejects.toMatchObject({ code: 'EINVAL' })
    expect(calls).toHaveBeenCalledTimes(2)
  })

  test('retries a revision conflict against fresh state', async () => {
    let gets = 0, puts = 0
    vi.stubGlobal('fetch', vi.fn(async (url, options) => {
      if (String(url).endsWith('/api/me')) return json({ user: { id: 'test-uid' } })
      if (options.method === 'GET') return json({ state: { ...existing(), _rev: 4 + gets++ }, rev: 3 + gets })
      puts++
      return puts === 1 ? json({ error: 'conflict' }, 409) : json({ ok: true, rev: 6 })
    }))
    const result = await createTrainingPlan.handler(input)
    expect(puts).toBe(2)
    expect(result.rev).toBe(6)
  })
})
