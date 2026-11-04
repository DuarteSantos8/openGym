import { generateRegistrationOptions, verifyRegistrationResponse } from '@simplewebauthn/server'
import { randomBytes } from 'node:crypto'
import {
  credsOfUid, usernameOfUid, providerIdsOf, credsOf, validUsername,
  saveChallenge, takeChallenge, b64u, RP_ID, RP_NAME, ORIGIN,
} from './_lib.js'

// The four Sign-in methods cores (list / link-options / link-verify / remove),
// served by the single [action].js function in this folder. They live in one
// underscore module (not a route, so it costs no function) because the Hobby
// plan caps a deployment at 12 Serverless Functions and four separate endpoint
// files pushed this deployment to 15. Each core takes { uid, db, auth } with the
// uid already proven by the dispatcher (bearerUid in _lib.js), exactly as the
// separate endpoint handlers did before the fold; URLs and payloads are
// unchanged.

// ---- list: POST (Bearer ID token) → { username, providers, passkeys: [{ id, createdAt, deviceType, backedUp }] }
//
// Settings → Sign-in methods reads the account's sign-in state from here, because the
// passkey collections are Admin-SDK-only (firestore.rules denies clients all access to
// them): the client cannot list its own credentials any other way. Only the caller's
// own record is ever read: the uid comes from the verified token, never from the body.
// The credential public key and counter stay server-side; the UI needs neither.
export async function listSignInMethods({ uid, db, auth }) {
  const [creds, nameRec, providers] = await Promise.all([
    credsOfUid(db, uid),
    usernameOfUid(db, uid),
    providerIdsOf(auth, uid),
  ])
  const passkeys = creds
    .map(c => ({ id: c.id, createdAt: c.createdAt || null, deviceType: c.deviceType || null, backedUp: !!c.backedUp }))
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
  return { status: 200, payload: { username: nameRec ? nameRec.username : null, providers, passkeys } }
}

// ---- link-options: POST (Bearer ID token) { username? } → { options, challengeId, username }
//
// The account-linking half of Settings → Sign-in methods: start a passkey registration
// for the account the caller is ALREADY signed into (a Google-first user adding their
// first passkey, or anyone adding a spare). Unlike register-options this never starts
// from a bare username claim: the uid comes from the verified ID token, and the
// username is either the one that uid already owns or a fresh one nobody owns.
// linkVerify below finishes the ceremony; the passkeyUsers record for a fresh username
// is only written there, inside the same transaction as the credential, so an
// abandoned ceremony cannot squat a name.
export async function linkOptions({ uid, reqBody, db, generate = generateRegistrationOptions }) {
  const existing = await usernameOfUid(db, uid)
  let name, userHandle, excludeCredentials = []
  if (existing) {
    const asked = typeof reqBody?.username === 'string' ? reqBody.username.trim() : ''
    if (asked && asked !== existing.username) {
      return { status: 409, payload: { error: `This account already has the username ${existing.username}` } }
    }
    name = existing.username
    userHandle = existing.userHandle
    excludeCredentials = (await credsOf(db, name)).map(c => ({ id: c.id, transports: c.transports || [] }))
  } else {
    name = typeof reqBody?.username === 'string' ? reqBody.username.trim() : ''
    if (!validUsername(name)) return { status: 400, payload: { error: 'Pick a username (letters, numbers, _ . -)' } }
    const taken = await db.collection('passkeyUsers').doc(name).get()
    if (taken.exists) return { status: 409, payload: { error: 'That username is taken. Pick another one' } }
    userHandle = b64u(randomBytes(32))
  }

  const options = await generate({
    rpName: RP_NAME,
    rpID: RP_ID,
    userID: Buffer.from(userHandle, 'base64url'),
    userName: name,
    attestationType: 'none',
    excludeCredentials,
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
  })
  const challengeId = await saveChallenge(db, 'linkreg', { uid, username: name, challenge: options.challenge, userHandle, newName: !existing })
  return { status: 200, payload: { options, challengeId, username: name } }
}

