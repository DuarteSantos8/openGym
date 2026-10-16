// @vitest-environment happy-dom
/* The splash the app opens with: over the page while it loads, drawn from the still G the first frame
 * shows, leaving when the animation is over and the app is ready (not before, not on a timer alone),
 * ended early by a tap or a key, played once per page load, and not at all for reduced motion or
 * where there is no canvas. The animation itself (lib/brand-splash.js) is a stand-in here: what is
 * checked is when the overlay is up and when it goes. */
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import BootSplash, { LEAVE_MS, resetBootSplash } from './BootSplash.jsx'
import { MIN_SHOW_MS } from '../lib/splash-rules.js'
import { useStore } from '../store/useStore.js'

const mocks = vi.hoisted(() => ({ created: [], ok: true, glyphs: Promise.resolve({ glyphs: true }) }))
vi.mock('../lib/brand-splash.js', () => ({
  loadGlyphs: () => mocks.glyphs,
  createSplash: (canvas, glyphs, opts) => {
    const handle = { ok: mocks.ok, destroy: vi.fn(), canvas, glyphs, opts }
    mocks.created.push(handle)
    return handle
  },
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let root, host, originalS
const realGetContext = HTMLCanvasElement.prototype.getContext
const q = s => document.querySelector(s)
const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve() })
const mount = async () => { act(() => root.render(<BootSplash />)); await settle() }
const setReady = ready => act(() => { useStore.setState({ ready }) })
const inert = id => document.getElementById(id).hasAttribute('inert')
const elapse = ms => act(() => { vi.advanceTimersByTime(ms) })
const finish = () => elapse(MIN_SHOW_MS)   // it has now been up for the minimum

beforeEach(() => {
  vi.useFakeTimers()
  mocks.created.length = 0; mocks.ok = true; mocks.glyphs = Promise.resolve({ glyphs: true })
  resetBootSplash()
  originalS = useStore.getState().S
  useStore.setState({ ready: false, S: { ...originalS, reduceMotion: false } })
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({}))
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  // The page the splash covers, as App.jsx draws it.
  window.location.hash = ''; window.location.search = ''
  document.body.innerHTML = '<div id="app"><button id="behind">Start</button></div><nav id="tabbar"></nav><div id="timer"></div>'
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount()); host.remove(); document.body.innerHTML = ''
  useStore.setState({ S: originalS, ready: false })
  HTMLCanvasElement.prototype.getContext = realGetContext
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers()
})

