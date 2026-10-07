// @vitest-environment happy-dom
import React, { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ sheets: [], vibrate: vi.fn() }))
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ openSheet: render => { mocks.sheets.push(render); return { close: vi.fn() } } })
  const useUI = selector => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})
vi.mock('../lib/sound.js', () => ({ vibrate: (...a) => mocks.vibrate(...a) }))

import DurationWheel, { durationSheet, WHEEL_ITEM, SETTLE_MS } from './DurationWheel.jsx'

let host, root
beforeEach(() => {
  mocks.sheets = []
  mocks.vibrate.mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
})

// A controlled wheel, the way Settings and the workout use it.
function Harness({ start, onChange, ...rest }) {
  const [v, setV] = useState(start)
  return <DurationWheel value={v} onChange={x => { setV(x); onChange(x) }} {...rest} />
}
const mount = (props) => {
  const onChange = vi.fn()
  act(() => root.render(<Harness onChange={onChange} {...props} />))
  const [min, sec] = host.querySelectorAll('[role="spinbutton"]')
  return { onChange, min, sec }
}
const key = (el, k) => act(() => { el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })) })

describe('DurationWheel', () => {
  it('is two spinbuttons, minutes and seconds, each telling the whole duration', () => {
    const { min, sec } = mount({ start: 105 })
    expect(min.getAttribute('aria-label')).toBe('Minutes')
    expect(sec.getAttribute('aria-label')).toBe('Seconds')
    expect(min.getAttribute('aria-valuenow')).toBe('1')
    expect(sec.getAttribute('aria-valuenow')).toBe('45')
    expect(min.getAttribute('aria-valuemax')).toBe('15')
    expect(sec.getAttribute('aria-valuemax')).toBe('59')
    expect(min.getAttribute('aria-valuetext')).toBe('1 minute 45 seconds')
    expect(sec.getAttribute('aria-valuetext')).toBe('1 minute 45 seconds')
    expect(min.tabIndex).toBe(0)
    // the selected rows are marked for the eye; the rows themselves are hidden from screen readers
    expect(min.querySelector('.dw-it.on').textContent).toBe('1')
    expect(sec.querySelector('.dw-it.on').textContent).toBe('45')
    expect(sec.querySelector('.dw-it').getAttribute('aria-hidden')).toBe('true')
  })

  it('names 0 with the "off" label when it means no timer', () => {
    const { min } = mount({ start: 0, off: 'Off' })
    expect(min.getAttribute('aria-valuetext')).toBe('Off')
  })

  it('steps with the arrows, jumps with Page Up/Down and Home/End', () => {
    const { onChange, min, sec } = mount({ start: 90 })
    key(sec, 'ArrowUp')
    expect(onChange).toHaveBeenLastCalledWith(91)
    key(sec, 'ArrowDown'); key(sec, 'ArrowDown')
    expect(onChange).toHaveBeenLastCalledWith(89)
    key(sec, 'PageUp')
    expect(onChange).toHaveBeenLastCalledWith(99)
    key(min, 'PageUp')
    expect(onChange).toHaveBeenLastCalledWith(6 * 60 + 39)
    key(min, 'Home')
    expect(onChange).toHaveBeenLastCalledWith(39)
    key(min, 'End')
    expect(onChange).toHaveBeenLastCalledWith(900)   // 15:39 is past the end: 15:00
  })

  it('keeps any value in range: 15:00 is the most, a rest-pause wheel stops at 5 s and 5:00', () => {
    const { onChange, sec } = mount({ start: 900 })
    key(sec, 'ArrowUp')                               // 15:01 → still 15:00, nothing to report
    expect(onChange).not.toHaveBeenCalled()
    act(() => root.unmount()); root = createRoot(host)
    const b = mount({ start: 10, min: 5, max: 300 })
    expect(b.min.getAttribute('aria-valuemax')).toBe('5')
    key(b.sec, 'PageDown')
    expect(b.onChange).toHaveBeenLastCalledWith(5)
    key(b.min, 'End')
    expect(b.onChange).toHaveBeenLastCalledWith(300)
  })

  it('dims the rows a wheel cannot land on', () => {
    const { sec } = mount({ start: 900 })
    const rows = sec.querySelectorAll('.dw-it')
    expect(rows[0].classList.contains('out')).toBe(false)
    expect(rows[1].classList.contains('out')).toBe(true)
  })

  it('reports where a scroll comes to rest, after the scroll events stop, and ticks on the way', () => {
    vi.useFakeTimers()
    const { onChange, sec } = mount({ start: 60 })
    const scroller = sec.querySelector('.dw-scroll')
    act(() => {
      scroller.dispatchEvent(new Event('touchstart'))
      scroller.scrollTop = 30 * WHEEL_ITEM
      scroller.dispatchEvent(new Event('scroll'))
    })
    expect(mocks.vibrate).toHaveBeenCalledTimes(1)
    // still under the finger: nothing is picked yet
    act(() => { vi.advanceTimersByTime(SETTLE_MS + 10) })
    expect(onChange).not.toHaveBeenCalled()
    act(() => { scroller.dispatchEvent(new Event('touchend')); vi.advanceTimersByTime(SETTLE_MS + 10) })
    expect(onChange).toHaveBeenLastCalledWith(90)
    expect(sec.getAttribute('aria-valuetext')).toBe('1 minute 30 seconds')
  })

  it('lays its wheels out left to right in every language and keeps the sheet from swiping on it', () => {
    mount({ start: 90 })
    const dw = host.querySelector('.dw')
    expect(dw.getAttribute('dir')).toBe('ltr')
    expect(dw.hasAttribute('data-nodrag')).toBe(true)
  })
})

