// @vitest-environment happy-dom
// The workout Timer's countdown (components/WorkoutClock.jsx) on the phone: the native alarm it
// books carries no chain of hold cues, while a rest after a set before a self-starting hold does.
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../lib/mobile.js', async importOriginal => ({ ...(await importOriginal()), MOBILE: true }))
vi.mock('../lib/rest-alert.js', () => ({
  armRestAlert: vi.fn(() => Promise.resolve(true)),
  holdRestAlert: vi.fn(),
  disarmRestAlert: vi.fn(),
  bindNativeRest: vi.fn(),
  toneNative: vi.fn(() => Promise.resolve(true)),
}))
vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn() }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({ ok: true })) }))

import { useUI, bindAuto } from './useUI.js'
import { useStore } from './useStore.js'
import { armRestAlert } from '../lib/rest-alert.js'

let originalS, unbind
beforeEach(() => {
  vi.useFakeTimers()
  originalS = useStore.getState().S
  useStore.setState({ S: { ...originalS, sound: false, active: { id: 'w', cur: 0, entries: [] } } })
  useUI.setState({ timer: null, work: null, countIn: null })
  armRestAlert.mockClear()
  unbind = bindAuto({ peek: () => ({ idx: 0, i: 1, id: 'plank', plan: 30, label: 'Plank' }), forecast: () => [], focus: vi.fn(), startHold: vi.fn(), stop: vi.fn() })
})
afterEach(() => {
  unbind()
  useUI.getState().stopRest()
  useUI.getState().stopCountIn()
  useStore.setState({ S: originalS })
  vi.useRealTimers()
})

const lastAlert = () => armRestAlert.mock.calls.at(-1)[1]

describe('the workout Timer on the phone', () => {
  it('books no hold cues, where a rest before a self-starting hold does', () => {
    useUI.getState().startRest(20, 0)
    expect(lastAlert().cues?.length).toBeGreaterThan(0)
    useUI.getState().startRest(20, undefined, { clock: true })
    expect(lastAlert().cues).toBeUndefined()
    const calls = armRestAlert.mock.calls.length, endsAt = useUI.getState().timer.endsAt
    useUI.getState().addRest(15)
    expect(armRestAlert.mock.calls.length).toBe(calls + 1)
    expect(armRestAlert.mock.calls.at(-1)[0]).toBe(endsAt + 15_000)
    expect(lastAlert().cues).toBeUndefined()
  })

  it('ends with "Time’s up." on the lock screen, where a rest after a set keeps its own title', () => {
    unbind()   // no hold next: a plain rest
    useUI.getState().startRest(20, 0)
    const restTitle = lastAlert().title
    expect(restTitle).toBeTruthy()
    expect(restTitle).not.toBe('Time’s up.')
    useUI.getState().startRest(20, undefined, { clock: true })
    expect(lastAlert()).toMatchObject({ title: 'Time’s up.', countdownTitle: 'Rest' })
    useUI.getState().addRest(15)
    expect(lastAlert().title).toBe('Time’s up.')
    useUI.getState().startRest(20, 0)
    expect(lastAlert().title).toBe(restTitle)
  })
})
