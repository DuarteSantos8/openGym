// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Slider, Stepper, SLIDER_GRAB_PX } from './ui.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host, root
beforeEach(() => {
  vi.useFakeTimers()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
})

function pointer(target, type, { x = 0, y = 0, button = 0 } = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  for (const [k, v] of Object.entries({ pointerId: 1, pointerType: 'touch', isPrimary: true, button, clientX: x, clientY: y })) {
    Object.defineProperty(event, k, { configurable: true, value: v })
  }
  act(() => target.dispatchEvent(event))
  return event
}

describe('Slider', () => {
  // 300px track from x=100 to x=400 over 0..300 so 1px == 1 unit
  const mountSlider = (value, onChange) => {
    act(() => root.render(<Slider value={value} min={0} max={300} step={1} onChange={onChange} />))
    const el = host.querySelector('.sld')
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ left: 100, right: 400, width: 300, top: 0, bottom: 20, height: 20, x: 100, y: 0 })
    return el
  }

  it('drags relative to the grab point when the touch lands on the knob', () => {
    const onChange = vi.fn()
    const el = mountSlider(80, onChange)               // knob at x=180
    pointer(el, 'pointerdown', { x: 180 + SLIDER_GRAB_PX - 2 })
    expect(onChange).not.toHaveBeenCalled()             // grabbing must not jump
    pointer(window, 'pointermove', { x: 180 + SLIDER_GRAB_PX - 2 + 60 })
    expect(onChange).toHaveBeenLastCalledWith(140)      // moved by 60, not to the finger
    pointer(window, 'pointerup')
  })

  it('still jumps to the touched position away from the knob', () => {
    const onChange = vi.fn()
    const el = mountSlider(80, onChange)
    pointer(el, 'pointerdown', { x: 350 })
    expect(onChange).toHaveBeenLastCalledWith(250)
    pointer(window, 'pointermove', { x: 360 })
    expect(onChange).toHaveBeenLastCalledWith(260)
    pointer(window, 'pointerup')
  })
})

describe('Stepper', () => {
  // controlled like every real caller: the parent re-renders with the new value
  function Host({ initial, onChange, step }) {
    const [v, setV] = React.useState(initial)
    return <Stepper value={v} step={step} onChange={n => { setV(n); onChange(n) }} />
  }
  const mountStepper = (value, onChange, step = 1) => {
    act(() => root.render(<Host initial={value} step={step} onChange={onChange} />))
    return host.querySelector('button[aria-label="Increase"]')
  }

  it('steps once for a short tap (pointerdown, pointerup, click)', () => {
    const onChange = vi.fn()
    const plus = mountStepper(10, onChange)
    pointer(plus, 'pointerdown'); pointer(plus, 'pointerup')
    act(() => plus.click())
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(11)
  })

  it('repeats while held and swallows the trailing click', () => {
    let value = 10
    const onChange = vi.fn(v => { value = v })
    const plus = mountStepper(value, onChange)
    pointer(plus, 'pointerdown')
    act(() => vi.advanceTimersByTime(399))
    expect(onChange).not.toHaveBeenCalled()
    // one act per tick: in the browser every interval callback is its own task
    act(() => vi.advanceTimersByTime(1 + 80))
    act(() => vi.advanceTimersByTime(80))
    act(() => vi.advanceTimersByTime(80))
    expect(onChange).toHaveBeenCalledTimes(3)
    // each repeat builds on the latest value, not the one the hold started with
    expect(onChange).toHaveBeenLastCalledWith(13)
    pointer(plus, 'pointerup')
    act(() => plus.click())
    expect(onChange).toHaveBeenCalledTimes(3)
    act(() => vi.advanceTimersByTime(1000))
    expect(onChange).toHaveBeenCalledTimes(3)           // nothing keeps ticking after release
  })

  it('keeps working from the keyboard (click without a pointer)', () => {
    const onChange = vi.fn()
    const plus = mountStepper(10, onChange)
    act(() => plus.click())
    expect(onChange).toHaveBeenCalledWith(11)
  })
})
