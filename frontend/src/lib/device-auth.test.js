import { beforeEach, describe, expect, it, vi } from 'vitest'

/* The phone's screen lock before a paired phone deletes its account (lib/device-auth.js). The
   native DeviceAuth plugin is a stand-in shaped like Capacitor's: a Proxy that answers every
   property, `then` included, with a native call; one resolved as a promise's value would hang
   (#42), which the wrapper object avoids. The web build registers nothing. */
const mocks = vi.hoisted(() => ({ MOBILE: true, check: vi.fn(), verify: vi.fn(), registered: 0 }))
vi.mock('./mobile.js', () => ({ get MOBILE() { return mocks.MOBILE } }))
vi.mock('@capacitor/core', () => ({
  registerPlugin: name => {
    mocks.registered++
    expect(name).toBe('DeviceAuth')
    return new Proxy({}, {
      get: (_, prop) => prop === 'check' ? mocks.check : prop === 'verify' ? mocks.verify
        : () => new Promise(() => {})   // `then` and everything else: a native call that never answers
    })
  }
}))

const nativeError = code => Object.assign(new Error(code), { code })
const fresh = async () => { vi.resetModules(); return import('./device-auth.js') }

beforeEach(() => {
  mocks.MOBILE = true
  mocks.registered = 0
  mocks.check.mockReset()
  mocks.verify.mockReset()
})

describe('deviceLock', () => {
  it('says whether the phone has a screen lock, and unknown when it cannot be asked', async () => {
    const { deviceLock } = await fresh()
    mocks.check.mockResolvedValueOnce({ secure: true })
    expect(await deviceLock()).toBe('set')
    mocks.check.mockResolvedValueOnce({ secure: false })
    expect(await deviceLock()).toBe('none')
    mocks.check.mockRejectedValueOnce(new Error('not implemented'))
    expect(await deviceLock()).toBe('unknown')
    expect(mocks.registered).toBe(1)
  })
})

describe('confirmDeviceOwner', () => {
  it('ok when unlocked, with the reason the prompt shows', async () => {
    const { confirmDeviceOwner } = await fresh()
    mocks.verify.mockResolvedValueOnce({ verified: true })
    expect(await confirmDeviceOwner('Confirm it’s you')).toBe('ok')
    expect(mocks.verify).toHaveBeenCalledWith({ reason: 'Confirm it’s you' })
  })

  it('tells backing out, no lock at all, and anything else apart', async () => {
    const { confirmDeviceOwner } = await fresh()
    mocks.verify.mockRejectedValueOnce(nativeError('cancelled'))
    expect(await confirmDeviceOwner('x')).toBe('cancelled')
    mocks.verify.mockRejectedValueOnce(nativeError('not-secure'))
    expect(await confirmDeviceOwner('x')).toBe('none')
    mocks.verify.mockRejectedValueOnce(nativeError('failed'))
    expect(await confirmDeviceOwner('x')).toBe('failed')
    mocks.verify.mockRejectedValueOnce(new Error('"DeviceAuth" plugin is not implemented on android'))
    expect(await confirmDeviceOwner('x')).toBe('failed')
  })
})

describe('the web build', () => {
  it('registers nothing and never says yes', async () => {
    mocks.MOBILE = false
    const { deviceLock, confirmDeviceOwner } = await fresh()
    expect(await deviceLock()).toBe('unknown')
    expect(await confirmDeviceOwner('x')).toBe('failed')
    expect(mocks.registered).toBe(0)
  })
})
