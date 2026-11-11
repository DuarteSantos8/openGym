import { useEffect, useState } from 'react'
import { useUI } from '../store/useUI.js'
import { useStore } from '../store/useStore.js'
import { api } from '../lib/api.js'
import Icon from '../components/Icon.jsx'
import { Button, Switch, TextArea, TextField } from '../components/ui.jsx'
import { confirmSheet } from '../sheets.jsx'

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

// Extra static headers for the endpoint, one `Name: value` per line — e.g. a gateway's
// routing/session header (opencode Go's `x-opencode-session`). Parsed client-side so a
// typo reads as a message on the card, not a 400 the admin has to decode. Empty clears.
export const headersToText = h => h && typeof h === 'object'
  ? Object.entries(h).map(([k, v]) => `${k}: ${v}`).join('\n')
  : ''
export function parseHeadersText(text) {
  const lines = String(text || '').split('\n').map(l => l.trim()).filter(Boolean)
  if (!lines.length) return { headers: null }
  const out = {}
  for (const line of lines) {
    const i = line.indexOf(':')
    if (i < 1) return { error: `not a Name: value line: ${line.slice(0, 40)}` }
    const name = line.slice(0, i).trim()
    const value = line.slice(i + 1).trim()
    if (!name || !value) return { error: `not a Name: value line: ${line.slice(0, 40)}` }
    out[name] = value
  }
  return { headers: out }
}

// Which chips go under which heading. Runtime-backed providers are the ones that need the
// bigger `coach` image; the fixture exists so the whole loop can be walked without any account.
const RUNTIME_IDS = ['claude', 'codex']

