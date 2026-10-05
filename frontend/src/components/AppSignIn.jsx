// The phone app's own side of sign-in through the server's provider (see lib/oidc-app.js for the
// pure verifier/challenge/return-parsing core this wires up, and lib/mobile.js's onAppUrlOpen for
// the native listener). The departure leaves the app for the system browser with a plain
// navigation - the Capacitor shell hands any address outside the app's own bundled origin to the
// system browser, no plugin needed - and the return arrives through the opengym:// scheme
// registered on both native shells.
import { useEffect, useState } from 'react'
import { appRedeem, appConfirm } from '../lib/api.js'
import { onAppActive, onAppUrlOpen } from '../lib/mobile.js'
import { beginAttempt, appStartUrl, finishAppReturn, peekAttempt, takeAttempt } from '../lib/oidc-app.js'
import { oidcErrorKey } from '../lib/oidc-errors.js'
import { oidcLinkErrorKey } from '../lib/oidc-link-errors.js'
import { oidcProofErrorKey } from '../lib/oidc-proof-errors.js'
import { requestLinkTicket, requestProofTicket, SENTENCE_TOAST_MS } from '../lib/oidc.js'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { askAddDeviceData } from '../sheets.jsx'
import { Button } from './ui.jsx'

// Leaves the app for the system browser at the given server's app-flavoured start route, carrying
// an S256 challenge this phone computed itself with WebCrypto. A plain navigation, not a fetch:
// the address is outside the app's own origin, so the native shell hands it to the system browser.
export async function startProviderSignIn(base) {
  const { challenge } = await beginAttempt({ base, mode: 'signIn' })
  window.location.href = appStartUrl(base, 'signIn', { challenge })
}

// Link and proof both run over the paired server this phone already holds a session for - the
// system browser they depart to has no session of its own, which is exactly why each buys a
// ticket first, over that Bearer session, before ever leaving the app.
const notPaired = () => Object.assign(new Error(t('This phone is not connected to a server.')), { code: 'not-paired', status: 0 })

// Links an identity from the paired phone: the owner's proof (already confirmed by the ProveOwner
// sheet that calls this) buys a one-shot link ticket over the Bearer session, carrying this
// phone's own S256 challenge, then the app leaves for the provider exactly as a sign-in does. A
// ticket refusal (already linked, provider off) never leaves - takeAttempt discards the attempt
// this call began, and the refusal itself is rethrown to the sheet that asked, which already
// shows it through its own explain().
export async function startProviderLink(proof) {
  const base = useStore.getState().sync?.server
  if (!base) throw notPaired()
  const { challenge } = await beginAttempt({ base, mode: 'link' })
  let ticket
  try {
    ticket = await requestLinkTicket({ ...proof, challenge })
  } catch (e) {
    takeAttempt()
    throw e
  }
  window.location.href = appStartUrl(base, 'link', { ticket })
}

// One waiter per in-flight proof act: the sheet that asked for it, woken with the one-shot proof
// id once the system browser comes back. A phone only ever has one departure in flight at a time
// (beginAttempt replaces any earlier one outright), so one waiter is all an act ever needs.
const proofWaiters = new Map()

// Starts the provider proof ProveOwner's own identity option offers on the phone: buys a one-shot
// proof ticket for `act` over the Bearer session, carrying this phone's own S256 challenge, only
// then registers the one waiter that will receive the proof id, and leaves for the provider. A
// ticket refusal registers no waiter at all and takes the attempt back out (takeAttempt) before
// rethrowing to the caller, which already shows it through explain() exactly as the web's own
// ticket refusal does. Resolves to the unsubscribe the caller keeps for its own unmount - removing
// a waiter nobody is listening for any more is a no-op, never an error.
export async function startProviderProof(act, onProof) {
  const base = useStore.getState().sync?.server
  if (!base) throw notPaired()
  const { challenge } = await beginAttempt({ base, mode: 'proof', act })
  let ticket
  try {
    ticket = await requestProofTicket(act, challenge)
  } catch (e) {
    takeAttempt()
    throw e
  }
  proofWaiters.set(act, onProof)
  window.location.href = appStartUrl(base, 'proof', { ticket })
  return () => { if (proofWaiters.get(act) === onProof) proofWaiters.delete(act) }
}

// Subscribers told once an identity was linked through the app channel - Settings' own Account
// section refreshes its rows on this, the same way it already refreshes after a passkey or
// password change, without needing a route to read the outcome back from (the app never leaves
// the screen a link sheet is open on).
const identityChangedListeners = new Set()
export function onIdentityChanged(cb) {
  identityChangedListeners.add(cb)
  return () => identityChangedListeners.delete(cb)
}

// How long to wait, once the app is back in the foreground, before deciding a departed attempt
// was abandoned - long enough that the return address and the foreground event, which can arrive
// in either order, both have time to settle.
export const ATTEMPT_UNFINISHED_GRACE_MS = 1500

