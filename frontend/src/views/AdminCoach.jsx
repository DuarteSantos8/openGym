import { useEffect, useState } from 'react'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import Icon from '../components/Icon.jsx'
import { Button, Switch, TextField } from '../components/ui.jsx'

/* The operator's side of the Coach, laid out as a guided setup: one master switch, numbered
   steps that each say what they are for, and everything an owner rarely needs folded away
   under "Advanced" and "Activity". Like the rest of the admin dashboard this is deliberately
   English-only — it isn't part of the translated end-user surface.

   What it never shows: anybody's intake answers, payloads or proposals. An admin can enable
   the feature and see that jobs ran; they cannot read what their users asked it.

   This is the ONLY place the Coach can be switched off for everyone. Users can decline the
   consent screen for themselves, but they cannot disable the feature — that is an operator
   decision, so it lives with the operator. */

const rel = ts => {
  if (!ts) return 'never'
  const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return Math.floor(s / 60) + ' min ago'
  if (s < 86400) return Math.floor(s / 3600) + ' h ago'
  return Math.floor(s / 86400) + ' d ago'
}

// Which chips go under which heading. Runtime-backed providers are the ones that need the
// bigger `coach` image; the fixture exists so the whole loop can be walked without any account.
const RUNTIME_IDS = ['claude', 'codex']
const TESTING_IDS = ['fixture']

