// Whose profile on the app's own server this browser has open (Cloud edition, ADR 0013).
//
// The account and the server profile are two sessions. Continue opens the second through the
// first (lib/cloud/enter-app.js), and from then on they have to end together: signed out of the
// account, or someone else signed in to it, the server profile left open would show the first
// person's training to whoever comes next (found in review of #78).
//
// So Continue notes whose account is on its way to the server. Back with a server profile, that
// profile is theirs, and the note says which profile: a different account, or none, means that
// profile has to be ended. Any other profile on the server is none of the note's business: an
// admin's passkey still works when the provider is down, and there are profiles from before
// this existed.
//
// The note is kept with the browser, so it holds over a reload and in every tab. And because
// there are other tabs, one that sees no server profile proves nothing: it may not have caught
// up, or the sign-in may still be open in another tab. A note is never thrown away on that
// (found in review of #79). It changes when the next person goes through the sign-in, and it
// stops counting, for a sign-in that never came back, once the server itself would no longer
// accept it.
//
// And because there are other tabs, the one that ends the profile says so in the note: for a
// short while it reads "ended", and every tab that still shows that profile lets go of it.
// Nothing else would tell them, and they would go on showing the training.
//
// What is kept: the account's id, the server profile's id, a time. Never a token.
export const LINK_KEY = 'gym_cloud_link_v1'
/** How long a sign-in that has not come back still counts. The server gives one ten minutes (api/oidc/routes.js, FLOW_TTL_MS). */
export const PENDING_MS = 15 * 60_000
/** How long "this profile was ended" is said to the other tabs. */
export const ENDED_MS = 2 * 60_000

function browserStorage() {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}
const idOf = user => (user && (typeof user.id === 'string' || typeof user.id === 'number') ? String(user.id) : '')

function valid(v) {
  if (!v || typeof v.id !== 'string' || !v.id) return null
  if (v.state === 'pending' && typeof v.at === 'number') return { id: v.id, state: 'pending', at: v.at }
  if (v.state === 'linked' && typeof v.server === 'string' && v.server) return { id: v.id, state: 'linked', server: v.server }
  if (v.state === 'ended' && typeof v.server === 'string' && v.server && typeof v.at === 'number') return { id: v.id, state: 'ended', server: v.server, at: v.at }
  return null
}

/**
 * @param {Pick<Storage, 'getItem'|'setItem'|'removeItem'>|null} [storage] where the note is kept; the page's own memory when it refuses
 * @param {() => number} [now]
 */
export function createServerLink(storage = browserStorage(), now = () => Date.now()) {
  let here = null         // the note, when storage will not keep it
  const read = () => {
    let v = here
    try { const raw = storage?.getItem(LINK_KEY); if (typeof raw === 'string') v = JSON.parse(raw) } catch { /* the page's memory will do */ }
    return valid(v)
  }
  const write = note => {
    here = note
    try { if (note) storage?.setItem(LINK_KEY, JSON.stringify(note)); else storage?.removeItem(LINK_KEY) } catch { /* the page's memory will do */ }
  }
  return {
    /** This account is about to go through the server's sign-in. */
    leaving(hostedId) {
      if (typeof hostedId !== 'string' || !hostedId) return
      write({ id: hostedId, state: 'pending', at: now() })
    },
    /** The account this server profile was opened through, or null: nobody noted, or another profile. */
    ownerOf(serverUser) {
      const note = read()
      return note?.state === 'linked' && note.server === idOf(serverUser) ? note.id : null
    },
    /** This tab ended the server profile the note is about. Said for a while, so other tabs let go too. */
    ended() {
      const note = read()
      if (note?.state === 'linked') write({ id: note.id, state: 'ended', server: note.server, at: now() })
    },
    /**
     * @param {{hostedId: string|null, serverUser: {id: string|number}|null}} seen who is signed in to the account, and the server profile this tab has open
     * @returns {'ok'|'end'} 'end': that server profile is not this account's and has to be signed out
     */
    check({ hostedId, serverUser }) {
      const note = read()
      if (!note) return 'ok'
      if (note.state === 'pending') {
        if (now() - note.at > PENDING_MS) { write(null); return 'ok' }
        if (!serverUser) return 'ok'                    // still out, here or in another tab
        if (note.id !== hostedId) return 'end'
        write({ id: note.id, state: 'linked', server: idOf(serverUser) })
        return 'ok'
      }
      if (note.state === 'ended' && now() - note.at > ENDED_MS) { write(null); return 'ok' }
      if (!serverUser || idOf(serverUser) !== note.server) return 'ok'
      if (note.state === 'ended') return 'end'
      return note.id === hostedId ? 'ok' : 'end'
    },
  }
}

let made
/** This browser's one note. */
export function serverLink() { return (made ??= createServerLink()) }
