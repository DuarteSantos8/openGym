// @vitest-environment happy-dom
// + › Add photo on Progress › Body: Photos is a segment of that page, so the sheet's link swaps
// the page instead of stacking on it. From Weight, back returns to Progress; from Photos there is
// no second Photos entry to step through. Real router, real history, the real sheet host.
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { setNav } from '../lib/nav.js'
import Modals from './Modals.jsx'
import { openPlusSheet } from './PlusSheet.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host, root

function Wire() {
  const navigate = useNavigate()
  setNav(navigate)
  return null
}
function Where() {
  return <span data-testid="where">{useLocation().pathname}</span>
}
const where = () => host.querySelector('[data-testid="where"]').textContent
const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise(r => setTimeout(r, 30)) }) }
const go = async to => { await act(async () => { history.pushState(null, '', '#' + to); window.dispatchEvent(new PopStateEvent('popstate')) }); await settle() }
const back = async () => { await act(async () => { history.back() }); await settle() }
const addPhoto = async () => {
  const row = [...document.querySelectorAll('.plus-sheet button, .plus-sheet [role="button"]')].find(b => b.textContent.includes('Add photo'))
  await act(async () => { row.click() })
  await settle()
}

beforeEach(async () => {
  useStore.setState(s => ({ user: null, S: { ...s.S, active: null, checkIn: false, unit: 'kg' } }))
  useUI.setState({ sheets: [], toastMsg: '', toastAction: null })
  history.replaceState(null, '', '#/progress')
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root.render(<HashRouter>
      <Wire />
      <Where />
      <Routes><Route path="*" element={null} /></Routes>
      <Modals />
    </HashRouter>)
  })
  await settle()
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks() })

describe('Add photo from the + sheet on Body', () => {
  it('from Weight, takes the Weight entry: back returns to Progress', async () => {
    await go('/progress/body')
    await act(async () => { openPlusSheet('/progress/body') })
    await settle()
    await addPhoto()
    expect(where()).toBe('/progress/body/photos')
    await back()
    expect(where()).toBe('/progress')
  })

  it('from Photos, leaves no second Photos entry: back returns to Progress', async () => {
    await go('/progress/body/photos')
    await act(async () => { openPlusSheet('/progress/body/photos') })
    await settle()
    await addPhoto()
    expect(where()).toBe('/progress/body/photos')
    await back()
    expect(where()).toBe('/progress')
  })
})
