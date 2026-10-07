// @vitest-environment happy-dom
import React, { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Slider, Stepper, NumberField, numWidthCh, SLIDER_GRAB_PX } from './ui.jsx'

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
  // 300px track from x=100 to x=400 over 0..300. The knob travels the track minus
  // its 13px insets on each side (usable 274px), so the scale is 300/274 per px.
  const mountSlider = (value, onChange) => {
    act(() => root.render(<Slider value={value} min={0} max={300} step={1} onChange={onChange} />))
    const el = host.querySelector('.sld')
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ left: 100, right: 400, width: 300, top: 0, bottom: 20, height: 20, x: 100, y: 0 })
    return el
  }

  it('drags relative to the grab point when the touch lands on the knob', () => {
    const onChange = vi.fn()
    const el = mountSlider(80, onChange)               // knob at x=186 (100 + 13 + 80/300 * 274)
    pointer(el, 'pointerdown', { x: 180 + SLIDER_GRAB_PX - 2 })
    expect(onChange).not.toHaveBeenCalled()             // grabbing must not jump
    pointer(window, 'pointermove', { x: 180 + SLIDER_GRAB_PX - 2 + 60 })
    expect(onChange).toHaveBeenLastCalledWith(146)      // moved with the finger, knob travel is 274px for 300 units
    pointer(window, 'pointerup')
  })

  it('still jumps to the touched position away from the knob', () => {
    const onChange = vi.fn()
    const el = mountSlider(80, onChange)
    pointer(el, 'pointerdown', { x: 350 })
    expect(onChange).toHaveBeenLastCalledWith(259)
    pointer(window, 'pointermove', { x: 360 })
    expect(onChange).toHaveBeenLastCalledWith(270)
    pointer(window, 'pointerup')
  })

  it('snaps from min, not from zero, so a min of 15 with step 10 stops at 15/25/35/45', () => {
    const seen = []
    act(() => root.render(<Slider value={35} min={15} max={45} step={10} onChange={v => seen.push(v)} />))
    const el = host.querySelector('.sld')
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ left: 100, right: 400, width: 300, top: 0, bottom: 20, height: 20, x: 100, y: 0 })
    // far left of the usable track lands on min, far right on max — never 20/30/40
    pointer(el, 'pointerdown', { x: 105 })
    expect(seen.at(-1)).toBe(15)
    pointer(el, 'pointerdown', { x: 395 })
    expect(seen.at(-1)).toBe(45)
    // the middle tick (25) sits halfway between 15 and 35 in value, i.e. 1/3 along the track
    pointer(el, 'pointerdown', { x: 100 + 13 + (274 / 3) })
    expect(seen.at(-1)).toBe(25)
    pointer(window, 'pointerup')
  })
})

