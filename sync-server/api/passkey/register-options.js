import { generateRegistrationOptions } from '@simplewebauthn/server'
import { randomBytes } from 'node:crypto'
import { admin, body, send, handler, validUsername, credsOf, bearerUid, saveChallenge, b64u, RP_ID, RP_NAME } from './_lib.js'

// POST { username } → { options, challengeId }
//
// Bootstrap rule (single-user trust model, see docs/FIREBASE_SYNC.md): a username with NO
// credentials yet may register its first passkey with no other proof, whoever registers
// first owns the name. Once credentials exist, registering another passkey for the name
// requires a Firebase ID token for that same account (i.e. being signed in on a device
// that already has one, Settings → "Add a passkey on this device").
export default handler(async (req, res) => {
  const { username } = await body(req)
  const name = typeof username === 'string' ? username.trim() : ''
  if (!validUsername(name)) return send(res, 400, { error: 'Pick a username (letters, numbers, _ . -)' })
  const { auth, db } = admin()
  const mapSnap = await db.collection('passkeyUsers').doc(name).get()

  let userHandle, excludeCredentials = []
  if (mapSnap.exists) {
    const uid = await bearerUid(req, auth)
    if (uid !== mapSnap.data().uid) {
      return send(res, 409, { error: 'That username already has a passkey. Sign in first, then add this device from Settings.' })
    }
    userHandle = mapSnap.data().userHandle
    excludeCredentials = (await credsOf(db, name)).map(c => ({ id: c.id, transports: c.transports || [] }))
  } else {
    userHandle = b64u(randomBytes(32))
  }

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userID: Buffer.from(userHandle, 'base64url'),
    userName: name,
    attestationType: 'none',
    excludeCredentials,
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
  })
  const challengeId = await saveChallenge(db, 'reg', { username: name, challenge: options.challenge, userHandle })
  return send(res, 200, { options, challengeId })
})
