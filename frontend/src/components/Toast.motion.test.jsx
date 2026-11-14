// @vitest-environment happy-dom
// The toast's motion is CSS on classes and attributes; nothing here waits for it, and removal of the
// toast's words is not part of it (the node stays mounted).
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUI } from '../store/useUI.js'
import Toast from './Toast.jsx'

const css = readFileSync('src/index.css', 'utf8')
let root, host
const el = () => host.querySelector('#toast')
beforeEach(() => { vi.useFakeTimers(); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); act(() => root.render(<Toast />)) })
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); useUI.getState().dismissToast() })
const show = (m, o) => act(() => useUI.getState().toast(m, o))

describe('toast motion', () => {
  it('shows with the show class and keeps its words while it goes out', () => {
    show('Saved')
    expect(el().className).toContain('show')
    act(() => vi.advanceTimersByTime(2300))
    expect(el().className).not.toContain('show')
    expect(el().textContent).toContain('Saved')
  })

  it('a toast that replaces another swaps its content and leaves a ghost of the old words', () => {
    show('First', { action: 'Undo', onAction: () => {} })
    expect(el().querySelector('.swap')).toBeNull()
    show('Second', { action: 'Undo', onAction: () => {} })
    expect(el().querySelector('.toast-msg').className).toContain('swap')
    expect(el().querySelector('.toast-ghost').textContent).toBe('First')
  })

  it('a tap on Undo takes the quick exit and still runs the action at once', () => {
    const run = vi.fn()
    show('Removed', { action: 'Undo', onAction: run })
    act(() => el().querySelector('.toast-act').click())
    expect(run).toHaveBeenCalledOnce()
    expect(el().className).toContain('quick')
  })

  it('a timed close is not the quick one', () => {
    show('Removed', { action: 'Undo', onAction: () => {} })
    act(() => vi.advanceTimersByTime(5100))
    expect(el().className).not.toContain('quick')
  })

  it('Reduce Motion: no rise or ghost, under html.reduce-motion and under the phone setting', () => {
    expect(css).toMatch(/\.reduce-motion #toast,\.reduce-motion #toast\.show\{transform:translateX\(-50%\)\}/)
    expect(css).toMatch(/\.reduce-motion #toast \.toast-ghost\{display:none\}/)
    expect(css).toMatch(/\.reduce-motion #toast \.toast-msg\.swap[^{]*\{animation:none\}/)
    expect(css).toMatch(/@media \(prefers-reduced-motion:reduce\)\{#toast,#toast\.show\{transform:translateX\(-50%\)\}#toast \.toast-ghost\{display:none\}#toast \.toast-msg\.swap[^{]*\{animation:none\}\}/)
  })
})
