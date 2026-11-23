// A person signed in to their account going on into the app (Cloud edition, ADR 0008, 0013).
//
// The account is for the plan and purchases; training lives in the app, on this device, or on a
// server of the app's own where there is one. Going to the app's address is not enough: someone
// who is in neither would meet the app's own sign-in screen and be asked to sign in again, to
// something else. So this opens the device's own profile for them, unless they are already in,
// or a server has said it requires its own account.
//
// Where the app's own server signs people in with this same account (ADR 0013), going on means
// becoming a profile on that server, so training follows the account. That is asked of the
// caller ('link'): it leaves the page for the server's sign-in. It holds for someone already on
// this device's profile too: that profile is the one to attach, and the app asks what to do
// with what is on the device once they are back (the store's adoptProfile).
import { guestAllowed } from '../guest.js'
import { oidcOn } from '../oidc.js'

/**
 * @param {{user: unknown, config: {allow_guest?: boolean, oidc?: object}|null, isGuest: () => boolean, setGuest: (on: boolean) => void}} st the app's store
 * @returns {'already'|'link'|'device'|'server'} nothing to do, go through the server's sign-in with the account, this device's profile opened, or left to the server's own sign-in
 */
export function enterApp(st) {
  if (st.user) return 'already'
  if (oidcOn(st.config)) return 'link'
  if (st.isGuest()) return 'already'
  if (!guestAllowed(st.config)) return 'server'
  st.setGuest(true)
  return 'device'
}
