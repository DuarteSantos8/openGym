import { describe, it, expect, vi } from 'vitest'
import { cloudConfig, createAuth, CloudAuthError, SESSION_KEY } from './auth.js'

const URL0 = 'https://proj.example'
const KEY = 'sb_publishable_test'
const memory = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), _m: m } }
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) })
const tokens = (over = {}) => ({ access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600, token_type: 'bearer', user: { id: 'u-1', email: 'a@example.com' }, ...over })

function setup(routes, { t0 = 1_000_000_000_000 } = {}) {
  const calls = []
  let clock = t0
  const fetchImpl = vi.fn(async (url, init = {}) => {
    const path = url.replace(URL0, '')
    calls.push({ path, method: init.method || 'GET', headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : undefined })
    // an exact route first, then the same path whatever its query
    const hit = routes[`${init.method || 'GET'} ${path}`] ?? routes[`${init.method || 'GET'} ${path.split('?')[0]}`]
    if (!hit) return res(404, { error_code: 'not_found', msg: 'no route ' + path })
    return typeof hit === 'function' ? hit(calls[calls.length - 1]) : hit
  })
  const storage = memory()
  const auth = createAuth({ url: URL0 + '/', key: KEY, fetchImpl, storage, now: () => clock })
  return { auth, calls, storage, fetchImpl, tick: ms => { clock += ms } }
}

