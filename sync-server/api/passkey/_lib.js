// Shared plumbing for the /api/passkey/* Vercel functions.
//
// Why these exist: Firebase Auth has no passkey sign-in, and Firestore alone cannot run a
// WebAuthn ceremony: something server-side must issue challenges, verify responses and,
// on success, mint the Firebase custom token the browser signs in with. That something is
// these four small functions (@simplewebauthn/server + firebase-admin), NOT Cloud
// Functions, so the Firebase project stays on the free Spark plan (no Blaze billing).
//
// Credentials come only from the FIREBASE_SERVICE_ACCOUNT env var (the service-account
// JSON, as one string) set in the Vercel project, never from a file, never committed.
//
// Data (Firestore, Admin SDK only: firestore.rules denies clients all access):
//   passkeyUsers/{username}     { uid, userHandle, createdAt }
//   passkeys/{credentialId}     { uid, username, publicKey, counter, transports, ... }
//   passkeyChallenges/{id}      { kind, challenge, username, userHandle, expiresAt }
import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { randomUUID } from 'node:crypto'

export const RP_ID = process.env.WEBAUTHN_RP_ID || 'your-app.vercel.app'
export const ORIGIN = process.env.WEBAUTHN_ORIGIN || 'https://your-app.vercel.app'
export const RP_NAME = process.env.WEBAUTHN_RP_NAME || 'openGym'
const CHALLENGE_TTL_MS = 5 * 60 * 1000

let dbCache = null
export function admin() {
  if (!getApps().length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT
    if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT env var is not set on the Vercel project')
    initializeApp({ credential: cert(JSON.parse(raw)) })
  }
  if (!dbCache) dbCache = getFirestore()
  return { auth: getAuth(), db: dbCache }
}

export const send = (res, status, obj) => res.status(status).json(obj)

export async function body(req) {
  if (req.body && typeof req.body === 'object') return req.body
  if (typeof req.body === 'string' && req.body) { try { return JSON.parse(req.body) } catch { return {} } }
  const chunks = []
  for await (const c of req) chunks.push(c)
  if (!chunks.length) return {}
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { return {} }
}

export const validUsername = name => typeof name === 'string' && /^[A-Za-z0-9_.-]{1,40}$/.test(name.trim())
export const b64u = buf => Buffer.from(buf).toString('base64url')
export const fromB64u = s => Buffer.from(s, 'base64url')

export async function saveChallenge(db, kind, data) {
  const id = randomUUID()
  await db.collection('passkeyChallenges').doc(id).set({ ...data, kind, expiresAt: Date.now() + CHALLENGE_TTL_MS })
  return id
}

/** Read + delete a challenge (single use). Null when missing, expired or the wrong kind. */
export async function takeChallenge(db, id, kind) {
  if (!id) return null
  const ref = db.collection('passkeyChallenges').doc(String(id))
  const snap = await ref.get()
  if (!snap.exists) return null
  await ref.delete()
  const d = snap.data()
  if (d.kind !== kind || Date.now() > d.expiresAt) return null
  return d
}

export async function credsOf(db, username) {
  const snap = await db.collection('passkeys').where('username', '==', username).get()
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

/** The Firebase uid behind a request's bearer ID token, or null. */
export async function bearerUid(req, auth) {
  const h = req.headers?.authorization || ''
  if (!h.startsWith('Bearer ')) return null
  try { const t = await auth.verifyIdToken(h.slice(7)); return t.uid } catch { return null }
}

export function handler(fn) {
  return async (req, res) => {
    if (req.method !== 'POST') return send(res, 405, { error: 'POST only' })
    try { await fn(req, res) }
    catch (e) { console.error(e); if (!res.headersSent) send(res, 500, { error: e.message || 'Server error' }) }
  }
}
