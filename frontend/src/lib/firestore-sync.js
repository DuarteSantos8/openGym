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
// Google sign-in (fbGoogleLogin) needs none of this machinery: it is a native Firebase
// Auth provider, and its sessions enter through the same onAuthStateChanged door.
import { firebaseConfig } from './firebase-config.js'
import { splitState, joinDocs, splitHashes, docIdFor, keyForDocId, entryHash } from './firestore-model.js'
import { mergeStates } from './sync-merge.js'

const USERNAME_KEY = 'gym_fb_username'
const PUSH_DEBOUNCE_MS = 800
const PUSH_RETRY_MS = 30000 // the one backoff retry for an owed push (see runPush in attach)
const PUSH_CHUNK = 400 // Firestore batches cap at 500 operations; pushes commit in slices under it

const usernameKeyFor = uid => `${USERNAME_KEY}:${uid}`
/** The passkey username cached for ONE account on this device. The cache used to be
 *  a single device-global key, so on a shared device one account's cached name was
 *  served as every account's. The legacy key is deliberately never read again. */
function cachedUsername(uid) {
  if (!uid) return ''
  try { return localStorage.getItem(usernameKeyFor(uid)) || '' } catch { return '' }
}
function cacheUsername(uid, name) {
  if (!uid || !name) return
  try { localStorage.setItem(usernameKeyFor(uid), name) } catch { /* storage unavailable: the name is a nicety */ }
}

// ---- tiny auth-state pub/sub for the UI (components/FirebaseAccount.jsx, views/Login.jsx)
let fbUser = null // { uid, username, email, displayName, provider, providers } | null:
// username is the passkey account name saved on this device; email/displayName/provider
// come from the Firebase user itself, which is what a Google session carries. providers
// is every provider id on the account (Settings → Sign-in methods reads it).
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

function describeUser(user) {
  if (!user) return null
  return {
    uid: user.uid,
    username: cachedUsername(user.uid),
    email: user.email || '',
    displayName: user.displayName || '',
    provider: (user.providerData && user.providerData[0] && user.providerData[0].providerId) || '',
    providers: (user.providerData || []).map(p => p.providerId),
  }
}

/** Re-publish the current Firebase user (after a link/unlink changed its providers:
 *  the auth-state listener is not guaranteed to refire for those). */
function refreshFbUser() {
  if (auth) setFbUser(describeUser(auth.currentUser))
}

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
  await signInWithToken(out.token)
  cacheUsername(auth.currentUser?.uid, out.username || name)
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
  await signInWithToken(out.token)
  if (out.username) cacheUsername(auth.currentUser?.uid, out.username)
  return out
}

/** Redirect or popup for a Google flow: an installed PWA (and mobile Safari generally)
 *  cannot be trusted with a popup — it opens in a separate browser context and the
 *  result is lost — so standalone displays and mobile user agents go through the
 *  redirect, whose result startFirestoreSync collects via getRedirectResult, and
 *  desktop browsers get the popup. */
function redirectPreferred() {
  const standalone = (typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      && window.matchMedia('(display-mode: standalone)').matches)
    || (typeof navigator !== 'undefined' && navigator.standalone === true)
  const mobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '')
  return standalone || mobile
}

/** Sign in with Google — native Firebase Auth, no project server function involved.
 *  The session it creates is an ordinary Firebase session, so the sync engine's
 *  onAuthStateChanged path treats it exactly like a passkey custom-token session and
 *  the account's data lives under users/{uid} like everyone else's. A redirect return
 *  value means the page is about to navigate away. */
export async function fbGoogleLogin() {
  await ensureFirebase()
  const authMod = authModCache || (await import('firebase/auth'))
  const provider = new authMod.GoogleAuthProvider()
  if (redirectPreferred()) {
    await authMod.signInWithRedirect(auth, provider)
    return { redirect: true }
  }
  await authMod.signInWithPopup(auth, provider)
  return { redirect: false }
}

// ---- account linking (Settings → Sign-in methods)
const LINK_REDIRECT_KEY = 'gym_fb_link_redirect'
let redirectOutcomePromise = null // set by startFirestoreSync from getRedirectResult

/** Link Google to the signed-in account. The uid does not change, so the account's
 *  data under users/{uid} is untouched; this only adds a way in. On the redirect
 *  path a flag is left behind so the returning page can tell the collected redirect
 *  outcome (fbLinkOutcome) belongs to a link, not a sign-in. */
