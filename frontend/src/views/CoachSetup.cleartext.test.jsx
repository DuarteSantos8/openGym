// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

/* The phone's own-key Coach and an http:// endpoint (#913). Both apps allow plain http:// (Android
   since #428, iOS for local addresses), so a model on the LAN is listed and saved like any other
   endpoint. The screen says what pairing says about http://, and no longer refuses it. */
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
const NOTE = 'Plain http:// isn’t encrypted. Fine on your home network, but use https:// if your server is reachable from the internet.'

describe('CoachSetup and an http:// endpoint', () => {
  it('a LAN model at http:// is listed, with the note pairing gives about http://', async () => {
    const { endpoint, input, page } = await openCompatible()
    expect(endpoint.querySelector('.sect-f')).toBeNull()
    type(input, 'http://192.168.1.20:11434')
    expect(endpoint.querySelector('.sect-f').textContent).toBe(NOTE)

    await act(async () => { byText(page, 'button', 'List models').click() })
    await settle()
    expect(mocks.localModels).toHaveBeenCalledTimes(1)
    expect(mocks.localModels.mock.calls[0][0]).toMatchObject({ provider: 'compatible', baseUrl: 'http://192.168.1.20:11434' })
    expect(mocks.toast).not.toHaveBeenCalled()
  })

  it('it saves too, and https:// carries no note', async () => {
    const { endpoint, input, page } = await openCompatible()
    type(input, 'https://ollama.example.com')
    expect(endpoint.querySelector('.sect-f')).toBeNull()
    type(input, 'HTTP://ollama.lan:11434')
    expect(endpoint.querySelector('.sect-f').textContent).toBe(NOTE)
    await act(async () => { byText(page, 'button', 'List models').click() })
    await settle()
    const select = page.querySelector('select')
    act(() => { select.value = 'llama3'; select.dispatchEvent(new Event('change', { bubbles: true })) })
    await act(async () => { byText(page, 'button', 'Save and use the Coach').click() })
    await settle()
    expect(mocks.setCoachLocal).toHaveBeenCalledWith(expect.objectContaining({ mode: 'byok', provider: 'compatible', model: 'llama3', baseUrl: 'http://ollama.lan:11434' }))
  })
})
