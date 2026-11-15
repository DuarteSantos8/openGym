// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Routes, Route, useNavigate } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { riseTo } from './rise.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const root = () => document.documentElement
let host, rt
afterEach(() => {
  act(() => rt?.unmount()); host?.remove(); rt = host = null
  delete document.startViewTransition; vi.unstubAllGlobals(); delete root().dataset.rise
  location.hash = ''
})
const mount = () => {
  let navigate
  const Grab = () => { navigate = useNavigate(); return null }
  host = document.createElement('div'); document.body.appendChild(host); rt = createRoot(host)
  act(() => { rt.render(<HashRouter><Grab /><Routes><Route path="/home" element={<p>HOME</p>} /><Route path="/workout" element={<p>WORKOUT</p>} /></Routes></HashRouter>) })
  return navigate
}
const reduced = on => vi.stubGlobal('matchMedia', () => ({ matches: on }))

describe('riseTo', () => {
  it('holds the transition until the new route is in the DOM', async () => {
    reduced(false)
    const navigate = mount()
    let ready, seen
    document.startViewTransition = cb => { ready = cb(); return { finished: Promise.resolve() } }
    act(() => { riseTo(navigate, '/workout') })
    await act(async () => { await ready; seen = host.textContent })
    expect(seen).toBe('WORKOUT')
  })

  it('clears the name when finished is rejected, and when it settles', async () => {
    reduced(false)
    const navigate = mount()
    document.startViewTransition = cb => { cb(); return { finished: Promise.reject(new Error('skipped')) } }
    await act(async () => { riseTo(navigate, '/workout'); await new Promise(r => setTimeout(r, 0)) })
    expect(root().dataset.rise).toBeUndefined()
  })

  it('falls back to a plain navigate when startViewTransition throws', () => {
    reduced(false)
    const nav = vi.fn()
    document.startViewTransition = () => { throw new Error('nope') }
    riseTo(nav, '/workout')
    expect(nav).toHaveBeenCalledWith('/workout')
    expect(root().dataset.rise).toBeUndefined()
  })
})