describe('cloudConfig', () => {
  it('needs both the address and the public key, and trims the address', () => {
    expect(cloudConfig({ VITE_SUPABASE_URL: 'https://x.example/', VITE_SUPABASE_PUBLISHABLE_KEY: 'k' })).toEqual({ url: 'https://x.example', key: 'k' })
    expect(cloudConfig({ VITE_SUPABASE_URL: 'https://x.example' })).toBeNull()
    expect(cloudConfig({})).toBeNull()
    expect(cloudConfig(undefined)).toBeNull()
  })
  it('refuses an address that is not https, except this machine while developing', () => {
    expect(cloudConfig({ VITE_SUPABASE_URL: 'http://x.example', VITE_SUPABASE_PUBLISHABLE_KEY: 'k' })).toBeNull()
    expect(cloudConfig({ VITE_SUPABASE_URL: 'http://127.0.0.1:54321', VITE_SUPABASE_PUBLISHABLE_KEY: 'k' })).toEqual({ url: 'http://127.0.0.1:54321', key: 'k' })
    expect(cloudConfig({ VITE_SUPABASE_URL: 'javascript:alert(1)', VITE_SUPABASE_PUBLISHABLE_KEY: 'k' })).toBeNull()
  })
  it('refuses a secret key: only the publishable one may be in a browser', () => {
    expect(cloudConfig({ VITE_SUPABASE_URL: 'https://x.example', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_abc' })).toBeNull()
  })
})

describe('sign in', () => {
  it('sends the email and password with the public key, keeps the session and tells listeners', async () => {
    const { auth, calls, storage } = setup({ 'POST /auth/v1/token?grant_type=password': res(200, tokens()) })
    const seen = []
    auth.onChange(s => seen.push(s?.user?.id ?? null))
    const s = await auth.signIn(' A@Example.com ', 'pw')
    expect(calls[0]).toMatchObject({ path: '/auth/v1/token?grant_type=password', method: 'POST', body: { email: 'a@example.com', password: 'pw' } })
    expect(calls[0].headers.apikey).toBe(KEY)
    expect(calls[0].headers.Authorization).toBeUndefined()
    expect(s.user).toEqual({ id: 'u-1', email: 'a@example.com' })
    expect(auth.session().access_token).toBe('at-1')
    expect(JSON.parse(storage.getItem(SESSION_KEY)).refresh_token).toBe('rt-1')
    expect(seen).toEqual(['u-1'])
  })

  it('turns the server\'s refusal into a code the screen can word, and keeps nothing', async () => {
    const { auth, storage } = setup({ 'POST /auth/v1/token?grant_type=password': res(400, { error_code: 'invalid_credentials', msg: 'Invalid login credentials' }) })
    await expect(auth.signIn('a@example.com', 'bad')).rejects.toMatchObject({ name: 'CloudAuthError', code: 'invalid_credentials', status: 400 })
    expect(auth.session()).toBeNull()
    expect(storage.getItem(SESSION_KEY)).toBeNull()
  })

  it('says "network" when the request never lands and "unknown" for an answer it cannot read', async () => {
    const down = setup({})
    down.fetchImpl.mockRejectedValueOnce(new TypeError('failed to fetch'))
    await expect(down.auth.signIn('a@example.com', 'pw')).rejects.toMatchObject({ code: 'network' })
    const odd = setup({ 'POST /auth/v1/token?grant_type=password': { ok: false, status: 502, json: async () => { throw new Error('html') } } })
    await expect(odd.auth.signIn('a@example.com', 'pw')).rejects.toMatchObject({ code: 'unknown', status: 502 })
  })

  it('never puts the password or a token in an error', async () => {
    const { auth } = setup({ 'POST /auth/v1/token?grant_type=password': res(400, { error_code: 'invalid_credentials', msg: 'Invalid login credentials for hunter2' }) })
    const err = await auth.signIn('a@example.com', 'hunter2').catch(e => e)
    expect(err).toBeInstanceOf(CloudAuthError)
    expect(JSON.stringify({ m: err.message, c: err.code })).not.toContain('hunter2')
  })
})

describe('sign up', () => {
  it('with confirmation on: no session yet, and says an email is on its way', async () => {
    const { auth, calls } = setup({ 'POST /auth/v1/signup': res(200, { id: 'u-2', email: 'b@example.com', confirmation_sent_at: 'now' }) })
    const out = await auth.signUp('b@example.com', 'long-enough-pw', { redirectTo: 'https://app.example/#/account' })
    expect(out).toEqual({ session: null, needsConfirmation: true })
    expect(calls[0].path).toBe('/auth/v1/signup?redirect_to=' + encodeURIComponent('https://app.example/#/account'))
    expect(auth.session()).toBeNull()
  })
  it('with confirmation off: signed in at once', async () => {
    const { auth } = setup({ 'POST /auth/v1/signup': res(200, tokens({ user: { id: 'u-3', email: 'c@example.com' } })) })
    const out = await auth.signUp('c@example.com', 'long-enough-pw')
    expect(out.needsConfirmation).toBe(false)
    expect(auth.session().user.id).toBe('u-3')
  })
})

describe('staying signed in', () => {
  it('hands out the token it has while it is good, and swaps it shortly before it runs out', async () => {
    const { auth, calls, tick } = setup({
      'POST /auth/v1/token?grant_type=password': res(200, tokens()),
      'POST /auth/v1/token?grant_type=refresh_token': res(200, tokens({ access_token: 'at-2', refresh_token: 'rt-2' })),
    })
    await auth.signIn('a@example.com', 'pw')
    expect(await auth.fresh()).toBe('at-1')
    expect(calls).toHaveLength(1)
    tick(3600_000 - 30_000)
    expect(await auth.fresh()).toBe('at-2')
    expect(calls[1]).toMatchObject({ path: '/auth/v1/token?grant_type=refresh_token', body: { refresh_token: 'rt-1' } })
    expect(auth.session().refresh_token).toBe('rt-2')
  })

  it('asks once when several callers need a fresh token at the same moment', async () => {
    const { auth, calls, tick } = setup({
      'POST /auth/v1/token?grant_type=password': res(200, tokens()),
      'POST /auth/v1/token?grant_type=refresh_token': res(200, tokens({ access_token: 'at-2', refresh_token: 'rt-2' })),
    })
    await auth.signIn('a@example.com', 'pw')
    tick(3600_000)
    const got = await Promise.all([auth.fresh(), auth.fresh(), auth.fresh()])
    expect(got).toEqual(['at-2', 'at-2', 'at-2'])
    expect(calls.filter(c => c.path.includes('refresh_token'))).toHaveLength(1)
  })

  it('signs out when the server says the refresh token is no good, but not for a network blip', async () => {
    const dead = setup({
      'POST /auth/v1/token?grant_type=password': res(200, tokens()),
      'POST /auth/v1/token?grant_type=refresh_token': res(400, { error_code: 'refresh_token_not_found', msg: 'gone' }),
    })
    await dead.auth.signIn('a@example.com', 'pw')
    dead.tick(3600_000)
    expect(await dead.auth.fresh()).toBeNull()
    expect(dead.auth.session()).toBeNull()

    const blip = setup({ 'POST /auth/v1/token?grant_type=password': res(200, tokens()) })
    await blip.auth.signIn('a@example.com', 'pw')
    blip.tick(3600_000)
    blip.fetchImpl.mockRejectedValueOnce(new TypeError('offline'))
    await expect(blip.auth.fresh()).rejects.toMatchObject({ code: 'network' })
    expect(blip.auth.session().refresh_token).toBe('rt-1')
  })

  // Review of #62: signing out while a refresh is on its way must stay signed out.
  it('a refresh that lands after signing out does not sign anyone back in', async () => {
    let land
    const { auth, storage, tick } = setup({
      'POST /auth/v1/token?grant_type=password': res(200, tokens()),
      'POST /auth/v1/token?grant_type=refresh_token': () => new Promise(r => { land = () => r(res(200, tokens({ access_token: 'at-2', refresh_token: 'rt-2' }))) }),
      'POST /auth/v1/logout': res(204, {}),
    })
    await auth.signIn('a@example.com', 'pw')
    tick(3600_000)
    const pending = auth.fresh()
    await Promise.resolve()
    await auth.signOut()
    land()
    expect(await pending).toBeNull()
    expect(auth.session()).toBeNull()
    expect(storage.getItem(SESSION_KEY)).toBeNull()
  })

  it('nor does it replace the session of whoever signed in meanwhile', async () => {
    let land
    const { auth, tick } = setup({
      'POST /auth/v1/token?grant_type=password': c => res(200, c.body.email === 'b@example.com' ? tokens({ access_token: 'at-b', refresh_token: 'rt-b', user: { id: 'u-b', email: 'b@example.com' } }) : tokens()),
      'POST /auth/v1/token?grant_type=refresh_token': () => new Promise(r => { land = () => r(res(200, tokens({ access_token: 'at-2', refresh_token: 'rt-2' }))) }),
      'POST /auth/v1/logout': res(204, {}),
    })
    await auth.signIn('a@example.com', 'pw')
    tick(3600_000)
    const pending = auth.fresh()
    await Promise.resolve()
    await auth.signOut()
    await auth.signIn('b@example.com', 'pw')
    land()
    // Review of #63: whoever asked as A must never be handed B's token. A request made for A
    // (deleting the account, say) would then act on B.
    expect(await pending).toBeNull()
    expect(auth.session().user.id).toBe('u-b')
    expect(auth.session().access_token).toBe('at-b')
  })

  it('a refresh left over from the last account does not stand in for the new account\'s own', async () => {
    const lands = []
    const { auth, calls, tick } = setup({
      'POST /auth/v1/token?grant_type=password': c => res(200, c.body.email === 'b@example.com' ? tokens({ access_token: 'at-b', refresh_token: 'rt-b', user: { id: 'u-b', email: 'b@example.com' } }) : tokens()),
      'POST /auth/v1/token?grant_type=refresh_token': c => new Promise(r => { lands.push(() => r(res(200, c.body.refresh_token === 'rt-b' ? tokens({ access_token: 'at-b2', refresh_token: 'rt-b2', user: { id: 'u-b', email: 'b@example.com' } }) : tokens({ access_token: 'at-2', refresh_token: 'rt-2' })))) }),
      'POST /auth/v1/logout': res(204, {}),
    })
    await auth.signIn('a@example.com', 'pw')
    tick(3600_000)
    const asA = auth.fresh()
    await Promise.resolve()
    await auth.signOut()
    await auth.signIn('b@example.com', 'pw')
    tick(3600_000)
    const asB = auth.fresh()
    await Promise.resolve()
    expect(calls.filter(c => c.path.includes('refresh_token')).map(c => c.body.refresh_token)).toEqual(['rt-1', 'rt-b'])
    lands.forEach(fn => fn())
    expect(await asA).toBeNull()
    expect(await asB).toBe('at-b2')
    expect(auth.session().user.id).toBe('u-b')
    expect(auth.session().refresh_token).toBe('rt-b2')
  })

  it('picks the session up again from storage, and ignores one that is not a session', async () => {
    const a = setup({ 'POST /auth/v1/token?grant_type=password': res(200, tokens()) })
    await a.auth.signIn('a@example.com', 'pw')
    const again = createAuth({ url: URL0, key: KEY, fetchImpl: a.fetchImpl, storage: a.storage, now: () => 1_000_000_000_000 })
    expect(again.session().user.id).toBe('u-1')
    a.storage.setItem(SESSION_KEY, '{"access_token":5}')
    expect(createAuth({ url: URL0, key: KEY, fetchImpl: a.fetchImpl, storage: a.storage }).session()).toBeNull()
    a.storage.setItem(SESSION_KEY, 'not json')
    expect(createAuth({ url: URL0, key: KEY, fetchImpl: a.fetchImpl, storage: a.storage }).session()).toBeNull()
  })
})

describe('sign out, reset, confirm', () => {
  it('sign out tells the server with the token, and forgets the session even if the server cannot be reached', async () => {
    const { auth, calls, fetchImpl } = setup({ 'POST /auth/v1/token?grant_type=password': res(200, tokens()), 'POST /auth/v1/logout?scope=local': res(204, {}) })
    await auth.signIn('a@example.com', 'pw')
    await auth.signOut()
    expect(calls[1].headers.Authorization).toBe('Bearer at-1')
    expect(auth.session()).toBeNull()
    await auth.signIn('a@example.com', 'pw')
    fetchImpl.mockRejectedValueOnce(new TypeError('offline'))
    await auth.signOut()
    expect(auth.session()).toBeNull()
  })

  it('asks for a reset email without saying whether the address has an account', async () => {
    const { auth, calls } = setup({ 'POST /auth/v1/recover': res(200, {}) })
    await auth.recover('a@example.com', { redirectTo: 'https://app.example/#/account?reset=1' })
    expect(calls[0].body).toEqual({ email: 'a@example.com' })
    expect(calls[0].path).toContain('redirect_to=')
  })

  it('trades the hash from a confirmation or reset link for a session', async () => {
    const { auth, calls } = setup({ 'POST /auth/v1/verify': res(200, tokens()) })
    const s = await auth.verify({ type: 'recovery', tokenHash: 'h-1' })
    expect(calls[0].body).toEqual({ type: 'recovery', token_hash: 'h-1' })
    expect(s.user.id).toBe('u-1')
    await expect(auth.verify({ type: 'nonsense', tokenHash: 'h' })).rejects.toMatchObject({ code: 'validation_failed' })
  })

  it('sets a new password as the signed-in user', async () => {
    const { auth, calls } = setup({ 'POST /auth/v1/token?grant_type=password': res(200, tokens()), 'PUT /auth/v1/user': res(200, { id: 'u-1', email: 'a@example.com' }) })
    await auth.signIn('a@example.com', 'pw')
    await auth.updatePassword('a-new-long-password')
    expect(calls[1]).toMatchObject({ method: 'PUT', body: { password: 'a-new-long-password' } })
    expect(calls[1].headers.Authorization).toBe('Bearer at-1')
    const out = setup({})
    await expect(out.auth.updatePassword('x')).rejects.toMatchObject({ code: 'not_signed_in' })
  })
})

describe('approving a sign-in to the app\'s own server (ADR 0013)', () => {
  it('reads what is being asked for and answers it, as the signed-in user', async () => {
    const { auth, calls } = setup({
      'POST /auth/v1/token?grant_type=password': res(200, tokens()),
      'GET /auth/v1/oauth/authorizations/az-1': res(200, { authorization_id: 'az-1', client: { name: 'Ironvane' }, scope: 'openid email', redirect_uri: 'https://api.example/api/oidc/callback' }),
      'POST /auth/v1/oauth/authorizations/az-1/consent': res(200, { redirect_url: 'https://api.example/api/oidc/callback?code=c' }),
    })
    await auth.signIn('a@example.com', 'pw')
    expect((await auth.authorization('az-1')).client.name).toBe('Ironvane')
    expect(await auth.consent('az-1', true)).toEqual({ redirectTo: 'https://api.example/api/oidc/callback?code=c' })
    expect(calls[2]).toMatchObject({ body: { action: 'approve' } })
    expect(calls[2].headers.Authorization).toBe('Bearer at-1')
  })
  it('refuses an id that could be a path, and needs someone signed in', async () => {
    const { auth } = setup({ 'POST /auth/v1/token?grant_type=password': res(200, tokens()) })
    await expect(auth.authorization('az-1')).rejects.toMatchObject({ code: 'not_signed_in' })
    await auth.signIn('a@example.com', 'pw')
    await expect(auth.authorization('../user')).rejects.toMatchObject({ code: 'validation_failed' })
    await expect(auth.consent('a/b', true)).rejects.toMatchObject({ code: 'validation_failed' })
  })
})

// Found in review of #79: the session was read from storage once, when the page loaded. A tab
// left open went on believing whatever was true then, and acted on it.
describe('another tab signs in or out', () => {
  const twoTabs = (routes = {}) => {
    const a = setup(routes)
    const heard = []
    const tabs = { fns: [] }
    const events = { addEventListener: (type, fn) => { if (type === 'storage') tabs.fns.push(fn) } }
    const other = createAuth({ url: URL0, key: KEY, fetchImpl: a.fetchImpl, storage: a.storage, now: () => 1_000_000_000_000, events })
    other.onChange(s => heard.push(s?.user.id ?? null))
    const tell = (key = SESSION_KEY) => tabs.fns.forEach(fn => fn({ key }))
    return { ...a, other, heard, tell }
  }

  it('this one follows: who is signed in, and its listeners hear it', async () => {
    const t = twoTabs({ 'POST /auth/v1/token': res(200, tokens()), 'POST /auth/v1/logout': res(204, {}) })
    expect(t.other.session()).toBeNull()
    await t.auth.signIn('a@example.com', 'right-password')
    t.tell()
    expect(t.other.session().user.id).toBe('u-1')
    await t.auth.signOut()
    t.tell()
    expect(t.other.session()).toBeNull()
    expect(t.heard).toEqual(['u-1', null])
  })

  it('sync() reads the latest without waiting to be told, and says nothing when nothing changed', async () => {
    const t = twoTabs({ 'POST /auth/v1/token': res(200, tokens()) })
    await t.auth.signIn('a@example.com', 'right-password')
    expect(t.other.sync().user.id).toBe('u-1')
    expect(t.other.sync().user.id).toBe('u-1')
    t.tell(); t.tell('something-else'); t.tell(null)
    expect(t.heard).toEqual(['u-1'])
  })

  it('a refresh that was on its way here is thrown away: it must not write the old session back', async () => {
    let answer
    const t = twoTabs({ 'POST /auth/v1/token': () => new Promise(r => { answer = r }) })
    t.storage.setItem(SESSION_KEY, JSON.stringify({ access_token: 'old', refresh_token: 'rt-old', expires_at: 1_000_000_000_000 + 1000, user: { id: 'u-1', email: 'a@example.com' } }))
    t.other.sync()
    const asked = t.other.fresh()                       // nearly expired: a refresh goes out
    t.storage.removeItem(SESSION_KEY)                   // the other tab signs out
    t.tell()
    answer(res(200, tokens({ access_token: 'new' })))
    expect(await asked).toBeNull()
    expect(t.other.session()).toBeNull()
    expect(t.storage.getItem(SESSION_KEY)).toBeNull()
  })

  it('without anything to listen on (tests, old browsers) it still works, and sync still reads', () => {
    const a = setup({})
    const lone = createAuth({ url: URL0, key: KEY, fetchImpl: a.fetchImpl, storage: a.storage, events: null })
    a.storage.setItem(SESSION_KEY, JSON.stringify({ access_token: 'x', refresh_token: 'y', expires_at: 5, user: { id: 'u-9', email: '' } }))
    expect(lone.session()).toBeNull()
    expect(lone.sync().user.id).toBe('u-9')
  })
})

// Found in review of #80: where storage will not keep the session (private mode, a full quota)
// it lives in the page's memory, and following storage must not take it away again.
describe('a session storage would not keep', () => {
  const refusing = () => { const s = memory(); return { ...s, setItem: () => { throw new Error('QuotaExceededError') } } }
  const unreadable = () => ({ getItem: () => { throw new Error('SecurityError') }, setItem: () => { throw new Error('SecurityError') }, removeItem: () => { throw new Error('SecurityError') } })
  const make = storage => {
    const a = setup({ 'POST /auth/v1/token': res(200, tokens()), 'POST /auth/v1/logout': res(204, {}) })
    const fns = []
    const auth = createAuth({ url: URL0, key: KEY, fetchImpl: a.fetchImpl, storage, now: () => 1_000_000_000_000, events: { addEventListener: (_t, fn) => fns.push(fn) } })
    return { auth, tell: () => fns.forEach(fn => fn({ key: SESSION_KEY })) }
  }

  it('is not thrown away by reading storage: writes refused', async () => {
    const t = make(refusing())
    await t.auth.signIn('a@example.com', 'right-password')
    expect(t.auth.sync().user.id).toBe('u-1')
    t.tell()
    expect(t.auth.session().user.id).toBe('u-1')
  })

  it('nor where storage cannot even be read', async () => {
    const t = make(unreadable())
    await t.auth.signIn('a@example.com', 'right-password')
    expect(t.auth.sync().user.id).toBe('u-1')
  })

  // Found in review of #81. Whoever is about to send the person through a full-page redirect
  // has to know whether they will still be signed in when the page comes back.
  it('lasting() says whether the session will outlive the page', async () => {
    const lost = make(refusing())
    expect(lost.auth.lasting()).toBe(false)             // nobody signed in
    await lost.auth.signIn('a@example.com', 'right-password')
    expect(lost.auth.lasting()).toBe(false)             // signed in, in memory only
    const kept = make(memory())
    await kept.auth.signIn('a@example.com', 'right-password')
    expect(kept.auth.lasting()).toBe(true)
    await kept.auth.signOut()
    expect(kept.auth.lasting()).toBe(false)
  })

  it('signing out still signs out, and a session that was kept still follows another tab\'s sign-out', async () => {
    const t = make(refusing())
    await t.auth.signIn('a@example.com', 'right-password')
    await t.auth.signOut()
    expect(t.auth.sync()).toBeNull()
    const s = memory()
    const kept = make(s)
    await kept.auth.signIn('a@example.com', 'right-password')
    s.removeItem(SESSION_KEY)                         // another tab signs out
    expect(kept.auth.sync()).toBeNull()
  })
})
