// @vitest-environment happy-dom
// The workout's animations go to the watch only while its Animation switch is on: with it off the
// phone converted and sent them, and the watch decoded every frame, for nothing on screen.
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./health-sync.js', () => ({ loadHealth: async () => ({ on: false }), onHealthChange: () => () => {} }))

import { startWatchSync, _setWatchPluginForTest, _resetWatchSync } from './watch-sync.js'
import { writeWatchPrefs } from './watch-settings.js'

beforeEach(() => { localStorage.clear(); _resetWatchSync() })

const store = initial => {
  let st = initial
  return { getState: () => st, setState: patch => { st = { ...st, ...patch } }, subscribe: () => () => {} }
}

describe('animations for the watch', () => {
  it('are not built or sent with the Animation switch off, and go when it is turned on', async () => {
    vi.useFakeTimers()
    try {
      const b = {
        status: vi.fn(async () => ({ paired: true, installed: true })),
        sendSnapshot: vi.fn(async () => ({ sent: true })),
        sendClips: vi.fn(async () => ({})),
        dropClips: vi.fn(async () => ({})),
        drain: vi.fn(async () => ({ events: [] })),
        ack: vi.fn(async () => ({})),
        listeners: {},
        addListener: vi.fn(async function (name, fn) { this.listeners[name] = fn; return { remove: () => {} } }),
      }
      _setWatchPluginForTest(b)
      writeWatchPrefs({ show: { clip: false } })
      const S = { unit: 'kg', workouts: [], routines: [], active: { id: 'w-1', start: Date.now() - 60e3, entries: [{ id: '0025', sets: [{ w: 60, r: 8, done: false }] }] } }
      const stop = await startWatchSync({ useStore: store({ ready: true, S }), useUI: store({ timer: null }) })
      await vi.runAllTimersAsync()
      expect(b.sendSnapshot).toHaveBeenCalled()
      expect(b.sendClips).not.toHaveBeenCalled()
      writeWatchPrefs({ show: { clip: true } })
      await vi.runAllTimersAsync()
      expect(b.sendClips).toHaveBeenCalledTimes(1)
      stop()
    } finally { vi.useRealTimers() }
  })
})
