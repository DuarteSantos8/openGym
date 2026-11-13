// Sign in with the server's identity provider (OIDC, #130). The server does the protocol
// (api/oidc/); in a browser this only leaves for /api/oidc/start and reads what the callback
// put in the address bar on the way back. The phone app's own flow is in lib/oidc-app.js.
import { t } from './i18n-core.js'
import { appBase } from './app-base.js'

export const oidcOn = config => !!config?.oidc
export const oidcOnly = config => !!config?.oidc?.only
export const oidcLabel = config => String(config?.oidc?.label || 'SSO')

// The route, relative to wherever the app is served (a subpath install included).
export const startUrl = (mode = 'web') => appBase() + 'api/oidc/start' + (mode === 'web' ? '' : '?mode=' + encodeURIComponent(mode))

/** Leaves for the provider. `mode`: 'web', 'reauth' (confirm it is you), or a link URL from the server. */
export function startWebSignIn(mode = 'web', go = url => window.location.assign(url)) {
  go(mode.startsWith('/api/') ? appBase() + mode.slice(1) : startUrl(mode))
}

// What the last trip to the provider came back with, read once at boot and kept for the screen
// that says so (Login, Settings). The address bar is tidied straight away, so a reload or a
// shared link never says it again.
let arrival = null
export function takeOidcReturn(loc = typeof location !== 'undefined' ? location : null, hist = typeof history !== 'undefined' ? history : null) {
  if (!loc || !loc.search) return null
  const q = new URLSearchParams(loc.search)
  const ok = q.get('oidc'), err = q.get('oidc-error')
  if (!ok && !err) return null
  arrival = err ? { error: err.slice(0, 40) } : { ok: ok.slice(0, 40) }
  q.delete('oidc'); q.delete('oidc-error')
  const rest = q.toString()
  try { hist?.replaceState(hist.state, '', loc.pathname + (rest ? '?' + rest : '') + (loc.hash || '')) } catch { /* the address stays, nothing else breaks */ }
  return arrival
}
export const oidcArrival = () => arrival
export const clearOidcArrival = () => { arrival = null }

/** Why the provider sign-in did not work, in the UI language. `label` names the provider. */
export function oidcErrorText(code, label = 'SSO') {
  switch (code) {
    case 'group': return t('{0} let you in, but this server only takes certain groups. Ask whoever runs it to add you.', label)
    case 'link-needed': return t('A profile here already uses that e-mail. Sign in to it another way, then link {0} in Settings.', label)
    case 'invite': return t('This server is invite-only and {0} alone does not get you in. Ask whoever runs it.', label)
    case 'disabled': return t('This account has been disabled.')
    case 'cancelled': return t('Sign-in cancelled. No harm done.')
    case 'taken': return t('That {0} account is already linked to another profile here.', label)
    case 'already-linked': return t('This profile is already linked to a {0} account.', label)
    case 'wrong-account': return t('That was a different {0} account than the one linked to this profile.', label)
    case 'link-expired': case 'state': return t('That sign-in took too long or came from another tab. Give it another go.')
    case 'throttled': return t('Too many attempts. Try again in a minute.')
    case 'oidc-only': return t('This server signs people in with {0}.', label)
    case 'token': return t('{0} sent back something we could not verify, so nobody was signed in. If it keeps happening, the admin page shows why.', label)
    default: return t('{0} could not be reached. Try again in a moment.', label)
  }
}

/** What a good arrival says. */
export function oidcOkText(code, label = 'SSO') {
  if (code === 'linked') return t('Linked. You can sign in with {0} from now on.', label)
  if (code === 'confirmed') return t('Confirmed. Go ahead.')
  return null
}
