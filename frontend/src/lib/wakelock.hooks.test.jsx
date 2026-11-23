// @vitest-environment happy-dom
// The two places that keep the screen on, as React mounts them: App.jsx holds it for the running
// workout, CircuitPlayer.jsx for its clock. Either one letting go must leave the other's hold.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let live, requests
let useWakeLock
beforeEach(async () => {
  live = 0; requests = 0
  Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: async () => {
    requests++; live++
    let done = false
    return { addEventListener() {}, release: async () => { if (!done) { done = true; live-- } } }
  } } })
  vi.resetModules()
  ;({ useWakeLock } = await import('./wakelock.js'))
})
afterEach(() => { delete navigator.wakeLock })

function Holders({ workout, player }) {
  useWakeLock(workout)
  useWakeLock(player)
  return null
}
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })

describe('useWakeLock with the workout and the circuit player', () => {
  it('keeps the screen on for the workout after the circuit player lets go', async () => {
    const root = createRoot(document.createElement('div'))
    await act(async () => root.render(<Holders workout player={false} />)); await flush()
    expect(live).toBe(1)
    await act(async () => root.render(<Holders workout player />)); await flush()
    expect(live).toBe(1)
    await act(async () => root.render(<Holders workout player={false} />)); await flush()
    expect(live).toBe(1)
    await act(async () => root.render(<Holders workout={false} player={false} />)); await flush()
    expect(live).toBe(0)
    await act(async () => root.unmount())
  })

  it('keeps it on for the circuit player when the workout pauses under it', async () => {
    const root = createRoot(document.createElement('div'))
    await act(async () => root.render(<Holders workout player />)); await flush()
    await act(async () => root.render(<Holders workout={false} player />)); await flush()
    expect(live).toBe(1)
    await act(async () => root.unmount()); await flush()
    expect(live).toBe(0)
  })
})
