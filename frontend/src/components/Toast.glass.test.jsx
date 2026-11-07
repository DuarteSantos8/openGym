// @vitest-environment happy-dom
// iPhone toast (Liquid Glass G4): nothing times out, a message alone is one button, an action
// toast keeps its Undo until it is used or closed, and the message is spoken once.
import React, { act } from 'react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useUI } from '../store/useUI.js'
import Toast from './Toast.jsx'

let root, host, go
const Nav = () => { go = useNavigate(); return null }
const ui = () => useUI.getState()
beforeEach(() => {
  vi.useFakeTimers()
  document.documentElement.dataset.platform = 'ios'
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(<MemoryRouter><Toast /><Nav /></MemoryRouter>))
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  ui().dismissToast()
  delete document.documentElement.dataset.platform
  vi.useRealTimers()
})
const show = (...a) => act(() => ui().toast(...a))

describe('the iPhone toast', () => {
  it('never dismisses itself, however long it waits', () => {
    show('Saved')
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(ui().toastMsg).toBe('Saved')
    expect(host.querySelector('#toast').className).toContain('show')
  })

  it('a message alone is one button, and tapping it dismisses', () => {
    show('Saved')
    const b = host.querySelectorAll('#toast button')
    expect(b).toHaveLength(1)
    act(() => b[0].click())
    expect(ui().toastMsg).toBe('')
  })

  it('touching anything else dismisses a message but not one that holds an action', () => {
    show('Saved')
    act(() => { document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })) })
    expect(ui().toastMsg).toBe('')
    show('Set removed', { action: 'Undo', onAction: () => {} })
    act(() => { document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })) })
    expect(ui().toastMsg).toBe('Set removed')
  })

  it('an action toast has the close button first and Undo last, and Undo runs the action once', () => {
    const undo = vi.fn()
    show('Set removed', { action: 'Undo', onAction: undo })
    const b = [...host.querySelectorAll('#toast button')]
    expect(b.map(x => x.className)).toEqual(['toast-x', 'toast-act'])
    act(() => b[1].click())
    expect(undo).toHaveBeenCalledTimes(1)
    expect(ui().toastMsg).toBe('')
  })

  it('speaks through one polite live region, refilled for the same words twice', () => {
    show('Saved')
    act(() => { vi.advanceTimersByTime(50) })
    const live = host.querySelector('.toast-live')
    expect(live.getAttribute('aria-live')).toBe('polite')
    expect(live.textContent).toBe('Saved')
    show('Saved')
    expect(live.textContent).toBe('')
    act(() => { vi.advanceTimersByTime(50) })
    expect(live.textContent).toBe('Saved')
  })

  it('goes with a route change', () => {
    show('Saved')
    act(() => go('/elsewhere'))
    expect(ui().toastMsg).toBe('')
  })
})
