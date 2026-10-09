// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUI } from './useUI.js'

beforeEach(() => { vi.useFakeTimers(); useUI.setState({ toastMsg: '', toastAction: null }) })
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

describe('toast with an action', () => {
  it('a plain toast is text only and goes after 2.2 s', () => {
    useUI.getState().toast('Saved')
    expect(useUI.getState().toastMsg).toBe('Saved')
    expect(useUI.getState().toastAction).toBeNull()
    vi.advanceTimersByTime(2199)
    expect(useUI.getState().toastMsg).toBe('Saved')
    vi.advanceTimersByTime(2)
    expect(useUI.getState().toastMsg).toBe('')
  })

  it('stays 5 s with an action, and the action fires once', () => {
    const onAction = vi.fn()
    useUI.getState().toast('Set 2 gone.', { action: 'Undo', onAction })
    expect(useUI.getState().toastAction.label).toBe('Undo')
    vi.advanceTimersByTime(4900)
    expect(useUI.getState().toastMsg).toBe('Set 2 gone.')
    useUI.getState().runToastAction()
    useUI.getState().runToastAction()
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(useUI.getState().toastMsg).toBe('')
  })

  it('times out after 5 s without running the action', () => {
    const onAction = vi.fn()
    useUI.getState().toast('Set 2 gone.', { action: 'Undo', onAction })
    vi.advanceTimersByTime(5001)
    expect(useUI.getState().toastMsg).toBe('')
    expect(useUI.getState().toastAction).toBeNull()
    useUI.getState().runToastAction()
    expect(onAction).not.toHaveBeenCalled()
  })

  it('a new toast replaces the old one and its action', () => {
    const first = vi.fn()
    useUI.getState().toast('Set 2 gone.', { action: 'Undo', onAction: first })
    useUI.getState().toast('Copied')
    expect(useUI.getState().toastAction).toBeNull()
    useUI.getState().runToastAction()
    expect(first).not.toHaveBeenCalled()
  })

  it('holds still while touched and carries on afterwards', () => {
    useUI.getState().toast('Set 2 gone.', { action: 'Undo', onAction: () => {} })
    vi.advanceTimersByTime(3000)
    useUI.getState().pauseToast()
    vi.advanceTimersByTime(20000)
    expect(useUI.getState().toastMsg).toBe('Set 2 gone.')
    useUI.getState().resumeToast()
    vi.advanceTimersByTime(1900)
    expect(useUI.getState().toastMsg).toBe('Set 2 gone.')
    vi.advanceTimersByTime(200)
    expect(useUI.getState().toastMsg).toBe('')
  })
})
