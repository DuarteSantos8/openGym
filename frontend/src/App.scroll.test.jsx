// @vitest-environment happy-dom
// The route's scroll restore on the very first load. A fresh load arrives as a POP with nothing
// remembered, and used to scroll to the top a frame later — on top of a scroll a view had made on
// mount (the superset card centring its row, views/Workout.jsx), cutting a smooth scroll off. It
// goes to the top now, in the same pass, so a view's own scroll runs after it and stands.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.jsx'
import { DEF, useStore } from './store/useStore.js'

vi.mock('./lib/sound.js', () => ({ setPlayOnSilent: vi.fn(), setVibrate: vi.fn(), setAlarmBuzzer: vi.fn() }))
vi.mock('./lib/api.js', async importOriginal => {
  const actual = await importOriginal()
  return { ...actual, api: vi.fn(() => Promise.resolve({})), beacon: vi.fn() }
})

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host, root, originalS, scrolls, frames
beforeEach(() => {
  originalS = useStore.getState().S
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  scrolls = []; frames = []
  window.scrollTo = vi.fn((x, y) => scrolls.push([x, y]))
  // Frames never run on their own here: what is asked for now is all that has landed.
  window.requestAnimationFrame = vi.fn(cb => { frames.push(cb); return frames.length })
  window.cancelAnimationFrame = vi.fn()
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  useStore.setState({ S: originalS })
})

describe('the first load', () => {
  it('goes to the top now, not a frame later', async () => {
    useStore.setState({ S: JSON.parse(JSON.stringify(DEF)) })
    await act(async () => { root.render(<App />) })
    expect(scrolls).toContainEqual([0, 0])
    // …and no top-of-page scroll is left waiting in a frame, where it would land on a view's own.
    const before = scrolls.length
    for (const cb of frames) cb()
    expect(scrolls.length).toBe(before)
  })
})
