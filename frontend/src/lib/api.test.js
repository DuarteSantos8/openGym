// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assetObjectUrl, setRemoteAuth, webauthnOK } from './api.js'

const originalPublicKeyCredential = window.PublicKeyCredential
const originalCredentials = navigator.credentials

function setCapability(target, property, value) {
  Object.defineProperty(target, property, { configurable: true, value })
}

afterEach(() => {
  setCapability(window, 'PublicKeyCredential', originalPublicKeyCredential)
  setCapability(navigator, 'credentials', originalCredentials)
  setRemoteAuth('', null)
  vi.restoreAllMocks()
})

describe('webauthnOK', () => {
  it('accepts WebAuthn when PublicKeyCredential is exposed', () => {
    setCapability(window, 'PublicKeyCredential', class PublicKeyCredential {})
    setCapability(navigator, 'credentials', {})
    expect(webauthnOK()).toBe(true)
  })

  it('does not reject WebAuthn when the generic credentials check is unavailable', () => {
    setCapability(window, 'PublicKeyCredential', class PublicKeyCredential {})
    setCapability(navigator, 'credentials', undefined)
    expect(webauthnOK()).toBe(true)
  })

  it('rejects browsers without the WebAuthn credential type', () => {
    setCapability(window, 'PublicKeyCredential', undefined)
    setCapability(navigator, 'credentials', {})
    expect(webauthnOK()).toBe(false)
  })
})

describe('private asset transport', () => {
  it('fetches a paired image with the bearer instead of putting the token in its URL', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('image-bytes', { status: 200, headers: { 'Content-Type': 'image/png' } }))
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:private-image')
    setRemoteAuth('https://gym.example.test/', 'scoped-grant')
    await expect(assetObjectUrl('asset-1')).resolves.toBe('blob:private-image')
    expect(fetchMock).toHaveBeenCalledWith('https://gym.example.test/api/assets/asset-1', { headers: { Authorization: 'Bearer scoped-grant', Accept: 'image/*' } })
    expect(createUrl).toHaveBeenCalledTimes(1)
    expect(globalThis.__opengymRemoteBase).toBe('https://gym.example.test')
  })
})
