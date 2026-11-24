// The app's side of "the two sessions end together" (lib/cloud/server-link.js, Cloud edition).
//
// The account screen ends the server profile itself when someone signs out there. This covers
// every other way the account can change under an open server profile: signed out in another
// tab, the session ending on its own, someone else signing in. Whenever the app knows both who
// is signed in to the account and which server profile is open, and the two do not belong
// together, the server profile is signed out. Forced, as the app's own sign-out offers: changes
// the server has not seen are kept aside on this device for that account, never dropped.
import { cloud } from './client.js'
import { serverLink } from './server-link.js'
import { oidcErrorText } from '../oidc.js'

/**
 * @param {object} [o]
 * @param {{auth: {session: () => ({user?: {id?: string}}|null), onChange: (fn: Function) => () => void}}|null} [o.client]
 * @param {{getState: () => any, subscribe: (fn: (s: any, p: any) => void) => () => void}} o.store the app's store
 * @param {ReturnType<typeof serverLink>} [o.note]
 * @returns {() => void} stop watching
 */
export function watchLink({ client = cloud(), store, note = serverLink() } = {}) {
  if (!client || !store) return () => {}
  let ending = false, watching = true
  const look = async () => {
    const st = store.getState()
    // Before the app has asked the server who this is, "no profile" would be a guess.
    if (!watching || ending || !st.ready) return
    if (note.check({ hostedId: client.auth.session()?.user?.id ?? null, serverUser: st.user }) !== 'end') return
    ending = true
    try { await st.signOut({ force: true }) } catch { /* still open: the next change looks again */ } finally { ending = false }
    if (watching) note.check({ hostedId: client.auth.session()?.user?.id ?? null, serverUser: store.getState().user })
  }
  look()
  const offAccount = client.auth.onChange(() => { look() })
  const offStore = store.subscribe((s, p) => { if (s.user !== p.user || s.ready !== p.ready) look() })
  return () => { watching = false; offAccount(); offStore() }
}

/**
 * Back from the server's sign-in with a refusal, as someone who stays in the app (this device's
 * profile): the sign-in screen, which says why, is not shown to them. Say it here instead.
 * @param {{arrival: {error?: string}|null, guest: boolean, label: string, toast: (msg: string) => void, clear: () => void}} o
 */
export function tellLinkFailure({ arrival, guest, label, toast, clear }) {
  if (!guest || !arrival?.error) return
  clear()
  if (arrival.error !== 'cancelled') toast(oidcErrorText(arrival.error, label))
}
