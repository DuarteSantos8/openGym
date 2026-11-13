import { test, expect, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const profile = () => ({ unit: 'kg', workouts: [], routines: [{ id: 'r', name: 'Push', ex: [], futureField: 42 }], futureSetting: { answer: 42 } })
test('MCP disk reader preserves unknown profile and known-collection fields', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ep01-mcp-'))
  const watch = vi.spyOn(fs, 'watch').mockImplementation(() => { throw new Error('no watcher in fixture') })
  try {
    fs.writeFileSync(path.join(dir, 'state-probe.json'), JSON.stringify(profile()))
    vi.stubEnv('OPENGYM_DATA', dir); vi.stubEnv('OPENGYM_UID', 'probe'); vi.resetModules()
    const { getState } = await import('../src/state.js')
    expect(getState()).toMatchObject(profile())
  } finally { watch.mockRestore(); vi.unstubAllEnvs(); vi.resetModules(); fs.rmSync(dir, { recursive: true, force: true }) }
})
test('log_workout preserves unknown fields through GET, 409 rebuild and PUT', async () => {
  const { logWorkout, _resetWriteWindow } = await import('../src/write-tools.js')
  const { _seedStateForTests } = await import('../src/state.js')
  _seedStateForTests(profile()); _resetWriteWindow()
  const puts = []
  const fetchImpl = async (url, opts) => {
    if (url.endsWith('/api/me')) return new Response(JSON.stringify({ user: { id: 'test-uid' } }))
    if (opts.method === 'GET') return new Response(JSON.stringify({ state: profile(), rev: 1 }))
    const body = JSON.parse(opts.body); puts.push(body)
    if (puts.length === 1) return new Response(JSON.stringify({ state: { ...profile(), futureSetting: { answer: 43 } }, rev: 2 }), { status: 409 })
    return new Response(JSON.stringify({ rev: 3 }))
  }
  const result = await logWorkout.handler({ exercises: [{ exercise: 'dumbbell curl', sets: [{ reps: 12, weight: 12 }] }] },
    { env: { OPENGYM_URL: 'https://example.invalid', OPENGYM_TOKEN: 'synthetic' }, fetchImpl })
  expect(result.logged).toBe(true); expect(puts).toHaveLength(2)
  expect(puts[0].state.futureSetting).toEqual({ answer: 42 })
  expect(puts[1].state.futureSetting).toEqual({ answer: 43 })
  for (const p of puts) expect(p.state.routines[0].futureField).toBe(42)
})
