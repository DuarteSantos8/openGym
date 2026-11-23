// Who is signed in to the hosted account, as the rest of the app may show it (Cloud edition,
// ADR 0008): an address and a name, or nobody. Both builds ship this file, so it knows nothing
// about where accounts live: the Cloud edition's own code (lib/cloud/account-watch.js, reached
// only through a dynamic import) tells it, and in the default edition nobody ever does.
//
// It holds what a screen may print and nothing else: no id, no token.
import { useSyncExternalStore } from 'react'

let account = null
const listeners = new Set()

/** @returns {{email: string, name: string}|null} */
export const cloudAccount = () => account

/** @param {{email?: unknown, name?: unknown}|null|undefined} next someone signed in, or nobody */
export function setCloudAccount(next) {
  const email = typeof next?.email === 'string' ? next.email.trim() : ''
  const clean = email ? { email, name: typeof next.name === 'string' ? next.name.trim() : '' } : null
  if (clean?.email === account?.email && clean?.name === account?.name) return
  account = clean
  listeners.forEach(fn => fn())
}

/** @returns {() => void} stop listening */
export function onCloudAccount(fn) { listeners.add(fn); return () => listeners.delete(fn) }

/** For a component: re-renders when who is signed in changes. */
export const useCloudAccount = () => useSyncExternalStore(onCloudAccount, cloudAccount, cloudAccount)

/** What to call them on a screen: their name where they gave one, else their address. */
export const whoIs = a => (a ? a.name?.trim() || a.email : '')

/**
 * What the account card at the top of Settings says for someone signed in to the hosted account:
 * who they are, and where their training is. `t` is the translator, handed in.
 * @returns {{title: string, sub: string, face: string}|null}
 */
export const badgeCard = (a, t) => (a ? { title: whoIs(a), sub: t('Signed in as {0}. Your training is stored on this device.', a.email), face: whoIs(a) } : null)
