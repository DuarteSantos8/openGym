// A person signed in to their account going on into the app (Cloud edition, ADR 0008, 0013).
//
// The account is for the plan and purchases; training lives in the app, on this device, or on a
// server of the app's own where there is one. Going to the app's address is not enough: someone
// who is in neither would meet the app's own sign-in screen and be asked to sign in again, to
// something else. So this opens the device's own profile for them, unless they are already in,
// or a server has said it requires its own account.
import { guestAllowed } from '../guest.js'

/**
 * @param {{user: unknown, config: {allow_guest?: boolean}|null, isGuest: () => boolean, setGuest: (on: boolean) => void}} st the app's store
 * @returns {'already'|'device'|'server'} what was done: nothing, this device's profile opened, or left to the server's own sign-in
 */
export function enterApp(st) {
  if (st.user || st.isGuest()) return 'already'
  if (!guestAllowed(st.config)) return 'server'
  st.setGuest(true)
  return 'device'
}