describe('Slider under dir=rtl', () => {
  // The Slider scales from inline-start: min sits on the left in LTR and on the right in
  // RTL. These cases pin the RTL behaviour — the pointer math, the grab point and the
  // arrow keys — the parts that would silently break if the direction handling were
  // dropped.
  beforeEach(() => {
    document.documentElement.dir = 'rtl'
  })
  afterEach(() => {
    document.documentElement.dir = 'ltr'
  })

  const mountSlider = (value, onChange) => {
    act(() => root.render(<Slider value={value} min={0} max={300} step={1} onChange={onChange} />))
    const el = host.querySelector('.sld')
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ left: 100, right: 400, width: 300, top: 0, bottom: 20, height: 20, x: 100, y: 0 })
    return el
  }

  it('reads the pointer from the physical right: the left end is near max, the right end near min', () => {
    const onChange = vi.fn()
    const el = mountSlider(80, onChange)
    pointer(el, 'pointerdown', { x: 110 })              // left of the usable track → mirrored to max
    expect(onChange).toHaveBeenLastCalledWith(300)
    pointer(el, 'pointerdown', { x: 390 })              // right of the usable track → mirrored to min
    expect(onChange).toHaveBeenLastCalledWith(0)
  })

  it('grabs the knob from the right end and drags relative to the finger', () => {
    const onChange = vi.fn()
    const el = mountSlider(80, onChange)               // RTL knob sits at x=314 (400 - 13 - 80/300 * 274)
    pointer(el, 'pointerdown', { x: 314 + SLIDER_GRAB_PX - 2 })
    expect(onChange).not.toHaveBeenCalled()             // grabbing must not jump
    pointer(window, 'pointermove', { x: 314 + SLIDER_GRAB_PX - 2 + 60 })
    expect(onChange).toHaveBeenLastCalledWith(14)       // moved toward min with the finger, not to the finger
    pointer(window, 'pointerup')
  })

  it('swaps the horizontal arrows in RTL and keeps the vertical arrows as they are', () => {
    const onChange = vi.fn()
    const el = mountSlider(50, onChange)
    // The arrow toward the inline-end (max) still increases — that is Left in RTL.
    const key = k => act(() => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })))
    key('ArrowLeft')
    expect(onChange).toHaveBeenLastCalledWith(51)
    key('ArrowRight')
    expect(onChange).toHaveBeenLastCalledWith(49)
    key('ArrowUp')
    expect(onChange).toHaveBeenLastCalledWith(51)
    key('ArrowDown')
    expect(onChange).toHaveBeenLastCalledWith(49)
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

  // A minimum holds for the buttons at once but for typing only once the field is left, so a
  // field can be emptied to type a new number without the minimum landing in front of it.
  it('applies `min` to the buttons at once and to typing on leaving the field', () => {
    const onChange = vi.fn()
    function MinHost() {
      const [v, setV] = React.useState(5)
      return <Stepper value={v} step={5} min={1} decimal={false} onChange={n => { setV(n); onChange(n) }} />
    }
    act(() => root.render(<MinHost />))
    const minus = host.querySelector('button[aria-label="Decrease"]')
    const field = host.querySelector('input.num')
    act(() => minus.click())
    expect(onChange).toHaveBeenLastCalledWith(1)
    const type = value => {
      Object.getOwnPropertyDescriptor(field.constructor.prototype, 'value').set.call(field, value)
      field.dispatchEvent(new Event('input', { bubbles: true }))
    }
    act(() => type(''))
    expect(field.value).toBe('')
    act(() => type('7'))
    expect(field.value).toBe('7')
    act(() => type(''))
    act(() => field.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
    expect(onChange).toHaveBeenLastCalledWith(1)
    expect(field.value).toBe('1')
  })

  it('keeps working from the keyboard (click without a pointer)', () => {
    const onChange = vi.fn()
    const plus = mountStepper(10, onChange)
    act(() => plus.click())
    expect(onChange).toHaveBeenCalledWith(11)
  })
})

describe('NumberField fit', () => {
  // A field that hugs its digits, for the big weight read-out where the unit sits right beside
  // the number. Digits are one ch each under tabular numerals; a decimal point is narrower.
  it('measures digits as one ch and a decimal point as half', () => {
    expect(numWidthCh('82')).toBe(2)
    expect(numWidthCh('82.5')).toBe(3.5)
    expect(numWidthCh('')).toBe(1)
  })

  // The width follows what is on screen while typing (the draft), not the last committed
  // number — otherwise clearing the field would leave a 2ch-wide box around a lone caret and
  // the digits typed next would be clipped until the parent caught up.
  it('tracks the draft on screen while typing, and stays unsized without fit', () => {
    const type = (el, value) => {
      Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    function Harness({ fit }) {
      const [v, setV] = useState(70)
      return <NumberField fit={fit} value={v} onChange={setV} />
    }
    act(() => root.render(<Harness fit />))
    const input = host.querySelector('input')
    expect(input.style.width).toBe('2ch')

    act(() => type(input, ''))
    expect(input.value).toBe('')
    expect(input.style.width).toBe('1ch')

    act(() => type(input, '82,5'))
    expect(input.value).toBe('82.5')
    expect(input.style.width).toBe('3.5ch')

    act(() => root.render(<Harness fit={false} />))
    expect(host.querySelector('input').style.width).toBe('')
  })
})
