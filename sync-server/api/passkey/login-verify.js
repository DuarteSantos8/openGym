import { verifyAuthenticationResponse } from '@simplewebauthn/server'
import { admin, body, send, handler, takeChallenge, fromB64u, RP_ID, ORIGIN } from './_lib.js'

// POST { challengeId, response } → { token, uid, username }
export default handler(async (req, res) => {
  const { challengeId, response } = await body(req)
  if (!response?.id) return send(res, 400, { error: 'Missing passkey response' })
  const { auth, db } = admin()
  const ch = await takeChallenge(db, challengeId, 'auth')
  if (!ch) return send(res, 400, { error: 'That sign-in expired. Try again' })

  const credRef = db.collection('passkeys').doc(String(response.id))
  const credSnap = await credRef.get()
  if (!credSnap.exists) return send(res, 400, { error: 'Unknown passkey' })
  const cred = credSnap.data()

  const verification = await verifyAuthenticationResponse({
    response, expectedChallenge: ch.challenge, expectedOrigin: ORIGIN, expectedRPID: RP_ID,
    credential: { id: credSnap.id, publicKey: fromB64u(cred.publicKey), counter: cred.counter || 0 },
  })
  if (!verification.verified) return send(res, 400, { error: 'Passkey could not be verified' })
  await credRef.update({ counter: verification.authenticationInfo.newCounter })

  const token = await auth.createCustomToken(cred.uid)
  return send(res, 200, { token, uid: cred.uid, username: cred.username })
})
