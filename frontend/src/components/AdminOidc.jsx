// Admin → "Sign in with your identity provider": what the server was told (OIDC_*) and what it
// found at the provider, with a button that asks again. Renders nothing on an instance without
// OIDC. English only, like the rest of the admin dashboard.
import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import { useStore } from '../store/useStore.js'
import { oidcOn } from '../lib/oidc.js'
import { Button } from './ui.jsx'

const when = ts => (ts ? new Date(ts).toLocaleString() : 'never')
const yes = v => (v ? 'on' : 'off')

export default function AdminOidc() {
  const config = useStore(s => s.config)
  const on = oidcOn(config)
  const [st, setSt] = useState(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (on) api('/api/admin/oidc').then(setSt, e => setErr(e.message)) }, [on])
  if (!on) return null
  const check = () => {
    setBusy(true)
    api('/api/admin/oidc/check', { method: 'POST', body: '{}' }).then(r => { setSt(r); setErr(null) }, e => setErr(e.message)).finally(() => setBusy(false))
  }
  const ok = st && st.reachable && st.keys > 0
  const rows = st ? [
    ['Provider', st.issuer],
    ['Client', st.clientId + (st.confidential ? ' (with a secret)' : ' (public, PKCE only)')],
    ['Redirect URI', st.redirectUri],
    ['Scopes', st.scopes.join(' ')],
    ['Groups claim', st.groupsClaim],
    ['Who may sign up', st.allowedGroups.length ? 'members of ' + st.allowedGroups.join(', ') : st.roleRules ? 'whoever an access= rule lets in' : 'anyone your provider signs in'],
    ['Role map rules', String(st.roleRules)],
    ['Provider only', st.only ? 'on: passkeys and passwords sign in admins only' : 'off'],
    ['Link by verified e-mail', yes(st.linkByEmail)],
    ['Provider logout', st.logout ? 'on' : st.logoutAsked ? 'asked for, but the provider has no end_session_endpoint' : 'off'],
    ['Signing keys', st.keys + (st.algs.length ? ' (' + st.algs.join(', ') + ')' : '')],
    ['Linked profiles', String(st.linked)],
    ['Last good answer', when(st.lastOk)]
  ] : []
  return <div className="card">
    <div className="row between"><h2 style={{ margin: 0 }}>Identity provider</h2>
      <Button size="sm" icon="reset" onClick={check} disabled={busy}>{busy ? 'Checking…' : 'Check now'}</Button></div>
    <div className="adm-lead">
      {!st ? (err || 'Loading…')
        : ok ? 'Sign-in with ' + st.label + ' is working: the provider answered and its signing keys are loaded.'
          : 'The provider has not answered properly yet, so nobody can sign in with ' + st.label + '. The last error says why.'}
    </div>
    {st && st.lastError && <div className="small" role="alert" style={{ color: 'var(--red)', marginBottom: 10 }}>
      Last error ({when(st.lastErrorAt)}): {st.lastError}
    </div>}
    {st && st.plainHttp && <div className="small" style={{ color: 'var(--orange)', marginBottom: 10 }}>
      The provider is on plain http. Fine for a test, but tokens cross the network readable.
    </div>}
    {rows.map(([k, v]) => <div key={k} className="row between" style={{ padding: '6px 0', borderBottom: 'var(--hair) solid var(--sep)', gap: 12 }}>
      <span className="dim small">{k}</span><span className="small" style={{ textAlign: 'end', overflowWrap: 'anywhere' }}>{v}</span>
    </div>)}
  </div>
}
