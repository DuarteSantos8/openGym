// @vitest-environment happy-dom
// The floating way back up (ScrollTopButton.jsx): in from 2.5 screens down, out again under one,
// out at once when tapped, and a jump instead of a glide with Reduce Motion on.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ScrollTopButton from './ScrollTopButton.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host, root, reduce
const scrolledTo = async y => {
  Object.defineProperty(window, 'scrollY', { configurable: true, value: y })
  await act(async () => { window.dispatchEvent(new Event('scroll')) })
}
const button = () => host.querySelector('#totop')
const shown = () => button()?.classList.contains('on') ?? false

beforeEach(() => {
  reduce = false
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
  Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 })
  window.matchMedia = vi.fn(q => ({ matches: reduce && q.includes('reduced-motion'), addEventListener() {}, removeEventListener() {} }))
  window.scrollTo = vi.fn()
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.body.style.position = ''
})

describe('when it shows', () => {
  it('comes in past 2.5 screens and leaves under one, with nothing in between flickering', async () => {
    await act(async () => root.render(<ScrollTopButton path="/library" />))
    expect(shown()).toBe(false)
    await scrolledTo(1990)                 // 2.49 screens
    expect(shown()).toBe(false)
    await scrolledTo(2010)
    expect(shown()).toBe(true)
    expect(document.body.classList.contains('totop-on')).toBe(true)
    await scrolledTo(1200)                 // on the way up it stays until near the top
    expect(shown()).toBe(true)
    await scrolledTo(790)
    expect(shown()).toBe(false)
    expect(document.body.classList.contains('totop-on')).toBe(false)
  })

  it('a page opened far down shows it straight away', async () => {
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 5000 })
    await act(async () => root.render(<ScrollTopButton path="/history" />))
    expect(shown()).toBe(true)
  })

  it('ignores the 0 a pinned body reports while a sheet is open', async () => {
    await act(async () => root.render(<ScrollTopButton path="/library" />))
    await scrolledTo(3000)
    document.body.style.position = 'fixed'
    await scrolledTo(0)
    expect(shown()).toBe(true)
  })

  it('is not there at all where it is switched off (the workout screen)', async () => {
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 5000 })
    await act(async () => root.render(<ScrollTopButton off path="/workout" />))
    await scrolledTo(6000)
    expect(button()).toBeNull()
    expect(document.body.classList.contains('totop-on')).toBe(false)
  })
})

describe('a tap', () => {
  it('glides to the top and the button leaves at once, staying out for the ride up', async () => {
    await act(async () => root.render(<ScrollTopButton path="/library" />))
    await scrolledTo(4000)
    await act(async () => button().click())
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'smooth' })
    expect(shown()).toBe(false)
    await scrolledTo(3000)                 // still above SHOW_AT on the way up
    expect(shown()).toBe(false)
    await scrolledTo(0)
    await scrolledTo(2500)                 // back down again: it returns
    expect(shown()).toBe(true)
  })

  it('jumps instead with Reduce Motion on', async () => {
    reduce = true
    await act(async () => root.render(<ScrollTopButton path="/library" />))
    await scrolledTo(4000)
    await act(async () => button().click())
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'auto' })
  })
})

it('has a name and takes focus only while it shows', async () => {
  await act(async () => root.render(<ScrollTopButton path="/library" />))
  expect(button().getAttribute('aria-label')).toBe('Back to top')
  expect(button().tabIndex).toBe(-1)
  expect(button().getAttribute('aria-hidden')).toBe('true')
  await scrolledTo(4000)
  expect(button().tabIndex).toBe(0)
  expect(button().hasAttribute('aria-hidden')).toBe(false)
})
