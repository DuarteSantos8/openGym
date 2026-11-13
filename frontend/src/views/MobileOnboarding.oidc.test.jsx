// @vitest-environment happy-dom
// #130: a server that signs people in with an identity provider offers that on the phone's connect
// sheet, once the typed address has been still for a moment. A server without it leaves the sheet
// as it was, and so does one that cannot be asked.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { _setLangState } from '../lib/i18n-core.js'

const probe = vi.hoisted(() => ({ fn: null }))
vi.mock('../lib/api.js', async orig => ({ ...(await orig()), serverConfig: (...a) => probe.fn(...a) }))
import { ConnectSheet } from './MobileOnboarding.jsx'

let root, host
const type = (el, value) => act(() => {
  Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
})
const btn = text => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(700) })

beforeEach(() => {
  vi.useFakeTimers()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  _setLangState('en', null, null, null)
  useUI.setState({ sheets: [], toastMsg: '' })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers() })

describe('ConnectSheet with an identity provider', () => {
  it('offers the provider for that server and signs in through it', async () => {
    probe.fn = vi.fn(async () => ({ oidc: { label: 'VoidAuth' } }))
    const connectWithProvider = vi.fn(async () => {})
    useStore.setState({ connectWithProvider })
    const close = vi.fn()
    act(() => root.render(<ConnectSheet close={close} />))
    type(host.querySelector('input'), 'gym.example.com')
    expect(btn('Sign in with VoidAuth')).toBeUndefined()
    await settle()
    expect(probe.fn).toHaveBeenCalledTimes(1)
    expect(probe.fn).toHaveBeenCalledWith('https://gym.example.com')
    expect(host.textContent).toContain('or use a pairing code')
    await act(async () => { btn('Sign in with VoidAuth').click() })
    expect(connectWithProvider).toHaveBeenCalledWith('https://gym.example.com', 'VoidAuth', expect.any(Function))
    expect(close).toHaveBeenCalled()
  })

  it('a cancelled sign-in says nothing; a refusal stays under the fields', async () => {
    probe.fn = vi.fn(async () => ({ oidc: { label: 'VoidAuth' } }))
    const connectWithProvider = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('cancelled'), { code: 'cancelled' }))
      .mockRejectedValueOnce(Object.assign(new Error('Not in the group.'), { code: 'group' }))
    useStore.setState({ connectWithProvider })
    act(() => root.render(<ConnectSheet close={vi.fn()} />))
    type(host.querySelector('input'), 'gym.example.com')
    await settle()
    await act(async () => { btn('Sign in with VoidAuth').click() })
    expect(host.querySelector('[role="alert"]')).toBeNull()
    await act(async () => { btn('Sign in with VoidAuth').click() })
    expect(host.querySelector('[role="alert"]').textContent).toBe('Not in the group.')
  })

  it('no provider, or no answer: just the pairing code', async () => {
    probe.fn = vi.fn(async () => ({ invite_only: false }))
    act(() => root.render(<ConnectSheet close={vi.fn()} />))
    type(host.querySelector('input'), 'gym.example.com')
    await settle()
    expect(host.textContent).not.toContain('or use a pairing code')
    probe.fn = vi.fn(async () => { throw new Error('down') })
    type(host.querySelector('input'), 'other.example.com')
    await settle()
    expect(host.textContent).not.toContain('or use a pairing code')
  })
})
