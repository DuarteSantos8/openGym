import { beforeEach, describe, expect, it, vi } from 'vitest'

/* syncReminder hands what it scheduled to the background check (lib/nudge-check.js), and nothing
   once nothing is scheduled: the check follows the notifications, never the other way round. */
const mocks = vi.hoisted(() => ({ perm: 'granted', schedule: vi.fn(async () => {}), arm: vi.fn(async () => true) }))
vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    cancel: vi.fn(async () => {}),
    checkPermissions: async () => ({ display: mocks.perm }),
    requestPermissions: async () => ({ display: mocks.perm }),
    schedule: (...a) => mocks.schedule(...a),
  }
}))
vi.mock('./nudge-check.js', () => ({ armNudgeCheck: (...a) => mocks.arm(...a) }))

import { syncReminder } from './mobile.js'

const S = reminder => ({ reminder, routines: [{ id: 'push', name: 'Push' }], week: { 0: ['push'], 1: ['push'], 2: ['push'], 3: ['push'], 4: ['push'], 5: ['push'], 6: ['push'] }, workouts: [] })

beforeEach(() => { mocks.perm = 'granted'; mocks.schedule.mockClear(); mocks.arm.mockClear() })

describe('syncReminder and the background check', () => {
  it('hands over exactly what it scheduled', async () => {
    const state = S({ on: true, nudge: true, time: '08:00' })
    expect(await syncReminder(state)).toBe(true)
    const scheduled = mocks.schedule.mock.calls[0][0].notifications
    expect(scheduled.length).toBeGreaterThan(0)
    expect(mocks.arm).toHaveBeenCalledWith(state, scheduled)
  })
  it('the reminder off, or no permission: the check is handed nothing', async () => {
    await syncReminder(S({ on: false }))
    mocks.perm = 'denied'
    await syncReminder(S({ on: true, nudge: true, time: '08:00' }))
    expect(mocks.arm.mock.calls.map(c => c[1])).toEqual([[], []])
    expect(mocks.schedule).not.toHaveBeenCalled()
  })
})