export default function AdminCoach() {
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const [d, setD] = useState(null)
  const [busy, setBusy] = useState(false)
  // The models the endpoint serves, fetched on demand. Seeded from the status call when the
  // stored key already let it list them.
  const [models, setModels] = useState(null)
  // The last "Test the Coach" outcome, shown inline where the button is rather than only as a
  // toast that is gone before anyone has read the provider's reason.
  const [testResult, setTestResult] = useState(null)

  const load = () => api('/api/admin/coach').then(r => { setD(r); setModels(r.knownModels || null) }).catch(e => toast(e.message || 'Failed to load'))
  useEffect(() => { load() }, [])

  const patch = async body => {
    setBusy(true)
    try { await api('/api/admin/coach/config', { method: 'POST', body: JSON.stringify(body) }); await load() }
    catch (e) { toast(e.message) }
    setBusy(false)
  }
  const loadModels = async () => {
    setBusy(true)
    try {
      const r = await api('/api/admin/coach/models', { method: 'POST', body: '{}' })
      if (r.ok) { setModels(r.models); toast(r.models.length + ' models') } else toast(r.error || 'Could not list models')
    } catch (e) { toast(e.message) }
    setBusy(false)
  }
  const test = async () => {
    setBusy(true); setTestResult({ pending: true })
    try {
      const r = await api('/api/admin/coach/test', { method: 'POST', body: '{}' })
      setTestResult(r)
      toast(r.ok ? 'Coach test passed ✅' : 'Test failed')
      await load()
    } catch (e) { setTestResult({ ok: false, error: e.message }); toast(e.message) }
    setBusy(false)
  }
  const disconnect = async () => {
    setBusy(true)
    try { await api('/api/admin/coach/disconnect', { method: 'POST', body: JSON.stringify({ provider: d.provider }) }); toast('Credential removed'); await load() }
    catch (e) { toast(e.message) }
    setBusy(false)
  }

  if (!d) return <div className="card"><div className="muted small">Loading Coach status…</div></div>

  if (d.disabledByEnv) return <div className="card">
    <h2 style={{ margin: '0 0 6px' }}>AI Coach</h2>
    <div className="adm-lead">Force-disabled by <code>COACH_DISABLED</code> in the server's environment. Remove that variable and restart to configure the Coach here.</div>
  </div>

  const meta = d.providers.find(p => p.id === d.provider) || {}
  const authState = d.auth?.state
  const authed = authState === 'connected' || authState === 'not-required' || authState === 'optional'
  const needsEndpoint = !!meta.baseUrl
  const hasEndpoint = !needsEndpoint || !!d.baseUrl
  const live = d.enabled && d.runtime.ok && authed && hasEndpoint

  const status = !d.enabled ? 'Off — users see no Coach anywhere in the app.'
    : live ? <>On · {meta.label}{d.model ? ' · ' + d.model : ''}</>
      : !hasEndpoint ? 'On, but no endpoint yet — finish step 2.'
        : !authed ? 'On, but no credential yet — finish the Credential step.'
          : !d.runtime.ok ? 'On, but the provider cannot be reached — see the Test step.'
            : 'On'

  // Chips, grouped.
  const groups = [
    { title: 'Paste an API key', hint: 'Plain HTTPS to the provider. Works on the default api image — nothing extra to install.', items: d.providers.filter(p => p.http) },
    { title: 'Runs a local AI runtime', hint: 'Needs the bigger api image built with --target coach.', items: d.providers.filter(p => RUNTIME_IDS.includes(p.id)) },
    { title: 'Testing', hint: 'A built-in fake that answers instantly, so the whole loop can be tried without an account.', items: d.providers.filter(p => TESTING_IDS.includes(p.id)) }
  ]

  const hasCredentialStep = !!(meta.setupToken || meta.apiKey)
  const step1Done = !!d.provider
  const step2Done = hasEndpoint
  const step3Done = authed
  const step4Done = !!d.model
  const step5Done = !!testResult?.ok || !!d.lastSuccess
  // Step numbers only count the steps this provider actually shows — and like any wizard,
  // only the first unfinished step stands open; everything done folds to its summary line.
  const flags = [step1Done, ...(needsEndpoint ? [step2Done] : []), ...(hasCredentialStep ? [step3Done] : []), step4Done, step5Done]
  const doneCount = flags.filter(Boolean).length
  const firstTodo = flags.indexOf(false)
  let n = 1
  let idx = 0
  const num = () => n++
  const stepAt = () => { const i = idx++; return { open: i === (firstTodo === -1 ? -1 : firstTodo), key: i + ':' + (i === firstTodo) } }

  // Off = a quiet, optional feature: one clean pitch and one button, no half-dimmed controls.
  if (!d.enabled) return <div className="card">
    <div className="adm-hero">
      <div className="adm-hero-av"><Icon name="sparkles" /></div>
      <h2>AI Coach</h2>
      <p>An optional coach that designs training plans and reviews what people actually log. Off right now — nobody sees it anywhere in the app.</p>
      <div className="adm-hero-feats">
        <div><Icon name="clipboard" /><span><b>Bring any AI.</b> An API key from Anthropic, OpenAI or Gemini — or a free local model via Ollama.</span></div>
        <div><Icon name="shield" /><span><b>Private by design.</b> A strict allowlist decides what leaves; every change needs the user's yes and can be undone.</span></div>
        <div><Icon name="person" /><span><b>Each user decides.</b> Turning it on only makes the Coach available; every person consents for themselves.</span></div>
      </div>
      <Button variant="primary" icon="sparkles" disabled={busy} onClick={() => patch({ enabled: true })}>Set up the Coach</Button>
    </div>
  </div>

  return <div className="card" style={{ borderColor: live ? 'var(--acc)' : undefined }}>
    <div className="row between" style={{ marginBottom: 2 }}>
      <h2 style={{ margin: 0 }}>AI Coach</h2>
      <Switch checked={!!d.enabled} disabled={busy} onChange={v => patch({ enabled: v })} />
    </div>
    <div className="adm-status">
      <span className={'adm-pill ' + (live ? 'ok' : 'warn')}>{live ? 'ready' : 'not ready'}</span>
      <span>{status}</span>
    </div>
    {!live && <div className="adm-progress" aria-hidden="true"><i style={{ width: Math.round(doneCount / flags.length * 100) + '%' }} /></div>}
    <div className="adm-lead">
      {live ? 'Users find the Coach under Plan → Coach. This switch is the only place it can be turned off for everyone.'
        : `${doneCount} of ${flags.length} steps done — finish the open step and the next one unfolds.`}
    </div>

    {d.enabled && <>
      {/* ---------- provider ---------- */}
      <Step n={num()} title="Provider" hint={meta.label || 'Which AI answers the Coach'} done={step1Done} {...stepAt()}>
        <div className="adm-hint">Pick who answers. A key or token you save stays with its provider, so you can switch back and forth without pasting it again.</div>
        {groups.map(g => !!g.items.length && <div key={g.title} className="adm-group">
          <div className="adm-group-t">{g.title}</div>
          <div className="adm-chips">
            {g.items.map(p => <button key={p.id} className={'chip' + (p.id === d.provider ? ' on' : '')} disabled={busy}
              onClick={() => { setTestResult(null); patch({ provider: p.id }) }}>
              {p.label}{p.connected && <span className="adm-chip-key">key saved</span>}
            </button>)}
          </div>
          <div className="adm-hint" style={{ margin: '6px 0 0' }}>{g.hint}</div>
        </div>)}
      </Step>

      {/* ---------- endpoint (compatible only) ---------- */}
      {needsEndpoint && <Step n={num()} title="Endpoint" hint={d.baseUrl || 'Where the model runs'} done={step2Done} {...stepAt()}>
        <div className="adm-hint">The address of any server that speaks OpenAI's chat API: <b>Ollama</b>, <b>LM Studio</b>, <b>vLLM</b>, <b>OpenRouter</b>, or a gateway of your own. Just the base — no <code>/v1</code>, no key in the URL.</div>
        <div className="adm-field">
          <label>Base URL</label>
          <TextField key={d.baseUrl || ''} defaultValue={d.baseUrl || ''} placeholder="http://ollama:11434  or  https://openrouter.ai/api" inputMode="url" autoCapitalize="none" autoCorrect="off"
            onBlur={e => e.target.value !== (d.baseUrl || '') && patch({ baseUrl: e.target.value })} />
        </div>
        <div className="adm-hint" style={{ margin: 0 }}>The host is written to the job log, so you can always see where requests went.</div>
      </Step>}

      {/* ---------- credential ---------- */}
      {hasCredentialStep && <Step n={num()} title="Credential" hint={credentialHint(d.auth, meta)} done={step3Done} {...stepAt()}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          <CredentialPill auth={d.auth} />
        </div>
        {authState === 'connected' ? <>
          <div className="adm-hint">Connected{d.auth.account ? ' as ' + d.auth.account : ''} via {credentialLabel(d.auth.type)}{d.auth.connectedAt ? ' · added ' + rel(d.auth.connectedAt) : ''}. The key is stored encrypted and is never shown again.</div>
          <div className="adm-actions">
            {meta.apiKey && <Button size="sm" variant="tinted" icon="lock" disabled={busy}
              onClick={() => openSheet(close => <ApiKeySheet close={close} onDone={load} label={meta.label} placeholder={meta.keyPlaceholder} optional={meta.keyOptional} />)}>Replace key</Button>}
            <Button size="sm" danger disabled={busy} onClick={disconnect}>Remove</Button>
          </div>
        </> : <>
          {authState === 'unreadable' && <div className="adm-hint" style={{ color: 'var(--red)' }}>
            The stored credential can't be decrypted. This usually means <code>./data</code> was restored without its <code>secret</code> file. Add the key again to fix it.
          </div>}
          {authState === 'optional' && <div className="adm-hint">This endpoint works without a key. Add one only if your server asks for it (OpenRouter does; a model on your own network usually does not).</div>}
          {authState === 'none' && <div className="adm-hint">{meta.setupToken
            ? 'Paste either a Claude Code setup token (your subscription) or an Anthropic API key (pay per use).'
            : 'Paste an API key from the provider\'s console. It is stored encrypted on this server and sent to the provider only while a job runs.'}</div>}
          <div className="adm-actions">
            {meta.setupToken && <Button size="sm" variant="primary" icon="key" disabled={busy}
              onClick={() => openSheet(close => <SetupTokenSheet close={close} onDone={load} label={meta.label} />)}>Add Claude Code token</Button>}
            {meta.apiKey && <Button size="sm" variant={meta.setupToken ? undefined : 'primary'} icon="lock" disabled={busy}
              onClick={() => openSheet(close => <ApiKeySheet close={close} onDone={load} label={meta.label} placeholder={meta.keyPlaceholder} optional={meta.keyOptional} />)}>
              {meta.keyOptional ? 'Add API key (optional)' : 'Add API key'}</Button>}
          </div>
        </>}
      </Step>}

      {/* ---------- model ---------- */}
      <Step n={num()} title="Model" hint={d.model || (meta.defaultModel ? 'default: ' + meta.defaultModel : 'not chosen yet')} done={step4Done} {...stepAt()}>
        <div className="adm-hint">{meta.http
          ? 'Which model the provider should use. "List models" asks the provider for its current list, so nothing here goes stale.'
          : 'Optional. Leave it empty to use the runtime\'s own default.'}</div>
        <div className="adm-field">
          <label>Model</label>
          {models && models.length
            ? <select className="adm-select" value={models.includes(d.model) ? d.model : ''} disabled={busy} onChange={e => patch({ model: e.target.value })}>
              <option value="">{meta.defaultModel ? `Default (${meta.defaultModel})` : 'Pick a model…'}</option>
              {d.model && !models.includes(d.model) && <option value={d.model}>{d.model} (not in the list)</option>}
              {models.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            : <TextField key={d.provider} defaultValue={d.models?.[d.provider] || ''} placeholder={meta.defaultModel ? `Default: ${meta.defaultModel}` : needsEndpoint ? 'e.g. qwen2.5:3b — or press "List models"' : '(runtime default)'}
              onBlur={e => e.target.value !== (d.models?.[d.provider] || '') && patch({ model: e.target.value })} />}
        </div>
        {meta.http && <div className="adm-actions">
          <Button size="sm" variant="tinted" icon="reset" disabled={busy} onClick={loadModels}>{models ? 'Refresh list' : 'List models'}</Button>
          {models && models.length ? <span className="dim small" style={{ alignSelf: 'center' }}>{models.length} served by the provider</span> : null}
        </div>}
      </Step>

      {/* ---------- test ---------- */}
      <Step n={num()} title="Test" hint={step5Done ? 'passed' : 'one real round trip, no user data'} done={step5Done} {...stepAt()} forceOpen={!!testResult}>
        <div className="adm-hint">Sends one tiny question to the provider and checks the answer. No training data is involved. Do this after every change above.</div>
        <div className="adm-actions">
          <Button size="sm" variant="primary" icon="check" disabled={busy || !authed || !hasEndpoint} onClick={test}>Test the Coach</Button>
        </div>
        {(!authed || !hasEndpoint) && <div className="adm-hint" style={{ margin: '6px 0 0' }}>
          {!hasEndpoint ? 'Finish the Endpoint step first.' : 'Finish the Credential step first.'}
        </div>}
        {testResult && <div className={'adm-result ' + (testResult.pending ? '' : testResult.ok ? 'ok' : 'bad')}>
          {testResult.pending ? 'Asking the provider…'
            : testResult.ok ? <><b>Passed</b>{testResult.version ? 'Provider: ' + testResult.version : 'The provider answered as expected.'}</>
              : <><b>Failed</b>{testResult.error || 'No answer from the provider.'}</>}
        </div>}
        <div className="adm-kv" style={{ marginTop: 10 }}>
          <span className="k">Runtime</span>
          <span className="v">{d.runtime.ok ? <span className="adm-pill ok">ready</span> : <span className="adm-pill bad">missing</span>}{d.runtime.version ? <div className="dim small">{d.runtime.version}</div> : null}{!d.runtime.ok && d.runtime.error ? <div className="small" style={{ color: 'var(--red)' }}>{d.runtime.error}</div> : null}</span>
        </div>
      </Step>

      {/* ---------- advanced ---------- */}
      <details className="adm-fold">
        <summary>Advanced <Icon name="chevronRight" className="chev" /></summary>
        <div className="adm-fold-b">
          <div className="adm-group-t">Limits</div>
          <div className="adm-hint">How many Coach runs are allowed per day. Every run is one request on the provider account above. 0 means no limit.</div>
          <div className="adm-kv"><span className="k">Per user, per day</span>
            <span className="v"><input className="num" type="number" min="0" max="200" defaultValue={d.caps.perProfileDaily} disabled={busy}
              onBlur={e => +e.target.value !== d.caps.perProfileDaily && patch({ caps: { ...d.caps, perProfileDaily: +e.target.value } })} /></span></div>
          <div className="adm-kv"><span className="k">Whole instance, per day</span>
            <span className="v"><input className="num" type="number" min="0" max="5000" defaultValue={d.caps.instanceDaily} disabled={busy}
              onBlur={e => +e.target.value !== d.caps.instanceDaily && patch({ caps: { ...d.caps, instanceDaily: +e.target.value } })} /></span></div>

          <div className="adm-group-t" style={{ marginTop: 14 }}>Compare with others</div>
          <div className="row between" style={{ gap: 12, alignItems: 'flex-start' }}>
            <div className="adm-hint" style={{ margin: 0 }}>
              <b>Let people compare with each other.</b> Anonymous medians (estimated 1RM, sessions per week) across profiles that opt in; at least three must share before anyone sees a number. Each person switches themselves on in the Coach chat, and sees nothing unless they do.
            </div>
            <Switch checked={!!d.community} disabled={busy} onChange={v => patch({ community: v })} />
          </div>

          <div className="adm-group-t" style={{ marginTop: 14 }}>Whose account pays</div>
          <div className="adm-hint">{d.authMode === 'profile'
            ? 'Each profile signs in with their own account.'
            : d.auth?.type === 'apikey' || meta.http
              ? 'One API key for the whole instance: every profile may use the Coach with it, and the daily limits above are what bound the spend.'
              : d.boundUid
                ? 'One personal account, already in use by one profile. Every other profile is refused, so nobody spends somebody else\'s subscription.'
                : 'One personal account. The first profile to use it becomes the only one allowed to — every other profile is then refused. Paste an API key instead if the whole instance should have the Coach.'}</div>

          <div className="adm-group-t" style={{ marginTop: 14 }}>Isolation</div>
          <div className="adm-hint">{d.unprivileged && !d.unprivileged.ok
            ? <span style={{ color: 'var(--red)' }}>Jobs are blocked: {d.unprivileged.why}. Nothing runs until this is fixed.</span>
            : d.unprivileged?.dropped
              ? 'Jobs run as a separate unprivileged user that cannot read your data directory or secrets.'
              : d.unprivileged?.why?.includes('no child process')
                ? 'Not needed for this provider — it makes an HTTPS request and starts no program on this server.'
                : 'Jobs run with the server\'s own user on this host (no separate user to drop to).'}</div>
        </div>
      </details>

      {/* ---------- activity ---------- */}
      <details className="adm-fold">
        <summary>Activity <Icon name="chevronRight" className="chev" /></summary>
        <div className="adm-fold-b">
          <div className="tiles" style={{ textAlign: 'left', marginBottom: 10 }}>
            <div className="tile"><div className="l">Jobs today</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.jobsToday}</div></div>
            <div className="tile"><div className="l">Last success</div><div className="v" style={{ fontSize: '.85rem' }}>{rel(d.lastSuccess?.at)}</div></div>
          </div>
          {d.lastError && <>
            <div className="adm-group-t">Last failure</div>
            <div className="adm-result bad" style={{ marginTop: 0, marginBottom: 10 }}>
              <b>{failureTitle(d.lastError.errorClass)}</b>
              {d.lastError.detail ? <span className="small">{d.lastError.detail}</span> : null}
              <div className="dim" style={{ fontSize: '.72rem', marginTop: 4 }}>{rel(d.lastError.at)}</div>
            </div>
          </>}
          <div className="adm-group-t">Recent jobs</div>
          {d.recent?.length ? <div className="adm-log">
            {d.recent.slice(0, 10).map((e, i) => <div key={i} className="adm-log-row">
              <span>{e.kind === 'create' ? 'Plan' : 'Review'}{e.trigger === 'scheduled' ? ' · scheduled' : ''} · <span style={{ color: e.outcome === 'failed' ? 'var(--red)' : e.outcome === 'ready' ? 'var(--acc)' : 'var(--label-2)' }}>{e.outcome}</span>{e.ms ? ' · ' + Math.round(e.ms / 1000) + ' s' : ''}</span>
              <span className="when">{rel(e.at)}</span>
            </div>)}
          </div> : <div className="adm-empty">No jobs yet.</div>}
          <div className="adm-hint" style={{ margin: '8px 0 0' }}>Counts and outcomes only. What people asked the Coach, and what it answered, is never shown here.</div>
        </div>
      </details>
    </>}
  </div>
}

