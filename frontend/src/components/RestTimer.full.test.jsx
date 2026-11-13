// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import RestTimer from './RestTimer.jsx'
import { useUI } from '../store/useUI.js'
import { useStore } from '../store/useStore.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn() }))

let host, root, sheetEl, sheetRoot, originalS

beforeEach(() => {
  vi.useFakeTimers()
  originalS = useStore.getState().S
  useStore.setState({ S: { ...originalS, sound: false } })
  useUI.setState({ timer: null, work: null, timerFlashId: 0, sheets: [] })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  sheetEl = document.createElement('div')
  document.body.appendChild(sheetEl)
  sheetRoot = createRoot(sheetEl)
})

afterEach(() => {
  act(() => { root.render(null); sheetRoot.render(null) })
  useUI.getState().stopRest()
  useUI.getState().stopWork()
  useUI.setState({ sheets: [] })
  useStore.setState({ S: originalS })
  host.remove(); sheetEl.remove()
  vi.useRealTimers()
})

// The open sheets, rendered the way Modals.jsx renders them, so a sheet that closes itself leaves.
function Sheets() {
  const sheets = useUI(s => s.sheets)
  return sheets.map(s => <div key={s.id} data-kind={s.kind}>{s.render(() => useUI.getState().closeSheet(s.id))}</div>)
}
const mount = () => act(() => { root.render(<RestTimer />); sheetRoot.render(<Sheets />) })
const full = () => sheetEl.querySelector('.restfull')
const tapClock = () => act(() => host.querySelector('#timer .tclock').click())

describe('the rest, full screen', () => {
  it('opens from the bar\'s clock as a viewer, and counts down with the bar', () => {
    act(() => useUI.getState().startRest(90, 0))
    mount()
    tapClock()
    expect(useUI.getState().sheets.map(s => s.kind)).toEqual(['viewer'])
    expect(full().querySelector('.restfull-clock .t').textContent).toBe('1:30')
    expect(full().querySelector('.restfull-clock').getAttribute('aria-label')).toBe('1:30. Change the time left')
    act(() => vi.advanceTimersByTime(10_000))
    expect(full().querySelector('.restfull-clock .t').textContent).toBe('1:20')
    expect(host.querySelector('#timer .t').textContent).toBe('1:20')
  })

  it('its buttons work the rest: −15, pause, +15', () => {
    act(() => useUI.getState().startRest(90, 0))
    mount()
    tapClock()
    const btn = sel => full().querySelector(sel)
    act(() => btn('.adj').click())
    expect(useUI.getState().timer.left).toBe(75)
    act(() => btn('.pause').click())
    expect(useUI.getState().timer.paused).toBe(true)
    expect(full().classList.contains('paused')).toBe(true)
    act(() => btn('.pause').click())
    expect(useUI.getState().timer.paused).toBeFalsy()
    act(() => full().querySelectorAll('.adj')[1].click())
    expect(useUI.getState().timer.left).toBe(90)
  })

  it('the big clock opens the wheel on top of it', () => {
    act(() => useUI.getState().startRest(90, 0))
    mount()
    tapClock()
    act(() => full().querySelector('.restfull-clock').click())
    expect(useUI.getState().sheets.map(s => s.kind)).toEqual(['viewer', 'sheet'])
    expect(sheetEl.querySelector('[data-kind="sheet"] h3').textContent).toBe('Time left')
  })

  it('Skip ends the rest and closes the view', () => {
    act(() => useUI.getState().startRest(90, 0))
    mount()
    tapClock()
    act(() => full().querySelector('.restfull-skip .btn').click())
    expect(useUI.getState().timer).toBeNull()
    expect(useUI.getState().sheets).toEqual([])
    expect(full()).toBeNull()
  })

  it('stays open at Ready, with Dismiss and no pause', () => {
    act(() => useUI.getState().startRest(2, 0))
    mount()
    tapClock()
    act(() => vi.advanceTimersByTime(2000))
    expect(useUI.getState().timer.ready).toBe(true)
    expect(full().classList.contains('ready')).toBe(true)
    expect(full().querySelector('.restfull-clock .t').textContent).toBe('Ready')
    expect(full().querySelector('.pause')).toBeNull()
    expect(full().querySelector('.restfull-skip .btn').textContent).toBe('Dismiss')
  })

  it('Minimize goes back to the bar, the rest still running', () => {
    act(() => useUI.getState().startRest(90, 0))
    mount()
    tapClock()
    act(() => full().querySelector('.restfull-bar .iconbtn').click())
    expect(useUI.getState().sheets).toEqual([])
    expect(useUI.getState().timer.left).toBe(90)
    expect(host.querySelector('#timer.rest')).not.toBeNull()
  })
})
