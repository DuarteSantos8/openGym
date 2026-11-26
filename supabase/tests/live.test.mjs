// The Cloud edition against a REAL project: the app's own sign-in client (frontend/src/lib/cloud)
// and the API's token check (api/supabase-jwt.js), with two real users. Everything else in this
// folder runs against a pretend server; this is where the pretending stops.
//
// Skipped unless the project is named, so `node --test` stays offline by default:
//
//   LIVE_SUPABASE_URL=https://<ref>.supabase.co  LIVE_SUPABASE_KEY=sb_publishable_…
//   LIVE_USER_A=email:password  LIVE_USER_B=email:password
//   node --test supabase/tests/live.test.mjs
//
// The two users must exist and be confirmed (supabase/README.md, "Test users"). The test changes
// only their own profile rows and puts them back.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createAuth, CloudAuthError } from '../../frontend/src/lib/cloud/auth.js'
import { createProfiles } from '../../frontend/src/lib/cloud/profile.js'
import { createSupabaseVerifier } from '../../api/supabase-jwt.js'

const url = process.env.LIVE_SUPABASE_URL, key = process.env.LIVE_SUPABASE_KEY
const pair = v => { const i = String(v || '').indexOf(':'); return i > 0 ? { email: v.slice(0, i), password: v.slice(i + 1) } : null }
const A = pair(process.env.LIVE_USER_A), B = pair(process.env.LIVE_USER_B)
const skip = !(url && key && A && B) && 'set LIVE_SUPABASE_URL, LIVE_SUPABASE_KEY, LIVE_USER_A and LIVE_USER_B to run'

const memory = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k) } }
const client = (now) => { const auth = createAuth({ url, key, storage: memory(), ...(now ? { now } : {}) }); return { auth, profiles: createProfiles({ url, key, auth }) } }
const rest = (path, token, init = {}) => fetch(`${url}/rest/v1/${path}`, { ...init, headers: { apikey: key, 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(init.headers || {}) } })

test('a wrong password is refused with a code the screen can word', { skip }, async () => {
  const { auth } = client()
  const err = await auth.signIn(A.email, A.password + 'x').catch(e => e)
  assert.ok(err instanceof CloudAuthError)
  assert.equal(err.code, 'invalid_credentials')
  assert.equal(auth.session(), null)
})

test('sign in, read and change your own profile, and nobody else\'s', { skip }, async () => {
  const a = client(), b = client()
  const sa = await a.auth.signIn(A.email, A.password)
  const sb = await b.auth.signIn(B.email, B.password)
  assert.notEqual(sa.user.id, sb.user.id)

  // the row the sign-up trigger made
  const mine = await a.profiles.get()
  assert.equal(mine.id, sa.user.id)

  // change the two fields that are yours, and get the server's row back
  const stamp = 'live ' + Date.now()
  const changed = await a.profiles.update({ display_name: stamp, experience: 'beginner' })
  assert.equal(changed.display_name, stamp)
  assert.equal(changed.experience, 'beginner')

  // B sees their own row only: asking for every row returns one, and it is not A's
  const all = await (await rest('profiles?select=id,display_name', sb.access_token)).json()
  assert.deepEqual(all.map(r => r.id), [sb.user.id])
  const peek = await (await rest(`profiles?select=id&id=eq.${sa.user.id}`, sb.access_token)).json()
  assert.deepEqual(peek, [])

  // B cannot change A's row: the update matches nothing
  const hit = await rest(`profiles?id=eq.${sa.user.id}`, sb.access_token, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ display_name: 'taken over' }) })
  assert.deepEqual(await hit.json(), [])
  assert.equal((await a.profiles.get()).display_name, stamp)

  // nobody may set the link to the app's own server, insert a row or delete one
  const link = await rest(`profiles?id=eq.${sa.user.id}`, sa.access_token, { method: 'PATCH', body: JSON.stringify({ node_uid: 'mine-now' }) })
  assert.equal(link.status, 403)
  const ins = await rest('profiles', sa.access_token, { method: 'POST', body: JSON.stringify({ id: '00000000-0000-4000-8000-000000000001' }) })
  assert.equal(ins.status, 403)
  const del = await rest(`profiles?id=eq.${sa.user.id}`, sa.access_token, { method: 'DELETE' })
  assert.equal(del.status, 403)
  assert.equal((await a.profiles.get()).id, sa.user.id)

  // a level the database does not know is refused by the database, not only by the app
  const bad = await rest(`profiles?id=eq.${sa.user.id}`, sa.access_token, { method: 'PATCH', body: JSON.stringify({ experience: 'wizard' }) })
  assert.equal(bad.status, 400)

  await a.profiles.update({ display_name: '', experience: null })
  await a.auth.signOut(); await b.auth.signOut()
})

