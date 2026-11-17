// @vitest-environment happy-dom
// Settings → Apple Watch: this phone's choices for its watch, per device, never in the profile.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readWatchPrefs, writeWatchPrefs, settingsForWatch, readWatchStatus, writeWatchStatus, onWatchPrefs, WATCH_DEFAULTS, SHOW_DEFAULTS, readWatchHeard, noteWatchHeard, lastHeardAt, routinesSync, noteRoutinesSent, readRoutinesSent } from './watch-settings.js'
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
  it('starts clean (animation, heart rate, last time, next exercise, the ring, calories)', () => {
    expect(readWatchPrefs().show).toEqual({ clip: true, hr: true, last: true, kcal: true, next: true, zones: true, rest: 'ring' })
  })
  it('changes one choice at a time, keeps the rest, and drops what it does not know', () => {
    writeWatchPrefs({ show: { kcal: false } })
    writeWatchPrefs({ show: { clip: false, zones: false, rest: 'plain', bogus: 1 } })
    expect(readWatchPrefs().show).toEqual({ clip: false, hr: true, last: true, kcal: false, next: true, zones: false, rest: 'plain' })
    expect(settingsForWatch().show).toEqual(readWatchPrefs().show)
    localStorage.setItem('gym_watch_v1', JSON.stringify({ show: { hr: 'yes', rest: 'spiral' } }))
    expect(readWatchPrefs().show).toEqual({ ...SHOW_DEFAULTS })
  })
})

// #1151: "Last heard from the watch" was the watch's status, sent when its app starts, so a watch
// logging sets for an hour still read "an hour ago". Now its newest event that reached the phone
// counts too, by the time it was made at the wrist (never later than that, never in the future).
describe('when the watch was last heard from', () => {
  const T = 1_800_000_000_000
  it('its newest event applied here counts, by its own time, never in the future', () => {
    writeWatchStatus({ health: 'on', version: '1.4.5', at: T - 3600e3 })
    expect(lastHeardAt()).toBe(T - 3600e3)
    bindWatchAppActions({})
    applyEvents([{ id: 'h1', type: 'stillHere', wid: 'w0', at: T - 60_000 }], () => ({ S: { active: null, workouts: [] } }), T)
    expect(readWatchHeard()).toBe(T - 60_000)
    expect(lastHeardAt()).toBe(T - 60_000)
    noteWatchHeard(T - 120_000, T)
    expect(readWatchHeard()).toBe(T - 60_000)
    noteWatchHeard(T + 60_000, T)
    expect(readWatchHeard()).toBe(T)
    // a newer status still wins, and a status never loses to an event (its own check is untouched)
    writeWatchStatus({ health: 'on', version: '1.4.5', at: T + 10 })
    expect(lastHeardAt()).toBe(T + 10)
  })
})

describe('whether the watch has the routines', () => {
  const link = { paired: true, installed: true }
  const phone = { hash: 'h1', count: 20 }
  const status = (over = {}) => ({ at: 5, routinesHash: 'h1', routinesCount: 20, ...over })
  it('synced when the watch shows the file the phone has, with as many routines', () => {
    expect(routinesSync({ link, phone, status: status() })).toBe('synced')
  })
  it('sending while the watch shows another file, the snapshot fallback (no hash) or fewer routines', () => {
    expect(routinesSync({ link, phone, status: status({ routinesHash: 'h0' }) })).toBe('sending')
    expect(routinesSync({ link, phone, status: status({ routinesHash: '' }) })).toBe('sending')
    expect(routinesSync({ link, phone, status: status({ routinesCount: 16 }) })).toBe('sending')
    expect(routinesSync({ link, phone, status: null })).toBe('sending')
  })
  it('unknown from a watch app that does not report it', () => {
    expect(routinesSync({ link, phone, status: { at: 5, version: '1.4.5' } })).toBe('unknown')
  })
  it('off (hidden) when the watch is switched off, not paired, without the app, or there is nothing to send', () => {
    expect(routinesSync({ link, phone, status: status(), enabled: false })).toBe('off')
    expect(routinesSync({ link: null, phone, status: status() })).toBe('off')
    expect(routinesSync({ link: { paired: false, installed: false }, phone, status: status() })).toBe('off')
    expect(routinesSync({ link: { paired: true, installed: false }, phone, status: status() })).toBe('off')
    expect(routinesSync({ link, phone: null, status: status() })).toBe('off')
  })
  it('the status keeps what the watch reports, and nothing it does not', () => {
    expect(writeWatchStatus({ health: 'on', version: '1', at: 9, routinesHash: 'h1', routinesCount: 20 })).toMatchObject({ routinesHash: 'h1', routinesCount: 20 })
    const old = writeWatchStatus({ health: 'on', version: '1', at: 9 })
    expect(old).not.toHaveProperty('routinesHash')
    expect(old).not.toHaveProperty('routinesCount')
  })
  it('the phone remembers what it last sent', () => {
    expect(readRoutinesSent()).toBeNull()
    noteRoutinesSent({ hash: 'h1', count: 3 })
    expect(readRoutinesSent()).toEqual({ hash: 'h1', count: 3 })
    noteRoutinesSent(null)
    expect(readRoutinesSent()).toBeNull()
  })
})
