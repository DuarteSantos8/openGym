// @vitest-environment happy-dom

/* A server behind Cloudflare Access: the phone's service token goes along on every request to the
   server it was entered for — the pairing itself included — and on nothing else. */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./mobile.js', () => ({ MOBILE: true, loadRemoteFile: async () => null, saveRemoteFile: async () => {} }))
const backing = new Map()
const plug = { failGet: 0, setArgs: [] }
vi.mock('@aparajita/capacitor-secure-storage', () => ({
  SecureStorage: {
    get: async k => { if (plug.failGet > 0) { plug.failGet--; throw new Error('errSecInteractionNotAllowed') } return backing.has(k) ? backing.get(k) : null },
    set: async (k, v, ...rest) => { plug.setArgs.push(rest); backing.set(k, v) },
    remove: async k => { backing.delete(k) }
  }
}))

import { api, pairRedeem, setRemoteAuth, cfAccessRefusal } from './api.js'
import { accessHeaders, loadCfAccess, reloadCfAccess, needsCfAccessReload, saveCfAccess } from './cf-access.js'
import { forgetRemote } from './remote.js'

const ok = body => vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }))

afterEach(async () => { vi.useRealTimers(); vi.unstubAllGlobals(); setRemoteAuth('', null); plug.failGet = 0; plug.setArgs.length = 0; await saveCfAccess({}); backing.clear() })

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

/* #1529: a read that fails (a locked iPhone starting the app in the background, a native call
   that times out) is not "no token". */
describe('a Cloudflare Access token that could not be read', () => {
  const headersSent = async () => {
    const fetch = ok({ rev: 1 })
    vi.stubGlobal('fetch', fetch)
    setRemoteAuth(GYM, 'TOKEN')
    await api('/api/data/rev')
    return fetch.mock.calls.at(-1)[1].headers['CF-Access-Client-Id']
  }

  it('keeps the headers already in use instead of dropping them', async () => {
    await saveCfAccess({ clientId: 'id', clientSecret: 'secret', server: GYM })
    plug.failGet = 1
    expect(await loadCfAccess({ pairedBase: GYM })).toEqual({ unreadable: true })
    expect(await headersSent()).toBe('id')
  })

  it('is read again on its own, and on resume or Try again', async () => {
    await saveCfAccess({ clientId: 'id', clientSecret: 'secret', server: GYM })
    // a fresh start: nothing in use yet, and the first read fails
    const { setAccessHeaders } = await import('./api.js')
    setAccessHeaders({}, '')
    vi.useFakeTimers()
    plug.failGet = 1
    await loadCfAccess({ pairedBase: GYM })
    expect(needsCfAccessReload()).toBe(true)
    await vi.advanceTimersByTimeAsync(3500)
    vi.useRealTimers()
    expect(needsCfAccessReload()).toBe(false)
    expect(await headersSent()).toBe('id')
    // headers lost while one was saved on this phone: resume reads it again
    setAccessHeaders({}, '')
    expect(await reloadCfAccess()).toBe(true)
    expect(await headersSent()).toBe('id')
    expect(await reloadCfAccess()).toBe(false)   // nothing to do now
  })

  it('is saved readable after the first unlock (iOS Keychain)', async () => {
    await saveCfAccess({ clientId: 'id', clientSecret: 'secret', server: GYM })
    expect(plug.setArgs.at(-1)[2]).toBe(2)   // KeychainAccess.afterFirstUnlock
  })

  it('a token saved under the old Keychain level moves to the new one once', async () => {
    backing.set('cfAccess', JSON.stringify({ clientId: 'id', clientSecret: 'secret', origin: GYM }))
    localStorage.removeItem('og_cfaccess_saved')
    await loadCfAccess({ pairedBase: GYM })
    expect(plug.setArgs.length).toBe(1)
    await loadCfAccess({ pairedBase: GYM })
    expect(plug.setArgs.length).toBe(1)
  })
})

describe('Cloudflare Access saying no', () => {
  const resp = (status, body, headers = {}) => Object.assign(new Response(body, { status, headers }), {})
  it('a 403 from the Cloudflare edge that is not openGym JSON has its own message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resp(403, '<html>Forbidden</html>', { 'cf-ray': '8abc-ZRH', 'content-type': 'text/html' })))
    setRemoteAuth(GYM, 'TOKEN')
    const e = await api('/api/data/rev').catch(x => x)
    expect(e.code).toBe('cf-access')
    expect(e.status).toBe(403)
  })
  it('openGym\'s own 401 behind Cloudflare stays a refusal of the device', () => {
    const r = resp(401, '', { 'cf-ray': '1' })
    expect(cfAccessRefusal(r, { error: 'not signed in' })).toBe(false)
    expect(cfAccessRefusal(r, null)).toBe(true)
    expect(cfAccessRefusal(Object.assign(resp(200, ''), { url: 'https://team.cloudflareaccess.com/cdn-cgi/access/login/gym' }), null)).toBe(true)
    expect(cfAccessRefusal(resp(500, '', { 'cf-ray': '1' }), null)).toBe(false)
  })
})
