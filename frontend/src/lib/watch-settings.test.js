// @vitest-environment happy-dom
// Settings → Apple Watch: this phone's choices for its watch, per device, never in the profile.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readWatchPrefs, writeWatchPrefs, settingsForWatch, readWatchStatus, writeWatchStatus, onWatchPrefs, WATCH_DEFAULTS, SHOW_DEFAULTS } from './watch-settings.js'
import { applyEvents, bindWatchAppActions, _resetWatchSync } from './watch-sync.js'

beforeEach(() => { localStorage.clear(); _resetWatchSync() })

describe('the choices', () => {
  it('start from the defaults and keep what is set, nothing else', () => {
    expect(readWatchPrefs()).toEqual({ ...WATCH_DEFAULTS })
    const seen = vi.fn()
    onWatchPrefs(seen)
    expect(writeWatchPrefs({ autoShow: false, crown: 'weight', junk: 1, health: true })).toEqual({ enabled: true, autoShow: false, restHaptics: true, crown: 'weight', show: { ...SHOW_DEFAULTS } })
    expect(readWatchPrefs().crown).toBe('weight')
    expect(seen).toHaveBeenCalled()
    localStorage.setItem('gym_watch_v1', '{broken')
    expect(readWatchPrefs()).toEqual({ ...WATCH_DEFAULTS })
  })

  it('go to the watch as its settings, and live outside the profile', () => {
    writeWatchPrefs({ restHaptics: false })
    expect(settingsForWatch()).toEqual({ health: false, restHaptics: false, crown: 'reps', show: { ...SHOW_DEFAULTS } })
    // Apple Health on the watch is the phone's Apple Health switch, whatever an older build stored.
    localStorage.setItem('gym_watch_v1', JSON.stringify({ health: true }))
    expect(settingsForWatch().health).toBe(false)
    expect(settingsForWatch(readWatchPrefs(), true).health).toBe(true)
    expect(localStorage.getItem('gym_state_v1')).toBeNull()
  })
})

describe('what the watch says about itself', () => {
  it('is kept for the page, whatever else waits in the queue', () => {
    bindWatchAppActions({ start: vi.fn(), patchSet: vi.fn() })
    expect(applyEvents([{ id: 's1', type: 'watchStatus', health: 'denied', version: '1.4.2', at: 5 }], () => ({ S: { active: null } }))).toEqual(['s1'])
    expect(readWatchStatus()).toEqual({ health: 'denied', version: '1.4.2', at: 5 })
    writeWatchStatus({ health: 'weird' })
    expect(readWatchStatus().health).toBeNull()
  })
})

describe('what the watch shows', () => {
  it('starts clean (animation, heart rate, last time, next exercise, the ring; no clock, no calories)', () => {
    expect(readWatchPrefs().show).toEqual({ clip: true, hr: true, last: true, elapsed: false, kcal: false, next: true, rest: 'ring' })
  })
  it('changes one choice at a time, keeps the rest, and drops what it does not know', () => {
    writeWatchPrefs({ show: { kcal: true } })
    writeWatchPrefs({ show: { clip: false, rest: 'plain', bogus: 1 } })
    expect(readWatchPrefs().show).toEqual({ clip: false, hr: true, last: true, elapsed: false, kcal: true, next: true, rest: 'plain' })
    expect(settingsForWatch().show).toEqual(readWatchPrefs().show)
    localStorage.setItem('gym_watch_v1', JSON.stringify({ show: { hr: 'yes', rest: 'spiral' } }))
    expect(readWatchPrefs().show).toEqual({ ...SHOW_DEFAULTS })
  })
})