describe('durationSheet', () => {
  it('opens the wheel with a read-out, and Done hands back the value', () => {
    const onDone = vi.fn()
    durationSheet({ title: 'Rest timer', value: 105, off: 'Off', footer: 'Scroll to 0:00 to turn the rest timer off.', onDone })
    expect(mocks.sheets).toHaveLength(1)
    const close = vi.fn()
    act(() => root.render(mocks.sheets[0](close)))
    expect(host.querySelector('h3').textContent).toBe('Rest timer')
    expect(host.querySelector('.dw-read').textContent).toBe('1:45')
    const sec = host.querySelectorAll('[role="spinbutton"]')[1]
    key(sec, 'ArrowUp')
    expect(host.querySelector('.dw-read').textContent).toBe('1:46')
    act(() => { [...host.querySelectorAll('button')].find(b => b.textContent === 'Done').click() })
    expect(close).toHaveBeenCalled()
    expect(onDone).toHaveBeenCalledWith(106)
  })

  it('Done straight after a flick saves where the wheel is, not the value from before it', () => {
    vi.useFakeTimers()
    const onDone = vi.fn()
    durationSheet({ title: 'Rest timer', value: 105, off: 'Off', onDone })
    act(() => root.render(mocks.sheets[0](vi.fn())))
    const [min] = host.querySelectorAll('[role="spinbutton"]')
    const scroller = min.querySelector('.dw-scroll')
    act(() => {
      scroller.scrollTop = 3 * WHEEL_ITEM
      scroller.dispatchEvent(new Event('scroll'))
    })
    // still rolling: no settle yet, and Done is tapped right away
    act(() => { [...host.querySelectorAll('button')].find(b => b.textContent === 'Done').click() })
    expect(onDone).toHaveBeenCalledWith(3 * 60 + 45)
  })

  it('reads 0 as Off', () => {
    durationSheet({ title: 'Rest timer', value: 0, off: 'Off', onDone: vi.fn() })
    act(() => root.render(mocks.sheets[0](vi.fn())))
    expect(host.querySelector('.dw-read').textContent).toBe('Off')
  })
})
