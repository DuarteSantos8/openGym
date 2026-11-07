// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import RestTimer, { fusedKind } from './RestTimer.jsx'
import { useUI } from '../store/useUI.js'
import { useStore } from '../store/useStore.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn() }))

let host, root, originalS
const rest = (over = {}) => ({ left: 60, total: 90, endsAt: Date.now() + 60000, forIdx: 0, ...over })

beforeEach(() => {
  vi.useFakeTimers()
  originalS = useStore.getState().S
  useStore.setState({ S: { ...originalS, sound: false } })
  useUI.setState({ timer: null, work: null, countIn: null, sheets: [] })
  document.documentElement.dataset.platform = 'ios'
  window.matchMedia = q => ({ matches: q.includes('reduced-motion'), addEventListener() {}, removeEventListener() {} })   // Reduce Motion: no clip-path, no flip
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.render(null))
  useUI.getState().stopRest(); useUI.getState().stopWork()
  useStore.setState({ S: originalS })
  delete document.documentElement.dataset.platform
  host.remove(); vi.useRealTimers()
})
const mount = (docked = true) => act(() => root.render(<RestTimer docked={docked} />))

describe('fusedKind', () => {
  it('a rest and a plain hold are fused; the chain\'s own rows keep the card', () => {
    expect(fusedKind({ timer: rest() })).toBe('rest')
    expect(fusedKind({ timer: rest({ ready: true, autoNext: 'Plank' }) })).toBe('rest')
    expect(fusedKind({ timer: rest({ autoNext: 'Plank' }) })).toBe('')
    expect(fusedKind({ work: { left: 5, total: 45 } })).toBe('work')
    expect(fusedKind({ work: { left: 5, total: 45, auto: true } })).toBe('')
    expect(fusedKind({ countIn: { left: 3, total: 3 }, timer: rest() })).toBe('')
  })
})

describe('the docked row on the iPhone', () => {
  it('replaces the card, shows the time and keeps the controls', () => {
    act(() => useUI.setState({ timer: rest() }))
    mount()
    expect(document.getElementById('timer')).toBeNull()
    const row = document.querySelector('.trow.dock')
    expect(row.querySelector('.clk .t').textContent).toBe('1:00')
    expect(row.getAttribute('data-tour')).toBe('rest')   // the tour's rest step still finds its target
    expect([...row.querySelectorAll('.acts .b')].map(b => b.textContent.trim())).toEqual(['−15s', '+15s', '', 'Skip'])
    act(() => row.querySelector('.adj + .adj').click())
    expect(useUI.getState().timer.left).toBe(75)
  })

  it('Rest over stays, says so once, and +15s starts a new rest', () => {
    act(() => useUI.setState({ timer: rest({ left: 0, ready: true }) }))
    mount()
    const row = document.querySelector('.trow.dock')
    expect(row.querySelector('.clk .t').textContent).toBe('0:00')
    const said = () => [...document.querySelectorAll('[role=status]')].map(e => e.textContent).join('')
    expect(said()).toBe('Rest over')
    expect(row.querySelector('.sk').textContent).toBe('Dismiss')
    act(() => { vi.advanceTimersByTime(3100) })
    expect(said()).toBe('')
  })

  it('the full view is a dialog: the page behind is inert until Escape', () => {
    act(() => useUI.setState({ timer: rest() }))
    mount()
    act(() => document.querySelector('.trow .clk').click())
    const xv = document.querySelector('.xv')
    expect(xv.querySelector('[role=status]')).not.toBeNull()   // the announcement is not inside the inert page
    expect(xv.getAttribute('role')).toBe('dialog')
    expect(xv.inert).toBe(false)
    expect(host.inert).toBe(true)
    expect(document.activeElement).toBe(xv.querySelector('.cls'))
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(host.inert).toBe(false)
    expect(xv.inert).toBe(true)
  })

  it('the glow is only marked for the last three seconds', () => {
    act(() => useUI.setState({ timer: rest({ left: 4 }) }))
    mount()
    expect(document.querySelector('.trow').hasAttribute('data-glow')).toBe(false)
    act(() => useUI.setState({ timer: rest({ left: 3 }) }))
    expect(document.querySelector('.trow').hasAttribute('data-glow')).toBe(true)
  })

  it('the rest before a timed hold that starts by itself keeps the card', () => {
    act(() => useUI.setState({ timer: rest({ autoNext: 'Plank' }) }))
    mount()
    expect(document.getElementById('timer')).not.toBeNull()
    expect(document.querySelector('.trow')).toBeNull()
  })

  it('off the iPhone nothing changes', () => {
    delete document.documentElement.dataset.platform
    act(() => useUI.setState({ timer: rest() }))
    mount()
    expect(document.getElementById('timer')).not.toBeNull()
    expect(document.querySelector('.trow')).toBeNull()
  })
})