export async function fbLinkGoogle() {
  await ensureFirebase()
  if (!auth.currentUser) throw new Error('Sign in first')
  const authMod = authModCache || (await import('firebase/auth'))
  const provider = new authMod.GoogleAuthProvider()
  if (redirectPreferred()) {
    try { sessionStorage.setItem(LINK_REDIRECT_KEY, '1') } catch { /* the outcome is a nicety, the link itself still lands */ }
    await authMod.linkWithRedirect(auth.currentUser, provider)
    return { redirect: true }
  }
  await authMod.linkWithPopup(auth.currentUser, provider)
  refreshFbUser()
  return { redirect: false }
}

/** The outcome of a Google LINK redirect once this page has come back from it:
 *  { ok: true } | { error: true, code, message } | null when no link redirect is
 *  pending. Consumed by the Sign-in methods card, once per return. */
export async function fbLinkOutcome() {
  let flagged = false
  try {
    flagged = sessionStorage.getItem(LINK_REDIRECT_KEY) === '1'
    if (flagged) sessionStorage.removeItem(LINK_REDIRECT_KEY)
  } catch { /* storage unavailable: nothing to collect */ }
  if (!flagged || !redirectOutcomePromise) return null
  return redirectOutcomePromise
}

/** Unlink Google from the signed-in account. The passkey guard lives in the UI and,
 *  for passkey removal, on the server; Firebase itself also refuses to unlink an
 *  account's only provider. */
export async function fbUnlinkGoogle() {
  await ensureFirebase()
  if (!auth.currentUser) throw new Error('Sign in first')
  const authMod = authModCache || (await import('firebase/auth'))
  await authMod.unlink(auth.currentUser, 'google.com')
  refreshFbUser()
}

/** The account's sign-in methods, from the project's own server (the passkey
 *  collections are Admin-SDK-only, so the client cannot read them directly). */
export async function fbSignInMethods() {
  await ensureFirebase()
  const token = auth.currentUser ? await auth.currentUser.getIdToken() : null
  if (!token) throw new Error('Sign in first')
  return postJSON('/api/passkey/list', {}, token)
}

/** Add a passkey to the signed-in account through the LINK ceremony
 *  (/api/passkey/link-*): the server binds the credential, and, for a Google-first
 *  user picking their first username, the username record, to the uid from the ID
 *  token. No new Auth user, no custom token, the session never changes hands.
 *  `username` is only needed when the account has no passkey username yet. */
export async function fbAddPasskeyLinked(username) {
  await ensureFirebase()
  if (!auth.currentUser) throw new Error('Sign in first')
  const token = await auth.currentUser.getIdToken()
  const name = (username || '').trim()
  const { startRegistration } = await import('@simplewebauthn/browser')
  const { options, challengeId } = await postJSON('/api/passkey/link-options', { username: name || undefined }, token)
  const response = await startRegistration({ optionsJSON: options })
  const out = await postJSON('/api/passkey/link-verify', { challengeId, response }, token)
  if (out.username) cacheUsername(auth.currentUser?.uid, out.username)
  return out
}

/** Remove one of the account's own passkey credentials. The server checks ownership
 *  and refuses to remove the account's last remaining sign-in method. */
export async function fbRemovePasskey(credentialId) {
  await ensureFirebase()
  const token = auth.currentUser ? await auth.currentUser.getIdToken() : null
  if (!token) throw new Error('Sign in first')
  return postJSON('/api/passkey/remove', { credentialId }, token)
}

