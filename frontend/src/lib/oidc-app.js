// The phone app signs in with the server's identity provider (#130) in the system browser, never
// in a WebView of its own: ASWebAuthenticationSession on iPhone, a Custom Tab on Android (the
// local OidcBrowser plugin, ios/App/App/OidcBrowserPlugin.swift and android/.../OidcBrowserPlugin.java).
// The server sends the browser back to opengym://oidc with a one-time code, and the code is only
// good together with the verifier made here, so another app that grabs the scheme gets nothing.
import { oidcRedeem } from './api.js'
import { oidcErrorText } from './oidc.js'

export const APP_RETURN = 'opengym://oidc'
const WAIT_MS = 10 * 60000
// Android: back in the app without the link means the tab was closed. The link can land a moment
// after the app comes to the front, so it gets this long.
const RESUME_GRACE_MS = 1500

const b64u = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const random = n => crypto.getRandomValues(new Uint8Array(n))

/** A PKCE-style pair: the verifier stays here, the challenge goes to the server. */
export async function appPair() {
  const verifier = b64u(random(32))
  const challenge = b64u(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))
  return { verifier, challenge, astate: b64u(random(18)) }
}

export function startAddress(base, { challenge, astate }) {
  return `${base}/api/oidc/start?mode=app&return=${encodeURIComponent(APP_RETURN)}&challenge=${challenge}&astate=${astate}`
}

const cancelled = () => Object.assign(new Error('cancelled'), { code: 'cancelled' })

let pluginP = null
const browserPlugin = () => pluginP || (pluginP = (async () => {
  const { registerPlugin } = await import('@capacitor/core')
  const { App } = await import('@capacitor/app')
  const { Capacitor } = await import('@capacitor/core')
  // Inside an object: a plugin proxy answers `then` and would hang a promise resolved with it.
  return { OidcBrowser: registerPlugin('OidcBrowser'), App, platform: Capacitor.getPlatform() }
})())

/** Opens `url` in the system browser and resolves with the opengym:// address it came back on
 *  (opengym://oidc unless `returnTo` names another, like the OpenRouter sign-in's). */
export async function openForReturn(url, deps, returnTo = APP_RETURN) {
  const { OidcBrowser, App, platform } = deps || await browserPlugin()
  if (platform === 'ios') {
    // ASWebAuthenticationSession catches the scheme itself and hands the address back.
    let r
    try { r = await OidcBrowser.open({ url }) }
    catch (e) { throw e?.code === 'cancelled' ? cancelled() : e }
    if (!r?.url) throw cancelled()
    return r.url
  }
  return new Promise((resolve, reject) => {
    const handles = []
    let graceTm = null
    const done = (fn, v) => { clearTimeout(timer); clearTimeout(graceTm); handles.forEach(h => { try { h.remove() } catch { /* gone */ } }); fn(v) }
    const timer = setTimeout(() => done(reject, cancelled()), WAIT_MS)
    Promise.all([
      App.addListener('appUrlOpen', e => { if (String(e?.url || '').startsWith(returnTo)) done(resolve, e.url) }),
      App.addListener('resume', () => { clearTimeout(graceTm); graceTm = setTimeout(() => done(reject, cancelled()), RESUME_GRACE_MS) })
    ]).then(hs => {
      handles.push(...hs)
      return OidcBrowser.open({ url })
    }).catch(e => done(reject, e))
  })
}

/**
 * The whole sign-in against `base`: { token, user }, or throws with a message in the UI language
 * (and `code` 'cancelled' when the person backed out, which the caller need not show).
 */
export async function phoneSignIn(base, label, { open = openForReturn, redeem = oidcRedeem, pair = appPair } = {}) {
  const p = await pair()
  const back = await open(startAddress(base, p))
  let q
  try { q = new URL(back).searchParams } catch { throw Object.assign(new Error(oidcErrorText('state', label)), { code: 'state' }) }
  // Our own state, back unchanged: anything else is an answer to some other sign-in.
  if (q.get('astate') !== p.astate) throw Object.assign(new Error(oidcErrorText('state', label)), { code: 'state' })
  const err = q.get('error')
  if (err) throw Object.assign(new Error(oidcErrorText(err, label)), { code: err })
  return redeem(base, q.get('code') || '', p.verifier)
}