test('a visitor reads no profile, and billing tables are closed to everyone but their owner', { skip }, async () => {
  const anon = await rest('profiles?select=id')
  assert.ok(anon.status === 401 || anon.status === 403 || (await anon.json()).length === 0)
  const { auth } = client()
  const s = await auth.signIn(A.email, A.password)
  for (const table of ['customers', 'subscriptions', 'entitlements']) {
    const res = await rest(`${table}?select=*`, s.access_token)
    assert.equal(res.status, 200, table)
    assert.deepEqual(await res.json(), [], table)
  }
  assert.equal((await rest('webhook_events?select=id', s.access_token)).status, 403)
  const ent = await rest('rpc/has_entitlement', s.access_token, { method: 'POST', body: JSON.stringify({ wanted: 'pro' }) })
  assert.equal(await ent.json(), false)
  assert.notEqual((await rest('rpc/has_entitlement', null, { method: 'POST', body: JSON.stringify({ wanted: 'pro' }) })).status, 200)
  await auth.signOut()
})

test('the session refreshes, and the old refresh token then stops working', { skip }, async () => {
  let clock = Date.now()
  const { auth, profiles } = client(() => clock)
  const first = await auth.signIn(A.email, A.password)
  clock += 2 * 3600_000                       // as if two hours had passed on this device
  const token = await auth.fresh()
  assert.ok(token && token !== first.access_token)
  assert.notEqual(auth.session().refresh_token, first.refresh_token)
  assert.equal((await profiles.get()).id, first.user.id)
  await auth.signOut()
  assert.equal(auth.session(), null)
})

test('the API\'s own check accepts a real access token and refuses a tampered one', { skip }, async () => {
  const { auth } = client()
  const s = await auth.signIn(A.email, A.password)
  const { verify } = createSupabaseVerifier({ url })
  const claims = await verify(s.access_token)
  assert.equal(claims.sub, s.user.id)
  const [h, p, sig] = s.access_token.split('.')
  const forged = [h, Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url')), sub: '00000000-0000-4000-8000-000000000002' })).toString('base64url'), sig].join('.')
  await assert.rejects(() => verify(forged))
  await auth.signOut()
})

test('what the project says about itself matches what the API\'s OIDC sign-in needs (ADR 0013)', { skip }, async () => {
  const d = await (await fetch(`${url}/auth/v1/.well-known/openid-configuration`)).json()
  assert.equal(d.issuer, `${url}/auth/v1`)
  assert.ok(d.code_challenge_methods_supported.includes('S256'))
  assert.ok(d.id_token_signing_alg_values_supported.some(a => a === 'ES256' || a === 'RS256'))
  assert.ok(d.token_endpoint_auth_methods_supported.includes('none'))
  assert.ok(d.claims_supported.includes('email_verified'))
  const jwks = await (await fetch(d.jwks_uri)).json()
  assert.ok(jwks.keys.length > 0 && jwks.keys.every(k => k.alg === 'ES256' || k.alg === 'RS256'))
})
