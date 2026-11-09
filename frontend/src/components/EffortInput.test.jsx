// @vitest-environment happy-dom
import React, { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EffortInput from './EffortInput.jsx'

vi.mock('../lib/sound.js', () => ({ vibrate: vi.fn() }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root, host, commit
function Fixture({ value, ...props }) {
  const [rating, setRating] = useState(value)
  return <EffortInput {...props} value={rating} label="Effort" scrubby={{ enabled: true }}
    onOpen={vi.fn()} onChange={v => { commit(v); setRating(v) }} />
}
const button = () => host.querySelector('button[aria-label="Effort"]')
const surface = () => host.querySelector('.effcell-stp') || button()
const pointer = (name, y = 100) => act(() => button().dispatchEvent(new PointerEvent(name, { pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0, clientX: 100, clientY: y, bubbles: true, cancelable: true })))
const hold = () => { pointer('pointerdown'); act(() => vi.advanceTimersByTime(300)) }
beforeEach(() => {
  vi.useFakeTimers(); commit = vi.fn()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount()); host.remove(); vi.runOnlyPendingTimers(); vi.useRealTimers()
})

describe.each(['dark', 'light'])('effort preview in %s theme', theme => {
  it.each([
    ['rir', false, true, 1, 2, '--yellow'],
    ['rir', false, false, 1, 2, '--yellow'],
    ['rir', true, false, 1, 2, '--yellow'],
    ['rpe', false, true, 9, 10, '--purple'],
    ['rpe', true, false, 9, 10, '--purple'],
  ])('%s: focus=%s, buttons=%s updates one authoritative tint and restores on cancel', (kind, focus, steppers, value, shown, color) => {
    document.documentElement.dataset.theme = theme
    act(() => root.render(<Fixture kind={kind} focus={focus} steppers={steppers} value={value} />))
    expect(surface().style.color).toBe('var(--orange)')
    hold(); pointer('pointermove', 60)
    expect(button().textContent).toBe(String(shown))
    expect(surface().style.color).toBe(`var(${color})`)
    // happy-dom does not parse color-mix; the browser check covers the actual paint.
    expect([...host.querySelectorAll('[style]')].filter(el => el.style.color)).toHaveLength(1)
    if (!focus) expect(button().style.background).toBe('')
    expect(commit).not.toHaveBeenCalled()
    pointer('pointercancel', 60)
    expect(button().textContent).toBe(String(value))
    expect(surface().style.color).toBe('var(--orange)')
    expect(commit).not.toHaveBeenCalled()
    hold(); pointer('pointermove', 60); pointer('pointerup', 60)
    expect(button().textContent).toBe(String(shown))
    expect(surface().style.color).toBe(`var(${color})`)
    expect(commit).toHaveBeenCalledExactlyOnceWith(shown)
    delete document.documentElement.dataset.theme
  })
  it('starts and ends empty without leaving a stale rating tint', () => {
    act(() => root.render(<Fixture kind="rir" value={null} />))
    expect(button().classList.contains('is-empty')).toBe(true)
    expect(surface().style.background).toBe('')
    hold(); pointer('pointermove', 78)
    expect(button().classList.contains('is-empty')).toBe(false)
    expect(surface().style.color).toBe('var(--purple)')
    pointer('pointercancel', 78)
    expect(button().classList.contains('is-empty')).toBe(true)
    expect(surface().style.background).toBe('')
  })
  it('keeps gesture listeners attached when committing empty to rated and back', () => {
    act(() => root.render(<Fixture kind="rir" value={null} />))
    hold(); pointer('pointermove', 78); pointer('pointerup', 78)
    expect(button().textContent).toBe('0')
    hold(); pointer('pointermove', 122); pointer('pointerup', 122)
    expect(button().classList.contains('is-empty')).toBe(true)
    expect(surface().style.background).toBe('')
    hold(); pointer('pointermove', 60); pointer('pointerup', 60)
    expect(button().textContent).toBe('0.5')
    expect(commit.mock.calls.map(([v]) => v)).toEqual([0, null, 0.5])
  })
})
