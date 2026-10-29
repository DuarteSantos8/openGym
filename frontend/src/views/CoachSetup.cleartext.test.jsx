// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

/* The phone's own-key Coach and an http:// endpoint (#219, #913). Plain http:// goes to an
   address on the home network (a llama-server on 192.168.x.x has no certificate a phone trusts);
   anything on the internet needs https://, and the screen says so as soon as it is typed and
   never tries the request. */
const mocks = vi.hoisted(() => ({ toast: vi.fn(), localModels: vi.fn(async () => ({ ok: true, models: ['llama3'] })), setCoachLocal: vi.fn(async () => {}) }))

vi.mock('../store/useStore.js', () => {
  const snap = () => ({ user: null, config: null, coachLocal: null, setCoachLocal: mocks.setCoachLocal, refreshConfig: vi.fn() })
  const useStore = selector => selector ? selector(snap()) : snap()
  useStore.getState = snap
  return { useStore }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: (...a) => mocks.toast(...a), openSheet: vi.fn() })
  const useUI = selector => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../lib/mobile.js', () => ({ MOBILE: true }))
vi.mock('../lib/coach-secrets.js', () => ({ getApiKey: async () => null, setApiKey: vi.fn(async () => {}), clearApiKey: vi.fn(async () => {}) }))
vi.mock('../lib/coach-local.js', () => ({ localModels: (...a) => mocks.localModels(...a), localForget: vi.fn() }))
vi.mock('./MobileOnboarding.jsx', () => ({ ConnectSheet: () => null }))

const { default: CoachSetup } = await import('./CoachSetup.jsx')

const mounted = []
function mount(el) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push({ root, host })
  act(() => root.render(el))
  return host
}
afterEach(() => { act(() => { mounted.splice(0).forEach(({ root, host }) => { root.unmount(); host.remove() }) }) })
beforeEach(() => { mocks.toast.mockClear(); mocks.localModels.mockClear(); mocks.setCoachLocal.mockClear() })

const settle = () => act(() => new Promise(r => setTimeout(r, 0)))
const byText = (el, sel, text) => [...el.querySelectorAll(sel)].find(n => n.textContent === text)
const rowByTitle = (el, title) => [...el.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent === title)
function type(input, value) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  act(() => { set.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) })
}
async function openCompatible() {
  const page = mount(<CoachSetup />)
  await settle()
  act(() => rowByTitle(page, 'Bring my own API key').click())
  act(() => byText(page, 'button.chip', 'OpenAI-compatible endpoint').click())
  const endpoint = [...page.querySelectorAll('.sect')].find(s => s.querySelector('.sect-t')?.textContent === 'Endpoint')
  return { page, endpoint, input: endpoint.querySelector('input') }
}
const REFUSAL = /Plain http:\/\/ only works for an address on your home network/
const NOTE = 'Plain http only on your home network'

describe('CoachSetup and an http:// endpoint', () => {
  it('takes plain http:// to a LAN address, and says where it is allowed', async () => {
    const { endpoint, input, page } = await openCompatible()
    expect(endpoint.querySelector('.sect-f').textContent).toBe(NOTE)
    type(input, 'http://192.168.1.20:11434')
    expect(endpoint.querySelector('.sect-f').textContent).toBe(NOTE)
    await act(async () => { byText(page, 'button', 'List models').click() })
    await settle()
    expect(mocks.localModels).toHaveBeenCalledTimes(1)
    expect(mocks.localModels.mock.calls[0][0]).toMatchObject({ provider: 'compatible', baseUrl: 'http://192.168.1.20:11434' })
  })

  it('says why as soon as a public http:// address is typed, and refuses to try it', async () => {
    const { endpoint, input, page } = await openCompatible()
    type(input, 'http://ollama.example.com:11434')
    expect(endpoint.querySelector('.sect-f').textContent).toMatch(REFUSAL)
    await act(async () => { byText(page, 'button', 'List models').click() })
    expect(mocks.localModels).not.toHaveBeenCalled()
    expect(mocks.toast).toHaveBeenCalledWith(expect.stringMatching(REFUSAL))
  })

  it('an https:// address goes through, and editing it to a public http:// one after listing still cannot be saved', async () => {
    const { endpoint, input, page } = await openCompatible()
    type(input, 'https://ollama.example.com')
    expect(endpoint.querySelector('.sect-f').textContent).toBe(NOTE)
    await act(async () => { byText(page, 'button', 'List models').click() })
    await settle()
    expect(mocks.localModels).toHaveBeenCalledTimes(1)
    expect(mocks.localModels.mock.calls[0][0]).toMatchObject({ provider: 'compatible', baseUrl: 'https://ollama.example.com' })

    type(input, 'HTTP://ollama.example.com:11434')
    const select = page.querySelector('select')
    act(() => { select.value = 'llama3'; select.dispatchEvent(new Event('change', { bubbles: true })) })
    await act(async () => { byText(page, 'button', 'Save and use the Coach').click() })
    expect(mocks.setCoachLocal).not.toHaveBeenCalled()
    expect(mocks.toast).toHaveBeenLastCalledWith(expect.stringMatching(REFUSAL))
  })
})
