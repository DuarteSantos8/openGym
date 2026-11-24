// Whose profile on the app's own server this browser has open (Cloud edition, ADR 0013).
//
// The account and the server profile are two sessions. Continue opens the second through the
// first (lib/cloud/enter-app.js), and from then on they have to end together: signed out of the
// account, or someone else signed in to it, the server profile left open would show the first
// person's training to whoever comes next (found in review of #78).
//
// So Continue notes whose account is on its way to the server. Back with a server profile, that
// profile is theirs, and it stays theirs alone: a different account, or none, means it has to be
// ended. A server profile nobody noted is left alone: an admin's passkey still works when the
// provider is down, and there are profiles from before this existed.
//
// What is kept is the account's id and nothing else, with the browser, so it holds over a reload
// and in other tabs.
export const LINK_KEY = 'gym_cloud_link_v1'

function browserStorage() {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}

/** @param {Pick<Storage, 'getItem'|'setItem'|'removeItem'>|null} [storage] where the note is kept; the page's own memory when it refuses */
export function createServerLink(storage = browserStorage()) {
  let here = null         // the note, when storage will not keep it
  let onTheWay = false    // this page noted someone and is about to leave for the server's sign-in
  const read = () => {
    let v = here
    try { const raw = storage?.getItem(LINK_KEY); if (typeof raw === 'string') v = JSON.parse(raw) } catch { /* the page's memory will do */ }
    return v && typeof v.id === 'string' && v.id && (v.state === 'pending' || v.state === 'linked') ? { id: v.id, state: v.state } : null
  }
  const write = note => {
    here = note
    try { if (note) storage?.setItem(LINK_KEY, JSON.stringify(note)); else storage?.removeItem(LINK_KEY) } catch { /* the page's memory will do */ }
  }
  return {
    /** This account is about to go through the server's sign-in. */
    leaving(hostedId) {
      if (typeof hostedId !== 'string' || !hostedId) return
      onTheWay = true
      write({ id: hostedId, state: 'pending' })
    },
    /** The account the open server profile belongs to, or null when nobody was noted. */
    owner() { return read()?.id ?? null },
    forget() { onTheWay = false; write(null) },
    /**
     * @param {{hostedId: string|null, serverUser: unknown}} now who is signed in to the account, and the server profile the app has open
     * @returns {'ok'|'end'} 'end': the open server profile is not this account's and has to be signed out
     */
    check({ hostedId, serverUser }) {
      const note = read()
      if (!note) return 'ok'
      if (!serverUser) {
        // Nothing open on the server: a sign-in that was refused, or a profile that ended
        // elsewhere. The note goes, unless this page is the one about to leave.
        if (!(onTheWay && note.state === 'pending')) write(null)
        return 'ok'
      }
      if (note.id !== hostedId) return 'end'
      if (note.state === 'pending') write({ id: note.id, state: 'linked' })
      return 'ok'
    },
  }
}

let made
/** This browser's one note. */
export function serverLink() { return (made ??= createServerLink()) }
