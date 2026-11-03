// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ScrubbyInput from './ScrubbyInput.jsx'
import { NumberField } from './ui.jsx'
import { stepEffort } from '../lib/history.js'
import { stepWeight } from '../lib/progression.js'
import { stepOwned } from '../lib/dumbbells.js'
import { workoutControls } from '../lib/workout-controls.js'
import { vibrate } from '../lib/sound.js'

vi.mock('../lib/sound.js', () => ({ vibrate: vi.fn() }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root, host, commit, tap, props
const render = (extra = {}) => {
  props = { enabled: true, value: 60, next: (v, d) => stepWeight(v, 2.5, d), onCommit: commit, ...extra }
  act(() => root.render(<ScrubbyInput {...props}>{v => <button onClick={tap}>{v ?? 'empty'}</button>}</ScrubbyInput>))
}
const button = () => host.querySelector('button')
const pointer = (name, y = 100, extra = {}, target = button()) => {
  const event = new PointerEvent(name, { pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0, clientX: 100, clientY: y, bubbles: true, cancelable: true, ...extra })
  act(() => target.dispatchEvent(event))
  return event
}
const hold = () => { pointer('pointerdown'); act(() => vi.advanceTimersByTime(300)) }
const text = () => button().textContent
beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  host = document.createElement('div'); document.body.append(host)
  root = createRoot(host); commit = vi.fn(); tap = vi.fn()
  render()
})
afterEach(() => {
  act(() => root.unmount()); host.remove()
  vi.runOnlyPendingTimers(); vi.useRealTimers()
})

