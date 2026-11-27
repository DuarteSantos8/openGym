// The offline Pro check (ADR 0011). The signing side lives with the Edge Functions
// (supabase/functions/_shared/token.js); what one signs the other has to accept.
import { describe, it, expect } from 'vitest'
import { verifyEntitlement, stateOf, hasFeature, loadEntitlement, saveToken, loadToken, GRACE_SEC, EntitlementError } from './entitlement.js'
import { signEntitlement, generateKeyPair, TOKEN_TTL_SEC } from '../../../../supabase/functions/_shared/token.js'

const NOW = 1_800_000_000
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const memory = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k) } }

describe('entitlement on the device', () => {
  it('accepts what the function signed', async () => {
    const { privateJwk, publicJwk } = await generateKeyPair()
    const claims = await verifyEntitlement(await signEntitlement({ sub: USER, features: ['pro'], nowSec: NOW }, privateJwk), publicJwk)
    expect(claims).toEqual({ sub: USER, features: ['pro'], iat: NOW, exp: NOW + TOKEN_TTL_SEC })
  })

  it('refuses a token signed with another key, or changed after signing', async () => {
    const a = await generateKeyPair(), b = await generateKeyPair()
    const token = await signEntitlement({ sub: USER, features: [], nowSec: NOW }, a.privateJwk)
    await expect(verifyEntitlement(token, b.publicJwk)).rejects.toMatchObject({ code: 'signature' })
    const [h, , s] = token.split('.')
    const forged = btoa(JSON.stringify({ sub: USER, features: ['pro'], iat: NOW, exp: NOW + 9e9 })).replace(/=+$/, '')
    await expect(verifyEntitlement(`${h}.${forged}.${s}`, a.publicJwk)).rejects.toBeInstanceOf(EntitlementError)
  })

  it('refuses any algorithm but ES256, and anything that is not a token', async () => {
    const { publicJwk } = await generateKeyPair()
    const head = alg => btoa(JSON.stringify({ alg })).replace(/=+$/, '')
    const body = btoa(JSON.stringify({ sub: USER, features: ['pro'], exp: NOW })).replace(/=+$/, '')
    await expect(verifyEntitlement(`${head('none')}.${body}.AAAA`, publicJwk)).rejects.toMatchObject({ code: 'alg' })
    await expect(verifyEntitlement(`${head('HS256')}.${body}.AAAA`, publicJwk)).rejects.toMatchObject({ code: 'alg' })
    for (const bad of ['', 'a.b', undefined, {}]) await expect(verifyEntitlement(bad, publicJwk)).rejects.toMatchObject({ code: 'malformed' })
  })

  it('stays Pro through the grace period, then reads as Free', () => {
    const claims = { sub: USER, features: ['pro'], exp: NOW }
    expect(stateOf(claims, NOW - 1)).toBe('active')
    expect(stateOf(claims, NOW)).toBe('grace')
    expect(stateOf(claims, NOW + GRACE_SEC - 1)).toBe('grace')
    expect(stateOf(claims, NOW + GRACE_SEC)).toBe('expired')
    expect(hasFeature(claims, 'pro', { nowSec: NOW + GRACE_SEC - 1 })).toBe(true)
    expect(hasFeature(claims, 'pro', { nowSec: NOW + GRACE_SEC })).toBe(false)
    expect(hasFeature(claims, 'other', { nowSec: NOW - 1 })).toBe(false)
    expect(hasFeature(null, 'pro')).toBe(false)
  })

  it('only counts a token for the account it was signed for', () => {
    const claims = { sub: USER, features: ['pro'], exp: NOW + 100 }
    expect(hasFeature(claims, 'pro', { nowSec: NOW, userId: USER })).toBe(true)
    expect(hasFeature(claims, 'pro', { nowSec: NOW, userId: 'someone-else' })).toBe(false)
  })

  it('keeps the token between launches and throws a bad one away', async () => {
    const { privateJwk, publicJwk } = await generateKeyPair()
    const storage = memory()
    expect(await loadEntitlement(publicJwk, { storage })).toBe(null)
    saveToken(await signEntitlement({ sub: USER, features: ['pro'], nowSec: NOW }, privateJwk), storage)
    expect((await loadEntitlement(publicJwk, { storage, nowSec: NOW + 1 })).state).toBe('active')
    saveToken('not.a.token', storage)
    expect(await loadEntitlement(publicJwk, { storage })).toBe(null)
    expect(loadToken(storage)).toBe(null)
  })

  it('reads storage that throws as no token', () => {
    const broken = { getItem() { throw new Error('denied') }, setItem() { throw new Error('full') }, removeItem() { throw new Error('denied') } }
    expect(loadToken(broken)).toBe(null)
    expect(saveToken('x', broken)).toBe(false)
  })
})