/** Add another passkey to the signed-in account (new phone/browser). */
export async function fbAddPasskey() {
  await ensureFirebase()
  if (!auth.currentUser) throw new Error('Sign in first')
  const name = cachedUsername(auth.currentUser?.uid)
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
  syncStore = useStore
  ensureFirebase().then(() => {
    const { onAuthStateChanged } = authModCache
    // A Google redirect (sign-in or account link) lands back on this page; its result
    // (or its failure) arrives here. The session itself is picked up by
    // onAuthStateChanged below either way, so this only keeps the outcome — an error
    // in particular, like a link whose Google account belongs to another account —
    // for whoever asked for it (fbLinkOutcome, read by Settings → Sign-in methods).
    if (typeof authModCache.getRedirectResult === 'function') {
      redirectOutcomePromise = authModCache.getRedirectResult(auth)
        .then(r => (r ? { ok: true } : null))
        .catch(e => {
          console.warn('[fb-sync] redirect failed', e)
          return { error: true, code: e?.code || '', message: e?.message || '' }
        })
    }
    onAuthStateChanged(auth, user => {
      if (user) {
        setFbUser(describeUser(user))
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
let syncStore = null // the store startFirestoreSync was given, for wake-triggered re-attach
let wakeAttachInFlight = false // a wake-triggered re-attach is already running (see attach)
function detach() {
  if (!session) return
  const sess = session
  // A push that was scheduled (debounce still pending) or is owed (an earlier attempt
  // failed) must not be discarded with the timer: fire one immediate flush attempt
  // with the session's own push machinery BEFORE teardown. Fire-and-forget: sign-out
  // never waits on the network. A session that never became ready (initial load
  // failed) has nothing safely flushable and is skipped.
  if (sess.ready && (sess.pushTm || sess.pushOwed) && typeof sess.flushPush === 'function') {
    try { void sess.flushPush() } catch { /* a failed flush is a lost retry, not a blocked sign-out */ }
  }
  for (const off of sess.unsubs) { try { off() } catch { /* already gone */ } }
  if (sess.pushTm) clearTimeout(sess.pushTm)
  if (sess.backoffTm) clearTimeout(sess.backoffTm)
  if (sess.wakeOff) { try { sess.wakeOff() } catch { /* already gone */ } }
  if (sess.storeOff) sess.storeOff()
  if (session === sess) session = null
}

/** attach() entry: a failure during the initial load must not leave the session
 *  silently dead. The half-built session stays current, marked attachFailed, with
 *  its wake triggers (installed in attachSession before the load runs) armed, so
 *  the next 'online' / return-to-visible event re-runs attach for this uid. The
 *  error still propagates to the caller's console.warn. */
async function attach(useStore, uid) {
  try {
    await attachSession(useStore, uid)
  } catch (e) {
    if (session && session.uid === uid) session.attachFailed = true
    throw e
  }
}

async function attachSession(useStore, uid) {
  detach()
  const S = () => useStore.getState().S
  const userRef = fs.doc(db, 'users', uid)
  const collRef = coll => fs.collection(db, 'users', uid, coll)

  const sess = session = {
    uid, unsubs: [], pushTm: null, storeOff: null,
    ready: false, // initial load done, pushes/listeners only count from here
    known: null, // splitHashes of what the cloud is believed to hold right now
    remote: null, // latest assembled cloud state (joinDocs form), for echo checks
    pushOwed: false, // a local change has not been proven pushed (debounce pending or a push failed)
    attachFailed: false, // the initial load threw, wake triggers re-run attach (set by attach())
    snapshotFailed: false, // a snapshot listener errored, wake triggers re-check (re-attach)
    backoffTm: null, // the ONE scheduled backoff retry for an owed push
    backoffUsed: false, // that backoff has already fired for the current owed push
    wakeOff: null, // removes this session's online/visibility listeners (detach)
    flushPush: null, // one immediate push attempt, for detach() to flush a pending push
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

  // Write the diff between the cloud's believed state (sess.known) and `state`,
  // committed in slices of PUSH_CHUNK: a first sync of a long history is thousands
  // of docs, and one unchunked batch dies on Firestore's 500-operation limit,
  // taking the whole push with it.
  const push = async state => {
    if (!sess.ready || session !== sess) return
    const split = splitState(state)
    const hashes = splitHashes(split)
    const ops = []
    if (hashes.meta !== sess.known.meta) {
      ops.push({ ref: userRef, v: { ...split.meta, _fbUpdatedAt: fs.serverTimestamp() } })
    }
    for (const [coll, m] of Object.entries(split.lists)) {
      const knownMap = sess.known.lists[coll] || new Map()
      for (const [k, v] of m) {
        if (knownMap.get(k) !== entryHash(v)) ops.push({ ref: fs.doc(collRef(coll), docIdFor(k)), v })
      }
      for (const k of knownMap.keys()) {
        if (!m.has(k)) ops.push({ ref: fs.doc(collRef(coll), docIdFor(k)), del: true })
      }
    }
    if (!ops.length) { sess.known = hashes; return }
    for (let i = 0; i < ops.length; i += PUSH_CHUNK) {
      const batch = fs.writeBatch(db)
      for (const op of ops.slice(i, i + PUSH_CHUNK)) {
        if (op.del) batch.delete(op.ref); else batch.set(op.ref, op.v)
      }
      await batch.commit()
    }
    sess.known = hashes
  }

  // ---- owed-push retry: a failed push is remembered, never silently dropped
  // A push failure used to be console.warn only: sync stayed dead until the user
  // happened to edit again. Now a failure marks the push owed, and it is re-attempted
  // (a) once on a backoff timer (~30 s), and (b) whenever the window reports 'online'
  // or the document returns to visible. No interval, no retry when nothing is owed:
  // the backoff is one per owed episode (backoffUsed), and the wake triggers below
  // check pushOwed first. A success clears the debt and any pending backoff.
  const schedulePushBackoff = () => {
    if (sess.backoffTm || sess.backoffUsed) return
    sess.backoffTm = setTimeout(() => {
      sess.backoffTm = null
      sess.backoffUsed = true
      if (session !== sess || !sess.pushOwed) return
      void runPush()
    }, PUSH_RETRY_MS)
  }
  const runPush = async () => {
    if (!sess.ready || session !== sess) return
    try {
      await push(S())
      // A newer edit may have landed while this push was in flight: it has its own
      // debounce timer pending, and its debt is that timer's to clear.
      if (!sess.pushTm) {
        sess.pushOwed = false
        sess.backoffUsed = false
        if (sess.backoffTm) { clearTimeout(sess.backoffTm); sess.backoffTm = null }
      }
    } catch (e) {
      console.warn('[fb-sync] push failed', e)
      if (session !== sess) return // detached mid-flight: the debt died with the session
      sess.pushOwed = true
      schedulePushBackoff()
    }
  }
  // detach()'s sign-out flush: the raw push, once, with no retry bookkeeping: the
  // session is going away, so an owed-mark or a backoff would have nothing to serve.
  sess.flushPush = () => push(S()).catch(e => console.warn('[fb-sync] push failed', e))

  // ---- wake triggers: 'online' and return-to-visible re-check a hurt session
  // Installed BEFORE the initial load, so a load that throws still leaves them armed
  // on the half-built session (attach() marks it attachFailed). Removed by detach(),
  // so a signed-out or replaced session is never resurrected by an event.
  const onWake = () => {
    if (session !== sess) return
    if (sess.attachFailed || sess.snapshotFailed) {
      // The initial load never finished, or a snapshot listener died: the only sound
      // re-check is a fresh attach for the same uid (it detaches this session first).
      if (wakeAttachInFlight || !syncStore) return
      wakeAttachInFlight = true
      attach(syncStore, sess.uid)
        .catch(e => console.warn('[fb-sync] attach failed', e))
        .finally(() => { wakeAttachInFlight = false })
      return
    }
    if (sess.pushOwed) void runPush()
  }
  const onVisible = () => {
    if (typeof document !== 'undefined' && document.visibilityState && document.visibilityState !== 'visible') return
    onWake()
  }
  if (typeof globalThis.addEventListener === 'function') globalThis.addEventListener('online', onWake)
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('visibilitychange', onVisible)
  sess.wakeOff = () => {
    if (typeof globalThis.removeEventListener === 'function') globalThis.removeEventListener('online', onWake)
    if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') document.removeEventListener('visibilitychange', onVisible)
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
    await runPush() // converge: local-only extras go up, tombstoned docs go away
  }
  const onSnapError = e => {
    // A dead listener used to be swallowed by an empty callback: sync looked live
    // while nothing arrived. Mark it; the wake triggers re-check by re-attaching.
    console.warn('[fb-sync] snapshot error', e)
    sess.snapshotFailed = true
  }
  sess.unsubs.push(fs.onSnapshot(userRef, onSnap, onSnapError))
  for (const c of ['workouts', 'routines', 'exercises', 'bodyweight', 'measurements']) {
    sess.unsubs.push(fs.onSnapshot(collRef(c), onSnap, onSnapError))
  }

  // ---- local changes go up, debounced, doc-diffed (in push)
  sess.storeOff = useStore.subscribe(() => {
    if (!sess.ready || session !== sess) return
    sess.pushOwed = true // owed from this moment until a push is proven to have landed
    clearTimeout(sess.pushTm)
    sess.pushTm = setTimeout(() => { sess.pushTm = null; void runPush() }, PUSH_DEBOUNCE_MS)
  })
}
