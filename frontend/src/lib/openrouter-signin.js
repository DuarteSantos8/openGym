// "Sign in with OpenRouter" in the app: OpenRouter's official OAuth PKCE flow
// (api/coach/core/openrouter-oauth.js) wired to the two places that hold a key.
//
//   Web (the admin card): the page goes to openrouter.ai and comes back to this same address with
//   ?code=…; the verifier waits in sessionStorage meanwhile, and the key is filed on the server as
//   the instance's OpenRouter key.
//   Phone (bring your own key): the system browser session goes to openrouter.ai and comes back
//   through https://opengym.ch/openrouter/ to opengym://openrouter, which the session catches; the
//   key goes into secure storage like a pasted one. Headless mode (a code to paste) is the
//   fallback when the way back does not work.
import { makePkce, authUrl, readCallback, pastedCode, exchangeCode, PHONE_CALLBACK, APP_RETURN } from '../../../api/coach/core/openrouter-oauth.js'

const PENDING = 'og_openrouter_pending'
const MAX_AGE_MS = 10 * 60000

const store = () => { try { return globalThis.sessionStorage || null } catch { return null } }

/** Web: send this page to openrouter.ai. `back` is the hash route to land on afterwards. */
export async function startWebSignIn({ back = '#/admin', go = url => window.location.assign(url), loc = window.location } = {}) {
  const p = await makePkce()
  store()?.setItem(PENDING, JSON.stringify({ verifier: p.verifier, state: p.state, at: Date.now(), back }))
  go(authUrl({ callbackUrl: loc.origin + loc.pathname, challenge: p.challenge, state: p.state }))
}

/** Web: is this page load the way back from openrouter.ai? */
export const isWebReturn = (loc = window.location) => /[?&]code=/.test(loc.search || '') && !!store()?.getItem(PENDING)

/**
 * Web: finish the way back. Exchanges the code, hands the key to `save`, and puts the address
 * back the way it was. Resolves { ok, back } or { ok:false, error }.
 */
export async function finishWebSignIn({ save, loc = window.location, history = window.history, fetch: fetchImpl } = {}) {
  const raw = store()?.getItem(PENDING)
  store()?.removeItem(PENDING)
  let pending = null
  try { pending = JSON.parse(raw) } catch { /* nothing waiting */ }
  const address = loc.href
  // The code must never stay in the address bar or the history.
  try { history.replaceState(null, '', loc.pathname + (pending?.back || '#/')) } catch { /* old browser */ }
  if (!pending || Date.now() - pending.at > MAX_AGE_MS) return { ok: false, error: 'the sign-in took too long; start again' }
  const cb = readCallback(address, pending.state)
  if (cb.error) return { ok: false, error: cb.error === 'state' ? 'that sign-in was not started here; start again' : 'the sign-in was cancelled' }
  const r = await exchangeCode({ code: cb.code, verifier: pending.verifier, ...(fetchImpl ? { fetch: fetchImpl } : {}) })
  if (!r.ok) return r
  await save(r.key)
  return { ok: true, back: pending.back }
}

/**
 * Phone: one sign-in attempt, one PKCE pair. `url` goes through the opengym.ch bridge and back
 * into the app; `headlessUrl` has OpenRouter show the code instead. Either way the same verifier
 * redeems it, so a code copied off the bridge page or OpenRouter's own screen works when pasted.
 */
export async function phoneSession({ fetch: fetchImpl } = {}) {
  const p = await makePkce()
  const trade = async code => {
    const r = await exchangeCode({ code, verifier: p.verifier, ...(fetchImpl ? { fetch: fetchImpl } : {}) })
    if (!r.ok) throw new Error(r.error)
    return r.key
  }
  return {
    url: authUrl({ callbackUrl: PHONE_CALLBACK, challenge: p.challenge, state: p.state }),
    headlessUrl: authUrl({ challenge: p.challenge }),
    /** The opengym://openrouter address the browser came back on. */
    finish: async back => {
      const cb = readCallback(back, p.state)
      if (cb.error) throw Object.assign(new Error(cb.error), { code: cb.error === 'denied' || cb.error === 'nocode' ? 'cancelled' : cb.error })
      return trade(cb.code)
    },
    /** A pasted code, or a pasted address with one in it. */
    redeem: async pasted => {
      const code = pastedCode(pasted)
      if (!code) throw Object.assign(new Error('nocode'), { code: 'nocode' })
      return trade(code)
    }
  }
}

/** Phone: the whole sign-in through the system browser. Resolves the key, or throws with `code`
 *  'cancelled' when the person backed out or the way back never came. */
export async function phoneSignIn({ open, fetch: fetchImpl, session } = {}) {
  const sess = session || await phoneSession({ fetch: fetchImpl })
  const opener = open || (async url => (await import('./oidc-app.js')).openForReturn(url, undefined, APP_RETURN))
  return sess.finish(await opener(sess.url))
}
