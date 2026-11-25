// @vitest-environment happy-dom
// Settings → Apple Watch: this phone's choices for its watch, per device, never in the profile.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readWatchPrefs, writeWatchPrefs, settingsForWatch, readWatchStatus, writeWatchStatus, onWatchPrefs, WATCH_DEFAULTS, SHOW_DEFAULTS, HR_REST_DEFAULTS, readWatchHeard, noteWatchHeard, lastHeardAt } from './watch-settings.js'
import { applyEvents, bindWatchAppActions, _resetWatchSync } from './watch-sync.js'

beforeEach(() => { localStorage.clear(); _resetWatchSync() })

describe('the choices', () => {
  it('start from the defaults and keep what is set, nothing else', () => {
    expect(readWatchPrefs()).toEqual({ ...WATCH_DEFAULTS })
    const seen = vi.fn()
    onWatchPrefs(seen)
    expect(writeWatchPrefs({ autoShow: false, crown: 'weight', junk: 1, health: true })).toEqual({ enabled: true, autoShow: false, restHaptics: true, crown: 'weight', show: { ...SHOW_DEFAULTS }, hrRest: { ...HR_REST_DEFAULTS } })
    expect(readWatchPrefs().crown).toBe('weight')
    expect(seen).toHaveBeenCalled()
    localStorage.setItem('gym_watch_v1', '{broken')
    expect(readWatchPrefs()).toEqual({ ...WATCH_DEFAULTS })
  })

  it('go to the watch as its settings, and live outside the profile', () => {
    writeWatchPrefs({ restHaptics: false })
    expect(settingsForWatch()).toEqual({ health: false, restHaptics: false, crown: 'reps', show: { ...SHOW_DEFAULTS }, hrRest: { on: false, bpm: null } })
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

// "Ready by heart rate": during a rest, once the pulse is back down, the watch says so. Off to begin
// with; the target is a fixed bpm or null for automatic (docs/dev/REST_BY_HEART_RATE.md).
describe('ready by heart rate', () => {
  it('starts off, on the automatic target', () => {
    expect(readWatchPrefs().hrRest).toEqual({ on: false, bpm: null })
    expect(HR_REST_DEFAULTS).toEqual({ on: false, bpm: null })
  })
  it('keeps the switch and the target apart, and goes to both watches as it is', () => {
    writeWatchPrefs({ hrRest: { on: true } })
    expect(readWatchPrefs().hrRest).toEqual({ on: true, bpm: null })
    writeWatchPrefs({ hrRest: { bpm: 120 } })
    expect(readWatchPrefs().hrRest).toEqual({ on: true, bpm: 120 })
    expect(settingsForWatch().hrRest).toEqual({ on: true, bpm: 120 })
    // a copy, not the stored object
    expect(settingsForWatch().hrRest).not.toBe(readWatchPrefs().hrRest)
    writeWatchPrefs({ hrRest: { bpm: null } })
    expect(readWatchPrefs().hrRest).toEqual({ on: true, bpm: null })
    // another choice leaves it alone
    writeWatchPrefs({ restHaptics: false })
    expect(readWatchPrefs().hrRest).toEqual({ on: true, bpm: null })
  })
  it('reads only what makes sense back', () => {
    for (const bad of [{ on: 'yes', bpm: 120.5 }, { on: 1, bpm: 20 }, { bpm: 300 }, { bpm: '120' }, 'on', null]) {
      localStorage.setItem('gym_watch_v1', JSON.stringify({ hrRest: bad }))
      expect(readWatchPrefs().hrRest).toEqual({ on: false, bpm: null })
    }
    localStorage.setItem('gym_watch_v1', JSON.stringify({ hrRest: { on: true, bpm: 60 } }))
    expect(readWatchPrefs().hrRest).toEqual({ on: true, bpm: 60 })
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
