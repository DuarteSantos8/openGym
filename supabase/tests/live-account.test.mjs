// The account functions on a REAL project (supabase/functions/export-account, delete-account).
// Skipped unless the project is named, like live.test.mjs, with the same variables.
//
// Deleting is tested only on a user made for it: LIVE_USER_DISPOSABLE=email:password. Without
// that variable the delete test checks the refusals and deletes nobody.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createAuth } from '../../frontend/src/lib/cloud/auth.js'

const url = process.env.LIVE_SUPABASE_URL, key = process.env.LIVE_SUPABASE_KEY
const pair = v => { const i = String(v || '').indexOf(':'); return i > 0 ? { email: v.slice(0, i), password: v.slice(i + 1) } : null }
const A = pair(process.env.LIVE_USER_A), B = pair(process.env.LIVE_USER_B), D = pair(process.env.LIVE_USER_DISPOSABLE)
const skip = !(url && key && A && B) && 'set LIVE_SUPABASE_URL, LIVE_SUPABASE_KEY, LIVE_USER_A and LIVE_USER_B to run'

const memory = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k) } }
const signIn = async who => { const auth = createAuth({ url, key, storage: memory() }); const s = await auth.signIn(who.email, who.password); return { auth, s } }
const fn = (name, token, body, method = 'POST') => fetch(`${url}/functions/v1/${name}`, {
  method, headers: { apikey: key, 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
  ...(body === undefined || method !== 'POST' ? {} : { body: JSON.stringify(body) }),
})

test('export: your own rows, as the deployed function returns them', { skip }, async () => {
  const { auth, s } = await signIn(A)
  const res = await fn('export-account', s.access_token)
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('cache-control'), 'no-store')
  const out = await res.json()
  assert.deepEqual(out.account, { id: s.user.id, email: A.email })
  assert.ok(out.profile && 'display_name' in out.profile)
  assert.deepEqual(out.subscriptions, [])
  assert.deepEqual(out.entitlements, [])
  assert.ok(!JSON.stringify(out).includes(B.email))
  await auth.signOut()
})

test('export and delete refuse a visitor, a made-up token and anything but POST', { skip }, async () => {
  for (const name of ['export-account', 'delete-account']) {
    assert.equal((await fn(name, null, { confirm: 'delete' })).status, 401, name)
    assert.equal((await fn(name, 'not.a.token', { confirm: 'delete' })).status, 401, name)
    assert.equal((await fn(name, key, { confirm: 'delete' })).status, 401, name + ' with the public key as a token')
    assert.equal((await fn(name, null, undefined, 'GET')).status, 405, name)
  }
})

test('delete: refused without the word, and the account is still there', { skip }, async () => {
  const { auth, s } = await signIn(B)
  const res = await fn('delete-account', s.access_token, { confirm: 'yes' })
  assert.equal(res.status, 400)
  assert.deepEqual(await res.json(), { error: 'confirm' })
  assert.equal((await fn('export-account', s.access_token)).status, 200)
  await auth.signOut()
})

test('delete: the account, its profile row and its sign-in are gone', { skip: skip || (!D && 'set LIVE_USER_DISPOSABLE to delete a user made for this') }, async () => {
  const { s } = await signIn(D)
  const res = await fn('delete-account', s.access_token, { confirm: 'delete' })
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { deleted: true })
  // the token no longer names anyone, and the password no longer signs in
  assert.equal((await fn('export-account', s.access_token)).status, 401)
  const again = await createAuth({ url, key, storage: memory() }).signIn(D.email, D.password).catch(e => e)
  assert.equal(again.code, 'invalid_credentials')
  // someone else, signed in, sees no trace of the row
  const b = await signIn(B)
  const rows = await (await fetch(`${url}/rest/v1/profiles?select=id&id=eq.${s.user.id}`, { headers: { apikey: key, Authorization: 'Bearer ' + b.s.access_token } })).json()
  assert.deepEqual(rows, [])
  await b.auth.signOut()
})
