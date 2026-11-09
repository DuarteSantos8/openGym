// Tests for the account-linking passkey endpoints (list / link-options / link-verify /
// remove). Run with: node --test tests/passkey-methods.test.mjs  (from sync-server/, after
// npm install)
//
// The endpoint cores take { uid, db, auth } with the uid already proven by the handler
// (bearerUid in _lib.js, shared with the older endpoints), so these tests drive the
// cores against an in-memory Firestore/Auth fake and pin the rules that matter:
//   - a list only ever shows the caller's own credentials, without public keys;
//   - link-verify binds the credential AND the username to the caller's existing uid,
//     creates no Auth user, and refuses a challenge issued to a different uid;
//   - remove only touches the caller's own credentials and never the account's last
//     remaining sign-in method (the lockout guard).
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { listSignInMethods, linkOptions, linkVerify, removePasskey } from '../api/passkey/_methods.js'

// ---- in-memory Firestore fake: just the surface _lib.js and the endpoints use
function fakeDb(seed = {}) {
  const store = new Map() // "coll/id" -> data
  for (const [coll, docs] of Object.entries(seed)) {
    for (const [id, data] of Object.entries(docs)) store.set(`${coll}/${id}`, { ...data })
  }
  const ref = (coll, id) => ({
    _coll: coll, id,
    async get() { const d = store.get(`${coll}/${id}`); return { exists: d !== undefined, id, data: () => d } },
    async set(data) { store.set(`${coll}/${id}`, { ...data }) },
    async update(data) { store.set(`${coll}/${id}`, { ...store.get(`${coll}/${id}`), ...data }) },
    async delete() { store.delete(`${coll}/${id}`) },
  })
  const query = (coll, filters, limitN) => ({
    where(field, op, value) { return query(coll, [...filters, [field, value]], limitN) },
    limit(n) { return query(coll, filters, n) },
    async get() {
      let docs = []
      for (const [key, data] of store) {
        const [c, id] = key.split('/')
        if (c !== coll) continue
        if (filters.every(([f, v]) => data[f] === v)) docs.push({ id, data: () => data })
      }
      if (limitN) docs = docs.slice(0, limitN)
      return { docs, empty: docs.length === 0 }
    },
  })
  return {
    _store: store,
    collection(coll) {
      return {
        doc: id => ref(coll, String(id)),
        where: (field, op, value) => query(coll, [[field, value]], null),
      }
    },
    async runTransaction(fn) {
      const tx = {
        get: r => r.get(),
        set: (r, data) => { store.set(`${r._coll}/${r.id}`, { ...data }) },
        delete: r => { store.delete(`${r._coll}/${r.id}`) },
      }
      await fn(tx)
    },
  }
}

const fakeAuth = (providersByUid = {}) => ({
  async getUser(uid) {
    if (!(uid in providersByUid)) throw new Error('no such user')
    return { providerData: providersByUid[uid].map(providerId => ({ providerId })) }
  },
  // Deliberately no createUser: link-verify must never create an Auth user, and a call
  // would throw here and fail the test loudly.
})

const UID = 'uid-alex'
const OTHER = 'uid-someone-else'
const genStub = async () => ({ challenge: 'challenge-abc' })
const verifyStub = async () => ({
  verified: true,
  registrationInfo: {
    credential: { id: 'cred-new', publicKey: new Uint8Array([9, 8, 7]), counter: 0 },
    credentialBackedUp: true, credentialDeviceType: 'multiDevice',
  },
})

describe('listSignInMethods', () => {
  it('returns only the caller\'s credentials, shaped for the UI, plus username and providers', async () => {
    const db = fakeDb({
      passkeyUsers: { Alex: { uid: UID, userHandle: 'h1' } },
      passkeys: {
        'cred-1': { uid: UID, username: 'Alex', publicKey: 'SECRET', counter: 3, createdAt: 100, deviceType: 'singleDevice', backedUp: false },
        'cred-2': { uid: OTHER, username: 'Other', publicKey: 'SECRET2', createdAt: 200 },
      },
    })
    const { status, payload } = await listSignInMethods({ uid: UID, db, auth: fakeAuth({ [UID]: ['google.com'] }) })
    assert.equal(status, 200)
    assert.equal(payload.username, 'Alex')
    assert.deepEqual(payload.providers, ['google.com'])
    assert.equal(payload.passkeys.length, 1)
    assert.equal(payload.passkeys[0].id, 'cred-1')
    assert.equal('publicKey' in payload.passkeys[0], false)
    assert.equal('counter' in payload.passkeys[0], false)
  })

  it('a Google-first account lists no username and no passkeys', async () => {
    const db = fakeDb({})
    const { payload } = await listSignInMethods({ uid: OTHER, db, auth: fakeAuth({ [OTHER]: ['google.com'] }) })
    assert.equal(payload.username, null)
    assert.deepEqual(payload.passkeys, [])
  })
})

