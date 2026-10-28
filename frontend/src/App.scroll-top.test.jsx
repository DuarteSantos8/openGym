// @vitest-environment happy-dom
// Back to the top, in the app itself: the floating button over a long page, the re-tapped tab,
// neither of them on the workout screen, and the route's remembered scroll position untouched.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.jsx'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'

vi.mock('./lib/sound.js', async importOriginal => ({ ...(await importOriginal()), setPlayOnSilent: vi.fn(), setVibrate: vi.fn(), setAlarmBuzzer: vi.fn(), setNativeBuzzer: vi.fn() }))
vi.mock('./lib/api.js', async importOriginal => {
  const actual = await importOriginal()
  return { ...actual, api: vi.fn(() => Promise.resolve({})), beacon: vi.fn() }
})

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host, root, originalS, scrolls
const scrolledTo = async y => {
  Object.defineProperty(window, 'scrollY', { configurable: true, value: y })
  await act(async () => { window.dispatchEvent(new Event('scroll')) })
}
const frame = () => act(async () => { await new Promise(r => requestAnimationFrame(() => r())) })
const tap = async el => { await act(async () => { el.click() }); await frame() }
const appear = async find => {
  const get = typeof find === 'string' ? () => document.querySelector(find) : find
  for (let i = 0; i < 500 && !get(); i++) await act(async () => { await new Promise(r => setTimeout(r, 10)) })
  return get()
}
const start = async (hash, S = JSON.parse(JSON.stringify(DEF))) => {
  useStore.setState({ S })
  window.location.hash = hash
  await act(async () => { root.render(<App />) })
}

beforeEach(() => {
  originalS = useStore.getState().S
  localStorage.setItem('gym_guest', '1')
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  scrolls = []
  // window.scrollTo(x, y) from the route restore, window.scrollTo({ top }) from the way back up.
  window.scrollTo = vi.fn((x, y) => {
    const top = typeof x === 'object' ? x.top : y
    scrolls.push(typeof x === 'object' ? x : [x, y])
    Object.defineProperty(window, 'scrollY', { configurable: true, value: top })
  })
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  useUI.getState().stopRest?.()
  useStore.setState({ S: originalS })
  localStorage.removeItem('gym_guest')
})

describe('on a long page', () => {
  it('the button comes in far down, and a tap glides to the top', async () => {
    await start('#/stats')
    await appear('#app .hdr button[aria-label="History"]')
    expect(document.querySelector('#totop.on')).toBeNull()
    await scrolledTo(2400)
    expect(document.querySelector('#totop.on')).toBeTruthy()
    await tap(document.querySelector('#totop'))
    expect(scrolls.at(-1)).toEqual({ top: 0, left: 0, behavior: 'smooth' })
    expect(document.querySelector('#totop.on')).toBeNull()
  })

  it('the tab you are on, tapped again, glides to the top too', async () => {
    await start('#/stats')
    await appear('#app .hdr button[aria-label="History"]')
    await scrolledTo(1500)
    await tap([...document.querySelectorAll('#tabbar button')].find(b => b.textContent === 'Stats'))
    expect(window.location.hash).toBe('#/stats')
    expect(scrolls.at(-1)).toEqual({ top: 0, left: 0, behavior: 'smooth' })
  })

  it('leaves the remembered position alone: back from History lands where Stats was', async () => {
    await start('#/stats')
    await appear('#app .hdr button[aria-label="History"]')
    await scrolledTo(3000)
    await tap(document.querySelector('#app .hdr button[aria-label="History"]'))
    expect(window.location.hash).toBe('#/history')
    expect(scrolls.at(-1)).toEqual([0, 0])
    await tap(await appear('#app [data-back]'))
    expect(window.location.hash).toBe('#/stats')
    expect(scrolls.at(-1)).toEqual([0, 3000])
  })
})

it('never shows inside a workout', async () => {
  const S = JSON.parse(JSON.stringify(DEF))
  S.sound = false
  S.active = { id: 'test', name: 'Test', start: Date.now(), cur: 0, entries: [
    { id: '1001', target: { mode: 'reps' }, sets: [{ w: 10, r: 5, done: false }] },
  ] }
  await start('#/workout', S)
  await scrolledTo(6000)
  expect(document.querySelector('#totop')).toBeNull()
  expect(document.body.classList.contains('totop-on')).toBe(false)
})
