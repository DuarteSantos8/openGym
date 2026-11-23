// The app hears who is signed in to the hosted account (Cloud edition, ADR 0008).
//
// The account screen is one screen; the rest of the app is the default edition's and knows
// nothing of accounts. Without this it went on saying "Guest mode" to someone who had just
// signed in. This watches the session and tells lib/account-badge.js, which both builds have
// and any screen may read: the address at once, the name once it has been read.
import { cloud } from './client.js'
import { setCloudAccount } from '../account-badge.js'

/**
 * @param {ReturnType<import('./client.js').buildCloud>|null} [client]
 * @param {(a: {email: string, name: string}|null) => void} [set]
 * @returns {() => void} stop watching
 */
export function watchAccount(client = cloud(), set = setCloudAccount) {
  if (!client) return () => {}
  let who = null          // the signed-in person's id, as last heard
  const hear = session => {
    const user = session?.user
    if (!user?.id || !user.email) { who = null; set(null); return }
    if (user.id === who) return            // the same person with a renewed session: nothing new
    who = user.id
    set({ email: user.email, name: '' })
    // The name is theirs to set and lives in their profile. Read once per sign-in; if it cannot
    // be read (offline), the address stands.
    client.profiles.get().then(p => { if (who === user.id && p?.display_name) set({ email: user.email, name: p.display_name }) }, () => {})
  }
  hear(client.auth.session())
  return client.auth.onChange(hear)
}
