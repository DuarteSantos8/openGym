// @vitest-environment happy-dom
/* initReminderSync and onAppActive both drop the promise App.addListener returns inside a block
 * body ( .then(({ App }) => { App.addListener(...) }) ), so when the App plugin is not behind the
 * bridge — a native project whose cap sync never ran, or a custom platform — Capacitor's proxy
 * rejects the call (UNIMPLEMENTED) and that rejection never reaches the existing .catch() right
 * behind it: every boot raised an unhandled rejection.
 *
 * A vi.fn cannot reproduce this: vitest attaches its own handlers to every promise a spy returns,
 * which counts as handling it and hides exactly the leak this pins. rejectingApp below is a plain
 * object instead, the same shape Capacitor's own proxy has.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mocks = vi.hoisted(() => ({ App: null }))
vi.mock('@capacitor/app', () => ({ get App() { return mocks.App } }))

const load = async () => {
  vi.stubEnv('VITE_MOBILE', '1')
  vi.resetModules()
  return import('./mobile.js')
}
const tick = () => new Promise(r => setTimeout(r, 0))
// What Capacitor's plugin proxy does when the App plugin is not behind the bridge: addListener
// returns a promise that rejects. Deliberately not a vi.fn — see the file header.
const rejectingApp = () => ({
  calls: 0,
  addListener() { this.calls++; return Promise.reject(new Error('"App" plugin is not implemented on android')) },
})
const settled = async ready => {
  for (let i = 0; i < 50 && !ready(); i++) await tick()
  await tick()
}

let unhandled
const trap = reason => unhandled.push(reason instanceof Error ? reason.message : String(reason))
beforeEach(() => {
  unhandled = []
  process.on('unhandledRejection', trap)
  mocks.App = rejectingApp()
})
afterEach(async () => {
  await tick()
  process.off('unhandledRejection', trap)
  vi.unstubAllEnvs()
  expect(unhandled).toEqual([])          // no test in this file may leave a rejection behind
})

describe('initReminderSync — the App plugin rejecting must not go unhandled', () => {
  it('reaches the catch instead of raising an unhandled rejection', async () => {
    const m = await load()
    m.initReminderSync(() => ({ routines: [], week: {}, dayPlan: {}, workouts: [], reminder: { on: false } }))
    await settled(() => mocks.App.calls > 0)
    expect(unhandled).toEqual([])
  })
})

describe('onAppActive — the App plugin rejecting must not go unhandled', () => {
  it('reaches the catch instead of raising an unhandled rejection', async () => {
    const m = await load()
    m.onAppActive(() => {})
    await settled(() => mocks.App.calls > 0)
    expect(unhandled).toEqual([])
  })
})