describe('BootSplash', () => {
  it('covers the page with the still G until the letters are loaded, then hands over to the canvas', async () => {
    let release
    mocks.glyphs = new Promise(r => { release = r })
    act(() => root.render(<BootSplash />))
    const box = q('.boot-splash')
    expect(box.getAttribute('aria-hidden')).toBe('true')
    expect(box.querySelector('.boot-mark svg.brand-mark')).not.toBeNull()
    expect(box.hasAttribute('data-drawing')).toBe(false)
    expect(mocks.created).toHaveLength(0)
    release({ glyphs: true }); await settle()
    expect(mocks.created).toHaveLength(1)
    expect(mocks.created[0].canvas).toBe(box.querySelector('canvas'))
    expect(mocks.created[0].opts.fromG).toBe(true)     // the G is already on screen: it must not redraw
    expect(box.hasAttribute('data-drawing')).toBe(true)  // and the still one under the canvas goes
  })

  it('puts the page behind it out of reach while it plays, and gives it back as it leaves', async () => {
    await mount()
    for (const id of ['app', 'tabbar', 'timer']) expect(inert(id), id).toBe(true)
    finish()
    for (const id of ['app', 'tabbar', 'timer']) expect(inert(id), id + ' while it waits for the state').toBe(true)
    await setReady(true)
    for (const id of ['app', 'tabbar', 'timer']) expect(inert(id), id + ' once it leaves').toBe(false)
  })

  it('gives the page back when it is taken away early', async () => {
    await mount()
    expect(inert('app')).toBe(true)
    act(() => root.render(null))
    expect(inert('app')).toBe(false)
  })

  it('does not touch the page when it is not played', async () => {
    HTMLCanvasElement.prototype.getContext.mockImplementation(() => null)
    await mount()
    for (const id of ['app', 'tabbar', 'timer']) expect(inert(id), id).toBe(false)
  })

  it('leaves alone an inert someone else set, and does not lift it', async () => {
    document.getElementById('app').setAttribute('inert', '')
    await mount()
    act(() => root.render(null))
    expect(inert('app')).toBe(true)
  })

  it('stays up past the minimum until the app has read its state, then fades and goes', async () => {
    await mount()
    finish()
    expect(q('.boot-splash').className).toBe('boot-splash')
    elapse(60000)
    expect(q('.boot-splash')).not.toBeNull()            // not on a timer alone
    await setReady(true)
    expect(q('.boot-splash').className).toBe('boot-splash leaving')
    elapse(LEAVE_MS)
    expect(q('.boot-splash')).toBeNull()
  })

  it('stays up after the app is ready until it has been up for the minimum', async () => {
    await mount()
    elapse(300)
    await setReady(true)
    expect(q('.boot-splash').className).toBe('boot-splash')
    elapse(MIN_SHOW_MS - 300 - 1)
    expect(q('.boot-splash').className).toBe('boot-splash')
    elapse(1)
    expect(q('.boot-splash').className).toBe('boot-splash leaving')
  })

  it('leaves at the later of the app being ready and the minimum: ready at 2 s leaves at 2 s, not after a tail', async () => {
    await mount()
    elapse(2000)
    expect(q('.boot-splash').className).toBe('boot-splash')
    await setReady(true)
    expect(q('.boot-splash').className).toBe('boot-splash leaving')
    elapse(LEAVE_MS)
    expect(q('.boot-splash')).toBeNull()
  })

  it('the page is back in reach by the minimum plus the fade at the latest when the app is ready at once', async () => {
    await mount()
    await setReady(true)
    finish()
    expect(q('.boot-splash').className).toBe('boot-splash leaving')
    elapse(LEAVE_MS)
    expect(q('.boot-splash')).toBeNull()
    expect(inert('app')).toBe(false)
  })

  it('is dropped, and never draws, when the app is ready before the letters have loaded', async () => {
    let release
    mocks.glyphs = new Promise(r => { release = r })
    act(() => root.render(<BootSplash />))
    expect(q('.boot-splash')).not.toBeNull()
    expect(inert('app')).toBe(true)
    await setReady(true)
    expect(q('.boot-splash')).toBeNull()
    expect(inert('app')).toBe(false)
    release({ glyphs: true }); await settle()
    expect(mocks.created).toHaveLength(0)
  })

  it('is not played at all when the app is already ready at mount', async () => {
    useStore.setState({ ready: true })
    await mount()
    expect(q('.boot-splash')).toBeNull()
    expect(mocks.created).toHaveLength(0)
  })

  it.each([
    ['a route in the hash (a deep link or a notification tap)', () => { window.location.hash = '#/train/workout' }],
    ['a pairing link query', () => { window.location.search = '?link=ABC123' }],
  ])('is not played on a launch with %s', async (_, launch) => {
    launch()
    await mount()
    expect(q('.boot-splash')).toBeNull()
    expect(mocks.created).toHaveLength(0)
    expect(inert('app')).toBe(false)
  })

  it('is still played on a plain cold start, with or without an empty hash', async () => {
    window.location.hash = '#/'
    await mount()
    expect(q('.boot-splash')).not.toBeNull()
  })

  it('a tap ends it early, and it still waits for the state', async () => {
    await mount()
    act(() => { q('.boot-splash').click() })
    expect(q('.boot-splash').className).toBe('boot-splash')
    await setReady(true)
    expect(q('.boot-splash').className).toBe('boot-splash leaving')
  })

  it.each(['Escape', 'Enter', ' '])('the %s key ends it early', async key => {
    await mount()
    await setReady(true)
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key })) })
    expect(q('.boot-splash').className).toBe('boot-splash leaving')
  })

  it('other keys do not', async () => {
    await mount()
    await setReady(true)
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' })) })
    expect(q('.boot-splash').className).toBe('boot-splash')
  })

  it('stops the animation when it is taken away', async () => {
    await mount()
    act(() => root.render(null))
    expect(mocks.created[0].destroy).toHaveBeenCalled()
  })

  it('plays once per page load: a second mount in the same page shows nothing', async () => {
    await mount()
    finish(); await setReady(true)
    act(() => { vi.advanceTimersByTime(LEAVE_MS) })
    act(() => root.render(null))
    await mount()
    expect(q('.boot-splash')).toBeNull()
    expect(mocks.created).toHaveLength(1)
  })

  it('is skipped where there is no 2D canvas', async () => {
    HTMLCanvasElement.prototype.getContext.mockImplementation(() => null)
    await mount()
    expect(q('.boot-splash')).toBeNull()
    expect(mocks.created).toHaveLength(0)
  })

  it('is skipped when the device asks for reduced motion', async () => {
    vi.stubGlobal('matchMedia', query => ({ matches: query.includes('reduce') }))
    await mount()
    expect(q('.boot-splash')).toBeNull()
  })

  it('is skipped when the app\'s own reduce-motion switch is on', async () => {
    useStore.setState({ S: { ...useStore.getState().S, reduceMotion: true } })
    await mount()
    expect(q('.boot-splash')).toBeNull()
  })

  it('goes quietly when the canvas cannot draw after all', async () => {
    mocks.ok = false
    await mount()
    expect(q('.boot-splash')).toBeNull()
  })

  it('goes quietly when the letters cannot be loaded', async () => {
    mocks.glyphs = Promise.reject(new Error('offline'))
    mocks.glyphs.catch(() => {})
    await mount()
    expect(q('.boot-splash')).toBeNull()
  })
})
