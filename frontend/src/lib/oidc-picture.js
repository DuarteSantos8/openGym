/* The identity provider's picture as the profile picture (OIDC, the `picture` claim).
 *
 * The server keeps nothing of it but the address: /api/me says when the last provider sign-in
 * named one (`oidcPicture`, that sign-in's time), and GET /api/oidc/picture relays the bytes. This
 * device then makes the stored square out of them exactly as out of a picked photo
 * (lib/avatar.js renderAvatarFrom), so the picture is kept and synced like one. S.avatarOidc keeps
 * that sign-in's time, which is how every device knows the sign-in is dealt with: one fetch per
 * sign-in, by whichever device gets there first, and none on later starts.
 */
import { avatarOf, fromProvider, providerMarkOf, setAvatarFromProvider, renderAvatarFrom } from './avatar.js'
import { MediaError } from './media-ingest.js'
import { MB, limitsFrom } from './media-limits.js'
import { apiBlob } from './api.js'
import { mediaStore } from './media-store.js'

/**
 * Whether the provider's picture of the sign-in at `seen` is to be fetched: only where the server
 * keeps avatars, and only when the profile has no picture or has the provider's from an earlier
 * sign-in. A photo or an icon chosen here is never replaced.
 */
export function providerPictureDue (S, seen, config) {
  if (!config?.media?.avatar || typeof seen !== 'string' || !seen) return false
  const mark = providerMarkOf(S)
  // Both are server times as ISO strings, which sort in time order.
  if (mark && mark.at >= seen) return false
  return !avatarOf(S) || fromProvider(S)
}

// A refusal that the same sign-in will not get past: that sign-in is done, with the picture the
// profile already has. Anything else (no network, a server or provider that failed, a session
// that changed) is tried again next start.
const settled = e => e instanceof MediaError || e?.code === 'too-large' || [404, 413, 415, 422].includes(e?.status)

const tried = new Set()

/** Fetches the picture when it is due and sets it. Resolves true when the avatar changed. */
export async function takeProviderPicture (store, deps = {}) {
  const d = { apiBlob, render: renderAvatarFrom, media: mediaStore, ...deps }
  const st = store.getState()
  const uid = st.user?.id
  const seen = st.user?.oidcPicture
  if (uid == null || !providerPictureDue(st.S, seen, st.config)) return false
  const key = uid + '|' + seen
  if (tried.has(key)) return false
  tried.add(key)
  const same = () => { const s = store.getState().user; return s?.id === uid && s?.oidcPicture === seen }
  // Still the same account and sign-in, and no photo or icon chosen meanwhile.
  const still = () => same() && providerPictureDue(store.getState().S, seen, st.config)
  let out = null
  try {
    const blob = await d.apiBlob('/api/oidc/picture', { expectSize: Math.round(limitsFrom(st.config).imageMB * MB), headers: { 'X-OpenGym-Account': String(uid) } })
    if (!same()) return false
    out = await d.render(blob)
  } catch (e) {
    if (!settled(e)) return false
  }
  if (!still()) return false
  if (out) await d.media.put(out.media.hash, out.blob, { mime: out.media.mime, pending: true })
  if (!still()) return false
  store.getState().update(s => {
    if (out) setAvatarFromProvider(s, out.media, seen)
    else s.avatarOidc = fromProvider(s) ? { at: seen, hash: providerMarkOf(s).hash } : { at: seen }
  })
  return true
}

/** A sign-in that found a photo or an icon chosen here is dealt with as well, without a fetch, so a
 *  provider picture that a restored backup brings back waits for the next one. */
function passedOver (S, seen, config) {
  if (!config?.media?.avatar || typeof seen !== 'string' || !seen) return false
  const mark = providerMarkOf(S)
  return !(mark && mark.at >= seen) && !!avatarOf(S) && !fromProvider(S)
}

/** Wires it to the app store: once boot is done, signed in, no sign-in question is open, and the
 *  last sync reached the server, so the profile in hand is the server's. */
export function startProviderPicture (store, deps) {
  let timer = null
  const shut = s => !s.ready || !s.user || s.sync?.held || s.sync?.offline || s.sync?.lastError
  const check = () => {
    const s = store.getState()
    if (timer || shut(s)) return
    const seen = s.user.oidcPicture
    if (passedOver(s.S, seen, s.config)) {
      const key = s.user.id + '|' + seen
      if (tried.has(key)) return
      tried.add(key)
      s.update(S => {
        if (!passedOver(S, seen, s.config)) return
        const hash = providerMarkOf(S)?.hash
        S.avatarOidc = hash ? { at: seen, hash } : { at: seen }
      })
      return
    }
    if (!providerPictureDue(s.S, seen, s.config)) return
    timer = setTimeout(() => { timer = null; if (!shut(store.getState())) takeProviderPicture(store, deps).catch(() => {}) }, 2000)
  }
  const unsub = store.subscribe(check)
  check()
  return () => { unsub(); clearTimeout(timer) }
}
