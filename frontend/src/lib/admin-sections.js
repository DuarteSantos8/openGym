// The Admin page's sections. On a wide window each is its own page, /admin/<id>, linked from the
// sidebar (TabBar.jsx); a phone shows them all on one page (views/Admin.jsx). The dashboard is
// English-only, so are these labels. A section that only exists on some instances (sign-in with an
// identity provider, the community library, gyms) says so in `on`, which reads the app's config the
// same way the card itself does.
import { oidcOn } from './oidc.js'
import { libraryOf } from './shared-api.js'

export const ADMIN_SECTIONS = [
  ['overview', 'Overview', 'grid'],
  ['users', 'Users', 'person'],
  ['invites', 'Invite codes', 'envelope'],
  ['coach', 'Coach', 'sparkles'],
  ['signin', 'Sign-in', 'key', config => oidcOn(config)],
  ['community', 'Community library', 'globe', config => !!libraryOf(config)],
  ['gyms', 'Gyms', 'house', config => !!config?.trainers?.on],
  ['activity', 'Activity log', 'history'],
]

/** The sections this instance has: all of them, minus the ones its config leaves out. */
export const adminSections = config => ADMIN_SECTIONS.filter(([, , , on]) => !on || on(config))

/** The section a path names, `overview` for /admin itself or anything unknown. */
export const adminSectionOf = path => {
  const id = String(path || '').split('/')[2]
  return ADMIN_SECTIONS.some(([s]) => s === id) ? id : 'overview'
}
