// @vitest-environment happy-dom
// A Cloudflare Access token belongs to one server and is only sent there (lib/cf-access.js): the
// sheet asks for that server's address beside the token, says where it goes, and a stored token
// shows its own server rather than whatever address is being typed for a pairing.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useUI } from '../store/useUI.js'
import { _setLangState } from '../lib/i18n-core.js'

const cf = vi.hoisted(() => ({ stored: null, save: null }))
vi.mock('../lib/cf-access.js', () => ({
  loadCfAccess: async () => cf.stored,
  saveCfAccess: (...a) => cf.save(...a)
}))
import { CfAccessSheet } from './MobileOnboarding.jsx'

let root, host
const type = (el, value) => act(() => {
  Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
})
const button = label => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === label)
const note = () => host.querySelector('[role="note"]')?.textContent

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  _setLangState('en', null, null, null)
  useUI.setState({ sheets: [], toastMsg: '' })
  cf.stored = null
  cf.save = vi.fn(async c => c)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('CfAccessSheet', () => {
  it('saves the token with the server it is for, and says so', async () => {
    const close = vi.fn()
    await act(async () => root.render(<CfAccessSheet close={close} server="https://gym.example.com" />))
    const [addr, id, secret] = host.querySelectorAll('input')
    expect(addr.value).toBe('https://gym.example.com')
    expect(note()).toBe('Sent only to gym.example.com, never to another server.')
    type(id, 'id.access')
    type(secret, 's3cret')
    await act(async () => { button('Save').click() })
    expect(cf.save).toHaveBeenCalledWith({ clientId: 'id.access', clientSecret: 's3cret', server: 'https://gym.example.com' })
    expect(close).toHaveBeenCalled()
  })

  it('refuses a token without an address', async () => {
    await act(async () => root.render(<CfAccessSheet close={() => {}} />))
    const [, id, secret] = host.querySelectorAll('input')
    type(id, 'id.access')
    type(secret, 's3cret')
    await act(async () => { button('Save').click() })
    expect(cf.save).not.toHaveBeenCalled()
    expect(useUI.getState().toastMsg).toBe('Enter the address of the server this token is for')
  })

  it('shows the server a stored token belongs to, not the one being typed for a pairing', async () => {
    cf.stored = { clientId: 'id', clientSecret: 'secret', origin: 'https://gym.example.com' }
    await act(async () => root.render(<CfAccessSheet close={() => {}} server="https://other.example.net" />))
    expect(host.querySelector('input').value).toBe('https://gym.example.com')
    expect(note()).toContain('gym.example.com')
  })
})
