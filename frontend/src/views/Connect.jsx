// The consent screen of the MCP endpoint's OAuth (api/oauth.js). An AI client sends the browser to
// GET /api/oauth/authorize, which lands here as #/connect?<the authorization request>. Signing in
// is the app's own: a signed-out visitor sees the login screen first (App.jsx renders it in place
// of every route) and comes back to this one, so a passkey or a password works the same as always.
import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import { Button } from '../components/ui.jsx'

const wrap = { display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: '70vh', textAlign: 'center' }

export default function Connect() {
  const user = useStore(s => s.user)
  const setGuest = useStore(s => s.setGuest)
  const { search } = useLocation()
  const q = Object.fromEntries(new URLSearchParams(search))
  const [client, setClient] = useState(null)   // { name, redirect_host } once checked, { error } if not
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!user) return
    api('/api/oauth/client?' + new URLSearchParams({ client_id: q.client_id || '', redirect_uri: q.redirect_uri || '' }))
      .then(setClient, () => setClient({ error: t('This connection request is not valid. Start again from the app you were connecting.') }))
  }, [search, user])

  // A guest has no profile on the server to hand out.
  if (!user) return (
    <div className="narrow" style={wrap}>
      <h2>{t('Connect an AI app')}</h2>
      <div className="muted" style={{ marginBottom: 24 }}>{t('Sign in with your profile to connect an AI app to it.')}</div>
      <Button variant="primary" onClick={() => setGuest(false)}>{t('Sign in')}</Button>
    </div>
  )
  if (!client) return <div className="narrow" style={wrap} />
  if (client.error) return <div className="narrow" style={wrap}><div className="card small muted">{client.error}</div></div>

  const allow = async () => {
    setBusy(true)
    try {
      const r = await api('/api/oauth/approve', { method: 'POST', body: JSON.stringify(q) })
      window.location.assign(r.redirect)
    } catch (e) {
      setClient({ error: e.message })
      setBusy(false)
    }
  }
  // RFC 6749 §4.1.2.1: the client hears the refusal at the redirect URI the server just vouched for.
  const deny = () => {
    const back = new URL(q.redirect_uri)
    back.searchParams.set('error', 'access_denied')
    if (q.state) back.searchParams.set('state', q.state)
    window.location.assign(back.href)
  }

  return (
    <div className="narrow" style={wrap}>
      <h2>{t('Connect {0}?', client.name)}</h2>
      <div className="muted" style={{ marginBottom: 14 }}>
        {t('{0} will be able to read the routines, workouts, body weight and progress of {1}. It cannot change anything.', client.name, user.name)}
      </div>
      <div className="dim small" style={{ marginBottom: 26 }}>{t('You will be sent back to {0}. "Sign out everywhere" in Settings disconnects it again.', client.redirect_host)}</div>
      <Button variant="primary" disabled={busy} onClick={allow}>{t('Allow')}</Button>
      <div style={{ height: 10 }} />
      <Button disabled={busy} onClick={deny}>{t('Cancel')}</Button>
    </div>
  )
}
