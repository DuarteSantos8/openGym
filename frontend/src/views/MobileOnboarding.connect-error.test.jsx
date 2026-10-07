// @vitest-environment happy-dom
// #329: why pairing failed used to be a two-second toast — too short for "the server was reached
// but refused the app's request (CORS)…" to be read, let alone acted on. It stays under the fields.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { _setLangState } from '../lib/i18n-core.js'
import { ConnectSheet } from './MobileOnboarding.jsx'

let root, host
const type = (el, value) => act(() => {
  Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
})
const connectButton = () => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === 'Connect')

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  _setLangState('en', null, null, null)
  useUI.setState({ sheets: [], toastMsg: '' })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('ConnectSheet', () => {
  it('shows why connecting failed under the fields, and clears it on the next try', async () => {
    const long = 'Your server was reached, but it refused the app’s request (CORS).'
    const connectToServer = vi.fn().mockRejectedValueOnce(Object.assign(new Error(long), { code: 'cors' })).mockResolvedValueOnce(undefined)
    useStore.setState({ connectToServer })
    const close = vi.fn()
    act(() => root.render(<ConnectSheet close={close} />))
    const [url, code] = host.querySelectorAll('input')
    type(url, 'gym.example.com')
    type(code, 'abcd2345')
    await act(async () => { connectButton().click() })
    const alert = host.querySelector('[role="alert"]')
    expect(alert?.textContent).toBe(long)
    expect(close).not.toHaveBeenCalled()

    await act(async () => { connectButton().click() })
    expect(host.querySelector('[role="alert"]')).toBeNull()
    expect(close).toHaveBeenCalled()
    expect(connectToServer).toHaveBeenLastCalledWith('gym.example.com', 'ABCD2345', expect.any(Function))
  })
})
