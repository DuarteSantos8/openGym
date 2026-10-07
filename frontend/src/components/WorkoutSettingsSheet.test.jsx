// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkoutSettings } from './WorkoutSettingsSheet.jsx'
import { useUI } from '../store/useUI.js'
import { useStore } from '../store/useStore.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const sound = vi.hoisted(() => ({ canVibrate: true, iPhone: false }))
vi.mock('../lib/sound.js', () => ({
  unlock: vi.fn(), beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn(),
  vibrateSupported: () => sound.canVibrate, appleTouchDevice: () => sound.iPhone,
}))
vi.mock('../lib/wakelock.js', () => ({ wakeLockSupported: () => true }))
const navTo = vi.hoisted(() => vi.fn())
vi.mock('../lib/nav.js', async importOriginal => {
  const real = await importOriginal()
  real.setNav(navTo)
  return real
})

let host, root, originalS, close

beforeEach(() => {
  originalS = useStore.getState().S
  useStore.setState({ S: {
    ...originalS, restSec: 90, sound: false, vibrate: true, timerFlash: false, keepAwake: true,
    workoutView: 'cards', effort: 'none', gifSize: 'full',
    active: { id: 'a', name: 'Push', start: Date.now(), cur: 0, entries: [], workoutView: 'list' },
  } })
  useUI.setState({ sheets: [] })
  sound.canVibrate = true; sound.iPhone = false
  close = vi.fn()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(<WorkoutSettings close={close} />))
})

afterEach(() => {
  act(() => root.render(null))
  useUI.setState({ sheets: [] })
  useStore.setState({ S: originalS })
  host.remove()
  navTo.mockReset()
})

const row = title => [...host.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent === title)
const S = () => useStore.getState().S

describe('the in-workout settings sheet', () => {
  it('has the rows people change at the gym, then All settings', () => {
    expect([...host.querySelectorAll('.lrow-t')].map(e => e.textContent)).toEqual([
      'Rest timer', 'Play a sound', 'Vibrate', 'Flash the screen', 'Keep screen awake',
      'Layout', 'Effort per set', 'Swipe actions', 'Exercise animations', 'All settings',
    ])
    expect(row('Rest timer').querySelector('.lrow-v').textContent).toBe('1:30')
    expect(row('Keep screen awake').querySelector('.lrow-s').textContent).toMatch(/^The screen stays on/)
    expect(row('Exercise animations').querySelector('.lrow-s')).toBeNull()
  })

  it('writes the same fields as Settings', () => {
    act(() => row('Play a sound').querySelector('[role=switch]').click())
    act(() => row('Vibrate').querySelector('[role=switch]').click())
    act(() => row('Flash the screen').querySelector('[role=switch]').click())
    act(() => row('Keep screen awake').querySelector('[role=switch]').click())
    act(() => [...row('Effort per set').querySelectorAll('button')].find(b => b.textContent === 'RIR').click())
    act(() => [...row('Exercise animations').querySelectorAll('button')].find(b => b.textContent === 'Small').click())
    expect(S()).toMatchObject({ sound: true, vibrate: false, timerFlash: true, keepAwake: false, effort: 'rir', gifSize: 'mini' })
  })

  it('shows this session’s layout, and a pick here is saved and replaces it', () => {
    expect(row('Layout').querySelector('button.on').textContent).toBe('List')
    act(() => [...row('Layout').querySelectorAll('button')].find(b => b.textContent === 'Compact').click())
    expect(S().workoutView).toBe('compact')
    expect(S().active.workoutView).toBeUndefined()
  })

  it('sets the rest timer on the wheel, 0:00 being off', () => {
    act(() => row('Rest timer').click())
    const sheet = useUI.getState().sheets.at(-1)
    const el = document.createElement('div')
    document.body.appendChild(el)
    const r = createRoot(el)
    act(() => r.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
    expect(el.querySelector('h3').textContent).toBe('Rest timer')
    expect(el.querySelector('.dw-read').textContent).toBe('1:30')
    act(() => [...el.querySelectorAll('button')].find(b => b.textContent === 'Done').click())
    expect(S().restSec).toBe(90)
    act(() => r.unmount()); el.remove()
  })

  it('greys Vibrate out on an iPhone and says why', () => {
    sound.canVibrate = false; sound.iPhone = true
    act(() => root.render(<WorkoutSettings close={close} key="iphone" />))
    expect(row('Vibrate').classList.contains('dis')).toBe(true)
    expect(row('Vibrate').querySelector('.lrow-s').textContent).toBe('Not on iPhone')
    expect(row('Vibrate').querySelector('[role=switch]').disabled).toBe(true)
  })

  it('goes to Settings → Workout from All settings, closing the sheet', () => {
    act(() => row('All settings').click())
    expect(close).toHaveBeenCalled()
    expect(navTo).toHaveBeenCalledWith('/settings/workout')
  })

  // The sheet's own history entry used to stay behind: back from Settings went to the workout, and
  // the next back landed on the same workout again and seemed to do nothing.
  it('Settings takes the sheet\'s history entry instead of leaving it behind', () => {
    history.pushState({ openGymSheet: true }, '')
    act(() => row('All settings').click())
    expect(navTo).toHaveBeenCalledWith('/settings/workout', { replace: true })
    history.replaceState(null, '')
  })
})
