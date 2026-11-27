// @vitest-environment happy-dom
// #1535: the daily check-in on the watch. The phone tells the watch whether to ask and which day was
// answered last; the watch's answers come back as a dailyForm event and are stored as the phone's own.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { watchCheckinOn, lastFormDay, withWatchForm, formOf, withForm, WATCH_FORM_KEYS, FORM_KEYS } from './daily-form.js'
import { applyEvents, bindWatchAppActions, watchExtras, formFromWatch, _resetWatchSync } from './watch-sync.js'

beforeEach(() => { localStorage.clear(); _resetWatchSync() })

describe('whether the watch asks', () => {
  it('only with the check-in on, and on by default then', () => {
    expect(watchCheckinOn({})).toBe(false)
    expect(watchCheckinOn({ dailyForm: false })).toBe(false)
    expect(watchCheckinOn({ dailyForm: true })).toBe(true)
    expect(watchCheckinOn({ dailyForm: true, dailyFormWatch: false })).toBe(false)
    expect(watchCheckinOn(null)).toBe(false)
  })

  it('never with the Health module off', () => {
    expect(watchCheckinOn({ dailyForm: true, modules: { health: false } })).toBe(false)
  })

  it('asks the three that matter most, all of them real check-in rows', () => {
    expect(WATCH_FORM_KEYS).toEqual(['sleep', 'energy', 'sore'])
    for (const k of WATCH_FORM_KEYS) expect(FORM_KEYS).toContain(k)
  })
})

describe('what the watch hears in its settings', () => {
  it('nothing about the check-in while it is off', () => {
    expect(watchExtras({})).not.toHaveProperty('checkin')
    expect(watchExtras({ dailyForm: true, dailyFormWatch: false, dayForm: { '2026-11-24': { sleep: 3 } } })).not.toHaveProperty('checkinDay')
  })

  it('checkin on, with the newest answered day', () => {
    const S = { dailyForm: true, dayForm: { '2026-11-20': { sleep: 4, _ts: 1 }, '2026-11-23': { energy: 2, _ts: 2 }, '2026-11-24': { _ts: 3 } } }
    expect(watchExtras(S)).toMatchObject({ checkin: true, checkinDay: '2026-11-23' })
    expect(lastFormDay(S)).toBe('2026-11-23')
  })

  it('checkin on without a day when nothing was ever answered', () => {
    const x = watchExtras({ dailyForm: true })
    expect(x.checkin).toBe(true)
    expect(x).not.toHaveProperty('checkinDay')
    expect(lastFormDay({})).toBe(null)
  })
})

describe('storing the watch\'s answers', () => {
  it('stores them on their day like the phone\'s own', () => {
    const map = withWatchForm({}, '2026-11-24', { sleep: 2, energy: 4, sore: 5 }, 1000)
    expect(map['2026-11-24']).toEqual({ sleep: 2, energy: 4, sore: 5, _ts: 1000 })
    // exactly what the phone's sheet would have stored for the same taps
    expect(map).toEqual(withForm({}, '2026-11-24', { sleep: 2, energy: 4, sore: 5 }, 1000))
    expect(formOf({ dayForm: map }, '2026-11-24')).toMatchObject({ sleep: 2, energy: 4, sore: 5, stress: null, lighter: null })
  })

  it('keeps the other days', () => {
    const map = withWatchForm({ '2026-11-23': { stress: 3, _ts: 5 } }, '2026-11-24', { sleep: 3 }, 9)
    expect(Object.keys(map).sort()).toEqual(['2026-11-23', '2026-11-24'])
  })

  it('never twice a day: a day answered on the phone keeps its answers', () => {
    const map = { '2026-11-24': { sleep: 5, energy: 5, _ts: 1 } }
    expect(withWatchForm(map, '2026-11-24', { sleep: 1 })).toBe(null)
  })

  it('a day whose answers were cleared counts as not done', () => {
    expect(withWatchForm({ '2026-11-24': { _ts: 1 } }, '2026-11-24', { energy: 3 }, 2)['2026-11-24']).toEqual({ energy: 3, _ts: 2 })
  })

  it('nothing to store: no answer, answers out of range, or no proper day', () => {
    expect(withWatchForm({}, '2026-11-24', {})).toBe(null)
    expect(withWatchForm({}, '2026-11-24', { sleep: 9, energy: 0 })).toBe(null)
    expect(withWatchForm({}, 'today', { sleep: 3 })).toBe(null)
    expect(withWatchForm({}, null, { sleep: 3 })).toBe(null)
  })
})

describe('the dailyForm event', () => {
  it('reads only whole answers from 1 to 5', () => {
    expect(formFromWatch({ sleep: 3, energy: 6, sore: 2.5, stress: 1, junk: 4 })).toEqual({ sleep: 3, stress: 1 })
    expect(formFromWatch({ sleep: '3' })).toBe(null)
    expect(formFromWatch(null)).toBe(null)
  })

  it('goes to the phone\'s handler with its answers and time, once', () => {
    const dailyForm = vi.fn()
    bindWatchAppActions({ start: vi.fn(), patchSet: vi.fn(), dailyForm })
    const done = applyEvents([
      { id: 'c1', type: 'dailyForm', sleep: 2, energy: 4, sore: 3, at: 5000 },
      { id: 'c2', type: 'dailyForm', sleep: 0, at: 5000 },
    ], () => ({ S: { active: null } }), 6000)
    expect(done).toEqual(['c1', 'c2'])
    expect(dailyForm).toHaveBeenCalledTimes(1)
    expect(dailyForm).toHaveBeenCalledWith({ form: { sleep: 2, energy: 4, sore: 3 }, at: 5000 })
    // sent again (the watch had not heard yet): not stored twice
    applyEvents([{ id: 'c1', type: 'dailyForm', sleep: 2, at: 5000 }], () => ({ S: { active: null } }), 7000)
    expect(dailyForm).toHaveBeenCalledTimes(1)
  })

  it('waits in the queue while the app has no handler bound yet', () => {
    const done = applyEvents([{ id: 'c3', type: 'dailyForm', sleep: 4, at: 5000 }], () => ({ S: { active: null } }), 6000)
    expect(done).toEqual([])
  })

  it('is applied before the start it came with, whatever runs on the phone', () => {
    const dailyForm = vi.fn(), start = vi.fn()
    bindWatchAppActions({ start, patchSet: vi.fn(), dailyForm })
    applyEvents([
      { id: 'c4', type: 'dailyForm', energy: 1, at: 5000 },
      { id: 's4', type: 'start', wid: 'watch-x', routineIds: [], at: 5001 },
    ], () => ({ S: { active: { id: 'phone-w', entries: [] } } }), 6000)
    expect(dailyForm).toHaveBeenCalledWith({ form: { energy: 1 }, at: 5000 })
  })
})
