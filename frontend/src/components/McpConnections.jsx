import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import { REPO } from '../lib/demo.js'
import { suggestMcpHost } from '../lib/mcp-host.js'
import { Section, Row, Button } from './ui.jsx'

// What GET /api/mcp/manage says about the connector: 503 is "this server never enabled it"
// (no MCP_INTERNAL_URL), 502 is "enabled, but the mcp container is not answering".
const serverState = e => e.status === 503 ? 'off' : e.status === 502 ? 'down' : null

// Settings' own entry point: a single row, not the whole connections list — the list lives on
// its own screen (/settings/mcp) so Settings itself doesn't grow with every connection a
// household member adds. When the connector is not running, only an administrator sees the row
// (it leads to the setup guide); everyone else gets nothing, since only the owner can act on it.
export function McpConnectionsRow({ admin = false }) {
  const nav = useNavigate()
  const [state, setState] = useState(null)
  useEffect(() => { api('/api/mcp/manage').then(() => setState('on')).catch(e => setState(serverState(e))) }, [])
  if (!state || (state !== 'on' && !admin)) return null
  return <Section title={t('MCP / AI')}>
    <Row icon="link" iconTint="var(--indigo)" title={t('Connect AI assistants')}
      subtitle={state === 'on' ? t('Claude, ChatGPT and other MCP clients') : t('Not set up yet — see how')} accessory="chevron"
      onClick={() => nav('/settings/mcp')} />
  </Section>
}

export default function McpConnections({ admin = false }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [server, setServer] = useState(null)
  const [notice, setNotice] = useState(null)
  const [busy, setBusy] = useState(false)
  const [reachability, setReachability] = useState('idle')
  const [attempt, setAttempt] = useState(0)
  const load = () => api('/api/mcp/manage')
    .then(value => { setData(value); setError(null); setServer(null) })
    .catch(e => { const state = serverState(e); if (state) { setServer(state); setData(null) } else setError(e.message) })
  useEffect(() => { load() }, [attempt])
  useEffect(() => {
    if (!data?.endpoint) return
    let endpoint
    try { endpoint = new URL(data.endpoint) } catch { setReachability('failed'); return }
    if (endpoint.protocol !== 'https:' || endpoint.origin === window.location.origin) { setReachability('needs-hostname'); return }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    setReachability('checking')
    fetch(new URL('/health', endpoint).href, { cache: 'no-store', signal: controller.signal })
      .then(response => setReachability(response.ok ? 'ready' : 'failed'))
      .catch(() => setReachability('failed'))
      .finally(() => clearTimeout(timer))
    return () => { clearTimeout(timer); controller.abort() }
  }, [data?.endpoint, attempt])
  const retry = () => setAttempt(n => n + 1)
  if (server) {
    if (!admin) return server === 'down' ? <Section title={t('MCP / AI')}><p className="sect-f">{t('The AI connector is not responding. Ask the person who runs this openGym server to check it.')}</p></Section> : null
    return <Section title={t('MCP / AI')}><div style={{ padding: 16 }}><SetupGuide stage={server} onRetry={retry} /></div></Section>
  }
  if (!data && !error) return null
  if (error) return <Section title="MCP"><p className="sect-f">{error}</p></Section>
  const action = async (route, body) => {
    setBusy(true); setNotice(null)
    try { await api('/api/mcp/' + route, { method: 'POST', body: JSON.stringify(body) }); await load() }
    catch (e) { setNotice(e.message) }
    finally { setBusy(false) }
  }
  const revoke = id => action('revoke', { id })
  const approve = id => action('approve', { id })
  const unreachable = reachability === 'needs-hostname' || reachability === 'failed'
  return <Section title={t('MCP / AI')} footer={t('Your passkey protects authorization. Cloudflare Tunnel and other HTTPS reverse proxies are supported.')}>
    <div style={{ padding: 16 }}>
      <strong>{t('Connection URL')}</strong>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}><code style={{ overflowWrap: 'anywhere', flex: 1, minWidth: 0 }}>{data.endpoint}</code><Button style={{ width: 'auto', flexShrink: 0 }} onClick={() => navigator.clipboard.writeText(data.endpoint).then(() => setNotice(t('Copied'))).catch(() => setNotice(t('Select and copy the URL above.')))}>{t('Copy')}</Button></div>
      <p className="muted">{t('Add this URL to an MCP-compatible AI client, then sign in and choose read or write access. Every connection is scoped to your own profile, {0} — no other account on this instance is ever reachable through it.', data.profile.name)}</p>
      {reachability === 'checking' && <p className="muted">{t('Checking MCP setup…')}</p>}
      {reachability === 'ready' && <>
        <p className="muted" role="status">{t('MCP is ready on this domain.')}</p>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <a className="btn plain" href="https://chatgpt.com/plugins" target="_blank" rel="noopener">{t('Add in ChatGPT')}</a>
          <a className="btn plain" href="https://claude.ai/new#customize/connectors" target="_blank" rel="noopener">{t('Add in Claude')}</a>
        </div>
      </>}
      {unreachable && (admin
        ? <div style={{ borderTop: '1px solid var(--sep)', marginTop: 12, paddingTop: 12 }}><SetupGuide stage={reachability} endpoint={data.endpoint} onRetry={retry} /></div>
        : <p className="muted" role="alert">{t('The AI connector is not reachable yet. Ask the person who runs this openGym server to finish its setup.')}</p>)}
    </div>
    {data.connections.map(connection => <div key={connection.id} style={{ padding: 16, borderTop: '1px solid var(--sep)' }}>
      <strong>{connection.name}</strong>
      <p className="muted">{connection.scopes.includes('opengym:write') ? t('Read and write') : t('Read only')}</p>
      {connection.createdAt && <p className="muted">{t('Connected since')}: {new Date(connection.createdAt).toLocaleString()}</p>}
      {connection.lastUsedAt && <p className="muted">{t('Last used')}: {new Date(connection.lastUsedAt).toLocaleString()}</p>}
      <Button variant="danger" disabled={busy} onClick={() => revoke(connection.id)}>{t('Revoke connection')}</Button>
    </div>)}
    {!data.connections.length && <p className="sect-f">{t('No active connections yet.')}</p>}
    {data.pending.map(request => <div key={request.id} style={{ padding: 16, borderTop: '1px solid var(--sep)' }}>
      <strong>{t('Deletion awaiting approval')}</strong>
      <p className="muted">{request.tool}: {request.summary}</p>
      <Button variant="danger" disabled={busy} onClick={() => approve(request.id)}>{t('Approve deletion')}</Button>
    </div>)}
    {notice && <p className="sect-f" role="status">{notice}</p>}
  </Section>
}

