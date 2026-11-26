// @vitest-environment happy-dom

/* A server behind Cloudflare Access: the phone's service token goes along on every request to the
   server it was entered for — the pairing itself included — and on nothing else. */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./mobile.js', () => ({ MOBILE: true, loadRemoteFile: async () => null, saveRemoteFile: async () => {} }))
const backing = new Map()
vi.mock('@aparajita/capacitor-secure-storage', () => ({
  SecureStorage: {
    get: async k => (backing.has(k) ? backing.get(k) : null),
    set: async (k, v) => { backing.set(k, v) },
    remove: async k => { backing.delete(k) }
  }
}))

import { api, pairRedeem, setRemoteAuth } from './api.js'
import { accessHeaders, loadCfAccess, saveCfAccess } from './cf-access.js'
import { forgetRemote } from './remote.js'

const ok = body => vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }))

afterEach(async () => { vi.unstubAllGlobals(); setRemoteAuth('', null); await saveCfAccess({}); backing.clear() })

const GYM = 'https://gym.example.com'

describe('accessHeaders', () => {
  it('needs both halves, trimmed', () => {
    expect(accessHeaders({ clientId: ' id.access ', clientSecret: ' s3cret ' }))
      .toEqual({ 'CF-Access-Client-Id': 'id.access', 'CF-Access-Client-Secret': 's3cret' })
    expect(accessHeaders({ clientId: 'id', clientSecret: '' })).toEqual({})
    expect(accessHeaders(null)).toEqual({})
  })
})

describe('the Cloudflare Access token on the phone', () => {
  it('goes with the pairing request', async () => {
    const fetch = ok({ token: 'T', user: { id: 'u' } })
    vi.stubGlobal('fetch', fetch)
    await saveCfAccess({ clientId: 'id', clientSecret: 'secret', server: GYM })
    await pairRedeem('https://gym.example.com', 'ABCD')
    expect(fetch.mock.calls[0][1].headers).toMatchObject({ 'CF-Access-Client-Id': 'id', 'CF-Access-Client-Secret': 'secret' })
  })

  it('goes with every api() call to the paired server, beside the pairing token', async () => {
    const fetch = ok({ rev: 1 })
    vi.stubGlobal('fetch', fetch)
    await saveCfAccess({ clientId: 'id', clientSecret: 'secret', server: GYM })
    setRemoteAuth('https://gym.example.com', 'TOKEN')
    await api('/api/data/rev')
    expect(fetch.mock.calls[0][1].headers).toMatchObject({
      Authorization: 'Bearer TOKEN', 'CF-Access-Client-Id': 'id', 'CF-Access-Client-Secret': 'secret'
    })
  })

  it('survives a restart and is gone once removed', async () => {
    await saveCfAccess({ clientId: 'id', clientSecret: 'secret', server: GYM })
    expect(await loadCfAccess()).toEqual({ clientId: 'id', clientSecret: 'secret', origin: GYM })
    await saveCfAccess({ clientId: '', clientSecret: '' })
    expect(await loadCfAccess()).toBe(null)
    const fetch = ok({ rev: 1 })
    vi.stubGlobal('fetch', fetch)
    setRemoteAuth('https://gym.example.com', 'TOKEN')
    await api('/api/data/rev')
    expect(fetch.mock.calls[0][1].headers['CF-Access-Client-Id']).toBeUndefined()
  })

  it('goes to nothing but the origin it was entered for', async () => {
    const fetch = ok({ token: 'T', user: { id: 'u' } })
    vi.stubGlobal('fetch', fetch)
    await saveCfAccess({ clientId: 'id', clientSecret: 'secret', server: GYM + '/' })
    // a pairing typed for another server, another port or plain http: no token
    for (const other of ['https://evil.example.net', 'https://gym.example.com:8443', 'http://gym.example.com']) {
      await pairRedeem(other, 'ABCD')
      setRemoteAuth(other, 'TOKEN')
      await api('/api/data/rev')
    }
    for (const call of fetch.mock.calls) expect(call[1].headers['CF-Access-Client-Id']).toBeUndefined()
    // its own server, whatever the path: the token
    setRemoteAuth(GYM + '/', 'TOKEN')
    await api('/api/data/rev')
    expect(fetch.mock.calls.at(-1)[1].headers['CF-Access-Client-Id']).toBe('id')
  })

  it('is not saved without the server it is for', async () => {
    await expect(saveCfAccess({ clientId: 'id', clientSecret: 'secret' })).rejects.toThrow()
    await expect(saveCfAccess({ clientId: 'id', clientSecret: 'secret', server: 'not a url' })).rejects.toThrow()
    expect(await loadCfAccess()).toBe(null)
  })

  it('is gone once the phone disconnects from the server', async () => {
    await saveCfAccess({ clientId: 'id', clientSecret: 'secret', server: GYM })
    setRemoteAuth(GYM, 'TOKEN')
    await forgetRemote()
    expect(await loadCfAccess({ pairedBase: GYM })).toBe(null)
    const fetch = ok({ token: 'T', user: { id: 'u' } })
    vi.stubGlobal('fetch', fetch)
    await pairRedeem(GYM, 'ABCD')
    expect(fetch.mock.calls[0][1].headers['CF-Access-Client-Id']).toBeUndefined()
  })

  it('saved before tokens knew their server: bound to the paired server on the next start', async () => {
    backing.set('cfAccess', JSON.stringify({ clientId: 'id', clientSecret: 'secret' }))
    expect(await loadCfAccess({ pairedBase: GYM })).toEqual({ clientId: 'id', clientSecret: 'secret', origin: GYM })
    expect(JSON.parse(backing.get('cfAccess')).origin).toBe(GYM)
    const fetch = ok({ token: 'T', user: { id: 'u' } })
    vi.stubGlobal('fetch', fetch)
    await pairRedeem('https://other.example.net', 'ABCD')
    await pairRedeem(GYM, 'ABCD')
    expect(fetch.mock.calls[0][1].headers['CF-Access-Client-Id']).toBeUndefined()
    expect(fetch.mock.calls[1][1].headers['CF-Access-Client-Id']).toBe('id')
  })

  it('saved before tokens knew their server, on a phone not paired: sent nowhere until entered again', async () => {
    backing.set('cfAccess', JSON.stringify({ clientId: 'id', clientSecret: 'secret' }))
    expect(await loadCfAccess()).toEqual({ clientId: 'id', clientSecret: 'secret', origin: '' })
    const fetch = ok({ token: 'T', user: { id: 'u' } })
    vi.stubGlobal('fetch', fetch)
    await pairRedeem(GYM, 'ABCD')
    expect(fetch.mock.calls[0][1].headers['CF-Access-Client-Id']).toBeUndefined()
  })
})

