import { describe, expect, it, beforeEach, vi } from 'vitest'
import { isoOf } from './format.js'
import { buildReminderNotifications } from './mobile.js'

const push = { id: 'push', name: 'Push' }
const pull = { id: 'pull', name: 'Pull' }
const legs = { id: 'legs', name: 'Legs' }
const state = (patch = {}) => ({
  routines: [push, pull, legs], week: {}, dayPlan: {}, workouts: [],
  reminder: { on: true, time: '08:00' }, ...patch,
})
const iso = d => isoOf(d)

describe('buildReminderNotifications', () => {
  it('expands the weekly baseline into future dated notifications', () => {
    const now = new Date(2026, 5, 1, 7, 0) // Monday
    const notifications = buildReminderNotifications(state({ week: { 1: 'push', 3: 'pull' } }), now)

    expect(notifications.slice(0, 2).map(n => iso(n.schedule.at))).toEqual([
      iso(now), iso(new Date(2026, 5, 3)),
    ])
    expect(notifications[0].body).toContain('Push')
    expect(notifications[0].schedule.allowWhileIdle).toBe(true)
  })

  it('uses rest today and a routine override tomorrow when rescheduling', () => {
    const now = new Date(2026, 5, 1, 7, 0) // Monday
    const today = iso(now), tomorrow = iso(new Date(2026, 5, 2))
    const notifications = buildReminderNotifications(state({
      week: { 1: 'push' }, dayPlan: { [today]: 'rest', [tomorrow]: 'pull' },
    }), now)

    expect(notifications.slice(0, 1).map(n => [iso(n.schedule.at), n.body])).toEqual([
      [tomorrow, expect.stringContaining('Pull')],
    ])
  })

  it('schedules a valid override on a weekly rest day', () => {
    const now = new Date(2026, 5, 1, 7, 0) // Monday
    const wednesday = new Date(2026, 5, 3)
    const notifications = buildReminderNotifications(state({ dayPlan: { [iso(wednesday)]: 'legs' } }), now)

    expect(notifications.some(n => iso(n.schedule.at) === iso(wednesday) && n.body.includes('Legs'))).toBe(true)
  })

  it('suppresses dates that already have a completed workout', () => {
    const now = new Date(2026, 5, 1, 7, 0) // Monday
    const notifications = buildReminderNotifications(state({
      week: { 1: 'push' }, workouts: [{ d: iso(now) }],
    }), now)

    expect(notifications.some(n => iso(n.schedule.at) === iso(now))).toBe(false)
  })

  it("skips today's reminder after the configured local time has passed", () => {
    const now = new Date(2026, 5, 1, 9, 0) // Monday
    const notifications = buildReminderNotifications(state({ week: { 1: 'push' } }), now)

    expect(notifications.some(n => iso(n.schedule.at) === iso(now))).toBe(false)
    expect(notifications.some(n => iso(n.schedule.at) === iso(new Date(2026, 5, 8)))).toBe(true)
  })

  it('names both routines of a combined day, and reads a legacy scalar day the same', () => {
    const now = new Date(2026, 5, 1, 7, 0) // Monday
    const combined = buildReminderNotifications(state({ week: { 1: ['push', 'pull'] } }), now)[0]
    expect(combined.body).toContain('Push + Pull')

    const legacy = buildReminderNotifications(state({ week: { 1: 'push' } }), now)[0]
    expect(legacy.body).toContain('Push')
  })

  it('falls back to a count for three or more routines on one day', () => {
    const now = new Date(2026, 5, 1, 7, 0)
    const n = buildReminderNotifications(state({ week: { 1: ['push', 'pull', 'legs'] } }), now)[0]
    expect(n.body).toContain('3 routines')
  })
})

// Mock setup for active-session tests
const activeBacking = new Map()
const activeImpl = {
  readFile: async ({ path }) => {
    if (path === 'corrupt.json' && activeBacking.has(path)) return { data: JSON.stringify({ corrupt: true }) }
    if (!activeBacking.has(path)) throw new Error('File not found')
    return { data: activeBacking.get(path) }
  },
  writeFile: async ({ path, data }) => {
    activeBacking.set(path, data)
  }
}
const ActiveFilesystem = new Proxy({}, {
  get(_, prop) {
    if (prop === '$$typeof') return undefined
    return (...args) => {
      if (activeImpl[prop]) return activeImpl[prop](...args)
      return Promise.reject(new Error(`Filesystem.${String(prop)}() not implemented`))
    }
  }
})
vi.mock('@capacitor/filesystem', () => ({
  Filesystem: ActiveFilesystem,
  Directory: { Data: 0 },
  Encoding: { UTF8: 'utf8' }
}), { virtual: true })

describe('active-session mirror', () => {
  beforeEach(() => { activeBacking.clear() })

  it('writes and reads the session through the existing JSON file helpers', async () => {
    const { nativeActiveSave, nativeActiveLoad, ACTIVE_FILE } = await import('./mobile.js')
    expect(ACTIVE_FILE).toBe('gym_active_v1.json')
    const session = { id: 'a1', d: '2026-09-22', start: 1, entries: [] }
    await nativeActiveSave(session)
    expect(await nativeActiveLoad()).toEqual(session)
  })

  it('removes nothing and returns null when there is no session', async () => {
    const { nativeActiveSave, nativeActiveLoad } = await import('./mobile.js')
    await nativeActiveSave(null)
    expect(await nativeActiveLoad()).toBe(null)
  })

  it('survives a filesystem failure without throwing', async () => {
    const { nativeActiveLoad } = await import('./mobile.js')
    await expect(nativeActiveLoad()).resolves.not.toThrow()
  })

  it('clears a previously saved session when passed null', async () => {
    const { nativeActiveSave, nativeActiveLoad } = await import('./mobile.js')
    await nativeActiveSave({ id: 'a1', d: '2026-09-22', start: 1, entries: [] })
    await nativeActiveSave(null)
    expect(await nativeActiveLoad()).toBe(null)
  })
})