/* ---------------------------------- pieces ---------------------------------- */

function Step({ n, title, hint, done, open, forceOpen, children }) {
  // `key` remounts the <details> when the wizard advances, so the next step unfolds itself.
  return <details className={'adm-step ' + (done ? 'done' : 'todo')} open={open || forceOpen}>
    <summary>
      <span className="adm-num">{done ? <Icon name="check" /> : n}</span>
      <span className="adm-step-t"><b>{title}</b><span>{hint}</span></span>
      <Icon name="chevronRight" className="chev" />
    </summary>
    <div className="adm-step-b">{children}</div>
  </details>
}

function CredentialPill({ auth }) {
  const s = auth?.state
  if (s === 'connected') return <span className="adm-pill ok">connected{auth.account ? ' · ' + auth.account : ''}</span>
  if (s === 'not-required') return <span className="adm-pill">not needed</span>
  if (s === 'optional') return <span className="adm-pill">optional — none saved</span>
  if (s === 'unreadable') return <span className="adm-pill bad">can't be read</span>
  return <span className="adm-pill warn">needed</span>
}

const credentialHint = (auth, meta) => {
  const s = auth?.state
  if (s === 'connected') return 'Connected' + (auth.account ? ' as ' + auth.account : '')
  if (s === 'not-required') return 'Not needed'
  if (s === 'optional') return 'Optional for this endpoint'
  if (s === 'unreadable') return 'Stored key can\'t be read — add it again'
  return meta.setupToken ? 'Token or API key needed' : 'API key needed'
}

