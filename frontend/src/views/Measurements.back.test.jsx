// @vitest-environment happy-dom
// The back chevron on Body measurements goes back the way you came (Stats -> /measurements ->
// chevron -> Stats, the same thing the browser's and Android's back do), and a /measurements
// page opened with nothing behind it goes up to Stats, the only page that routes here — never
// Home, the way the pre-fix hardcoded chevron did (#704). window.history.state.idx is the
// react-router index the Settings back chevron already reads; the tests set it the way the
// router does on a fresh load ({ idx: 0 }) and after in-app navigation ({ idx: 2 }).
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import Measurements from './Measurements.jsx'

const nav = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => nav }))
vi.mock('../sheets.jsx', () => ({ confirmSheet: vi.fn() }))

let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  nav.mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  window.history.replaceState(null, '')
  host.remove()
})

const mount = () => act(() => root.render(<Measurements />))
const chevron = () => host.querySelector('.hdr .iconbtn')

describe('Measurements — the back chevron', () => {
  it('goes back the way you came when there is a way (Stats -> /measurements -> chevron)', () => {
    window.history.replaceState({ idx: 2 }, '')
    mount()
    act(() => { chevron().click() })
    expect(nav).toHaveBeenCalledWith(-1)
    expect(nav).not.toHaveBeenCalledWith('/home')
  })

  it('a /measurements page opened with nothing behind it goes up to Stats, not Home', () => {
    window.history.replaceState({ idx: 0 }, '')
    mount()
    act(() => { chevron().click() })
    expect(nav).toHaveBeenCalledTimes(1)
    expect(nav).toHaveBeenCalledWith('/stats', { replace: true })
  })

  it('says Back, not Home — the chevron is a back button, not a home button', () => {
    mount()
    expect(chevron().getAttribute('aria-label')).toBe('Back')
  })
})
