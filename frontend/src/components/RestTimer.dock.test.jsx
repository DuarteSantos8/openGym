// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import RestTimer, { applyRestLeft } from './RestTimer.jsx'
import { useUI } from '../store/useUI.js'
import { useStore } from '../store/useStore.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn() }))

let host, root, originalS

beforeEach(() => {
  vi.useFakeTimers()
  originalS = useStore.getState().S
  useStore.setState({ S: { ...originalS, sound: false } })
  useUI.setState({ timer: null, work: null, timerFlashId: 0, sheets: [] })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.render(null))
  useUI.getState().stopRest()
  useUI.getState().stopWork()
  useUI.setState({ sheets: [] })
  useStore.setState({ S: originalS })
  host.remove()
  vi.useRealTimers()
})

const mount = () => act(() => root.render(<RestTimer />))
const sheetHost = () => {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const r = createRoot(el)
  const sheet = useUI.getState().sheets.at(-1)
  act(() => r.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return { el, r }
}

// v1.3.11: one docked row; the clock is a button that opens the wheel at the time left.
describe('the docked rest bar', () => {
  it('is one row: the clock with its label, then −15, +15, pause and Skip', () => {
    act(() => useUI.getState().startRest(90, 0))
    mount()
    const bar = host.querySelector('#timer.rest')
    expect(bar.querySelector('button.tclock .t').textContent).toBe('1:30')
    expect(bar.querySelector('.tclock .lbl').textContent).toBe('Rest')
    expect([...bar.querySelectorAll('.acts > button')].map(b => b.getAttribute('aria-label') || (b.querySelector('.on') || b).textContent.trim()))
      .toEqual(['15s', '15s', 'Pause', 'Skip'])
    expect(bar.querySelector('.tclock').getAttribute('aria-label')).toBe('1:30. Change the time left')
  })

  // QA 10-05: Ready used to drop the pause button and reflow the row, so the spot +15 had been
  // in became −15. The slots stay put now: the pause slot is kept (inert, invisible) and Skip
  // carries Dismiss in the same cell, so its width does not change either.
  it('keeps every button in its slot when the rest turns Ready', () => {
    act(() => useUI.getState().startRest(1, 0))
    mount()
    const slots = () => [...host.querySelectorAll('#timer .acts > button')].map(b => b.className.match(/adj|pause-slot|pause|skip/)[0])
    expect(slots()).toEqual(['adj', 'adj', 'pause', 'skip'])
    expect(host.querySelector('#timer .t').dataset.alt).toBe('Ready')
    const skipCell = () => [...host.querySelectorAll('#timer .skip > span:not(.skip-probe) > span')].map(s => s.textContent).sort()
    expect(skipCell()).toEqual(['Dismiss', 'Skip'])
    act(() => vi.advanceTimersByTime(1000))
    expect(host.querySelector('#timer .t').textContent).toBe('Ready')
    expect(slots()).toEqual(['adj', 'adj', 'pause-slot', 'skip'])
    expect(host.querySelector('#timer .t').dataset.alt).toBe('0:00')
    expect(skipCell()).toEqual(['Dismiss', 'Skip'])
    const stand = host.querySelector('#timer .pause-slot')
    expect(stand.disabled).toBe(true)
    expect(stand.getAttribute('aria-hidden')).toBe('true')
    expect(stand.tabIndex).toBe(-1)
    expect(host.querySelector('#timer .skip .off').getAttribute('aria-hidden')).toBe('true')
  })

  it('shows Skip as an icon, named in full, when its label does not fit, and Dismiss as × once Ready', () => {
    const rect = Element.prototype.getBoundingClientRect
    Element.prototype.getBoundingClientRect = function () {
      const r = rect.call(this)
      return this.parentElement?.classList.contains('skip-probe') ? { ...r, width: 400 } : r
    }
    try {
      act(() => useUI.getState().startRest(1, 0))
      mount()
      const skip = host.querySelector('#timer .skip')
      expect(skip.classList.contains('icon-only')).toBe(true)
      expect(skip.getAttribute('aria-label')).toBe('Skip')
      expect(skip.querySelector('.on')).toBeNull()
      expect(skip.querySelector('svg')).toBeTruthy()
      act(() => vi.advanceTimersByTime(1000))
      expect(host.querySelector('#timer .skip').getAttribute('aria-label')).toBe('Dismiss')
      act(() => host.querySelector('#timer .skip').click())
      expect(useUI.getState().timer).toBeNull()
    } finally { Element.prototype.getBoundingClientRect = rect }
  })

  it('says Paused under the clock while the rest is held', () => {
    act(() => useUI.getState().startRest(90, 0))
    mount()
    act(() => host.querySelector('#timer .pause').click())
    expect(host.querySelector('#timer .tclock .lbl').textContent).toBe('Paused')
  })

  it('opens the wheel at the time left, and Done sets the rest to what was picked', () => {
    act(() => useUI.getState().startRest(90, 3))
    mount()
    act(() => vi.advanceTimersByTime(10_000))
    act(() => host.querySelector('#timer .tclock').click())
    const { el, r } = sheetHost()
    expect(el.querySelector('h3').textContent).toBe('Time left')
    expect(el.querySelector('.dw-read').textContent).toBe('1:20')
    act(() => r.unmount()); el.remove()
    act(() => applyRestLeft(120))
    expect(useUI.getState().timer).toMatchObject({ left: 120, forIdx: 3 })
    expect(host.querySelector('#timer .t').textContent).toBe('2:00')
  })

  it('ends the rest at 0:00, and starts a fresh one when the old one had run out', () => {
    act(() => useUI.getState().startRest(30, 1))
    act(() => applyRestLeft(0))
    expect(useUI.getState().timer).toBeNull()

    act(() => useUI.getState().startRest(1, 2))
    act(() => vi.advanceTimersByTime(1000))
    expect(useUI.getState().timer.ready).toBe(true)
    act(() => applyRestLeft(45))
    expect(useUI.getState().timer).toMatchObject({ left: 45, total: 45, forIdx: 2 })
    expect(useUI.getState().timer.ready).toBeUndefined()
  })

  // A fresh rest from Ready keeps what the old one led into, and so the sound it ends with.
  it('a fresh rest from Ready keeps the kind of rest and the set it belongs to', () => {
    act(() => useUI.getState().startRest(1, 2, { kind: 'block', forSet: 1 }))
    act(() => vi.advanceTimersByTime(1000))
    act(() => applyRestLeft(60))
    expect(useUI.getState().timer).toMatchObject({ left: 60, forIdx: 2, forSet: 1, kind: 'block' })
  })

  it('Done on an untouched wheel leaves the rest alone', () => {
    // still counting: the seconds that passed while the wheel was open are not given back
    act(() => useUI.getState().startRest(60, 0))
    mount()
    act(() => host.querySelector('#timer .tclock').click())
    act(() => vi.advanceTimersByTime(10_000))
    let { el, r } = sheetHost()
    act(() => { [...el.querySelectorAll('button')].find(b => b.textContent === 'Done').click() })
    act(() => r.unmount()); el.remove()
    expect(useUI.getState().timer.left).toBe(50)

    // ran out meanwhile: no fresh rest nobody asked for
    act(() => useUI.getState().startRest(5, 2))
    act(() => host.querySelector('#timer .tclock').click())
    act(() => vi.advanceTimersByTime(5000))
    expect(useUI.getState().timer.ready).toBe(true);
    ({ el, r } = sheetHost())
    act(() => { [...el.querySelectorAll('button')].find(b => b.textContent === 'Done').click() })
    act(() => r.unmount()); el.remove()
    expect(useUI.getState().timer).toMatchObject({ ready: true, left: 0 })

    // a switch-sides pause that ended does not turn into a plain rest
    act(() => useUI.getState().startRest(5, 1, { kind: 'switch' }))
    act(() => host.querySelector('#timer .tclock').click())
    act(() => vi.advanceTimersByTime(5000))
    expect(useUI.getState().timer).toBeNull();
    ({ el, r } = sheetHost())
    act(() => { [...el.querySelectorAll('button')].find(b => b.textContent === 'Done').click() })
    act(() => r.unmount()); el.remove()
    expect(useUI.getState().timer).toBeNull()
  })

  it('+15 s stops at the wheel maximum of 15:00', () => {
    act(() => useUI.getState().startRest(890, 0))
    mount()
    act(() => useUI.getState().addRest(15))
    expect(useUI.getState().timer).toMatchObject({ left: 900, total: 900 })
    act(() => useUI.getState().addRest(15))
    expect(useUI.getState().timer.left).toBe(900)
    expect(host.querySelectorAll('#timer .adj')[1].disabled).toBe(true)
    act(() => useUI.getState().addRest(-15))
    expect(useUI.getState().timer.left).toBe(885)
  })

  it('keeps a paused rest paused at the new time', () => {
    act(() => useUI.getState().startRest(90, 0))
    act(() => useUI.getState().pauseRest())
    act(() => applyRestLeft(60))
    expect(useUI.getState().timer).toMatchObject({ left: 60, paused: true })
  })
})
