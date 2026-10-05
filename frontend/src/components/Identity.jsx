// A linked identity, next to the passkeys and the code for another device (Settings -> Account):
// the row in both its unlinked ("Link {provider}") and linked states, and the two proof-gated
// sheets that attach or remove it. The rules are the server's (api/identities-store.js and the
// identity block in api/server.js): what needs proof, the last way in, what the row is allowed to
// show. This only words them.
import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { fmtDate } from '../lib/format.js'
import { MOBILE } from '../lib/mobile.js'
import { oidcLinkErrorKey } from '../lib/oidc-link-errors.js'
import { oidcReturnErrorKey } from '../lib/oidc-errors.js'
import { oidcProofErrorKey } from '../lib/oidc-proof-errors.js'
import { oidcLinkStartUrl, removeIdentity, requestLinkTicket, SENTENCE_TOAST_MS } from '../lib/oidc.js'
import { recallProof, forgetProof } from '../lib/pending-proof.js'
import { startProviderLink } from './AppSignIn.jsx'
import { passwordError, ProveOwner, resumePasswordProof, passwordStatus } from './PasswordAuth.jsx'
import { resumePasskeyProof, passkeysState } from './Passkeys.jsx'
import { Row, Button } from './ui.jsx'
import Icon from './Icon.jsx'

const ui = () => useUI.getState()
const toast = m => ui().toast(m)

// The server's refusal in the UI language. `passkeyError` performs the identical delegation for
// its own feature; this one adds the two link-time codes a proof step here can also see.
export function identityError(e) {
  switch (e?.data?.code) {
    case 'last-way-in': return t('This is the only way you can sign in to this profile - removing it is not available.')
    case 'profile-linked': return t(oidcLinkErrorKey('profile-linked'))
    case 'provider-off': return t(oidcLinkErrorKey('provider-misconfigured'))
  }
  return passwordError(e)
}

const PASSKEY_ACTS = new Set(['passkey-add', 'passkey-remove', 'device-link'])
const PASSWORD_ACTS = new Set(['password-remove', 'email', 'email-remove'])

// Opens the removal sheet a proof was pending for, already past its proof step - the only one of
// this module's own two proof-gated changes a provider round trip can be resumed for. Linking has
// no proof step of its own to resume: the option only ever renders once an identity is already
// linked (ProveOwner's identity prop), and a profile cannot link a second one.
export function resumeIdentityProof(act, draft, { state, done }) {
  if (act === 'identity-remove' && state.identity?.usable) {
    ui().openSheet(close => <RemoveIdentitySheet close={close} state={state} done={done} resume />)
    return true
  }
  return false
}

// Reopens the sheet a change was pending for while the browser was away confirming with the
// provider - the one dispatcher every module's own resume opener sits behind (resumePasskeyProof
// in components/Passkeys.jsx, resumePasswordProof in components/PasswordAuth.jsx, and this
// module's own resumeIdentityProof). Answers false with nothing left to reopen: no remembered
// change, no provider configured any more, the account state could not be read, or the change
// itself no longer applies - its own resume opener already said so.
export async function reopenAfterProof(record, { changed, provider }) {
  if (!record || !provider) return false
  const { act, draft } = record
  try {
    if (PASSKEY_ACTS.has(act)) {
      const st = await passkeysState()
      return st ? resumePasskeyProof(act, draft, { st, changed }) : false
    }
    if (PASSWORD_ACTS.has(act)) {
      const status = await passwordStatus()
      return resumePasswordProof(act, draft, { status, done: changed })
    }
    const st = await passkeysState()
    return st ? resumeIdentityProof(act, draft, { state: st, done: changed }) : false
  } catch { return false }
}

// A link or a proof round trip returns to Settings carrying its outcome in the route query - read
// once, acted on, then replaced, so a reload or a back gesture never announces it a second time.
// `oidc-err` is a return the server could not tie to either (the attempt outlived its cookie, or
// the provider was switched off meanwhile), so any change still waiting for a proof is forgotten
// too. Rendered only where provider sign-in is offered or an identity is linked, so nothing else
// in Settings depends on the router's location. `provider` is what reopenAfterProof needs to tell "nothing to reopen" apart from "the
// instance turned the provider off since the round trip started".
export function IdentityReturn({ changed, provider }) {
  const loc = useLocation()
  const nav = useNavigate()
  useEffect(() => {
    const params = new URLSearchParams(loc.search)
    const linkErr = params.get('link-err')
    const proofErr = params.get('proof-err')
    const returnErr = params.get('oidc-err')
    if (params.get('link') === 'ok') { ui().toast(t('Identity linked')); changed() }
    else if (linkErr != null) ui().toast(t(oidcLinkErrorKey(linkErr)), SENTENCE_TOAST_MS)
    else if (params.get('proof') === 'ok') {
      // Fire-and-forget: the route is replaced right away either way, and reopening the sheet
      // (or saying the confirmation expired) happens as soon as the account state answers.
      reopenAfterProof(recallProof(), { changed, provider }).then(opened => {
        if (!opened) ui().toast(t(oidcProofErrorKey('state-expired')))
      })
    }
    else if (proofErr != null) { forgetProof(); ui().toast(t(oidcProofErrorKey(proofErr)), SENTENCE_TOAST_MS) }
    else if (returnErr != null) { forgetProof(); ui().toast(t(oidcReturnErrorKey(returnErr)), SENTENCE_TOAST_MS) }
    else return
    nav('/settings', { replace: true })
  }, [loc.search])
  return null
}