// ---- link-verify: POST (Bearer ID token) { challengeId, response } → { ok, username }
//
// Finishes what linkOptions started. The binding rules that make this a LINK and
// not a second account:
//   - the challenge was issued to one uid (linkOptions stored it) and only that same
//     uid, proven by a fresh ID token, may spend it;
//   - the passkeyUsers record and the credential are written in ONE transaction, and
//     the write aborts if the username has been claimed by a different uid meanwhile;
//   - no Firebase Auth user is ever created here and no custom token is minted: the
//     caller keeps the session (and the uid, and the data under users/{uid}) they
//     already have.
export async function linkVerify({ uid, reqBody, db, verify = verifyRegistrationResponse }) {
  const { challengeId, response } = reqBody || {}
  if (!response) return { status: 400, payload: { error: 'Missing passkey response' } }
  const ch = await takeChallenge(db, challengeId, 'linkreg')
  if (!ch) return { status: 400, payload: { error: 'That registration expired. Try again' } }
  if (ch.uid !== uid) return { status: 403, payload: { error: 'That registration was started by a different account' } }

  const verification = await verify({
    response, expectedChallenge: ch.challenge, expectedOrigin: ORIGIN, expectedRPID: RP_ID,
  })
  if (!verification.verified || !verification.registrationInfo) {
    return { status: 400, payload: { error: 'Passkey could not be verified' } }
  }
  const { credential, credentialBackedUp, credentialDeviceType } = verification.registrationInfo

  const mapRef = db.collection('passkeyUsers').doc(ch.username)
  const credRef = db.collection('passkeys').doc(credential.id)
  let conflict = false
  await db.runTransaction(async tx => {
    const mapSnap = await tx.get(mapRef)
    if (mapSnap.exists && mapSnap.data().uid !== uid) { conflict = true; return }
    if (!mapSnap.exists) tx.set(mapRef, { uid, userHandle: ch.userHandle, createdAt: Date.now() })
    tx.set(credRef, {
      uid, username: ch.username,
      publicKey: b64u(credential.publicKey),
      counter: credential.counter || 0,
      transports: response.response?.transports || [],
      backedUp: !!credentialBackedUp,
      deviceType: credentialDeviceType || null,
      createdAt: Date.now(),
    })
  })
  if (conflict) return { status: 409, payload: { error: 'That username is taken. Pick another one' } }
  return { status: 200, payload: { ok: true, username: ch.username } }
}

// ---- remove: POST (Bearer ID token) { credentialId } → { ok, passkeys }
//
// Removes ONE of the caller's own passkey credentials (Settings → Sign-in methods).
// Ownership is checked against the credential's stored uid, never the username in the
// body (there is none); a credential id that is missing or belongs to someone else is
// the same 404, so the endpoint cannot be used to probe other accounts.
//
// LOCKOUT GUARD: the delete is refused when this passkey is the account's last way in:
// no other passkey credential and no Google provider on the Auth user (checked via
// the Admin SDK, not the client's say-so). The passkeyUsers username record is kept on
// purpose: the name stays the account's, and a passkey can be re-added later through
// linkOptions under it.
export async function removePasskey({ uid, reqBody, db, auth }) {
  const credentialId = typeof reqBody?.credentialId === 'string' ? reqBody.credentialId : ''
  if (!credentialId) return { status: 400, payload: { error: 'Missing credentialId' } }
  const ref = db.collection('passkeys').doc(credentialId)
  const snap = await ref.get()
  if (!snap.exists || snap.data().uid !== uid) {
    return { status: 404, payload: { error: 'Passkey not found' } }
  }
  const [creds, providers] = await Promise.all([credsOfUid(db, uid), providerIdsOf(auth, uid)])
  const remaining = creds.filter(c => c.id !== credentialId).length
  if (remaining === 0 && !providers.includes('google.com')) {
    return { status: 409, payload: { error: 'That passkey is your only way in. Link Google or add another passkey first' } }
  }
  await ref.delete()
  return { status: 200, payload: { ok: true, passkeys: remaining } }
}
