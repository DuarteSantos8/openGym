// @vitest-environment happy-dom
// A page opened from a sheet (#/workout ⋯ > Workout settings > All settings) takes over the
// sheet's history entry (closeThenNav), and the router numbers the new page from that entry's
// state. The sheet's entry carried no number, so Settings read index 0, and its back button went
// up to the Settings root instead of back to the workout that Android's back returns to.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Modals from './Modals.jsx'
import { useUI } from '../store/useUI.js'
import { closeThenNav, nav, setNav } from '../lib/nav.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let root
let here
function Shell() {
  setNav(useNavigate())
  here = useLocation().pathname
  return null
}

beforeEach(async () => {
  history.replaceState(null, '', '#/home')
  const el = document.createElement('div')
  document.body.appendChild(el)
  root = createRoot(el)
  await act(async () => {
    root.render(<HashRouter><Routes><Route path="*" element={<Shell />} /></Routes><Modals /></HashRouter>)
  })
  await act(async () => { nav('/workout') })
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  useUI.setState({ sheets: [] })
})

describe('a page that takes over a sheet\'s history entry', () => {
  // Settings' back goes back while history.state.idx > 0, and up to its parent page otherwise.
  it('keeps its place in history, one past the page the sheet opened on', async () => {
    const workout = history.state.idx
    let close
    await act(async () => { useUI.getState().openSheet(c => { close = c; return null }) })
    await act(async () => { closeThenNav(close, '/settings/workout') })
    expect(here).toBe('/settings/workout')
    expect(history.state.idx).toBe(workout + 1)
  })

  it('a page pushed from under an open sheet is numbered after the sheet', async () => {
    const workout = history.state.idx
    await act(async () => { useUI.getState().openSheet(() => null) })
    await act(async () => { nav('/settings') })
    expect(history.state.idx).toBe(workout + 2)
  })
})