describe('scrubby gesture', () => {
  it('keeps a short tap and never writes', () => {
    pointer('pointerdown'); act(() => vi.advanceTimersByTime(299)); pointer('pointerup')
    act(() => button().click())
    expect(tap).toHaveBeenCalledOnce(); expect(commit).not.toHaveBeenCalled()
  })
  it('previews discrete steps, reverses, and commits only once on release', () => {
    hold(); expect(host.querySelector('.scrubbing')).not.toBeNull()
    pointer('pointermove', 79); expect(text()).toBe('60')
    pointer('pointermove', 78); expect(text()).toBe('62.5')
    pointer('pointermove', 60); expect(text()).toBe('65')
    pointer('pointermove', 78); expect(text()).toBe('62.5')
    expect(commit).not.toHaveBeenCalled()
    pointer('pointerup', 78); pointer('pointerup', 78)
    expect(commit).toHaveBeenCalledExactlyOnceWith(62.5)
  })
  it.each(['pointercancel', 'lostpointercapture'])('discards on %s', name => {
    hold(); pointer('pointermove', 60); pointer(name, 100, {}, name === 'lostpointercapture' ? host.querySelector('.scrubby') : button()); pointer('pointerup')
    expect(commit).not.toHaveBeenCalled(); expect(text()).toBe('60')
  })
  it('keeps scrubbing when implicit capture transfers from the input to the wrapper', () => {
    hold(); pointer('lostpointercapture'); pointer('pointermove', 60); pointer('pointerup', 60)
    expect(commit).toHaveBeenCalledExactlyOnceWith(65)
  })
  it('leaves early vertical scroll and horizontal swipe to the page', () => {
    for (const extra of [{ clientY: 109 }, { clientX: 109 }]) {
      pointer('pointerdown'); expect(pointer('pointermove', 100, extra).defaultPrevented).toBe(false)
      act(() => vi.advanceTimersByTime(400)); pointer('pointerup')
      expect(host.querySelector('.scrubbing')).toBeNull()
    }
    expect(commit).not.toHaveBeenCalled()
  })
  it('suppresses a touch click after activation, even without movement', () => {
    hold(); pointer('pointerup')
    act(() => button().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })))
    expect(tap).not.toHaveBeenCalled(); expect(commit).not.toHaveBeenCalled()
    act(() => button().click()); expect(tap).toHaveBeenCalledOnce()
  })
  it('cancels on another pointer, then cleans up the gesture', () => {
    hold(); pointer('pointermove', 60)
    pointer('pointerdown', 100, { pointerId: 2, isPrimary: false }, document.body)
    pointer('pointerup', 60)
    expect(commit).not.toHaveBeenCalled()
  })
  it('blocks touch scrolling only after activation and cancels multi-touch', () => {
    const touch = touches => {
      const ev = new Event('touchmove', { bubbles: true, cancelable: true })
      Object.defineProperty(ev, 'touches', { value: touches })
      act(() => document.dispatchEvent(ev))
      return ev
    }
    pointer('pointerdown'); expect(touch([{}]).defaultPrevented).toBe(false)
    act(() => vi.advanceTimersByTime(300)); expect(touch([{}]).defaultPrevented).toBe(true)
    pointer('pointermove', 60); touch([{}, {}]); pointer('pointerup', 60)
    expect(commit).not.toHaveBeenCalled()
  })
  it('throttles haptics while keeping every preview step', () => {
    hold(); pointer('pointermove', 78)
    expect(vibrate).toHaveBeenCalledExactlyOnceWith(6)
    act(() => vi.advanceTimersByTime(50)); pointer('pointermove', 60); pointer('pointermove', 42)
    expect(vibrate).toHaveBeenCalledTimes(2); expect(text()).toBe('67.5')
  })
  it('cancels when the application becomes hidden', () => {
    hold(); pointer('pointermove', 60)
    const spy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    act(() => document.dispatchEvent(new Event('visibilitychange'))); pointer('pointerup', 60)
    spy.mockRestore(); expect(commit).not.toHaveBeenCalled()
  })
  it('cancels on changed data, target, setting, Escape and backgrounding', () => {
    hold(); pointer('pointermove', 60); render({ revision: {} }); pointer('pointerup')
    hold(); pointer('pointermove', 60); render({ targetKey: 'other' }); pointer('pointerup')
    hold(); pointer('pointermove', 60); render({ enabled: false }); pointer('pointerup')
    render(); hold(); pointer('pointermove', 60)
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    pointer('pointerup')
    hold(); pointer('pointermove', 60); act(() => window.dispatchEvent(new Event('blur'))); pointer('pointerup')
    expect(commit).not.toHaveBeenCalled()
  })
  it('cancels unmounts and removes pending timers/listeners', () => {
    hold(); pointer('pointermove', 60)
    act(() => root.render(null))
    pointer('pointerup', 60, {}, document.body)
    act(() => vi.advanceTimersByTime(1000))
    expect(commit).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0)
  })
  it('preserves mouse behavior and disabled-by-default settings', () => {
    expect(workoutControls({}).scrubby).toBe(false)
    pointer('pointerdown', 100, { pointerType: 'mouse' }); act(() => vi.advanceTimersByTime(400))
    expect(host.querySelector('.scrubbing')).toBeNull()
    render({ enabled: false }); hold(); pointer('pointerup'); expect(commit).not.toHaveBeenCalled()
  })
  it('uses irregular equipment stepping and can reverse at the upper limit', () => {
    render({ value: 11, next: (v, d) => stepOwned([9, 11, 13], v, d) })
    hold(); pointer('pointermove', 42); expect(text()).toBe('13')
    pointer('pointermove', 60); expect(text()).toBe('11')
    pointer('pointerup', 60); expect(commit).not.toHaveBeenCalled() // returned to initial
  })
  it.each(['rir', 'rpe'])('keeps nullable %s and half steps edit-only', kind => {
    render({ value: null, next: (v, d) => stepEffort(kind, v, d) })
    hold(); pointer('pointermove', 78); expect(text()).toBe(kind === 'rir' ? '0' : '6')
    pointer('pointermove', 60); expect(text()).toBe(kind === 'rir' ? '0.5' : '6.5')
    pointer('pointerup', 60)
    expect(commit).toHaveBeenCalledExactlyOnceWith(kind === 'rir' ? 0.5 : 6.5)
    expect(tap).not.toHaveBeenCalled()
  })
  it('keeps the native input unfocused until a short release, and out of the keyboard on hold', () => {
    act(() => root.render(<ScrubbyInput numeric {...props}>{v => <NumberField value={v} onChange={commit} />}</ScrubbyInput>))
    const input = host.querySelector('input')
    const hit = host.querySelector('.scrubby-hit')
    expect(hit.tagName).toBe('SPAN')
    expect(input.readOnly).toBe(false)
    pointer('pointerdown', 100, {}, hit); expect(document.activeElement).not.toBe(input)
    pointer('pointerup', 100, {}, hit); expect(document.activeElement).toBe(input)
    input.blur()
    pointer('pointerdown', 100, {}, hit); act(() => vi.advanceTimersByTime(300))
    pointer('pointermove', 60, {}, hit); pointer('pointerup', 60, {}, hit)
    expect(document.activeElement).not.toBe(input)
    expect(commit).toHaveBeenCalledExactlyOnceWith(65)
  })
  it('a numeric hold without movement cannot enter editing, including its compatibility click', () => {
    act(() => root.render(<ScrubbyInput numeric {...props}>{v => <NumberField value={v} onChange={commit} />}</ScrubbyInput>))
    const hit = host.querySelector('.scrubby-hit'), input = host.querySelector('input')
    const focus = vi.spyOn(input, 'focus')
    pointer('pointerdown', 100, {}, hit); act(() => vi.advanceTimersByTime(300))
    expect(focus).not.toHaveBeenCalled()
    pointer('pointerup', 100, {}, hit)
    act(() => hit.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })))
    expect(focus).not.toHaveBeenCalled(); expect(commit).not.toHaveBeenCalled()
  })
  it('early numeric scroll does not focus, while mouse entry and focused editing remain native', () => {
    act(() => root.render(<ScrubbyInput numeric {...props}>{v => <NumberField value={v} onChange={commit} />}</ScrubbyInput>))
    const hit = host.querySelector('.scrubby-hit'), input = host.querySelector('input')
    pointer('pointerdown', 100, {}, hit); pointer('pointermove', 120, {}, hit)
    act(() => vi.advanceTimersByTime(400)); pointer('pointerup', 120, {}, hit)
    expect(document.activeElement).not.toBe(input)
    pointer('pointerdown', 100, { pointerType: 'mouse' }, hit)
    expect(document.activeElement).toBe(input)
    pointer('pointerdown', 100, {}, input); act(() => vi.advanceTimersByTime(400))
    expect(host.querySelector('.scrubbing')).toBeNull()
    expect(document.activeElement).toBe(input)
  })
  it('disabled numeric scrubbing renders the original editable input without a hit surface', () => {
    act(() => root.render(<ScrubbyInput numeric {...props} enabled={false}>{v => <NumberField value={v} onChange={commit} />}</ScrubbyInput>))
    expect(host.querySelector('.scrubby-hit')).toBeNull()
    const input = host.querySelector('input')
    act(() => input.focus()); expect(document.activeElement).toBe(input)
    expect(input.readOnly).toBe(false)
  })
})