describe('linkOptions', () => {
  it('a Google-first user can start with a fresh username; the challenge is bound to their uid', async () => {
    const db = fakeDb({})
    const { status, payload } = await linkOptions({ uid: OTHER, reqBody: { username: 'NewName' }, db, generate: genStub })
    assert.equal(status, 200)
    assert.equal(payload.username, 'NewName')
    const challenges = [...db._store.entries()].filter(([k]) => k.startsWith('passkeyChallenges/'))
    assert.equal(challenges.length, 1)
    assert.equal(challenges[0][1].uid, OTHER)
    assert.equal(challenges[0][1].newName, true)
    // No passkeyUsers record yet: an abandoned ceremony must not squat the name.
    assert.equal(db._store.has('passkeyUsers/NewName'), false)
  })

  it('refuses a username somebody else owns', async () => {
    const db = fakeDb({ passkeyUsers: { Alex: { uid: UID, userHandle: 'h1' } } })
    const { status } = await linkOptions({ uid: OTHER, reqBody: { username: 'Alex' }, db, generate: genStub })
    assert.equal(status, 409)
  })

  it('an account with a username adds under it, and a different asked name is refused', async () => {
    const db = fakeDb({
      passkeyUsers: { Alex: { uid: UID, userHandle: 'h1' } },
      passkeys: { 'cred-1': { uid: UID, username: 'Alex', transports: ['internal'] } },
    })
    const ok = await linkOptions({ uid: UID, reqBody: {}, db, generate: genStub })
    assert.equal(ok.status, 200)
    assert.equal(ok.payload.username, 'Alex')
    const bad = await linkOptions({ uid: UID, reqBody: { username: 'Other' }, db, generate: genStub })
    assert.equal(bad.status, 409)
  })
})

describe('linkVerify', () => {
  async function started(db, uid, username) {
    const { payload } = await linkOptions({ uid, reqBody: { username }, db, generate: genStub })
    return payload.challengeId
  }

  it('binds the credential and the username to the caller\'s existing uid', async () => {
    const db = fakeDb({})
    const challengeId = await started(db, OTHER, 'NewName')
    const { status, payload } = await linkVerify({ uid: OTHER, reqBody: { challengeId, response: { id: 'cred-new', response: {} } }, db, verify: verifyStub })
    assert.equal(status, 200)
    assert.equal(payload.username, 'NewName')
    assert.equal(db._store.get('passkeyUsers/NewName').uid, OTHER)
    assert.equal(db._store.get('passkeys/cred-new').uid, OTHER)
    assert.equal(db._store.get('passkeys/cred-new').username, 'NewName')
  })

  it('refuses a challenge issued to a different uid and writes nothing', async () => {
    const db = fakeDb({})
    const challengeId = await started(db, OTHER, 'NewName')
    const { status } = await linkVerify({ uid: UID, reqBody: { challengeId, response: { id: 'cred-new', response: {} } }, db, verify: verifyStub })
    assert.equal(status, 403)
    assert.equal(db._store.has('passkeys/cred-new'), false)
    assert.equal(db._store.has('passkeyUsers/NewName'), false)
  })

  it('aborts when the username was claimed by another uid between options and verify', async () => {
    const db = fakeDb({})
    const challengeId = await started(db, OTHER, 'NewName')
    db._store.set('passkeyUsers/NewName', { uid: UID, userHandle: 'hx' }) // claimed meanwhile
    const { status } = await linkVerify({ uid: OTHER, reqBody: { challengeId, response: { id: 'cred-new', response: {} } }, db, verify: verifyStub })
    assert.equal(status, 409)
    assert.equal(db._store.get('passkeyUsers/NewName').uid, UID)
    assert.equal(db._store.has('passkeys/cred-new'), false)
  })

  it('an unknown or spent challenge is a plain 400', async () => {
    const db = fakeDb({})
    const { status } = await linkVerify({ uid: OTHER, reqBody: { challengeId: 'nope', response: { id: 'x', response: {} } }, db, verify: verifyStub })
    assert.equal(status, 400)
  })
})

describe('removePasskey (lockout guard + ownership)', () => {
  const seed = () => ({
    passkeys: {
      'cred-1': { uid: UID, username: 'Alex' },
      'cred-2': { uid: UID, username: 'Alex' },
      'cred-9': { uid: OTHER, username: 'Other' },
    },
  })

  it('removes one of two passkeys', async () => {
    const db = fakeDb(seed())
    const { status, payload } = await removePasskey({ uid: UID, reqBody: { credentialId: 'cred-1' }, db, auth: fakeAuth({ [UID]: [] }) })
    assert.equal(status, 200)
    assert.equal(payload.passkeys, 1)
    assert.equal(db._store.has('passkeys/cred-1'), false)
  })

  it('refuses to remove the last passkey when nothing else is linked', async () => {
    const db = fakeDb({ passkeys: { 'cred-1': { uid: UID, username: 'Alex' } } })
    const { status } = await removePasskey({ uid: UID, reqBody: { credentialId: 'cred-1' }, db, auth: fakeAuth({ [UID]: [] }) })
    assert.equal(status, 409)
    assert.equal(db._store.has('passkeys/cred-1'), true)
  })

  it('allows removing the last passkey when Google is linked', async () => {
    const db = fakeDb({ passkeys: { 'cred-1': { uid: UID, username: 'Alex' } } })
    const { status, payload } = await removePasskey({ uid: UID, reqBody: { credentialId: 'cred-1' }, db, auth: fakeAuth({ [UID]: ['google.com'] }) })
    assert.equal(status, 200)
    assert.equal(payload.passkeys, 0)
  })

  it('another account\'s credential is a 404 and stays put', async () => {
    const db = fakeDb(seed())
    const { status } = await removePasskey({ uid: UID, reqBody: { credentialId: 'cred-9' }, db, auth: fakeAuth({ [UID]: [] }) })
    assert.equal(status, 404)
    assert.equal(db._store.has('passkeys/cred-9'), true)
  })
})