describe('a secure storage that does not answer at start', () => {
  it('still sends the stored token once it answers: the next request reads it again', async () => {
    backing.set('cfAccess', JSON.stringify({ clientId: 'id', clientSecret: 'secret', origin: GYM }))
    const { SecureStorage } = await import('@aparajita/capacitor-secure-storage')
    const real = SecureStorage.get
    SecureStorage.get = async () => { throw new Error('keychain locked') }
    try { expect(await loadCfAccess({ pairedBase: GYM })).toBe(null) } finally { SecureStorage.get = real }
    const fetch = ok({ rev: 1 })
    vi.stubGlobal('fetch', fetch)
    setRemoteAuth(GYM, 'TOKEN')
    await api('/api/data/rev')
    expect(fetch.mock.calls[0][1].headers).toMatchObject({ 'CF-Access-Client-Id': 'id', 'CF-Access-Client-Secret': 'secret' })
  })
})

describe('a read still waiting on the store when the token is saved or removed', () => {
  // The read finds what was stored before the save; it answers only after the save is done.
  async function slowRead(stored, change) {
    backing.set('cfAccess', JSON.stringify(stored))
    const { SecureStorage } = await import('@aparajita/capacitor-secure-storage')
    const real = SecureStorage.get
    let answer
    SecureStorage.get = () => new Promise(resolve => { answer = resolve })
    try {
      const reading = loadCfAccess({ pairedBase: GYM })
      await change()
      answer(JSON.stringify(stored))
      return await reading
    } finally { SecureStorage.get = real }
  }

  async function sentHeaders() {
    const fetch = ok({ rev: 1 })
    vi.stubGlobal('fetch', fetch)
    setRemoteAuth(GYM, 'TOKEN')
    await api('/api/data/rev')
    return fetch.mock.calls[0][1].headers
  }

  it('does not put the old token back over the new one', async () => {
    const old = { clientId: 'old', clientSecret: 'old-secret', origin: GYM }
    expect(await slowRead(old, () => saveCfAccess({ clientId: 'new', clientSecret: 'new-secret', server: GYM }))).toBe(null)
    expect(await sentHeaders()).toMatchObject({ 'CF-Access-Client-Id': 'new', 'CF-Access-Client-Secret': 'new-secret' })
  })

  it('does not bring back a token that was removed', async () => {
    const old = { clientId: 'old', clientSecret: 'old-secret', origin: GYM }
    expect(await slowRead(old, () => saveCfAccess({}))).toBe(null)
    expect((await sentHeaders())['CF-Access-Client-Id']).toBeUndefined()
  })

  it('does not bind and send a token saved before tokens knew their server once it was removed', async () => {
    const old = { clientId: 'old', clientSecret: 'old-secret' }
    expect(await slowRead(old, () => saveCfAccess({}))).toBe(null)
    expect((await sentHeaders())['CF-Access-Client-Id']).toBeUndefined()
    expect(backing.has('cfAccess')).toBe(false)
  })
})

describe('a binding write still on its way when the token is saved or removed', () => {
  // A token saved before tokens knew their server is bound to the paired one on load; that write
  // reaches the store only after the save or removal was asked for.
  async function slowBinding(change) {
    backing.set('cfAccess', JSON.stringify({ clientId: 'old', clientSecret: 'old-secret' }))
    const { SecureStorage } = await import('@aparajita/capacitor-secure-storage')
    const real = SecureStorage.set
    let land
    SecureStorage.set = (k, v) => {
      SecureStorage.set = real
      return new Promise(resolve => { land = () => { backing.set(k, v); resolve() } })
    }
    try {
      const reading = loadCfAccess({ pairedBase: GYM })
      while (!land) await new Promise(r => setTimeout(r, 0))
      const changing = change()
      await new Promise(r => setTimeout(r, 0))
      land()
      await Promise.all([reading, changing])
    } finally { SecureStorage.set = real }
  }

  it('does not put the old token back in the store over a removal', async () => {
    await slowBinding(() => saveCfAccess({}))
    expect(backing.has('cfAccess')).toBe(false)
    expect(await loadCfAccess({ pairedBase: GYM })).toBe(null)
  })

  it('does not put the old token back in the store over a new one', async () => {
    await slowBinding(() => saveCfAccess({ clientId: 'new', clientSecret: 'new-secret', server: GYM }))
    expect(JSON.parse(backing.get('cfAccess'))).toEqual({ clientId: 'new', clientSecret: 'new-secret', origin: GYM })
  })
})
