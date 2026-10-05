/* A guest who leaves for the provider from Settings (Account) rather than from the sign-in screen.
 *
 * The page comes back through a full reload, and a guest's reload never shows the sign-in screen:
 * an identity no profile has yet would never be offered its name, and a profile that signs in
 * would take this browser's entries without the question every other sign-in asks about them.
 * The mark tells the next boot to stop being a guest and to ask that question (useStore boot).
 * Kept for this tab only (sessionStorage), and read once whether the trip finished or not. A
 * browser that refuses to store it must not leave at all: that return would sign the profile in
 * without the question, so markGuestDeparture answers whether the mark is there. A browser that
 * blocks site data throws on reaching `sessionStorage` at all, so the default is resolved inside
 * the guarded body: boot reads the mark on every start and must not fail there.
 */
const KEY = 'gym_oidc_from_guest'

export function markGuestDeparture({ storage } = {}) {
  try { (storage ?? globalThis.sessionStorage).setItem(KEY, '1'); return true } catch { return false }
}

export function takeGuestDeparture({ storage } = {}) {
  try {
    storage ??= globalThis.sessionStorage
    const marked = storage.getItem(KEY) === '1'
    storage.removeItem(KEY)
    return marked
  } catch { return false }
}
