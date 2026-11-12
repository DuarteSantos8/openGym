// @vitest-environment happy-dom
// The seconds wheel in 5-second rows (S.wheelStep: 5), and the default 1-second rows.
import React, { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ sheets: [], S: {} }))
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ openSheet: render => { mocks.sheets.push(render); return { close: vi.fn() } } })
  const useUI = selector => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})
vi.mock('../store/useStore.js', () => {
  const snap = () => ({ S: mocks.S })
  const useStore = selector => selector ? selector(snap()) : snap()
  useStore.getState = snap
  return { useStore }
})
vi.mock('../lib/sound.js', () => ({ vibrate: () => {} }))

import DurationWheel, { durationSheet, WHEEL_ITEM, SETTLE_MS } from './DurationWheel.jsx'

let host, root
beforeEach(() => {
  mocks.sheets = []
  mocks.S = { wheelStep: 5 }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
})

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
const labels = sec => [...sec.querySelectorAll('.dw-it')].map(r => r.textContent)

describe('DurationWheel in 5-second rows', () => {
  it('has 12 seconds rows, 00 to 55', () => {
    const { sec } = mount({ start: 90 })
    expect(labels(sec)).toEqual(['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55'])
    expect(sec.getAttribute('aria-valuemax')).toBe('11')
    expect(sec.querySelector('.dw-it.on').textContent).toBe('30')
  })

  it('keeps 1-second rows when the profile has no step, or one it does not know', () => {
    for (const S of [{}, { wheelStep: 1 }, { wheelStep: 10 }]) {
      mocks.S = S
      const { sec } = mount({ start: 66 })
      expect(sec.querySelectorAll('.dw-it')).toHaveLength(60)
      expect(sec.querySelector('.dw-it.on').textContent).toBe('06')
      act(() => root.unmount()); root = createRoot(host)
    }
  })

  it('reports multiples of 5: arrows a row, Page Up/Down about 10 seconds', () => {
    const { onChange, sec } = mount({ start: 90 })
    key(sec, 'ArrowUp')
    expect(onChange).toHaveBeenLastCalledWith(95)
    key(sec, 'ArrowDown'); key(sec, 'ArrowDown')
    expect(onChange).toHaveBeenLastCalledWith(85)
    key(sec, 'PageUp')
    expect(onChange).toHaveBeenLastCalledWith(95)
    key(sec, 'PageDown')
    expect(onChange).toHaveBeenLastCalledWith(85)
    key(sec, 'End')
    expect(onChange).toHaveBeenLastCalledWith(115)
  })

  it('shows a stored 1:06 at 1:05 without rewriting it, and the read-back says 65', () => {
    const readRef = { current: null }
    const { onChange, sec } = mount({ start: 66, readRef })
    expect(sec.querySelector('.dw-it.on').textContent).toBe('05')
    expect(onChange).not.toHaveBeenCalled()
    expect(readRef.current()).toBe(65)
  })

  it('moves an off-grid value on the grid once a wheel moves', () => {
    const a = mount({ start: 66 })
    key(a.sec, 'ArrowUp')
    expect(a.onChange).toHaveBeenLastCalledWith(70)
    act(() => root.unmount()); root = createRoot(host)
    const b = mount({ start: 66 })
    key(b.min, 'ArrowUp')
    expect(b.onChange).toHaveBeenLastCalledWith(125)
  })

  it('clamps to min and max per row, and dims the rows out of range', () => {
    const { onChange, sec } = mount({ start: 900 })
    key(sec, 'ArrowUp')                                // 15:05 → still 15:00
    expect(onChange).not.toHaveBeenCalled()
    const rows = sec.querySelectorAll('.dw-it')
    expect(rows[0].classList.contains('out')).toBe(false)
    expect(rows[1].classList.contains('out')).toBe(true)
    act(() => root.unmount()); root = createRoot(host)
    const b = mount({ start: 10, min: 5, max: 300 })
    expect(b.sec.querySelectorAll('.dw-it')[0].classList.contains('out')).toBe(true)
    expect(b.sec.querySelectorAll('.dw-it')[1].classList.contains('out')).toBe(false)
    key(b.sec, 'Home')
    expect(b.onChange).toHaveBeenLastCalledWith(5)    // 0:00 is under the minimum
    key(b.min, 'End')
    expect(b.onChange).toHaveBeenLastCalledWith(300)
  })

  it('reports where a scroll comes to rest in seconds, and Done reads the rolling wheel in seconds', () => {
    vi.useFakeTimers()
    const { onChange, sec } = mount({ start: 60 })
    const scroller = sec.querySelector('.dw-scroll')
    act(() => {
      scroller.dispatchEvent(new Event('touchstart'))
      scroller.scrollTop = 9 * WHEEL_ITEM
      scroller.dispatchEvent(new Event('scroll'))
    })
    act(() => { scroller.dispatchEvent(new Event('touchend')); vi.advanceTimersByTime(SETTLE_MS + 10) })
    expect(onChange).toHaveBeenLastCalledWith(105)
    act(() => root.unmount()); root = createRoot(host)

    const onDone = vi.fn()
    durationSheet({ title: 'Rest timer', value: 90, off: 'Off', onDone })
    act(() => root.render(mocks.sheets[0](vi.fn())))
    const s2 = host.querySelectorAll('[role="spinbutton"]')[1].querySelector('.dw-scroll')
    act(() => {
      s2.scrollTop = 3 * WHEEL_ITEM
      s2.dispatchEvent(new Event('scroll'))
    })
    act(() => { [...host.querySelectorAll('button')].find(b => b.textContent === 'Done').click() })
    expect(onDone).toHaveBeenCalledWith(75)
  })
})
