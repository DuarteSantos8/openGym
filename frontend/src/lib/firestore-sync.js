// Firestore sync + passkey sign-in (Phase 2). Loaded ONLY dynamically, and only when
// lib/firebase-config.js says Firebase mode is on with a full config, the Firebase SDK
// never enters a demo/local build's runtime path.
//
// How sync works
// --------------
// The store stays the single source of truth on the device (localStorage is the offline
// cache, exactly as in local mode). This module is a transport under it:
//
//   sign-in → read users/{uid} (meta doc + the five subcollections, see firestore-model.js)
//           → if the account is empty, upload this device's current state as the initial
//             cloud state (that's how the seeded profile becomes the cloud profile)
//           → otherwise mergeStates(cloud, local), upstream's own merge, tombstones and
//             per-field stamps included, hydrate the store with the result, and push the
//             merged copy back so the cloud converges on it
//   live    → onSnapshot on the meta doc + each subcollection: a change from another
//             device is merged in the same way and hydrated, unless it is just the echo of
//             this device's own push (tracked by per-doc hashes)
//   local   → store subscription: a change is debounced (~800 ms) and only the docs whose
//             hash moved are written; docs the cloud has that the local state no longer
//             has are deleted. `active` (a workout in progress) is never synced.
//
// Passkeys
// --------
// Firebase Auth has no passkey sign-in, so the ceremony runs on this project's own
// /api/passkey/* Vercel functions (@simplewebauthn/server + firebase-admin): they verify
// the WebAuthn response and mint a Firebase custom token; this module then signs in with
// it via signInWithCustomToken. Session persistence is Firebase Auth's own (local).
import { firebaseConfig } from './firebase-config.js'
import { splitState, joinDocs, splitHashes, docIdFor, keyForDocId, entryHash } from './firestore-model.js'
import { mergeStates } from './sync-merge.js'

const USERNAME_KEY = 'gym_fb_username'
const PUSH_DEBOUNCE_MS = 800

// ---- tiny auth-state pub/sub for the UI (components/FirebaseAccount.jsx, views/Login.jsx)
let fbUser = null // { uid, username } | null
let fbReady = false
const authListeners = new Set()
export function onFbAuthChange(fn) {
  authListeners.add(fn)
  fn({ user: fbUser, ready: fbReady })
  return () => authListeners.delete(fn)
}
function setFbUser(u) {
  fbUser = u
  fbReady = true
  for (const fn of [...authListeners]) fn({ user: fbUser, ready: fbReady })
}
export const currentFbUser = () => fbUser

// ---- Firebase handles (filled by ensureFirebase)
let app, auth, db
let fs // the firestore module namespace (kept so every call site stays terse)
let started = false

async function ensureFirebase() {
  if (app) return
  const [{ initializeApp }, authMod, fsMod] = await Promise.all([
    import('firebase/app'), import('firebase/auth'), import('firebase/firestore'),
  ])
  fs = fsMod
  authModCache = authMod
  app = initializeApp(firebaseConfig)
  auth = authMod.getAuth(app)
  try { await authMod.setPersistence(auth, authMod.browserLocalPersistence) } catch { /* default is already local */ }
  try {
    db = fsMod.initializeFirestore(app, {
      localCache: fsMod.persistentLocalCache({ tabManager: fsMod.persistentMultipleTabManager() }),
    })
  } catch { db = fsMod.getFirestore(app) }
}

