// @vitest-environment happy-dom
// The Wear OS watch (android/wear) speaks the Apple Watch's protocol over another wire. The two
// files below are the contract between this page and its Kotlin code, both read by both sides:
//   snapshot.json  what the phone sends: built here by buildSnapshot, parsed by the watch's
//                  CodecTest (Model.kt). Changes on purpose: UPDATE_WEAR_FIXTURES=1 npx vitest run …
//   events.json    what the watch sends: built by the watch's SessionCore (SessionCoreTest compares),
//                  applied here through the page's own applyEvents.
// And Android counts as a phone with a watch link, the iPhone still does, the web does not.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'android', 'wear', 'src', 'test', 'resources')

const mobile = vi.hoisted(() => ({ platform: 'android', status: null }))
vi.mock('@capacitor/core', () => ({ registerPlugin: () => ({ status: (...a) => mobile.status(...a) }) }))
vi.mock('./mobile.js', async (orig) => ({ ...(await orig()), MOBILE: true, nativePlatform: async () => mobile.platform }))

const ws = await import('./watch-sync.js')
const { buildSnapshot, applyEvents, bindWatchActions, bindWatchAppActions, streakFor, watchStatus, _setWatchPluginForTest, _resetWatchSync } = ws

const state = () => ({
  unit: 'kg', restSec: 90, routines: [], weekStart: 1,
  workouts: [
    { id: 'old', d: '2026-10-19', entries: [{ id: '0025', target: { sets: 2, reps: 8 }, sets: [{ w: 55, r: 8, done: true }, { w: 57.5, r: 6, done: true }] }] },
  ],
  active: {
    id: 'w-1', name: 'Push day', cur: 0, d: '2026-10-29', start: 1761742800000,
    entries: [
      { id: '0025', target: { sets: 2, reps: 8, weight: 60, restSec: 120 }, sets: [{ w: 60, r: 8, done: true, at: 1761742900000 }, { w: 60, r: 8, done: false }] },
      { id: '0001', target: { sets: 1, reps: 10 }, sets: [{ w: 20, r: 10, done: false, phase: 'warmup' }, { w: 30, r: 10, done: false }] },
    ],
  },
})

beforeEach(() => { localStorage.clear(); _resetWatchSync(); mobile.platform = 'android' })
afterEach(() => _resetWatchSync())

describe('the snapshot the Wear OS watch parses', () => {
  it('is the fixture its Kotlin test reads', () => {
    const snap = buildSnapshot(state(), { timer: { endsAt: 1761743000000 }, activeAt: 1761742950000 })
    snap.settings = { health: false, restHaptics: true, crown: 'reps', show: { hr: true, last: true, next: true }, lang: 'de', weighIn: false }
    snap.streak = streakFor(state(), '2026-10-29')
    const file = join(fixtures, 'snapshot.json')
    if (process.env.UPDATE_WEAR_FIXTURES) writeFileSync(file, JSON.stringify(snap, null, 2) + '\n')
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(JSON.parse(JSON.stringify(snap)))
  })

  it('carries the week streak for the Tile', () => {
    expect(streakFor(state(), '2026-10-29')).toEqual({ weeks: 1, thisWeekDone: false })
    expect(streakFor({ workouts: [] })).toEqual({ weeks: 0, thisWeekDone: false })
    expect(streakFor(null)).toEqual({ weeks: 0, thisWeekDone: false })
  })
})

describe('the events the Wear OS watch sends', () => {
  const events = () => JSON.parse(readFileSync(join(fixtures, 'events.json'), 'utf8'))

  it('are applied through the page\'s own actions, like the Apple Watch\'s', () => {
    const S = state()
    const setDone = vi.fn(), finish = vi.fn()
    bindWatchActions({ setDone, finish })
    const evs = events().filter(e => e.wid === 'w-1')
    expect(applyEvents(evs, () => ({ S }))).toEqual(evs.map(e => e.id))
    // the second set of the bench press, with its heart rate
    expect(setDone).toHaveBeenCalledWith(0, 1, { w: 62.5, r: 7, at: 1761743100000, hr: { avg: 128, max: 141 } })
    // the second exercise's work set, no heart rate measured
    expect(setDone).toHaveBeenCalledWith(1, 1, { w: 30, r: 10, at: 1761743200000, hr: null })
    expect(finish).toHaveBeenCalledTimes(1)
  })

  it('start a routine on the phone with the watch\'s id', () => {
    const start = vi.fn()
    bindWatchAppActions({ start })
    const ev = events().find(e => e.type === 'start')
    expect(applyEvents([ev], () => ({ S: { ...state(), active: null } }))).toEqual([ev.id])
    expect(start).toHaveBeenCalledWith(['r-push'], { id: ev.wid, start: ev.at })
  })
})

describe('the watch link per platform', () => {
  it('asks the native WatchBridge on Android, as on the iPhone', async () => {
    const status = vi.fn(async () => ({ supported: true, paired: true, installed: true, reachable: true }))
    mobile.status = status
    for (const platform of ['android', 'ios']) {
      _resetWatchSync()
      mobile.platform = platform
      expect(await watchStatus()).toMatchObject({ paired: true, installed: true, reachable: true })
    }
    expect(status).toHaveBeenCalledTimes(2)
  })

  it('has none on the web', async () => {
    mobile.platform = 'web'
    expect(await watchStatus()).toEqual({ paired: false, installed: false })
  })

  it('without the watch app installed, nothing is linked', async () => {
    _setWatchPluginForTest({ status: async () => ({ supported: true, paired: true, installed: false }) })
    expect(await watchStatus()).toMatchObject({ installed: false })
  })
})