// Reports whether this phone's own attempt of `mode` was left unfinished: the app came back to
// the foreground, the grace period passed, and the attempt this phone is holding (lib/oidc-app.js)
// is still the one of that mode - nobody redeemed it and nothing replaced it. Never touches the
// attempt itself: going back to the browser can still finish it. The caller resets the flag the
// moment it starts a fresh attempt (the second element of the return value), so a quiet note from
// an earlier attempt never lingers once another departure begins. Every sheet this hook is
// mounted in (the connect screen, every "confirm it is you" sheet) can be opened and closed many
// times in one app session, so the foreground listener and the grace-period timer both have to
// go when the sheet does - otherwise each mount leaks one more listener, still running
// setTimeout/setState against a component nobody can see any more.
export function useAttemptUnfinished(mode) {
  const [unfinished, setUnfinished] = useState(false)
  useEffect(() => {
    let timer = null
    const off = onAppActive(() => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        const attempt = peekAttempt()
        setUnfinished(!!attempt && attempt.mode === mode)
      }, ATTEMPT_UNFINISHED_GRACE_MS)
    })
    return () => { clearTimeout(timer); off?.() }
  }, [mode])
  return [unfinished, () => setUnfinished(false)]
}

// The phone's own naming screen for an identity nobody has linked yet - the in-app counterpart to
// views/Login.jsx's ConfirmProfileScreen, finished with the one-shot handle the redeem answered
// with instead of the web's waiting-identity cookie. Mirrors that screen's validation and error
// handling exactly: an empty name or a missing invite code sends nothing, and a refusal from the
// server is worded through the same error table and stays open on the sheet so it can be retried.
export function AppConfirmSheet({ close, base, handle, name, invite }) {
  const [typedName, setTypedName] = useState(name || '')
  const [code, setCode] = useState('')
  const go = async () => {
    const n = typedName.trim()
    if (!n) { useUI.getState().toast(t('Enter a name')); return }
    if (invite && !code.trim()) { useUI.getState().toast(t('An invite code is required')); return }
    try {
      const { token, user } = await appConfirm(base, { handle, name: n, code })
      await useStore.getState().connectViaProvider(base, { token, user }, askAddDeviceData)
      useUI.getState().closeAll()
      useUI.getState().toast(t('Connected'))
    } catch (e) {
      useUI.getState().toast(t(oidcErrorKey(e.data?.code || e.code)), SENTENCE_TOAST_MS)
    }
  }
  return <>
    <h3>{t('Confirm your name')}</h3>
    <div className="muted" style={{ marginBottom: 14 }}>
      {t("You're creating a NEW, empty profile on this server. If you already have one, go back and pair this phone from a browser where you are signed in.")}
    </div>
    <input className="input" maxLength={40} value={typedName} onChange={e => setTypedName(e.target.value)} />
    {invite && <>
      <div style={{ height: 10 }} />
      <input className="input" placeholder={t('Invite code')} maxLength={40} value={code}
        onChange={e => setCode(e.target.value.toUpperCase())} style={{ letterSpacing: '.14em', fontWeight: 600, textAlign: 'center' }} />
      <div className="dim small" style={{ marginTop: 6 }}>{t('This app is invite-only — enter the code you were given.')}</div>
    </>}
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={go}>{t('Create profile')}</Button>
    <div style={{ height: 10 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t("This isn't me - go back")}</Button>
  </>
}

let listening = false
// Registers the one appUrlOpen listener the whole app needs, idempotently - App.jsx calls this
// once, on the mobile build only. finishAppReturn's own attempt store spends itself on the first
// read, so one return is handled at a time: a duplicate delivery of the same intent, or a return
// that arrives while this phone holds no attempt of its own, finds nothing to redeem.
export function listenForProviderReturn() {
  if (listening) return
  listening = true
  onAppUrlOpen(url => {
    finishAppReturn(url, {
      // A sign-in redeem carries no bearer of its own; a re-auth redeem (a later plan's own
      // screen) shares this same tail and sends the phone's own (now-refused) remote token
      // alongside the new attempt's credential instead.
      redeem: (base, body, attempt) => appRedeem(base, body, { session: attempt.mode !== 'signIn' })
    }).then(async outcome => {
      if (outcome.kind === 'signed-in') {
        try {
          await useStore.getState().connectViaProvider(outcome.base, { token: outcome.token, user: outcome.user }, askAddDeviceData)
          useUI.getState().closeAll()
          useUI.getState().toast(t('Connected'))
        } catch (e) {
          useUI.getState().toast(e.message || t('Could not connect'))
        }
      } else if (outcome.kind === 'confirm') {
        useUI.getState().closeAll()
        useUI.getState().openSheet(close => (
          <AppConfirmSheet close={close} base={outcome.base} handle={outcome.handle} name={outcome.name} invite={outcome.invite} />
        ))
      } else if (outcome.kind === 'linked') {
        useUI.getState().toast(t('Identity linked'))
        useUI.getState().closeAll()
        identityChangedListeners.forEach(cb => cb())
      } else if (outcome.kind === 'proof') {
        const waiter = proofWaiters.get(outcome.act)
        if (waiter) {
          proofWaiters.delete(outcome.act)
          waiter(outcome.proof)
        } else {
          // The sheet that asked for this proof already closed, or the app was restarted since -
          // nobody is left to hand the proof id to, so it is simply dropped.
          useUI.getState().toast(t(oidcProofErrorKey('state-expired')), SENTENCE_TOAST_MS)
        }
      } else if (outcome.kind === 'failed') {
        // Each mode is worded by its own table: the same code means something different to a
        // visitor signing in than to an owner linking an identity or confirming it is them.
        const errorKey = outcome.mode === 'link' ? oidcLinkErrorKey : outcome.mode === 'proof' ? oidcProofErrorKey : oidcErrorKey
        useUI.getState().toast(t(errorKey(outcome.code)), SENTENCE_TOAST_MS)
      }
      // 'none': not a return this app made, or no attempt of this phone's own is in flight -
      // nothing to show, nothing to redeem.
    })
  })
}