const START = 'docker compose --profile mcp up -d --build'

// Step-by-step setup for the server owner, written for someone who has put openGym behind a
// domain once and has not done it twice. `stage` is where the check stopped:
//   off            — the server never enabled the connector (no MCP_INTERNAL_URL)
//   down           — enabled, but the mcp container is not answering
//   needs-hostname — running, but MCP_ORIGIN is missing, not https, or the app's own hostname
//   failed         — MCP_ORIGIN is set, but nothing answers there from this browser
export function SetupGuide({ stage, endpoint, onRetry }) {
  const current = (() => { try { const u = new URL(endpoint); return u.protocol === 'https:' && u.origin !== window.location.origin ? u.host : null } catch { return null } })()
  const host = current || suggestMcpHost(window.location.hostname)
  const code = { display: 'block', overflowWrap: 'anywhere', whiteSpace: 'pre-wrap', margin: '6px 0' }
  const intro = {
    off: 'The AI connector (MCP) is optional and not enabled on this server yet. Follow these steps once, on the machine that runs openGym.',
    down: 'The AI connector is enabled, but its service is not running.',
    'needs-hostname': 'MCP needs its own public HTTPS hostname, separate from openGym.',
    failed: 'The separate MCP hostname is not reachable yet.'
  }[stage]
  return <div role="alert">
    <strong>{t('Set up the AI connector')}</strong>
    <p className="muted">{t(intro)}</p>
    {stage === 'down' ? <>
      <p className="muted">{t('Start it on the server:')}</p>
      <code style={code}>{START}</code>
    </> : <ol className="muted" style={{ paddingLeft: 20, margin: '8px 0' }}>
      <li>{t('Choose a second address just for MCP, for example {0}. It must be different from the openGym address.', host)}</li>
      <li>{t('Point that address at this server, port 8086. With Cloudflare Tunnel: in the Zero Trust dashboard open Networks → Tunnels, edit the tunnel openGym already uses and add a public hostname (in newer dashboards: a published application route) for {0}, with type HTTP and URL localhost:8086.', host)}</li>
      <li>{t('Using Caddy, nginx or another reverse proxy instead? Add a second HTTPS site for {0} that forwards to 127.0.0.1:8086.', host)}</li>
      <li>{t('Do not put Cloudflare Access or any other login page in front of {0}: the AI app must reach it directly, and your passkey already protects every connection. If Access protects openGym itself, add a bypass for exactly {1}.', host, window.location.origin + '/mcp-authorize')}</li>
      <li>{t('Add these lines to the .env file next to docker-compose.yml:')}
        <code style={code}>{`MCP_ORIGIN=https://${host}\nMCP_WEB_PORT=127.0.0.1:8086\nMCP_INTERNAL_URL=http://mcp:3001`}</code></li>
      <li>{t('Apply it (this also restarts openGym with the new settings):')}
        <code style={code}>{START}</code></li>
      <li>{t('Come back here and tap Check again. Once it says ready, the connection URL is {0}.', `https://${host}/mcp`)}</li>
    </ol>}
    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
      <Button style={{ width: 'auto' }} onClick={onRetry}>{t('Check again')}</Button>
      <a className="btn plain" href={`${REPO}/-/blob/main/docs/MCP_REMOTE.md`} target="_blank" rel="noopener">{t('Full guide')}</a>
    </div>
  </div>
}