// One line where the key is pasted, for the two providers where a key costs less than people think.
// Claude Max, Ultra and Team include monthly API credits (support.claude.com/en/articles/17154008);
// Gemini's key from AI Studio is free to start with.
export function ProviderHint({ id }) {
  if (id === 'anthropic' || id === 'claude') return <div className="adm-hint adm-tip"><Icon name="lightbulb" /><span><b>Got Claude Max, Ultra or Team?</b> Your plan includes monthly API credits (link the Console organisation once under Settings, Billing on claude.ai). <a href="https://platform.claude.com/settings/keys" target="_blank" rel="noopener noreferrer">Create a key here</a>.</span></div>
  if (id === 'gemini') return <div className="adm-hint adm-tip"><Icon name="lightbulb" /><span><b>A free key in a minute.</b> <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">Open Google AI Studio</a>, press Create API key, copy it, then Add API key here and Test the Coach.</span></div>
  return null
}
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
  // Model servers found next to the api (Ollama, LM Studio, llama.cpp), after "Find".
  const [found, setFound] = useState(null)
  const discover = async () => {
    setBusy(true)
    try { const r = await api('/api/admin/coach/discover', { method: 'POST', body: '{}' }); setFound(r.found || []) }
    catch (e) { toast(e.message) }
    setBusy(false)
  }

  // Every change on this card ends in load(), so load() also re-reads /api/config. The app reads
  // that once per boot, and the Plan tab's Coach card hangs off it: without the re-read, an admin
  // who has just switched the Coach on and connected it finds no Coach anywhere until a reload,
  // which reads as a setup that failed (Discord #install-help, 2026-09-19).
  const load = () => api('/api/admin/coach').then(r => { setD(r); setModels(r.knownModels || null); useStore.getState().refreshConfig() }).catch(e => toast(e.message || 'Failed to load'))
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
      // The server gives the provider up to 90 s for this round-trip (api/coach/jobs.js testRun),
      // longer than api()'s default for a request; a slow local model must still get its answer.
      const r = await api('/api/admin/coach/test', { method: 'POST', body: '{}', timeout: 150000 })
      setTestResult(r)
      toast(r.ok ? 'Coach test passed' : 'Test failed')
      await load()
    } catch (e) { setTestResult({ ok: false, error: e.message }); toast(e.message) }
    setBusy(false)
  }
  // A number input hands back "" for anything it cannot parse, and +"" is 0, which the hint on
  // this card calls "no limit". So an admin who cleared the box to retype and clicked elsewhere
  // had just uncapped daily spend on their API key, silently. An empty box is no change now: the
  // stored value goes back into it and nothing is written. Removing the cap takes typing a 0.
  const capBlur = key => e => {
    if (e.target.value.trim() === '') { e.target.value = d.caps[key]; return }
    if (+e.target.value !== d.caps[key]) patch({ caps: { ...d.caps, [key]: +e.target.value } })
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

  const status = !d.enabled ? 'Off. Users won’t see the Coach anywhere in the app.'
    : live ? <>On · {meta.label}{d.model ? ' · ' + d.model : ''}</>
      : !hasEndpoint ? 'On, but no endpoint yet. Finish step 2.'
        : !authed ? 'On, but no credential yet. Finish the Credential step.'
          : !d.runtime.ok ? 'On, but the provider can’t be reached. See the Test step.'
            : 'On'

  // Chips, grouped.
  const groups = [
    { title: 'Paste an API key', hint: 'Plain HTTPS to the provider. Works on the default api image, nothing extra to install.', items: d.providers.filter(p => p.http) },
    { title: 'Runs a local AI runtime', hint: 'Needs the bigger api image built with --target coach.', items: d.providers.filter(p => RUNTIME_IDS.includes(p.id)) },
    { title: 'Sign in with your plan (preview)', hint: 'Your ChatGPT Plus or Pro plan pays for the Coach. Switched on with COACH_CHATGPT_PLAN=on; for your own instance (OpenAI asks hosted apps to apply first).', items: d.providers.filter(p => p.signIn === 'chatgpt') },
    { title: 'Testing', hint: 'A built-in fake that answers instantly, so the whole loop can be tried without an account.', items: d.providers.filter(p => TESTING_IDS.includes(p.id)) }
  ]

  const hasCredentialStep = !!(meta.setupToken || meta.apiKey || meta.signIn === 'chatgpt')
  const lists = !!(meta.http || meta.signIn === 'chatgpt')
  // The model this provider was explicitly GIVEN — as opposed to `d.model`, which falls back to
  // the provider's own default. Both halves of the Model step (the dropdown and the free-text
  // box) read this one value, so they cannot disagree about what is configured.
  const chosenModel = d.models?.[d.provider] || ''
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
  const stepAt = () => { const i = idx++; return { open: i === (firstTodo === -1 ? -1 : firstTodo), stepKey: i + ':' + (i === firstTodo) } }

  // Off = a quiet, optional feature: one clean pitch and one button, no half-dimmed controls.
  if (!d.enabled) return <div className="card">
    <div className="adm-hero">
      <div className="adm-hero-av"><Icon name="sparkles" /></div>
      <h2>AI Coach</h2>
      <p>An optional coach that designs training plans and reviews what people actually log. Off right now, so nobody sees it anywhere in the app.</p>
      <div className="adm-hero-feats">
        <div><Icon name="key" /><span><b>Bring any AI.</b> An API key from Anthropic, OpenAI or Gemini, or a free local model via Ollama.</span></div>
        <div><Icon name="chat" /><span><b>Or skip the key.</b> With <code>MCP=on</code> everyone can add openGym to the Claude, ChatGPT or Gemini they already pay for: Settings, Use your subscription.</span></div>
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
        : `${doneCount} of ${flags.length} steps done. Finish the open step and the next one unfolds.`}
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
        <div className="adm-hint">The address of any server that speaks OpenAI's chat API: <b>Ollama</b>, <b>LM Studio</b>, <b>vLLM</b>, <b>OpenRouter</b>, or a gateway of your own. The base as your provider documents it, with or without its version (<code>/v1</code>, <code>/v4</code>), and no key in the URL.</div>
        <div className="adm-field">
          <label>Base URL</label>
          <TextField key={d.baseUrl || ''} defaultValue={d.baseUrl || ''} placeholder="http://ollama:11434  or  https://openrouter.ai/api" inputMode="url" autoCapitalize="none" autoCorrect="off"
            onBlur={e => e.target.value !== (d.baseUrl || '') && patch({ baseUrl: e.target.value })} />
        </div>
        <div className="adm-actions">
          <Button size="sm" variant="tinted" icon="magnifier" disabled={busy} onClick={discover}>Find Ollama or LM Studio</Button>
        </div>
        {found && (found.length
          ? found.map(f => <div key={f.base} className="adm-kv"><span className="k">{f.kind} · {f.models.length} models</span>
            <span className="v"><Button size="sm" disabled={busy} onClick={() => patch({ baseUrl: f.base, ...(f.models[0] && !chosenModel ? { model: f.models[0] } : {}) })}>Use {f.base}</Button></span></div>)
          : <div className="adm-hint">Nothing answered on the usual ports next to the server. Type the address instead.</div>)}
        <div className="adm-hint" style={{ margin: 0 }}>The host is written to the job log, so you can always see where requests went.</div>
        <div className="adm-field">
          <label>Extra headers (optional)</label>
          <TextArea key={headersToText(d.headers)} defaultValue={headersToText(d.headers)} placeholder={'x-opencode-session: 550e8400-…'} autoCapitalize="none" autoCorrect="off" rows={2}
            onBlur={e => {
              const cur = headersToText(d.headers)
              if (e.target.value === cur) return
              const p = parseHeadersText(e.target.value)
              if (p.error) { toast(p.error); e.target.value = cur; return }
              patch({ headers: p.headers })
            }} />
        </div>
        <div className="adm-hint" style={{ margin: 0 }}>One <code>Name: value</code> per line, sent with every request to this endpoint. For gateways that demand routing headers. Never <code>Authorization</code> or <code>Content-Type</code> — those are refused.</div>
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
            {/* The key is encrypted at rest and never shown again, so this is the one action on the
                card that cannot be walked back. Every other irreversible action in the app asks first;
                until 2026-09-22 this one did not. */}
            <Button size="sm" variant="danger" disabled={busy} onClick={() => confirmSheet({
              title: 'Remove this credential?',
              message: 'The Coach stops working for everyone on this instance until a new key is added. The stored key cannot be recovered.',
              confirmText: 'Remove', danger: true, onConfirm: disconnect,
            })}>Remove</Button>
          </div>
        </> : <>
          {authState === 'unreadable' && <div className="adm-hint" style={{ color: 'var(--red)' }}>
            The stored credential can't be decrypted. This usually means <code>./data</code> was restored without its <code>secret</code> file. Add the key again to fix it.
          </div>}
          {authState === 'optional' && <div className="adm-hint">This endpoint works without a key. Add one only if your server asks for it (OpenRouter does; a model on your own network usually does not).</div>}
          {authState === 'none' && meta.signIn !== 'chatgpt' && <div className="adm-hint">{meta.setupToken
            ? 'Paste either a Claude Code setup token (your subscription) or an Anthropic API key (pay per use).'
            : 'Paste an API key from the provider\'s console. It is stored encrypted on this server and sent to the provider only while a job runs.'}</div>}
          {authState === 'none' && meta.setupToken && <SetupTokenRisk />}
          {authState === 'none' && <ProviderHint id={d.provider} />}
          <div className="adm-actions">
            {meta.signIn === 'chatgpt' && <ChatGptSignIn onDone={load} />}
            {meta.signIn === 'pkce' && <Button size="sm" variant="primary" icon="person" disabled={busy}
              onClick={() => import('../lib/openrouter-signin.js').then(m => m.startWebSignIn({ back: '#/admin' }))}>Sign in with OpenRouter</Button>}
            {meta.setupToken && <Button size="sm" variant="primary" icon="key" disabled={busy}
              onClick={() => openSheet(close => <SetupTokenSheet close={close} onDone={load} label={meta.label} />)}>Add Claude Code token</Button>}
            {meta.apiKey && <Button size="sm" variant={meta.setupToken || meta.signIn ? undefined : 'primary'} icon="lock" disabled={busy}
              onClick={() => openSheet(close => <ApiKeySheet close={close} onDone={load} label={meta.label} placeholder={meta.keyPlaceholder} optional={meta.keyOptional} />)}>
              {meta.keyOptional ? 'Add API key (optional)' : 'Add API key'}</Button>}
            {meta.keyUrl && <Button size="sm" variant="tinted" icon="link" onClick={() => window.open(meta.keyUrl, '_blank', 'noopener')}>Get a key</Button>}
          </div>
          {meta.signIn === 'pkce' && <div className="adm-hint" style={{ margin: '6px 0 0' }}>OpenRouter's own sign-in (OAuth PKCE): you approve openGym on openrouter.ai and it hands back a key of your own, billed to your OpenRouter credits. One key for Claude, GPT, Gemini and the rest.</div>}
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
            ? <select className="adm-select" value={chosenModel} disabled={busy} onChange={e => patch({ model: e.target.value })}>
              <option value="">{meta.defaultModel ? `Default (${meta.defaultModel})` : 'Pick a model…'}</option>
              {chosenModel && !models.includes(chosenModel) && <option value={chosenModel}>{chosenModel} (not in the list)</option>}
              {models.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            : <TextField key={d.provider} defaultValue={chosenModel} placeholder={meta.defaultModel ? `Default: ${meta.defaultModel}` : needsEndpoint ? 'e.g. qwen2.5:3b, or press "List models"' : '(runtime default)'}
              onBlur={e => e.target.value !== chosenModel && patch({ model: e.target.value })} />}
        </div>
        {lists && <div className="adm-actions">
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
              onBlur={capBlur('perProfileDaily')} /></span></div>
          <div className="adm-kv"><span className="k">Whole instance, per day</span>
            <span className="v"><input className="num" type="number" min="0" max="5000" defaultValue={d.caps.instanceDaily} disabled={busy}
              onBlur={capBlur('instanceDaily')} /></span></div>
          <div className="adm-hint" style={{ marginTop: 10 }}>How long a chat message, refinement or review note can be. The chat composer and the server both enforce this.</div>
          <div className="adm-kv"><span className="k">Max message length</span>
            <span className="v"><input className="num" type="number" min="200" max="4000" defaultValue={d.maxMessageLen} disabled={busy}
              onBlur={e => +e.target.value !== d.maxMessageLen && patch({ maxMessageLen: +e.target.value })} /></span></div>
          <div className="adm-hint" style={{ marginTop: 10 }}>The ceiling on a single provider answer. Reasoning models — DeepSeek-style endpoints, or a "thinking" Gemini/OpenAI model — count their hidden reasoning against it, so a plan can fail with "the answer was cut off at the output limit" even though the plan itself is short. Raise it if that happens; keep it within the model's own output limit.</div>
          <div className="adm-kv"><span className="k">Max output tokens</span>
            <span className="v"><input className="num" type="number" min="1024" max="65536" defaultValue={d.maxOutputTokens} disabled={busy}
              onBlur={e => +e.target.value !== d.maxOutputTokens && patch({ maxOutputTokens: +e.target.value })} /></span></div>

          <div className="adm-group-t" style={{ marginTop: 14 }}>Compare with others</div>
          <div className="row between" style={{ gap: 12, alignItems: 'flex-start' }}>
            <div className="adm-hint" style={{ margin: 0 }}>
              <b>Let people compare with each other.</b> Anonymous medians (estimated 1RM, sessions per week) across profiles that opt in; at least three must share before anyone sees a number. Each person switches themselves on in the Coach chat, and sees nothing unless they do.
            </div>
            <Switch checked={!!d.community} disabled={busy} onChange={v => patch({ community: v })} />
          </div>

          <div className="adm-group-t" style={{ marginTop: 14 }}>Web research</div>
          <div className="row between" style={{ gap: 12, alignItems: 'flex-start' }}>
            <div className="adm-hint" style={{ margin: 0 }}>
              <b>Let the Coach search the web for chat questions.</b> Uses the provider's own search tool (Anthropic web search, OpenAI web search, Google Search grounding, OpenRouter's web plugin), which most providers bill per search on top of tokens. Each person also switches it on for themselves, and the chat shows the pages it used.{meta.web === false ? ' The current provider has no search tool.' : ''}
            </div>
            <Switch checked={!!d.web} disabled={busy} onChange={v => patch({ web: v })} />
          </div>

          <div className="adm-group-t" style={{ marginTop: 14 }}>Routines library</div>
          <div className="adm-hint">Where the app looks for community routines the Coach can suggest, next to the built-in starter plans (docs/ROUTINES_LIBRARY.md). Empty is opengym.ch's; <code>off</code> keeps to the built-in ones. The app fetches it, not this server.</div>
          <TextField key={d.routinesUrl || ''} defaultValue={d.routinesUrl || ''} placeholder="https://opengym.ch/routines/index.json" inputMode="url" autoCapitalize="none" autoCorrect="off"
            onBlur={e => e.target.value !== (d.routinesUrl || '') && patch({ routinesUrl: e.target.value })} />

          <div className="adm-group-t" style={{ marginTop: 14 }}>Whose account pays</div>
          <div className="adm-hint">{d.authMode === 'profile'
            ? 'Each profile signs in with their own account.'
            : d.auth?.type === 'apikey' || meta.http
              ? 'One API key for the whole instance: every profile may use the Coach with it, and the daily limits above are what bound the spend.'
              : d.boundUid
                ? 'One personal account, already in use by one profile. Every other profile is refused, so nobody spends somebody else\'s subscription.'
                : 'One personal account. The first profile to use it becomes the only one allowed to; every other profile is then refused. Paste an API key instead if the whole instance should have the Coach.'}</div>

          <div className="adm-group-t" style={{ marginTop: 14 }}>Isolation</div>
          <div className="adm-hint">{d.unprivileged && !d.unprivileged.ok
            ? <span style={{ color: 'var(--red)' }}>Jobs are blocked: {d.unprivileged.why}. Nothing runs until this is fixed.</span>
            : d.unprivileged?.dropped
              ? 'Jobs run as a separate unprivileged user that cannot read your data directory or secrets.'
              : d.unprivileged?.why?.includes('no child process')
                ? 'Not needed for this provider. It makes an HTTPS request and starts no program on this server.'
                : 'Jobs run with the server\'s own user on this host (no separate user to drop to).'}</div>
        </div>
      </details>

      {/* ---------- activity ---------- */}
      <details className="adm-fold">
        <summary>Activity <Icon name="chevronRight" className="chev" /></summary>
        <div className="adm-fold-b">
          <div className="tiles" style={{ textAlign: 'start', marginBottom: 10 }}>
            <div className="tile"><div className="l">Jobs today</div><div className="v v-sm">{d.jobsToday}</div></div>
            <div className="tile"><div className="l">Last success</div><div className="v" style={{ fontSize: 'var(--fs-footnote)' }}>{rel(d.lastSuccess?.at)}</div></div>
          </div>
          {d.lastError && <>
            <div className="adm-group-t">Last failure</div>
            <div className="adm-result bad" style={{ marginTop: 0, marginBottom: 10 }}>
              <b>{failureTitle(d.lastError.errorClass)}</b>
              {d.lastError.detail ? <span className="small">{d.lastError.detail}</span> : null}
              <div className="dim" style={{ fontSize: 'var(--fs-caption2)', marginTop: 4 }}>{rel(d.lastError.at)}</div>
            </div>
          </>}
          <div className="adm-group-t">Recent jobs</div>
          {d.recent?.length ? <div className="adm-log">
            {d.recent.slice(0, 10).map((e, i) => <div key={i} className="adm-log-row">
              <span>{e.kind === 'create' ? 'Plan' : 'Review'}{e.trigger === 'scheduled' ? ' · scheduled' : ''} · <span style={{ color: e.outcome === 'failed' ? 'var(--red)' : e.outcome === 'ready' ? 'var(--acc-ink)' : 'var(--label-2)' }}>{e.outcome}</span>{e.ms ? ' · ' + Math.round(e.ms / 1000) + ' s' : ''}</span>
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

function Step({ n, title, hint, done, open, forceOpen, stepKey, children }) {
  // `stepKey` remounts the <details> when the wizard advances, so the next step unfolds itself.
  // On the element itself: React wants a key written out, not spread in with the other props.
  return <details key={stepKey} className={'adm-step ' + (done ? 'done' : 'todo')} open={open || forceOpen}>
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
  if (s === 'optional') return <span className="adm-pill">optional, none saved</span>
  if (s === 'unreadable') return <span className="adm-pill bad">can't be read</span>
  return <span className="adm-pill warn">needed</span>
}

const credentialHint = (auth, meta) => {
  const s = auth?.state
  if (s === 'connected') return 'Connected' + (auth.account ? ' as ' + auth.account : '')
  if (s === 'not-required') return 'Not needed'
  if (s === 'optional') return 'Optional for this endpoint'
  if (s === 'unreadable') return 'Stored key can\'t be read. Add it again'
  return meta.signIn === 'chatgpt' ? 'Sign-in needed' : meta.setupToken ? 'Token or API key needed' : 'API key needed'
}

const credentialLabel = type => ({
  'cli-token': 'Claude Code setup token', 'chatgpt-cli': 'ChatGPT CLI login', oauth: 'sign-in', apikey: 'API key'
}[type] || 'credential')

// The failure classes jobs.js emits, in words an operator can act on.
const failureTitle = cls => ({
  timeout: 'The provider took longer than the job budget (COACH_JOB_TIMEOUT_MS, default 10 minutes)',
  missing: 'The provider runtime or key is missing',
  auth: 'The provider rejected the credential',
  // The four ways a provider call fails that used to be one line, "The provider returned an
  // error", on this card and in the chat. Each has its own fix; naming it is the point.
  quota: 'The provider is out of quota, or rate limiting this instance',
  schema: 'The provider would not serve the request shape we send (try another model)',
  outage: 'The provider was having an outage (5xx after its own retries)',
  cutoff: 'The connection dropped while the model was thinking or answering (a NAT, proxy or CDN idle limit)',
  unreachable: 'The provider could not be reached at all (network, DNS or the endpoint)',
  provider: 'The provider returned an error',
  unusable: 'The model answered, but not in a shape the app could use',
  restart: 'The server restarted while a job was running',
  nostate: 'The user\'s training data could not be read',
  off: 'The Coach was off when the job ran',
  toolarge: 'The user\'s training data made a request too large to send, so no provider was called',
  internal: 'Something went wrong on the server'
}[cls] || cls || 'Failed')

/* ------------------------------- setup token -------------------------------- */

// The setup token stays on offer (owner decision, sub-connect-146), with the risk said plainly
// where it is pasted: Anthropic's terms allow it in Claude Code only
// (code.claude.com/docs/en/agent-sdk/overview, "Authentication").
export const SETUP_TOKEN_RISK = 'Anthropic\'s terms only allow this token in Claude Code; using it here can get your Claude account limited. An API key, or openGym as a connector inside Claude (Use your subscription), is the safe way.'
function SetupTokenRisk() {
  return <div className="adm-risk" role="note"><Icon name="warning" /><span>{SETUP_TOKEN_RISK}</span></div>
}

/* The admin finishes sign-in using the callback received by openGym or the pasted address. */
function ChatGptSignIn({ onDone }) {
  const toast = useUI(s => s.toast)
  const [attempt, setAttempt] = useState(null)
  const [cb, setCb] = useState('')
  const [busy, setBusy] = useState(false)
  const complete = r => {
    toast('Signed in' + (r.account ? ' as ' + r.account : ''))
    setCb(''); setAttempt(null); onDone()
  }
  useEffect(() => {
    if (!attempt?.automatic || busy) return
    let active = true
    let timer
    const poll = async () => {
      try {
        const r = await api('/api/admin/coach/chatgpt/finish', { method: 'POST', body: JSON.stringify({ attemptId: attempt.attemptId }) })
        if (!active) return
        if (r.pending) timer = setTimeout(poll, 1500)
        else complete(r)
      } catch (e) {
        if (!active) return
        if (!e.status) timer = setTimeout(poll, 3000)
        else {
          toast(`${e.message.replace(/[.!?]$/, '')}. Select Continue with ChatGPT to start again.`)
          setCb(''); setAttempt(null)
        }
      }
    }
    timer = setTimeout(poll, 1500)
    return () => { active = false; clearTimeout(timer) }
  }, [attempt, busy, onDone, toast])
  const start = async () => {
    setBusy(true)
    try {
      const r = await api('/api/admin/coach/chatgpt/start', { method: 'POST', body: '{}' })
      setAttempt(r); setCb(''); window.open(r.url, '_blank', 'noopener')
    }
    catch (e) { toast(e.message) }
    setBusy(false)
  }
  const finish = async () => {
    setBusy(true)
    try {
      const r = await api('/api/admin/coach/chatgpt/finish', { method: 'POST', body: JSON.stringify({ callback: cb.trim(), attemptId: attempt.attemptId }) })
      if (!r.pending) complete(r)
    }
    catch (e) { toast(e.message) }
    setBusy(false)
  }
  return <div style={{ flexBasis: '100%' }}>
    <Button size="sm" variant="primary" icon="person" disabled={busy} onClick={start}>Continue with ChatGPT</Button>
    {attempt && <>
      <div className="adm-hint" style={{ margin: '10px 0 6px' }}>
        Allow plan use on the <a href={attempt.url} target="_blank" rel="noopener noreferrer">ChatGPT page</a>.
        {attempt.automatic ? ' Waiting for ChatGPT to return to openGym. If the callback page does not load, copy the whole address and paste it here.'
          : <> It then sends you to <code>127.0.0.1:1455</code>, which shows an error page: that is expected. Copy that whole address from the address bar and paste it here.</>}
      </div>
      <TextField value={cb} placeholder="http://127.0.0.1:1455/auth/callback?code=…" autoCapitalize="none" autoCorrect="off" onChange={e => setCb(e.target.value)} />
      <div className="adm-actions" style={{ marginTop: 8 }}><Button size="sm" variant="primary" icon="check" disabled={busy || !cb.trim()} onClick={finish}>Finish sign-in</Button></div>
    </>}
    <div className="adm-hint" style={{ margin: '6px 0 0' }}>Uses your ChatGPT plan's limits, shared with ChatGPT itself. <a href="https://chatgpt.com/settings/usage" target="_blank" rel="noopener noreferrer">Manage usage</a> there.</div>
  </div>
}

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
      toast(r.test?.ok ? 'Connected' : 'Token saved')
      close(); onDone()
    } catch (e) { toast(e.message); setBusy(false) }
  }

  return <>
    <h3>Connect {label}</h3>
    <div className="muted small" style={{ lineHeight: 1.5, marginBottom: 12 }}>
      On a trusted computer where you use Claude Code, run <code>claude setup-token</code>, complete its normal browser sign-in, then paste the token it prints here. This app never opens or handles Claude's authorization flow.
    </div>
    <SetupTokenRisk />
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
      toast(r.test?.ok ? 'Key saved and tested' : 'Key saved')
      close(); onDone()
    } catch (e) { toast(e.message); setBusy(false) }
  }
  return <>
    <h3>{label} API key</h3>
    <div className="muted small" style={{ lineHeight: 1.5, marginBottom: 12 }}>
      Stored encrypted on this server and sent to the provider only while a job runs. It is never shown again and never leaves the server{optional ? '. For an endpoint that takes no key, you can leave this empty and close the sheet.' : '.'}
    </div>
    <TextField value={key} autoFocus type="password" placeholder={placeholder || 'sk-…'} autoCapitalize="none" autoCorrect="off" onChange={e => setKey(e.target.value)} />
    <div style={{ height: 12 }} />
    <Button variant="primary" disabled={busy || !key.trim()} onClick={save}>Save key</Button>
    <div style={{ height: 8 }} />
  </>
}
