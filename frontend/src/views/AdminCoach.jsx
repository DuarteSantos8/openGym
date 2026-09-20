import { useCallback, useEffect, useRef, useState } from 'react'
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
              {/* The provider's own mark when it has one, tinted to the chip's text colour so it
                  sits in the row rather than on top of it. */}
              {p.logo && <img className="adm-chip-logo" src={p.logo} alt="" width="18" height="18" />}
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
            {/* The account choice stays available after a key is connected: a key pasted in
                first is not a reason to lose the browser flow, and replacing the credential is
                the same action either way. */}
            {meta.connect === 'pkce' && <Button size="sm" variant="tinted" icon="sparkles" disabled={busy}
              onClick={() => openSheet(close => <OrcaConnectSheet close={close} onDone={load} label={meta.label} connectedAs={d.auth.account} />)}>Connect with {meta.label}</Button>}
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
          {/* The two ways to connect, side by side and both named. They are not
              interchangeable — one needs a key from the console, the other a browser and an
              account — so they are two buttons rather than one that behaves differently
              depending on something the admin cannot see. */}
          <div className="adm-actions">
            {meta.setupToken && <Button size="sm" variant="primary" icon="key" disabled={busy}
              onClick={() => openSheet(close => <SetupTokenSheet close={close} onDone={load} label={meta.label} />)}>Add Claude Code token</Button>}
            {meta.apiKey && <Button size="sm" variant={meta.setupToken || meta.connect === 'pkce' ? undefined : 'primary'} icon="lock" disabled={busy}
              onClick={() => openSheet(close => <ApiKeySheet close={close} onDone={load} label={meta.label} placeholder={meta.keyPlaceholder} optional={meta.keyOptional} />)}>
              {meta.keyOptional ? 'Add API key (optional)' : 'Add API key'}</Button>}
            {meta.connect === 'pkce' && <Button size="sm" variant="primary" icon="sparkles" disabled={busy}
              onClick={() => openSheet(close => <OrcaConnectSheet close={close} onDone={load} label={meta.label} />)}>Connect with {meta.label}</Button>}
          </div>
          {meta.connect === 'pkce' && <div className="adm-hint" style={{ margin: '8px 0 0' }}>
            Both end at the same key on your account. Use an API key if you already have one; use Connect to sign in and have one issued to this server.
          </div>}
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

/* ------------------------- connect with an account (PKCE) -------------------------
   The second of the two ways to hold an OrcaRouter key, and the one with a lifecycle.

   Out-of-band by design: this dashboard is served from wherever the owner deployed it, so the
   server is in no position to receive a redirect to a loopback address. The admin opens the
   consent page and pastes back the code it shows — the same gesture the Claude setup-token sheet
   above already asks for, so nothing here is a new habit for whoever runs the box.

   What this sheet has to get right is the leaving. A sign-in can end by succeeding, by being
   denied, by failing, by timing out, by Cancel, by switching provider, by closing the sheet, by
   unmounting, or by the browser navigating away — and every one of those has to release the
   server-side lock, not just the happy path. Two mechanisms do that:

     generationRef — a client-side counter. Every response carries the attempt it belongs to, and
     a late answer from an abandoned attempt is dropped rather than written into state. Without
     it, cancelling and starting again can leave the first attempt's URL or error on screen.

     pagehide — handled by clearing the busy flag and the hint *synchronously*, then sending the
     cancel with `keepalive`. It cannot be left to the cancelled request's own `finally`: that
     block is guarded by the generation and will correctly refuse to touch state, which on a
     back-forward-cache restore means a page that comes back permanently busy. */
