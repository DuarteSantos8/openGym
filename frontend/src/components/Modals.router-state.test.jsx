// @vitest-environment happy-dom
// A sheet's history entry carries the page's router state (usr). Without it, closing a sheet
// opened over another sheet walked back onto the first sheet's entry and the page read a null
// location.state.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Modals from './Modals.jsx'
import { useUI } from '../store/useUI.js'
import { nav, setNav } from '../lib/nav.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let root
let state
function Shell() {
  setNav(useNavigate())
  state = useLocation().state
  return null
}

const popped = () => new Promise(resolve => window.addEventListener('popstate', () => setTimeout(resolve, 0), { once: true }))

beforeEach(async () => {
  history.replaceState(null, '', '#/home')
  const el = document.createElement('div')
  document.body.appendChild(el)
  root = createRoot(el)
  await act(async () => {
    root.render(<HashRouter><Routes><Route path="*" element={<Shell />} /></Routes><Modals /></HashRouter>)
  })
  await act(async () => { nav('/workout', { state: { from: 'routine' } }) })
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  useUI.setState({ sheets: [] })
})

describe('a sheet\'s history entry', () => {
  it('keeps the page\'s router state', async () => {
    await act(async () => { useUI.getState().openSheet(() => null) })
    expect(history.state.openGymSheet).toBe(true)
    expect(history.state.usr).toEqual({ from: 'routine' })
  })

  it('closing a sheet opened over another leaves location.state as it was', async () => {
    let closeSecond
    await act(async () => { useUI.getState().openSheet(() => null) })
    await act(async () => { useUI.getState().openSheet(c => { closeSecond = c; return null }) })
    const back = popped()
    await act(async () => { closeSecond(); await back })
    expect(history.state.openGymSheet).toBe(true)
    expect(state).toEqual({ from: 'routine' })
  })
})
