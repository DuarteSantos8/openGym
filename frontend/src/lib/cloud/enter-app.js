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

//
// A server profile already open counts as "already in" only for the account it was opened
// through (lib/cloud/server-link.js). Opened through another one, it is the previous person's:
// 'switch' asks the caller to sign it out first and then go through the sign-in as this one.
//
// The server's sign-in is a full-page trip. Where the browser is not keeping the account session
// (private browsing, storage full: `lasting` false) the person would come back signed out, and
// the profile just opened would be ended again (found in review of #81). There the trip is not
// offered, and what works is this device's profile.
/**
 * @param {{user: unknown, config: {allow_guest?: boolean, oidc?: object}|null, isGuest: () => boolean, setGuest: (on: boolean) => void}} st the app's store
 * @param {{hostedId?: string|null, owner?: string|null, lasting?: boolean}} [who] the account signed in now, the account the open server profile was opened through (null: nobody noted), and whether the account session will outlive the page
 * @returns {'already'|'link'|'switch'|'device'|'server'} nothing to do; go through the server's sign-in with the account; the same after signing out the server profile that is open; this device's profile opened; left to the server's own sign-in
 */
export function enterApp(st, { hostedId = null, owner = null, lasting = true } = {}) {
  if (st.user) return owner && owner !== hostedId && oidcOn(st.config) ? 'switch' : 'already'
  if (oidcOn(st.config) && lasting) return 'link'
  if (st.isGuest()) return 'already'
  if (!guestAllowed(st.config)) return 'server'
  st.setGuest(true)
  return 'device'
}
