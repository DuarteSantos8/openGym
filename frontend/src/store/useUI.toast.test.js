// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUI } from './useUI.js'
import { SENTENCE_TOAST_MS } from '../lib/oidc.js'

const ACK_MS = 2200

beforeEach(() => { vi.useFakeTimers(); useUI.setState({ toastMsg: '' }) })
afterEach(() => { vi.useRealTimers() })

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
    useUI.getState().toast('Tell whoever runs this instance.', SENTENCE_TOAST_MS)
    vi.advanceTimersByTime(ACK_MS)
    expect(useUI.getState().toastMsg).toBe('Tell whoever runs this instance.')
    vi.advanceTimersByTime(SENTENCE_TOAST_MS - ACK_MS)
    expect(useUI.getState().toastMsg).toBe('')
  })

  it('gives a sentence more time than an acknowledgement', () => {
    expect(SENTENCE_TOAST_MS).toBeGreaterThan(ACK_MS)
  })

  it('lets a later message replace an earlier one without inheriting its deadline', () => {
    useUI.getState().toast('first', SENTENCE_TOAST_MS)
    vi.advanceTimersByTime(SENTENCE_TOAST_MS - 100)
    useUI.getState().toast('second')
    vi.advanceTimersByTime(200)
    expect(useUI.getState().toastMsg).toBe('second')
    vi.advanceTimersByTime(ACK_MS)
    expect(useUI.getState().toastMsg).toBe('')
  })
})
