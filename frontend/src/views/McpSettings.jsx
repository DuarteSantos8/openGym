import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { copyText } from '../lib/clipboard.js'
import { t, dateLocale } from '../lib/i18n.js'
import { DEMO } from '../lib/demo.js'
import { confirmSheet } from '../sheets.jsx'
import { Section, Row, Button, Switch, TextField, TextArea } from '../components/ui.jsx'

const scopeLabels = {
  'training.read': 'Read training plans and statistics',
  'nutrition.read': 'Read products, diary and nutritional totals',
  'nutrition.write': 'Create, edit and delete food diary entries',
}

/** Account-owned connections and public setup details; server configuration is administrator-only. */
export default function McpSettings() {
  const user = useStore(s => s.user)
  const toast = useUI(s => s.toast)
  const [state, setState] = useState(null)
  const [draft, setDraft] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  const ownerId = user?.id
  const signedIn = !!user && !DEMO
  useEffect(() => {
    let current = true
    setError(''); setState(null); setDraft(null)
    if (signedIn) Promise.all([api('/api/mcp/settings'), api('/api/mcp/connections')])
      .then(([settings, grants]) => {
        if (!current) return
        setState({ ownerId, settings, connections: grants.connections || [] })
        setDraft(settings.saved || null)
      }).catch(() => { if (current) setError(t('Could not load MCP settings. Try again.')) })
    return () => { current = false }
  }, [ownerId, user?.admin, signedIn, revision])
  const loaded = state?.ownerId === ownerId ? state : null
  const copy = async value => { if (await copyText(value)) toast(t('Copied')); else toast(t('Could not copy. Select and copy the value.')) }
  const save = async event => {
    event.preventDefault()
    if (busy || !user?.admin || !draft) return
    setBusy(true); setError('')
    try {
      const result = await api('/api/mcp/settings', { method: 'PUT', body: JSON.stringify({ ...draft,
        clients: draft.clients.map(client => ({ ...client, redirect_uris: client.redirect_uris.map(uri => uri.trim()).filter(Boolean) })) }) })
      if (useStore.getState().user?.id !== ownerId) return
      setState(previous => ({ ...previous, settings: result }))
      setDraft(result.saved)
      toast(t('MCP settings saved'))
    } catch (failure) { setError(failure.message || t('Could not save MCP settings.')) }
    finally { setBusy(false) }
  }
  const revoke = grant => confirmSheet({
    title: t('Revoke MCP access?'),
    message: t('Disconnect {0} from your OpenGym account. It must request your permission again.', grant.clientId),
    confirmText: t('Revoke access'), danger: true,
    onConfirm: async () => {
      if (busy || useStore.getState().user?.id !== ownerId) return
      setBusy(true); setError('')
      try {
        await api('/api/mcp/connections/revoke', { method: 'POST', body: JSON.stringify({ grantId: grant.grantId }) })
        if (useStore.getState().user?.id !== ownerId) return
        setState(previous => ({ ...previous, connections: previous.connections.filter(item => item.grantId !== grant.grantId) }))
        toast(t('MCP access revoked'))
      } catch { setError(t('Could not revoke access. Reload and try again.')) }
      finally { setBusy(false) }
    },
  })
  const changeClient = (index, key, value) => setDraft(previous => ({ ...previous,
    clients: previous.clients.map((client, i) => i === index ? { ...client, [key]: value } : client) }))
  return <>
    <Section title={t('MCP connection')}>
      {!signedIn ? <Row icon="personCircle" title={t('Sign in to manage MCP connections.')} />
        : !loaded ? <div className="mcp-content" role={error ? 'alert' : 'status'}>{error || t('Loading…')}</div> : <>
          <Row icon="cloud" title={t('Remote MCP')} value={loaded.settings.enabled ? t('On') : t('Off')}
            subtitle={!loaded.settings.enabled ? t('Remote MCP is disabled on this server.') : t('Connect an AI client using OAuth; never share your OpenGym session.')} />
          <Row icon="link" title={t('MCP URL')} subtitle={<span className="mcp-value" dir="ltr">{loaded.settings.url}</span>}
            onClick={() => copy(loaded.settings.url)} />
          <Row icon="shield" title={t('Authentication')} value="OAuth + PKCE (S256)" />
          <Row icon="key" title={t('Client secret')} value={t('Not required')} />
          {loaded.settings.clients.map(client => <Row key={client.client_id} icon="clipboard"
            title={client.client_name} subtitle={<span className="mcp-value" dir="ltr">Client ID: {client.client_id}</span>}
            onClick={() => copy(client.client_id)} />)}
          <Row icon="clock" title={t('Calendar timezone')} value={loaded.settings.timezone}
            subtitle={t('Training today uses the server timezone. Nutrition requires an explicit local date.')} />
        </>}
    </Section>
    {signedIn && <>
      {loaded && <Section title={t('Your MCP connections')} footer={t('Only your connections are shown. Signing out everywhere also revokes MCP access.')}>
        {!loaded.connections.length ? <Row title={t('No MCP connections yet.')} /> : loaded.connections.map(grant =>
          <Row key={grant.grantId} icon="shield" title={loaded.settings.clients.find(client => client.client_id === grant.clientId)?.client_name || grant.clientId}
            subtitle={<>{new Date(grant.created).toLocaleString(dateLocale())}<br />{grant.scopes.map(scope => t(scopeLabels[scope] || scope)).join(' · ')}</>}>
            <Button variant="danger" disabled={busy} onClick={() => revoke(grant)}>{t('Revoke access')}</Button>
          </Row>)}
      </Section>}
      {error && loaded && <div className="mcp-content" role="alert">{error}</div>}
      <Button icon="reset" disabled={busy} onClick={() => setRevision(value => value + 1)}>{t('Reload')}</Button>
    </>}
    <Section title={t('Connect ChatGPT or another MCP client')}>
      <div className="mcp-content">
        <ol className="mcp-steps">
          <li>{t('Create a private MCP connection in your AI client using the MCP URL.')}</li>
          <li>{t('Choose OAuth with the configured Client ID, no client secret, and exact callback URL.')}</li>
          <li>{t('Give the callback URL shown by your AI client to the server administrator.')}</li>
          <li>{t('Sign in to OpenGym and approve only the permissions you need.')}</li>
        </ol>
        <p>{t('Access tokens last 10 minutes; connections last up to 30 days. Reconnect after revocation or expiry.')}</p>
      </div>
    </Section>
    <Section title={t('MCP permissions')}>
      {Object.entries(scopeLabels).map(([scope, label]) => <Row key={scope} icon="shield" title={t(label)} subtitle={scope} />)}
    </Section>
    <Section title={t('Using training and Nutrition tools')}>
      <div className="mcp-content">
        <p>{t('Nine read-only training tools share the app calculations. Ask preview_session before advising training weights.')}</p>
        <p>{t('Nutrition searches your personal products and records grams. Clarify product and quantity; do not guess the weight of two eggs.')}</p>
        <p>{t('Read and confirm an entry before deleting it. For an uncertain write, retry the same entry UUID and identical payload; never create a new UUID.')}</p>
        <p>{t('Multiple products are recorded separately, not as one atomic meal. Local stdio remains read-only with nine training tools.')}</p>
      </div>
    </Section>
    {signedIn && user.admin && draft && <Section title={t('MCP server settings')}
      footer={t('These settings override MCP environment defaults after the API restarts. No new container or public port is needed.')}>
      <Row icon="cloud" title={t('Enable remote MCP')}><Switch checked={draft.enabled} disabled={busy}
        aria-label={t('Enable remote MCP')} onChange={enabled => setDraft(previous => ({ ...previous, enabled }))} /></Row>
      <form onSubmit={save}>
        <div className="mcp-content">
          {loaded.settings.restartRequired && <p role="status">{t('Saved changes are pending. Restart the API to apply them.')}</p>}
          <label htmlFor="mcp-public-url">{t('Public MCP URL')}</label>
          <TextField id="mcp-public-url" type="url" required value={draft.url} disabled={busy} dir="ltr"
            onChange={event => setDraft(previous => ({ ...previous, url: event.target.value }))} />
          <p className="muted small">{t('Use the existing OpenGym HTTPS origin and a path ending in /mcp. HTTP is only for localhost testing.')}</p>
          {draft.clients.map((client, index) => <fieldset key={index} disabled={busy} className="mcp-client">
            <legend>{t('OAuth client')} {index + 1}</legend>
            <label htmlFor={'mcp-client-id-' + index}>Client ID</label>
            <TextField id={'mcp-client-id-' + index} required dir="ltr" value={client.client_id}
              onChange={event => changeClient(index, 'client_id', event.target.value)} />
            <label htmlFor={'mcp-client-name-' + index}>{t('Client name')}</label>
            <TextField id={'mcp-client-name-' + index} value={client.client_name}
              onChange={event => changeClient(index, 'client_name', event.target.value)} />
            <label htmlFor={'mcp-callbacks-' + index}>{t('Callback URLs')}</label>
            <TextArea id={'mcp-callbacks-' + index} required dir="ltr" rows={3} value={client.redirect_uris.join('\n')}
              onChange={event => changeClient(index, 'redirect_uris', event.target.value.split('\n'))} />
            <p className="muted small">{t('One exact trusted HTTPS callback per line, copied from the client. No wildcards or client secrets.')}</p>
            <Button type="button" variant="danger" onClick={() => setDraft(previous => ({ ...previous,
              clients: previous.clients.filter((_, i) => i !== index) }))}>{t('Remove client')}</Button>
          </fieldset>)}
          <div className="mcp-actions">
            <Button type="button" icon="plus" disabled={busy || draft.clients.length >= 10} onClick={() => setDraft(previous => ({ ...previous,
              clients: [...previous.clients, { client_id: '', client_name: '', redirect_uris: [''] }] }))}>{t('Add OAuth client')}</Button>
            <Button type="submit" variant="primary" disabled={busy}>{busy ? t('Saving…') : t('Save MCP settings')}</Button>
          </div>
          <p className="muted small">{t('After saving, the administrator must restart the API container. Disabling MCP does not delete existing grants; revoke them separately.')}</p>
        </div>
      </form>
    </Section>}
  </>
}