const credentialLabel = type => ({
  'cli-token': 'Claude Code setup token', 'chatgpt-cli': 'ChatGPT CLI login', oauth: 'legacy token', apikey: 'API key'
}[type] || 'credential')

// The failure classes jobs.js emits, in words an operator can act on.
const failureTitle = cls => ({
  timeout: 'The provider took longer than the job budget (COACH_JOB_TIMEOUT_MS, default 5 minutes)',
  missing: 'The provider runtime or key is missing',
  auth: 'The provider rejected the credential',
  provider: 'The provider returned an error',
  unusable: 'The model answered, but not in a shape the app could use',
  restart: 'The server restarted while a job was running',
  nostate: 'The user\'s training data could not be read',
  off: 'The Coach was off when the job ran',
  internal: 'Something went wrong on the server'
}[cls] || cls || 'Failed')

/* ------------------------------- setup token -------------------------------- */

function SetupTokenSheet({ close, onDone, label }) {
  const toast = useUI(s => s.toast)
  const [token, setToken] = useState('')
  // Which account this token belongs to. Optional, and stored as a plain label — it is what the
  // admin card and the user's Coach screen both show when they name whose account is spent.
  const [account, setAccount] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    try {
      const r = await api('/api/admin/coach/connect', { method: 'POST', body: JSON.stringify({ type: 'cli-token', token: token.trim(), account: account.trim() }) })
      setToken('')
      toast(r.test?.ok ? 'Connected ✅' : 'Token saved')
      close(); onDone()
    } catch (e) { toast(e.message); setBusy(false) }
  }

  return <>
    <h3>Connect {label}</h3>
    <div className="muted small" style={{ lineHeight: 1.5, marginBottom: 12 }}>
      On a trusted computer where you use Claude Code, run <code>claude setup-token</code>, complete its normal browser sign-in, then paste the token it prints here. This app never opens or handles Claude's authorization flow.
    </div>
    <TextField value={token} autoFocus type="password" placeholder="paste setup token" onChange={e => setToken(e.target.value)} />
    <div style={{ height: 8 }} />
    <TextField value={account} placeholder="whose account is this? (e.g. you@example.com)" onChange={e => setAccount(e.target.value)} />
    <div style={{ height: 12 }} />
    <Button variant="primary" disabled={busy || !token.trim()} onClick={save}>Save token</Button>
    <div style={{ height: 8 }} />
  </>
}

function ApiKeySheet({ close, onDone, label, placeholder, optional }) {
  const toast = useUI(s => s.toast)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    try {
      const r = await api('/api/admin/coach/connect', { method: 'POST', body: JSON.stringify({ type: 'apikey', token: key.trim() }) })
      toast(r.test?.ok ? 'Key saved ✅' : 'Key saved')
      close(); onDone()
    } catch (e) { toast(e.message); setBusy(false) }
  }
  return <>
    <h3>{label} API key</h3>
    <div className="muted small" style={{ lineHeight: 1.5, marginBottom: 12 }}>
      Stored encrypted on this server and sent to the provider only while a job runs. It is never shown again and never leaves the server{optional ? ' — and for an endpoint that takes no key, you can leave this empty and close the sheet.' : '.'}
    </div>
    <TextField value={key} autoFocus type="password" placeholder={placeholder || 'sk-…'} autoCapitalize="none" autoCorrect="off" onChange={e => setKey(e.target.value)} />
    <div style={{ height: 12 }} />
    <Button variant="primary" disabled={busy || !key.trim()} onClick={save}>Save key</Button>
    <div style={{ height: 8 }} />
  </>
}