// ---- passkey ceremony (talks to /api/passkey/* on this project's own domain)
async function postJSON(path, body, idToken) {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
    body: JSON.stringify(body || {}),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`)
  return data
}

async function signInWithToken(token) {
  await ensureFirebase()
  const { signInWithCustomToken } = await import('firebase/auth')
  const cred = await signInWithCustomToken(auth, token)
  return cred.user
}

/** Create the account and its first passkey. Bootstrap rule: allowed only while the
 *  username has no credentials yet (see SETUP-SYNC.md, single-user trust model). */
export async function fbRegister(username) {
  await ensureFirebase()
  const name = (username || '').trim()
  if (!name) throw new Error('Enter a username')
  const { startRegistration } = await import('@simplewebauthn/browser')
  const idToken = auth.currentUser ? await auth.currentUser.getIdToken() : null
  const { options, challengeId } = await postJSON('/api/passkey/register-options', { username: name }, idToken)
  const response = await startRegistration({ optionsJSON: options })
  const out = await postJSON('/api/passkey/register-verify', { username: name, challengeId, response }, idToken)
  localStorage.setItem(USERNAME_KEY, out.username || name)
  await signInWithToken(out.token)
  return out
}

/** Sign in with an existing passkey. Username optional: without it the passkey itself
 *  (discoverable credential) says which account it belongs to. */
export async function fbLogin(username) {
  await ensureFirebase()
  const name = (username || '').trim()
  const { startAuthentication } = await import('@simplewebauthn/browser')
  const { options, challengeId } = await postJSON('/api/passkey/login-options', { username: name || undefined })
  const response = await startAuthentication({ optionsJSON: options })
  const out = await postJSON('/api/passkey/login-verify', { challengeId, response })
  if (out.username) localStorage.setItem(USERNAME_KEY, out.username)
  await signInWithToken(out.token)
  return out
}

/** Add another passkey to the signed-in account (new phone/browser). */
export async function fbAddPasskey() {
  await ensureFirebase()
  if (!auth.currentUser) throw new Error('Sign in first')
  const name = localStorage.getItem(USERNAME_KEY) || ''
  if (!name) throw new Error('No username saved on this device')
  return fbRegister(name) // register-options accepts it: the bearer token proves the account
}

export async function fbSignOut() {
  await ensureFirebase()
  const { signOut } = await import('firebase/auth')
  await signOut(auth)
}

// ---- sync engine
export function startFirestoreSync(useStore) {
  if (started) return
  started = true
  ensureFirebase().then(() => {
    const { onAuthStateChanged } = authModCache
    onAuthStateChanged(auth, user => {
      if (user) {
        setFbUser({ uid: user.uid, username: localStorage.getItem(USERNAME_KEY) || '' })
        attach(useStore, user.uid).catch(e => console.warn('[fb-sync] attach failed', e))
      } else {
        detach()
        setFbUser(null)
      }
    })
  }).catch(e => console.warn('[fb-sync] init failed', e))
}

// ensureFirebase stashes the auth module here so startFirestoreSync can subscribe.
let authModCache = null

let session = null // per-sign-in sync session, see attach()
function detach() {
  if (!session) return
  for (const off of session.unsubs) { try { off() } catch { /* already gone */ } }
  if (session.pushTm) clearTimeout(session.pushTm)
  if (session.storeOff) session.storeOff()
  session = null
}

async function attach(useStore, uid) {
  detach()
  const S = () => useStore.getState().S
  const userRef = fs.doc(db, 'users', uid)
  const collRef = coll => fs.collection(db, 'users', uid, coll)

  const sess = session = {
    uid, unsubs: [], pushTm: null, storeOff: null,
    ready: false, // initial load done, pushes/listeners only count from here
    known: null, // splitHashes of what the cloud is believed to hold right now
    remote: null, // latest assembled cloud state (joinDocs form), for echo checks
  }

  const readAll = async () => {
    const [metaSnap, ...snaps] = await Promise.all([
      fs.getDoc(userRef),
      ...['workouts', 'routines', 'exercises', 'bodyweight', 'measurements'].map(c => fs.getDocs(collRef(c))),
    ])
    const lists = {}
    const colls = ['workouts', 'routines', 'exercises', 'bodyweight', 'measurements']
    snaps.forEach((snap, i) => {
      const m = new Map()
      snap.forEach(d => m.set(keyForDocId(d.id), d.data()))
      lists[colls[i]] = m
    })
    return { exists: metaSnap.exists(), split: { meta: metaSnap.exists() ? metaSnap.data() : {}, lists }, joined: joinDocs({ meta: metaSnap.exists() ? metaSnap.data() : {}, lists }) }
  }

  // Write the diff between the cloud's believed state (sess.known) and `state`.
  const push = async state => {
    if (!sess.ready || session !== sess) return
    const split = splitState(state)
    const hashes = splitHashes(split)
    const batch = fs.writeBatch(db)
    let ops = 0
    if (hashes.meta !== sess.known.meta) {
      batch.set(userRef, { ...split.meta, _fbUpdatedAt: fs.serverTimestamp() }); ops++
    }
    for (const [coll, m] of Object.entries(split.lists)) {
      const knownMap = sess.known.lists[coll] || new Map()
      for (const [k, v] of m) {
        if (knownMap.get(k) !== entryHash(v)) { batch.set(fs.doc(collRef(coll), docIdFor(k)), v); ops++ }
      }
      for (const k of knownMap.keys()) {
        if (!m.has(k)) { batch.delete(fs.doc(collRef(coll), docIdFor(k))); ops++ }
      }
    }
    if (!ops) { sess.known = hashes; return }
    await batch.commit()
    sess.known = hashes
  }

  // ---- initial load: upload-on-first-sign-in, else merge cloud into local
  const { exists, split, joined } = await readAll()
  sess.remote = joined
  if (!exists && Object.values(split.lists).every(m => m.size === 0)) {
    sess.known = { meta: null, lists: { workouts: new Map(), routines: new Map(), exercises: new Map(), bodyweight: new Map(), measurements: new Map() } }
    sess.ready = true
    await push(S())
  } else {
    sess.known = splitHashes(split)
    const local = S()
    const merged = mergeStates(joined, local)
    merged.active = local.active // a workout in progress is this device's alone
    if (entryHash(merged) !== entryHash(local)) useStore.getState().replaceState(merged, false)
    sess.ready = true
    await push(useStore.getState().S)
  }

  // ---- live: snapshots from other devices merge in; our own pushes echo back identical
  const onSnap = async () => {
    if (!sess.ready || session !== sess) return
    const fresh = await readAll().catch(() => null)
    if (!fresh || session !== sess) return
    if (entryHash(fresh.joined) === entryHash(sess.remote)) return // echo / no-op
    sess.remote = fresh.joined
    sess.known = splitHashes(fresh.split)
    const local = S()
    const merged = mergeStates(fresh.joined, local)
    merged.active = local.active
    if (entryHash(merged) !== entryHash(local)) useStore.getState().replaceState(merged, false)
    await push(useStore.getState().S) // converge: local-only extras go up, tombstoned docs go away
  }
  sess.unsubs.push(fs.onSnapshot(userRef, onSnap, () => {}))
  for (const c of ['workouts', 'routines', 'exercises', 'bodyweight', 'measurements']) {
    sess.unsubs.push(fs.onSnapshot(collRef(c), onSnap, () => {}))
  }

  // ---- local changes go up, debounced, doc-diffed (in push)
  sess.storeOff = useStore.subscribe(() => {
    if (!sess.ready || session !== sess) return
    clearTimeout(sess.pushTm)
    sess.pushTm = setTimeout(() => { push(S()).catch(e => console.warn('[fb-sync] push failed', e)) }, PUSH_DEBOUNCE_MS)
  })
}
