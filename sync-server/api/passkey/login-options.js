import { generateAuthenticationOptions } from '@simplewebauthn/server'
import { admin, body, send, handler, credsOf, saveChallenge, RP_ID } from './_lib.js'

// POST { username? } → { options, challengeId }
// With a username, only that account's passkeys are offered. Without one, the request is
// discoverable (resident-key): the passkey the user picks says which account it is, and
// login-verify looks the account up by credential id.
export default handler(async (req, res) => {
  const { username } = await body(req)
  const name = typeof username === 'string' ? username.trim() : ''
  const { db } = admin()
  let allowCredentials = []
  if (name) {
    const creds = await credsOf(db, name)
    if (!creds.length) return send(res, 404, { error: 'No passkey for that username yet, create the account first' })
    allowCredentials = creds.map(c => ({ id: c.id, transports: c.transports || [] }))
  }
  const options = await generateAuthenticationOptions({ rpID: RP_ID, allowCredentials, userVerification: 'preferred' })
  const challengeId = await saveChallenge(db, 'auth', { challenge: options.challenge, username: name || null })
  return send(res, 200, { options, challengeId })
})