function OrcaConnectSheet({ close, onDone, label, connectedAs }) {
  const toast = useUI(s => s.toast)
  const [phase, setPhase] = useState('starting')   // starting | pending | exchanging | failed
  const [attempt, setAttempt] = useState(null)     // { url, generation, expiresAt }
  const [code, setCode] = useState('')
  const [error, setError] = useState(null)
  const [unreachable, setUnreachable] = useState(false)

  // The generation guard, and the live copy the pagehide handler reads. A ref because the
  // handler is installed once and must see the current value, not the one from its first render.
  const generationRef = useRef(0)
  const attemptRef = useRef(null)
  const busyRef = useRef(true)

  const invalidate = useCallback(() => { generationRef.current += 1; return generationRef.current }, [])

  const start = useCallback(async () => {
    const gen = invalidate()
    setPhase('starting'); setError(null); setAttempt(null); setCode('')
    busyRef.current = true
    try {
      const r = await api('/api/admin/coach/connect/orcarouter/start', { method: 'POST', body: '{}' })
      if (gen !== generationRef.current) return          // a newer attempt already replaced this one
      attemptRef.current = { url: r.url, generation: r.generation, expiresAt: r.expiresAt }
      setAttempt(attemptRef.current)
      setPhase('pending')
      busyRef.current = false
    } catch (e) {
      if (gen !== generationRef.current) return
      busyRef.current = false
      setError(e.message || 'Could not start the connection.')
      setPhase('failed')
    }
  }, [invalidate])

  useEffect(() => { start() }, [start])

  /* The server holds the lock; every way out of this sheet has to tell it so. `keepalive` lets
     the request survive the page going away, which is the whole point on pagehide. */
  const releaseServer = useCallback((opts = {}) => {
    const generation = attemptRef.current?.generation
    const body = JSON.stringify(generation != null ? { generation } : {})
    const path = opts.denied ? '/api/admin/coach/connect/orcarouter/denied' : '/api/admin/coach/connect/orcarouter/cancel'
    try {
      fetch(path, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true
      }).catch(() => {})
    } catch { /* a page that is going away has nothing to report to */ }
    attemptRef.current = null
  }, [])

  // Closing the sheet — by the X, by Escape, or by the backdrop — is a cancellation. The server
  // must not keep a lock on an attempt nobody is looking at any more.
  useEffect(() => () => { invalidate(); releaseServer() }, [invalidate, releaseServer])

  useEffect(() => {
    const onPageHide = () => {
      // Synchronously, before anything can be cancelled: a back-forward-cache restore brings this
      // component back exactly as it was, so anything left true here is a page stuck on "busy".
      invalidate()
      busyRef.current = false
      setError('The page was closed before this finished. Start the connection again.')
      setPhase('failed')
      // The attempt is gone server-side, so the URL on screen is dead. Dropping it is what makes
      // the sheet offer a fresh start rather than a code field that cannot succeed.
      attemptRef.current = null
      setAttempt(null)
      releaseServer()
    }
    window.addEventListener('pagehide', onPageHide)
    return () => window.removeEventListener('pagehide', onPageHide)
  }, [invalidate, releaseServer])

  const cancel = () => { invalidate(); releaseServer(); toast('Connection cancelled'); close(); onDone() }

  const deny = async () => {
    invalidate()
    releaseServer({ denied: true })
    toast('Authorization declined — nothing was saved')
    close(); onDone()
  }

  const submit = async () => {
    const gen = generationRef.current
    const started = attemptRef.current
    if (!started) return
    setPhase('exchanging'); setError(null); busyRef.current = true
    try {
      const r = await api('/api/admin/coach/connect/orcarouter/complete', {
        method: 'POST', body: JSON.stringify({ generation: started.generation, code: code.trim() })
      })
      if (gen !== generationRef.current) return
      attemptRef.current = null
      busyRef.current = false
      toast('Connected ✅')
      close(); onDone()
    } catch (e) {
      if (gen !== generationRef.current) return
      busyRef.current = false
      setError(e.message || 'That code was not accepted.')
      setPhase('failed')
    }
  }

  const copy = async () => {
    try { await navigator.clipboard.writeText(attempt.url); toast('Link copied') }
    catch { toast('Copy the link above') }
  }

  if (phase === 'starting') return <>
    <h3>Connect {label}</h3>
    <div className="muted small" style={{ lineHeight: 1.5 }}>Asking this server for an authorization link…</div>
  </>

  if (phase === 'failed' && !attempt) return <>
    <h3>Connect {label}</h3>
    <div className="adm-result bad" style={{ marginTop: 0 }}><b>Could not start</b>{error}</div>
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={start}>Try again</Button>
    <div style={{ height: 8 }} />
    <Button onClick={cancel}>Cancel</Button>
    <div style={{ height: 8 }} />
  </>

  return <>
    <h3>Connect {label}</h3>
    <div className="muted small" style={{ lineHeight: 1.5, marginBottom: 12 }}>
      {connectedAs
        ? `This replaces the key currently connected as ${connectedAs}. `
        : ''}Open the link below, approve access on your OrcaRouter account, then paste the code the page shows you here. No password is shared with this server, and no client secret is involved — the code only works for this one request.
    </div>

    <div className="adm-field">
      <label>Authorization link</label>
      {/* Shown as text, not only as a button: the browser may not launch from a link on a
          headless box or over SSH, and the admin still has to be able to get there. */}
      <div className="adm-code" style={{ display: 'block', wordBreak: 'break-all', letterSpacing: 0, fontWeight: 500, fontSize: 12 }} data-testid="orca-auth-url">{attempt.url}</div>
    </div>
    <div className="adm-actions">
      <Button size="sm" variant="tinted" icon="link" onClick={() => window.open(attempt.url, '_blank', 'noopener,noreferrer')}>Open consent page</Button>
      <Button size="sm" onClick={copy}>Copy link</Button>
    </div>

    <div style={{ height: 12 }} />
    <div className="adm-field">
      <label>Code from that page</label>
      <TextField value={code} type="text" placeholder="paste the code" autoCapitalize="none" autoCorrect="off" spellCheck={false}
        onChange={e => setCode(e.target.value)} disabled={phase === 'exchanging'} />
    </div>

    {error && <div className="adm-result bad"><b>Not connected</b>{error}</div>}

    <div style={{ height: 12 }} />
    <div className="adm-actions">
      <Button variant="primary" disabled={phase === 'exchanging' || !code.trim()} onClick={submit}>
        {phase === 'exchanging' ? 'Connecting…' : 'Connect'}</Button>
      <Button disabled={phase === 'exchanging'} onClick={cancel}>Cancel</Button>
    </div>
    {/* A person who declined on the consent page needs a way to say so here, rather than a
        spinner that runs until the attempt expires on its own. */}
    <div style={{ height: 4 }} />
    <Button variant="plain" size="sm" disabled={phase === 'exchanging'} onClick={deny}>I declined on that page</Button>
    <div style={{ height: 10 }} />
    <div className="muted small" style={{ lineHeight: 1.5 }}>
      The key issued this way belongs to your OrcaRouter account: it is billed to you and can be revoked any time from your console. This server keeps it encrypted and reuses it until you remove it — it will not ask you to sign in again on every restart.
    </div>
    <div style={{ height: 8 }} />
  </>
}
