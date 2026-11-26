// Cloud edition (ADR 0010): the API checks a Supabase access token against the project's
// published keys. No network: the keys are made here and served by a pretend fetch.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { createSupabaseVerifier, issuerOf, SupabaseJwtError } from '../supabase-jwt.js'

const URL_ = 'https://proj.example'
const ISS = URL_ + '/auth/v1'
const SUB = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const T0 = 1_800_000_000_000

const b64u = v => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url')
const ec = kid => { const p = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }); return { ...p, kid, jwk: { ...p.publicKey.export({ format: 'jwk' }), kid, alg: 'ES256', use: 'sig' } } }
const rsa = kid => { const p = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }); return { ...p, kid, jwk: { ...p.publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' } } }

function sign(pair, claims = {}, header = {}) {
  const alg = header.alg || (pair.jwk.kty === 'RSA' ? 'RS256' : 'ES256')
  const h = b64u({ alg, typ: 'JWT', kid: pair.kid, ...header })
  const p = b64u({ iss: ISS, aud: 'authenticated', sub: SUB, exp: T0 / 1000 + 3600, email: 'a@example.test', ...claims })
  const sig = crypto.sign('sha256', Buffer.from(h + '.' + p), alg === 'ES256' ? { key: pair.privateKey, dsaEncoding: 'ieee-p1363' } : pair.privateKey)
  return h + '.' + p + '.' + sig.toString('base64url')
}

function setup(pairs, { failing = false } = {}) {
  const state = { now: T0, fetches: [], keys: pairs.map(p => p.jwk), failing }
  const fetchImpl = async url => {
    state.fetches.push(String(url))
    if (state.failing) return new Response('nope', { status: 503 })
    return new Response(JSON.stringify({ keys: state.keys }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const v = createSupabaseVerifier({ url: URL_, fetchImpl, now: () => state.now })
  return { v, state }
}
const refused = code => e => e instanceof SupabaseJwtError && e.code === code

test('off unless a usable project URL is set', () => {
  assert.equal(createSupabaseVerifier({}), null)
  assert.equal(createSupabaseVerifier({ url: '' }), null)
  assert.equal(createSupabaseVerifier({ url: 'not a url' }), null)
  assert.equal(createSupabaseVerifier({ url: 'http://proj.example' }), null)   // plain http only for localhost
  assert.ok(createSupabaseVerifier({ url: 'http://localhost:54321' }))
  assert.equal(issuerOf('https://proj.example/'), 'https://proj.example/auth/v1')
  assert.equal(issuerOf('ftp://proj.example'), null)
})

test('accepts a token the project signed (ES256 and RS256) and says who it is for', async () => {
  const e = ec('k-ec'), r = rsa('k-rsa')
  const { v, state } = setup([e, r])
  assert.deepEqual(await v.verify(sign(e)), { sub: SUB, email: 'a@example.test', anonymous: false, exp: T0 / 1000 + 3600 })
  assert.equal((await v.verify(sign(r, { is_anonymous: true, email: '' }))).anonymous, true)
  assert.equal((await v.verify(sign(r, { email: undefined }))).email, null)
  assert.equal((await v.verify(sign(e, { aud: ['other', 'authenticated'] }))).sub, SUB)
  assert.deepEqual(state.fetches, [ISS + '/.well-known/jwks.json'])   // fetched once, then cached
})

test('refuses a token that is not three well-formed parts', async () => {
  const { v, state } = setup([ec('k')])
  for (const bad of ['', 'a.b', 'a.b.c.d', 'a..c', null, undefined, 42, 'not base64!.x.y', b64u('{') + '.' + b64u({}) + '.sig', b64u('"str"') + '.' + b64u({}) + '.sig']) {
    await assert.rejects(v.verify(bad), refused('malformed'), String(bad))
  }
  assert.equal(state.fetches.length, 0)   // refused before any key was asked for
})

test('refuses HS256 and none outright, before looking at any key', async () => {
  const e = ec('k')
  const { v, state } = setup([e])
  const body = b64u({ iss: ISS, aud: 'authenticated', sub: SUB, exp: T0 / 1000 + 3600 })
  // the classic confusion attack: HMAC keyed with the public key
  const h = b64u({ alg: 'HS256', typ: 'JWT', kid: 'k' })
  const mac = crypto.createHmac('sha256', e.publicKey.export({ type: 'spki', format: 'pem' })).update(h + '.' + body).digest('base64url')
  await assert.rejects(v.verify(h + '.' + body + '.' + mac), refused('alg'))
  await assert.rejects(v.verify(b64u({ alg: 'none', kid: 'k' }) + '.' + body + '.AAAA'), refused('alg'))
  await assert.rejects(v.verify(b64u({ alg: 'constructor', kid: 'k' }) + '.' + body + '.AAAA'), refused('alg'))
  await assert.rejects(v.verify(b64u({ kid: 'k' }) + '.' + body + '.AAAA'), refused('alg'))
  assert.equal(state.fetches.length, 0)
})

test('refuses an algorithm that does not fit the key it names', async () => {
  const e = ec('k-ec'), r = rsa('k-rsa')
  const { v } = setup([e, r])
  await assert.rejects(v.verify(sign(r, {}, { kid: 'k-ec', alg: 'RS256' })), refused('alg'))
  await assert.rejects(v.verify(sign(e, {}, { kid: 'k-rsa', alg: 'ES256' })), refused('alg'))
})

test('refuses a changed payload, a changed signature and another project\'s key', async () => {
  const e = ec('k'), other = ec('k')
  const { v } = setup([e])
  const [h, , s] = sign(e).split('.')
  const forged = b64u({ iss: ISS, aud: 'authenticated', sub: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', exp: T0 / 1000 + 3600 })
  await assert.rejects(v.verify(`${h}.${forged}.${s}`), refused('signature'))
  await assert.rejects(v.verify(sign(e).slice(0, -6) + 'AAAAAA'), refused('signature'))
  await assert.rejects(v.verify(sign(other)), refused('signature'))   // same kid, different key
})

test('refuses the wrong issuer, audience, time or subject', async () => {
  const e = ec('k')
  const { v } = setup([e])
  await assert.rejects(v.verify(sign(e, { iss: 'https://evil.example/auth/v1' })), refused('issuer'))
  await assert.rejects(v.verify(sign(e, { iss: URL_ })), refused('issuer'))
  await assert.rejects(v.verify(sign(e, { aud: 'anon' })), refused('audience'))
  await assert.rejects(v.verify(sign(e, { aud: undefined })), refused('audience'))
  await assert.rejects(v.verify(sign(e, { exp: T0 / 1000 - 31 })), refused('expired'))
  await assert.rejects(v.verify(sign(e, { exp: 'tomorrow' })), refused('expired'))
  await assert.rejects(v.verify(sign(e, { exp: undefined })), refused('expired'))
  await assert.rejects(v.verify(sign(e, { nbf: T0 / 1000 + 600 })), refused('not-yet'))
  await assert.rejects(v.verify(sign(e, { sub: '' })), refused('subject'))
  await assert.rejects(v.verify(sign(e, { sub: '../../etc/passwd' })), refused('subject'))
  await assert.rejects(v.verify(sign(e, { sub: 42 })), refused('subject'))
  // a clock a few seconds off is forgiven, in both directions
  assert.equal((await v.verify(sign(e, { exp: T0 / 1000 - 10 }))).sub, SUB)
  assert.equal((await v.verify(sign(e, { nbf: T0 / 1000 + 10 }))).sub, SUB)
})

test('picks up a rotated key, without letting unknown kids hammer the project', async () => {
  const old = ec('k1'), fresh = ec('k2')
  const { v, state } = setup([old])
  await v.verify(sign(old))
  assert.equal(state.fetches.length, 1)
  state.keys = [old.jwk, fresh.jwk]
  // within a minute of the last fetch an unknown kid is refused without a request
  for (let i = 0; i < 50; i++) await assert.rejects(v.verify(sign(fresh, {}, { kid: 'made-up-' + i })), refused('kid'))
  await assert.rejects(v.verify(sign(fresh)), refused('kid'))
  assert.equal(state.fetches.length, 1)
  // a minute later it asks once and finds the new key
  state.now += 61_000
  assert.equal((await v.verify(sign(fresh, { exp: T0 / 1000 + 7200 }))).sub, SUB)
  assert.equal(state.fetches.length, 2)
  await assert.rejects(v.verify(sign(fresh, {}, { kid: '' })), refused('kid'))
})

test('a key the project withdrew stops working after the cache runs out', async () => {
  const gone = ec('k1'), kept = ec('k2')
  const { v, state } = setup([gone, kept])
  await v.verify(sign(gone))
  state.keys = [kept.jwk]
  state.now += 11 * 60_000
  await assert.rejects(v.verify(sign(gone, { exp: state.now / 1000 + 600 })), refused('kid'))
  assert.equal((await v.verify(sign(kept, { exp: state.now / 1000 + 600 }))).sub, SUB)
})

test('with the key endpoint down: refused when no key is held, served from held keys otherwise', async () => {
  const e = ec('k')
  const cold = setup([e], { failing: true })
  await assert.rejects(cold.v.verify(sign(e)), refused('keys'))
  const warm = setup([e])
  await warm.v.verify(sign(e))
  warm.state.failing = true
  warm.state.now += 11 * 60_000
  assert.equal((await warm.v.verify(sign(e, { exp: warm.state.now / 1000 + 600 }))).sub, SUB)
})

test('a published key with a private part, or one that cannot be read, is never used', async () => {
  const e = ec('leaky'), good = ec('good')
  const { v, state } = setup([good])
  state.keys = [{ ...e.privateKey.export({ format: 'jwk' }), kid: 'leaky' }, { kid: 'junk', kty: 'EC', crv: 'P-256', x: '!!', y: '!!' }, { kty: 'EC' }, null, good.jwk]
  await assert.rejects(v.verify(sign(e)), refused('kid'))
  assert.equal((await v.verify(sign(good))).sub, SUB)
})

test('many checks at once share one request for the keys', async () => {
  const e = ec('k')
  const { v, state } = setup([e])
  const token = sign(e)
  await Promise.all(Array.from({ length: 20 }, () => v.verify(token)))
  assert.equal(state.fetches.length, 1)
})
