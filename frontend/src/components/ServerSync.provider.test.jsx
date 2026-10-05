// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'

/* "Sign in again with {provider}" closes its sheet before it leaves for the provider, so a
   departure that cannot even start has nowhere else to say so: it has to be a toast. */
const mocks = vi.hoisted(() => ({ toast: null, startProviderSignIn: null }))
vi.mock('../store/useStore.js', () => {
  const snap = () => ({ sync: { server: 'https://gym.example.com' }, config: null })
  const useStore = selector => (selector ? selector(snap()) : snap())
  useStore.getState = snap
  return { useStore }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: m => mocks.toast(m), openSheet: vi.fn() })
  const useUI = selector => (selector ? selector(snap()) : snap())
  useUI.getState = snap
  return { useUI }
})
vi.mock('../lib/media-sync.js', () => ({ syncMedia: vi.fn() }))
vi.mock('../lib/mobile.js', () => ({ MOBILE: true }))
vi.mock('../lib/api.js', () => ({ passkeyLogin: vi.fn(), webauthnOK: () => true }))
vi.mock('../sheets.jsx', () => ({ askAddDeviceData: vi.fn() }))
vi.mock('../views/MobileOnboarding.jsx', () => ({ ConnectSheet: () => null }))
vi.mock('./AppSignIn.jsx', () => ({ startProviderSignIn: (...a) => mocks.startProviderSignIn(...a) }))

const { signInAgainWithProvider } = await import('./ServerSync.jsx')

beforeEach(() => {
  mocks.toast = vi.fn()
  mocks.startProviderSignIn = vi.fn(async () => {})
})

describe('signInAgainWithProvider', () => {
  it('departs for the paired server', async () => {
    await signInAgainWithProvider()
    expect(mocks.startProviderSignIn).toHaveBeenCalledWith('https://gym.example.com')
    expect(mocks.toast).not.toHaveBeenCalled()
  })

  it('a departure that cannot start says why, and a later tap can try again', async () => {
    mocks.startProviderSignIn = vi.fn(async () => { throw new Error('Storage is full') })
    await signInAgainWithProvider()
    expect(mocks.toast).toHaveBeenCalledWith('Storage is full')
    await signInAgainWithProvider()
    expect(mocks.startProviderSignIn).toHaveBeenCalledTimes(2)
  })
})
