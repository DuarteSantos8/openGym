// @vitest-environment happy-dom
// The iPhone's control feel in the shared controls (Liquid Glass G5): VoiceOver adjustable
// steppers, the segmented pill's slide, the set tick's pop. Off the iPhone none of it exists.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Stepper, Segmented, Check } from './ui.jsx'
import { setNativeHaptic } from '../lib/sound.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host, root, buzzes
beforeEach(() => {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  buzzes = []; setNativeHaptic(k => { buzzes.push(k); return Promise.resolve(true) })
})
afterEach(() => {
  act(() => root.unmount()); host.remove(); setNativeHaptic(null)
  delete document.documentElement.dataset.platform
  vi.restoreAllMocks()
})
const ios = () => { document.documentElement.dataset.platform = 'ios' }
const click = el => act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })))

describe('Stepper on the iPhone', () => {
  it('is a spinbutton with a value text, and the arrow keys VoiceOver sends step it', () => {
    ios()
    const onChange = vi.fn()
    act(() => root.render(<Stepper value={82.5} step={2.5} max={100} unit="kg" ariaLabel="Weight" onChange={onChange} />))
    const inp = host.querySelector('input')
    expect(inp.getAttribute('role')).toBe('spinbutton')
    expect(inp.getAttribute('aria-valuenow')).toBe('82.5')
    expect(inp.getAttribute('aria-valuetext')).toBe('82.5 kg')
    expect(inp.getAttribute('aria-label')).toBe('Weight')
    act(() => inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true })))
    expect(onChange).toHaveBeenLastCalledWith(85)
    expect(buzzes).toEqual(['selection'])
  })

  it('an empty value is no NaN, and at the limit it is one light haptic', () => {
    ios()
    act(() => root.render(<Stepper value={100} max={100} unit="kg" onChange={() => {}} />))
    click(host.querySelectorAll('button')[1])
    expect(buzzes).toEqual(['light'])
    act(() => root.render(<Stepper value="" unit="kg" onChange={() => {}} />))
    const inp = host.querySelector('input')
    expect(inp.hasAttribute('aria-valuenow')).toBe(false)
    expect(inp.getAttribute('aria-valuetext')).not.toMatch(/NaN/)
  })

  it('off the iPhone it is the plain text field it was, with no haptic', () => {
    act(() => root.render(<Stepper value={80} unit="kg" onChange={() => {}} />))
    expect(host.querySelector('input').getAttribute('role')).toBeNull()
    click(host.querySelectorAll('button')[1])
    expect(buzzes).toEqual([])
  })
})

describe('Segmented', () => {
  const opts = ['a', 'b', 'c'].map(v => ({ value: v, label: v }))
  it('buzzes a selection on iPhone only when the value changes', () => {
    ios()
    const Host = ({ v }) => <Segmented options={opts} value={v} onChange={() => {}} />
    act(() => root.render(<Host v="a" />))
    act(() => root.render(<Host v="c" />))
    expect(host.querySelector('.seg').style.getPropertyValue('--i')).toBe('2')
    act(() => root.render(<Host v="b" />))
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 10_000)   // past the 80 ms selection throttle
    click(host.querySelectorAll('button')[1]); expect(buzzes).toEqual([])
    click(host.querySelectorAll('button')[0]); expect(buzzes).toEqual(['selection'])
  })
})

describe('Segmented pill css', () => {
  it('slides by transform on iOS, never by inset (RTL comes from the base translateX rule)', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')
    const r = css.match(/:root\[data-platform="ios"\] \.seg-sel\{([^}]*)\}/)[1]
    expect(r).toMatch(/transition:transform calc\(\.22s\*var\(--fx\)\) var\(--spring-soft\)/)
    expect(r).not.toMatch(/inset-inline/)
    expect(css).toMatch(/\[dir="rtl"\] \.seg-sel\{transform:translateX\(calc\(-100% \* var\(--i\)\)\)\}/)
  })
})

describe('Check with pop', () => {
  it('pops the circle after the user\'s own tick, and not for a tick that arrives by itself', async () => {
    ios()
    const Host = ({ on }) => <Check pop checked={on} onChange={() => {}} label="Set 1 done" />
    act(() => root.render(<Host on={false} />))
    const btn = host.querySelector('button')
    click(btn)
    act(() => root.render(<Host on={true} />))   // the store answers
    await act(async () => { await Promise.resolve() })
    expect(btn.classList.contains('pop')).toBe(true)
    act(() => root.render(<Host on={false} />))
    btn.classList.remove('pop')
    act(() => root.render(<Host on={true} />))   // sync / watch: checked changes with no tap
    await act(async () => { await Promise.resolve() })
    expect(btn.classList.contains('pop')).toBe(false)
  })
})
