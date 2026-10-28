import { verifyRegistrationResponse } from '@simplewebauthn/server'
import { admin, body, send, handler, takeChallenge, bearerUid, b64u, RP_ID, ORIGIN } from './_lib.js'

// POST { username, challengeId, response } → { token, uid, username }
// First registration for a username creates the Firebase Auth user; the custom token in
// the reply is what the browser signs in with (signInWithCustomToken).
export default handler(async (req, res) => {
  const { username, challengeId, response } = await body(req)
  const name = typeof username === 'string' ? username.trim() : ''
  if (!name || !response) return send(res, 400, { error: 'Missing username or passkey response' })
  const { auth, db } = admin()
  const ch = await takeChallenge(db, challengeId, 'reg')
  if (!ch || ch.username !== name) return send(res, 400, { error: 'That registration expired. Try again' })

  const mapRef = db.collection('passkeyUsers').doc(name)
  const mapSnap = await mapRef.get()
  if (mapSnap.exists) {
    const uid = await bearerUid(req, auth)
    if (uid !== mapSnap.data().uid) return send(res, 409, { error: 'That username already has a passkey' })
  }

  const verification = await verifyRegistrationResponse({
    response, expectedChallenge: ch.challenge, expectedOrigin: ORIGIN, expectedRPID: RP_ID,
  })
  if (!verification.verified || !verification.registrationInfo) {
    return send(res, 400, { error: 'Passkey could not be verified' })
  }
  const { credential, credentialBackedUp, credentialDeviceType } = verification.registrationInfo

  let uid, userHandle
  if (mapSnap.exists) {
    uid = mapSnap.data().uid; userHandle = mapSnap.data().userHandle
  } else {
    const user = await auth.createUser({ displayName: name })
    uid = user.uid; userHandle = ch.userHandle
    await mapRef.set({ uid, userHandle, createdAt: Date.now() })
  }

  await db.collection('passkeys').doc(credential.id).set({
    uid, username: name,
    publicKey: b64u(credential.publicKey),
    counter: credential.counter || 0,
    transports: response.response?.transports || [],
    backedUp: !!credentialBackedUp,
    deviceType: credentialDeviceType || null,
    createdAt: Date.now(),
  })
  const token = await auth.createCustomToken(uid)
  return send(res, 200, { token, uid, username: name })
})
