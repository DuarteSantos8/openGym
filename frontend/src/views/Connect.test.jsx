// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Connect from './Connect.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

/* The MCP endpoint's OAuth consent screen: what it asks the server, what Allow and Cancel send the
   browser to, and that a guest is sent to sign in rather than shown a consent it cannot give. */
const mocks = vi.hoisted(() => ({ user: { id: 'u1', name: 'Ana' }, setGuest: null }))
vi.mock('../store/useStore.js', () => {
  const snap = () => ({ user: mocks.user, setGuest: mocks.setGuest })
  const useStore = selector => selector(snap())
  return { useStore }
})
vi.mock('../lib/api.js', () => ({ api: vi.fn() }))
import { api } from '../lib/api.js'

const REQ = 'client_id=cid&redirect_uri=http%3A%2F%2F127.0.0.1%3A5000%2Fcb&response_type=code&code_challenge=c&code_challenge_method=S256&state=s1'
let host, root, assign
beforeEach(() => {
  mocks.user = { id: 'u1', name: 'Ana' }
  mocks.setGuest = vi.fn()
  assign = vi.fn()
  vi.spyOn(window, 'location', 'get').mockReturnValue({ assign })
  api.mockReset()
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks() })

async function mount() {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root.render(<MemoryRouter initialEntries={['/connect?' + REQ]}><Connect /></MemoryRouter>))
}
const button = text => [...host.querySelectorAll('button')].find(b => b.textContent === text)

describe('Connect', () => {
  it('names the client, and Allow posts the request and follows the redirect', async () => {
    api.mockImplementation(async (path, opts) => path.startsWith('/api/oauth/client')
      ? { name: 'Claude', redirect_host: '127.0.0.1:5000' }
      : { redirect: 'http://127.0.0.1:5000/cb?code=abc&state=s1' })
    await mount()
    expect(api.mock.calls[0][0]).toBe('/api/oauth/client?client_id=cid&redirect_uri=http%3A%2F%2F127.0.0.1%3A5000%2Fcb')
    expect(host.textContent).toContain('Connect Claude?')
    expect(host.textContent).toContain('Ana')
    await act(async () => button('Allow').click())
    const [path, opts] = api.mock.calls[1]
    expect(path).toBe('/api/oauth/approve')
    expect(JSON.parse(opts.body)).toMatchObject({ client_id: 'cid', code_challenge: 'c', state: 's1' })
    expect(assign).toHaveBeenCalledWith('http://127.0.0.1:5000/cb?code=abc&state=s1')
  })

  it('Cancel tells the client no, with its state', async () => {
    api.mockResolvedValue({ name: 'Claude', redirect_host: '127.0.0.1:5000' })
    await mount()
    await act(async () => button('Cancel').click())
    expect(assign).toHaveBeenCalledWith('http://127.0.0.1:5000/cb?error=access_denied&state=s1')
  })

  it('a request the server does not vouch for offers nothing to click', async () => {
    api.mockRejectedValue(new Error('invalid_client'))
    await mount()
    expect(host.querySelectorAll('button').length).toBe(0)
  })

  it('a guest is sent to sign in first', async () => {
    mocks.user = null
    await mount()
    expect(api).not.toHaveBeenCalled()
    await act(async () => button('Sign in').click())
    expect(mocks.setGuest).toHaveBeenCalledWith(false)
  })
})
