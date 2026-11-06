// Settings → Account → "Sign in with {provider}": link this profile to the server's identity
// provider (OIDC), or unlink it. Linking asks the same proof as adding a passkey, then goes to
// the provider and back (api/oidc/routes.js); unlinking is refused while it is the last way in.
import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import { oidcOn, oidcLabel, startWebSignIn, oidcArrival, clearOidcArrival, oidcErrorText, oidcOkText } from '../lib/oidc.js'
import { Row } from './ui.jsx'
import { ProveOwner, passwordError } from './PasswordAuth.jsx'

const ui = () => useUI.getState()

export function oidcError(e, label) {
  const code = e?.data?.code
  if (code === 'last-way-in') return t('{0} is the only way into this profile, so it stays linked. Add a passkey first.', label)
  if (code === 'already-linked') return oidcErrorText('already-linked', label)
  return passwordError(e)
}

export function OidcRow({ state, changed }) {
  const config = useStore(s => s.config)
  const user = useStore(s => s.user)
  const [linked, setLinked] = useState(!!user?.oidc)
  useEffect(() => setLinked(!!user?.oidc), [user?.oidc])
  const label = oidcLabel(config)
  // Back from a link or a confirmation: say how it went, once.
  useEffect(() => {
    const a = oidcArrival()
    if (!a || a.ok === 'signed-in') return
    clearOidcArrival()
    if (a.ok === 'linked') setLinked(true)
    const msg = a.error ? oidcErrorText(a.error, label) : oidcOkText(a.ok, label)
    if (msg && a.error !== 'cancelled') ui().toast(msg)
  }, [])
  if (!oidcOn(config) || !user) return null
  const open = () => ui().openSheet(close => <OidcSheet close={close} linked={linked} label={label} state={state}
    unlinked={() => { setLinked(false); changed?.() }} />)
  return <Row icon="shield" iconTint="var(--indigo)" title={t('Sign in with {0}', label)} accessory="chevron"
    subtitle={linked ? t('Linked. {0} signs you in here.', label) : t('Not linked yet.')} onClick={open} />
}

export function OidcSheet({ close, linked, label, state, unlinked }) {
  const passkeys = state?.passkeys?.length || 0
  const password = !!state?.password
  const link = async body => {
    const r = await api('/api/oidc/link', { method: 'POST', body: JSON.stringify(body) })
    startWebSignIn(r.url)
  }
  const unlink = async body => {
    await api('/api/oidc/unlink', { method: 'POST', body: JSON.stringify(body) })
    close(); unlinked?.()
    ui().toast(t('Unlinked. {0} no longer signs you in here.', label))
  }
  if (linked) {
    const last = passkeys === 0 && !password
    return <>
      <h3>{t('Sign in with {0}', label)}</h3>
      <div className="muted small" style={{ marginBottom: 14 }}>{t('This profile is linked to your {0} account, so signing in there signs you in here.', label)}</div>
      {last
        ? <div className="dim small">{t('{0} is the only way into this profile, so it stays linked. Add a passkey first.', label)}</div>
        : <ProveOwner passkey={passkeys > 0} password={password} danger submitText={t('Unlink')} onProof={unlink} explain={e => oidcError(e, label)} />}
    </>
  }
  return <>
    <h3>{t('Sign in with {0}', label)}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>{t('Link your {0} account and sign in with it from now on. Your passkeys keep working too. First a quick check that this is really you.', label)}</div>
    <ProveOwner passkey={passkeys > 0} password={password} submitText={t('Link')} onProof={link} explain={e => oidcError(e, label)} />
  </>
}
