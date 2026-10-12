// @vitest-environment happy-dom
// #428: pairing with a plain http:// server works now; the connect sheet only says, once, that
// http is not encrypted. Not for https://, a bare address (tried as https://) or the phone itself.
import { describe, expect, it, vi } from 'vitest'

vi.mock('../store/useStore.js', () => ({ useStore: () => ({}) }))
vi.mock('../store/useUI.js', () => ({ useUI: { getState: () => ({}) } }))
vi.mock('../sheets.jsx', () => ({ askAddDeviceData: () => {} }))
vi.mock('../components/Icon.jsx', () => ({ default: () => null }))
vi.mock('../components/ui.jsx', () => ({ Button: () => null }))

const { plainHttp } = await import('./MobileOnboarding.jsx')

describe('plainHttp', () => {
  it('warns for an http:// server on the network', () => {
    for (const a of ['http://192.168.1.20:8080', ' HTTP://nas.local/ ', 'http://gym.example.com']) expect(plainHttp(a), a).toBe(true)
  })
  it('stays quiet for https://, a bare address, the phone itself and nonsense', () => {
    for (const a of ['https://gym.example.com', '192.168.1.20:8080', 'http://localhost:3000', 'http://127.0.0.1', 'http://[::1]:8080', 'http://', '', null]) expect(plainHttp(a), String(a)).toBe(false)
  })
})