/* ------------------------------------------------------------------- Settings -------------
   Settings -> Account: the linked identity, or the way to attach one. `changed` tells Settings to
   read the account state again, the way removing a passkey or a password already does. `provider`
   is the instance's configured provider, absent when it offers none: an identity linked while it
   did is still listed, so its owner can see it and remove it, but nothing new can be linked. */
export function IdentityRow({ state, provider, changed }) {
  if (!state) return null
  if (!state.identity) {
    if (!provider) return null
    return <Row icon="link" iconTint="var(--indigo)" title={t('Link {0}', provider.name)}
      subtitle={t('Sign in once to attach it - afterwards either credential opens this profile.')}
      accessory="chevron"
      onClick={() => ui().openSheet(close => <LinkIdentitySheet close={close} state={state} provider={provider} />)} />
  }
  const linkedDate = fmtDate(state.identity.linkedAt.slice(0, 10), false, true)
  // An identity that no longer signs in (its provider is gone, or replaced by another) is still
  // listed so its owner can see what is attached and remove it. It never counts as the last way
  // in, since it is not a way in at all.
  const usable = !!state.identity.usable
  const lastWayIn = usable && state.lastWayIn
  return <>
    <Row icon="link" iconTint="var(--indigo)"
      title={state.identity.email || state.identity.providerName || t('Linked identity')}
      subtitle={!usable ? t('This identity can no longer sign in - its provider is not set up on this instance any more.')
        : state.identity.email ? t('{0} - linked {1}', state.identity.providerName, linkedDate)
        : t('Linked {0}', linkedDate)}>
      <button className="iconbtn" aria-label={t('Remove linked identity')} disabled={lastWayIn}
        onClick={ev => { ev.stopPropagation(); ui().openSheet(close => <RemoveIdentitySheet close={close} state={state} done={changed} />) }}>
        <Icon name="trash" />
      </button>
    </Row>
    {lastWayIn && <div className="dim small" style={{ marginTop: 8 }}>
      {t('This is the only way you can sign in to this profile - removing it is not available.')}
    </div>}
  </>
}

/* Linking: the owner's proof first, then straight to the provider - a plain navigation, not a
   second WebAuthn prompt, so nothing here waits for it and nothing here needs a spinner. On the
   phone there is no page to navigate at all - the system browser departs and returns through the
   app's own opengym:// channel (AppSignIn.jsx's startProviderLink), which mints the same kind of
   ticket this sheet's proof already buys on the web, just over the phone's own Bearer session. */
export function LinkIdentitySheet({ close, state, provider, resume = false }) {
  const start = MOBILE
    ? proof => startProviderLink(proof)
    : async proof => {
      const ticket = await requestLinkTicket(proof)
      window.location.href = oidcLinkStartUrl(ticket)
    }
  return <>
    <h3>{t('Link {0}', provider.name)}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>
      {t('Sign in once with {0} to attach it - afterwards either credential opens this profile. First confirm that it is you.', provider.name)}
    </div>
    <ProveOwner passkey={state.passkeys.length > 0} password={state.password}
      identity={!!state.identity} providerName={provider.name} act="identity-link" resume={resume}
      explain={identityError} onProof={start} />
  </>
}

/* Removing asks for the proof linking does (proveOwner in api/server.js): a copied session must
   not take away the owner's way in. The identity being removed may itself supply its own proof -
   the same "any credential of this type proves it, this one included" precedent RemovePasskeySheet
   states for passkeys, applied here without a new rule. */
export function RemoveIdentitySheet({ close, state, done, resume = false }) {
  // Only an identity that still signs in can confirm its own removal.
  const usable = !!state.identity.usable
  const remove = async proof => {
    await removeIdentity(proof)
    close(); done()
    toast(t('Identity removed'))
  }
  return <>
    <h3>{t('Remove this identity?')}</h3>
    <div className="muted small" style={{ marginBottom: 6 }}>
      {usable ? t('You will no longer be able to sign in to this profile with {0}.', state.identity.providerName) : t('This identity can no longer sign in - its provider is not set up on this instance any more.')}
    </div>
    <div className="dim small" style={{ marginBottom: 14 }}>{t('First confirm that it is you.')}</div>
    <ProveOwner passkey={state.passkeys.length > 0} password={state.password}
      identity={usable} providerName={state.identity.providerName} act="identity-remove" resume={resume}
      explain={identityError} danger submitText={t('Remove')} onProof={remove} />
    <div style={{ height: 8 }} />
    <Button type="button" variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}
