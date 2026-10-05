// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUI } from './useUI.js'
import { SENTENCE_TOAST_MS } from '../lib/oidc.js'

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

  it('the × sends it away at once, without running the action', () => {
    const onAction = vi.fn()
    useUI.getState().toast('Set 2 gone.', { action: 'Undo', onAction })
    useUI.getState().pauseToast()
    useUI.getState().dismissToast()
    expect(useUI.getState().toastMsg).toBe('')
    expect(useUI.getState().toastAction).toBeNull()
    useUI.getState().resumeToast()
    useUI.getState().runToastAction()
    expect(onAction).not.toHaveBeenCalled()
    useUI.getState().toast('Saved')
    vi.advanceTimersByTime(2201)
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

const ACK_MS = 2200

describe('how long a message stays up', () => {
  it('acknowledges by default, and gets out of the way on its own', () => {
    useUI.getState().toast('Identity linked')
    expect(useUI.getState().toastMsg).toBe('Identity linked')
    vi.advanceTimersByTime(ACK_MS - 1)
    expect(useUI.getState().toastMsg).toBe('Identity linked')
    vi.advanceTimersByTime(1)
    expect(useUI.getState().toastMsg).toBe('')
  })

  it('keeps a sentence up long enough to be read', () => {
    useUI.getState().toast('Tell whoever runs this instance.', { ms: SENTENCE_TOAST_MS })
    vi.advanceTimersByTime(ACK_MS)
    expect(useUI.getState().toastMsg).toBe('Tell whoever runs this instance.')
    vi.advanceTimersByTime(SENTENCE_TOAST_MS - ACK_MS)
    expect(useUI.getState().toastMsg).toBe('')
  })

  it('gives a sentence more time than an acknowledgement', () => {
    expect(SENTENCE_TOAST_MS).toBeGreaterThan(ACK_MS)
  })

  it('lets a later message replace an earlier one without inheriting its deadline', () => {
    useUI.getState().toast('first', { ms: SENTENCE_TOAST_MS })
    vi.advanceTimersByTime(SENTENCE_TOAST_MS - 100)
    useUI.getState().toast('second')
    vi.advanceTimersByTime(200)
    expect(useUI.getState().toastMsg).toBe('second')
    vi.advanceTimersByTime(ACK_MS)
    expect(useUI.getState().toastMsg).toBe('')
  })
})
