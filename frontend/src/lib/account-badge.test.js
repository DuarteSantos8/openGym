import { afterEach, describe, expect, it, vi } from 'vitest'
import { cloudAccount, onCloudAccount, setCloudAccount, whoIs } from './account-badge.js'

afterEach(() => setCloudAccount(null))

describe('account-badge: who is signed in to the hosted account, as the app may show it', () => {
  it('is nobody until something says otherwise', () => {
    expect(cloudAccount()).toBeNull()
  })

  it('keeps an address and a name, and nothing else that was handed in', () => {
    setCloudAccount({ email: 'sam@example.com', name: 'Sam', access_token: 'secret', id: 'u-1' })
    expect(cloudAccount()).toEqual({ email: 'sam@example.com', name: 'Sam' })
  })

  it('no address is nobody', () => {
    for (const none of [null, undefined, {}, { name: 'Sam' }, { email: '' }, { email: 7 }]) {
      setCloudAccount({ email: 'a@example.com' }); setCloudAccount(none)
      expect(cloudAccount()).toBeNull()
    }
  })

  it('tells its listeners when it changes, and only then', () => {
    const heard = vi.fn()
    const off = onCloudAccount(heard)
    setCloudAccount({ email: 'sam@example.com' })
    setCloudAccount({ email: 'sam@example.com', name: '' })     // the same
    expect(heard).toHaveBeenCalledTimes(1)
    setCloudAccount({ email: 'sam@example.com', name: 'Sam' })
    setCloudAccount(null)
    expect(heard).toHaveBeenCalledTimes(3)
    off()
    setCloudAccount({ email: 'x@example.com' })
    expect(heard).toHaveBeenCalledTimes(3)
  })

  it('whoIs: the name where there is one, else the address', () => {
    expect(whoIs({ email: 'sam@example.com', name: 'Sam' })).toBe('Sam')
    expect(whoIs({ email: 'sam@example.com', name: '  ' })).toBe('sam@example.com')
    expect(whoIs(null)).toBe('')
  })
})
