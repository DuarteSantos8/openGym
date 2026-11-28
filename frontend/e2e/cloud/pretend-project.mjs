// A pretend hosted project for the Cloud edition's E2E: it answers, through page.route, for the
// address the cloud build was given (playwright.config.mjs), so the app runs its real code against
// it and nothing leaves this machine. It keeps just enough state to be worth talking to: who
// exists, who is signed in, one profile row each, and what the functions were asked to do.
export const PROJECT = 'http://127.0.0.1:4175'
export const KEY = 'sb_publishable_e2e'

export async function pretendProject(page, { users = [{ id: 'u-1', email: 'sam@example.com', password: 'right-password', name: 'Sam' }] } = {}) {
  const byToken = new Map()
  const seen = []                                   // every request, for the test to read
  let n = 0
  const state = { users: users.map(u => ({ ...u })), deleted: [], emails: [], consents: [] }
  const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) })
  const session = u => { const t = `at-${++n}`; byToken.set(t, u.id); return { access_token: t, refresh_token: `rt-${n}`, expires_in: 3600, token_type: 'bearer', user: { id: u.id, email: u.email } } }
  const who = req => state.users.find(u => u.id === byToken.get((req.headers().authorization || '').replace(/^Bearer /, '')))

  await page.route(PROJECT + '/**', async route => {
    const req = route.request()
    const url = new URL(req.url())
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } })
    const body = (() => { try { return JSON.parse(req.postData() || '{}') } catch { return {} } })()
    const path = url.pathname
    seen.push({ method: req.method(), path, search: url.search, body, apikey: req.headers().apikey })
    if (req.headers().apikey !== KEY && !path.startsWith('/api/')) return json(route, 401, { error_code: 'no_api_key' })

    if (path === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
      const u = state.users.find(x => x.email === body.email && x.password === body.password)
      return u ? json(route, 200, session(u)) : json(route, 400, { error_code: 'invalid_credentials', msg: 'Invalid login credentials' })
    }
    if (path === '/auth/v1/signup') {
      if (state.users.some(x => x.email === body.email)) return json(route, 422, { error_code: 'user_already_exists' })
      state.users.push({ id: `u-${state.users.length + 1}`, email: body.email, password: body.password, name: '' })
      state.emails.push({ kind: 'signup', to: body.email, redirect: url.searchParams.get('redirect_to') })
      return json(route, 200, { id: 'new', email: body.email, confirmation_sent_at: 'now' })
    }
    if (path === '/auth/v1/recover') { state.emails.push({ kind: 'recovery', to: body.email, redirect: url.searchParams.get('redirect_to') }); return json(route, 200, {}) }
    if (path === '/auth/v1/verify') {
      const u = body.token_hash === 'good-hash' ? state.users[0] : null
      return u ? json(route, 200, session(u)) : json(route, 403, { error_code: 'otp_expired' })
    }
    if (path === '/auth/v1/logout') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
    // where an approved sign-in sends the browser: the app's own server, played by this page
    if (path === '/api/oidc/callback') return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>back at the server</title><h1 id="landed">landed</h1>' })
    const me = who(req)
    if (!me) return json(route, 401, { error_code: 'bad_jwt' })
    if (path === '/auth/v1/user' && req.method() === 'PUT') { if (body.password) me.password = body.password; return json(route, 200, { id: me.id, email: me.email }) }
    if (path === '/rest/v1/profiles') {
      if (req.method() === 'PATCH') me.name = body.display_name ?? ''
      return json(route, 200, [{ id: me.id, display_name: me.name || null, experience: null, node_uid: null }])
    }
    if (path === '/functions/v1/export-account') return json(route, 200, { exported_at: 'now', account: { id: me.id, email: me.email }, profile: { display_name: me.name }, subscriptions: [], entitlements: [] })
    if (path === '/functions/v1/delete-account') {
      if ('subject' in body && body.subject !== me.id) return json(route, 403, { error: 'subject_mismatch' })
      if (state.subscriptionActive) return json(route, 409, { error: 'subscription_active' })
      if (body.confirm === 'check') return json(route, 200, { allowed: true })
      if (body.confirm !== 'delete') return json(route, 400, { error: 'confirm' })
      state.deleted.push(me.id); state.users = state.users.filter(u => u !== me)
      return json(route, 200, { deleted: true })
    }
    const az = /^\/auth\/v1\/oauth\/authorizations\/([^/]+)(\/consent)?$/.exec(path)
    // The hosted server asks once: with consent on record it answers with where to go, and a
    // consent sent after that is refused ("no longer pending").
    if (az && !az[2] && state.allowedBefore) return json(route, 200, { redirect_url: `${PROJECT}/api/oidc/callback?code=c-2` })
    if (az && state.allowedBefore) return json(route, 400, { error_code: 'validation_failed', msg: 'authorization request is no longer pending' })
    if (az && !az[2]) return json(route, 200, { authorization_id: az[1], client: { name: 'Ironvane server' }, scope: 'openid email' })
    if (az) { state.consents.push({ id: az[1], action: body.action }); return json(route, 200, { redirect_url: `${PROJECT}/api/oidc/callback?${body.action === 'approve' ? 'code=c-1' : 'error=access_denied'}` }) }
    return json(route, 404, { error_code: 'not_found' })
  })
  return { state, seen }
}
