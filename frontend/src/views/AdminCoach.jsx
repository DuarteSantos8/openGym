import { useEffect, useState } from 'react'
import { useUI } from '../store/useUI.js'
import { useStore } from '../store/useStore.js'
import { api } from '../lib/api.js'
import Icon from '../components/Icon.jsx'
import { Button, Switch, TextArea, TextField } from '../components/ui.jsx'
import { confirmSheet } from '../sheets.jsx'
import { useLang } from '../lib/i18n.js'
import { adminT } from '../lib/admin-i18n.js'
import { COACH_GROUP_COPY, credentialHint, credentialLabel, failureTitle } from '../lib/admin-coach-i18n.js'
export { COACH_GROUP_COPY, credentialHint, credentialLabel, failureTitle } from '../lib/admin-coach-i18n.js'

/* The operator's side of the Coach, laid out as a guided setup: one master switch, numbered
   steps that each say what they are for, and everything an owner rarely needs folded away
   under "Advanced" and "Activity". English source strings are translated at the admin boundary.

   What it never shows: anybody's intake answers, payloads or proposals. An admin can enable
   the feature and see that jobs ran; they cannot read what their users asked it.

   This is the ONLY place the Coach can be switched off for everyone. Users can decline the
   consent screen for themselves, but they cannot disable the feature — that is an operator
   decision, so it lives with the operator. */

const rel = ts => {
  if (!ts) return adminT('never')
  const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000)
  if (s < 60) return adminT('just now')
  if (s < 3600) return adminT('{0} min ago', Math.floor(s / 60))
  if (s < 86400) return adminT('{0} h ago', Math.floor(s / 3600))
  return adminT('{0} d ago', Math.floor(s / 86400))
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
    if (i < 1) return { error: adminT('not a Name: value line: {0}', line.slice(0, 40)) }
    const name = line.slice(0, i).trim()
    const value = line.slice(i + 1).trim()
    if (!name || !value) return { error: adminT('not a Name: value line: {0}', line.slice(0, 40)) }
    out[name] = value
  }
  return { headers: out }
}

// Which chips go under which heading. Runtime-backed providers are the ones that need the
// bigger `coach` image; the fixture exists so the whole loop can be walked without any account.
const RUNTIME_IDS = ['claude', 'codex']
const TESTING_IDS = ['fixture']

export default function AdminCoach() {
  useLang()
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

  // Every change on this card ends in load(), so load() also re-reads /api/config. The app reads
  // that once per boot, and the Plan tab's Coach card hangs off it: without the re-read, an admin
  // who has just switched the Coach on and connected it finds no Coach anywhere until a reload,
  // which reads as a setup that failed (Discord #install-help, 2026-09-19).
  const load = () => api('/api/admin/coach').then(r => { setD(r); setModels(r.knownModels || null); useStore.getState().refreshConfig() }).catch(e => toast(e.message || adminT('Failed to load')))
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
      if (r.ok) { setModels(r.models); toast(r.models.length + ' models') } else toast(r.error || adminT('Could not list models'))
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
      toast(r.ok ? adminT('Coach test passed ✅') : adminT('Test failed'))
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
    try { await api('/api/admin/coach/disconnect', { method: 'POST', body: JSON.stringify({ provider: d.provider }) }); toast(adminT('Credential removed')); await load() }
    catch (e) { toast(e.message) }
    setBusy(false)
  }

  if (!d) return <div className="card"><div className="muted small">{adminT('Loading Coach status…')}</div></div>

  if (d.disabledByEnv) return <div className="card">
    <h2 style={{ margin: '0 0 6px' }}>{adminT('AI Coach')}</h2>
    <div className="adm-lead">{adminT('Force-disabled by ')}<code>COACH_DISABLED</code>{adminT(' in the server environment. Remove that variable and restart to configure the Coach here.')}</div>
  </div>

  const meta = d.providers.find(p => p.id === d.provider) || {}
  const authState = d.auth?.state
  const authed = authState === 'connected' || authState === 'not-required' || authState === 'optional'
  const needsEndpoint = !!meta.baseUrl
  const hasEndpoint = !needsEndpoint || !!d.baseUrl
  const live = d.enabled && d.runtime.ok && authed && hasEndpoint

  const status = !d.enabled ? adminT('Off. Users won’t see the Coach anywhere in the app.')
    : live ? <>{adminT('On')} · {meta.label}{d.model ? ' · ' + d.model : ''}</>
      : !hasEndpoint ? adminT('On, but no endpoint yet. Finish step 2.')
        : !authed ? adminT('On, but no credential yet. Finish the Credential step.')
          : !d.runtime.ok ? adminT('On, but the provider can’t be reached. See the Test step.')
            : adminT('On')

  // Chips, grouped.
  const groups = [
    { sourceTitle: COACH_GROUP_COPY[0][0], hint: COACH_GROUP_COPY[0][1], items: d.providers.filter(p => p.http) },
    { sourceTitle: COACH_GROUP_COPY[1][0], hint: COACH_GROUP_COPY[1][1], items: d.providers.filter(p => RUNTIME_IDS.includes(p.id)) },
    { sourceTitle: COACH_GROUP_COPY[2][0], hint: COACH_GROUP_COPY[2][1], items: d.providers.filter(p => TESTING_IDS.includes(p.id)) }
  ]

  const hasCredentialStep = !!(meta.setupToken || meta.apiKey)
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
  const stepAt = () => { const i = idx++; return { open: i === (firstTodo === -1 ? -1 : firstTodo), key: i + ':' + (i === firstTodo) } }

  // Off = a quiet, optional feature: one clean pitch and one button, no half-dimmed controls.
  if (!d.enabled) return <div className="card">
    <div className="adm-hero">
      <div className="adm-hero-av"><Icon name="sparkles" /></div>
      <h2>{adminT('AI Coach')}</h2>
      <p>{adminT('An optional coach that designs training plans and reviews what people actually log. Off right now, so nobody sees it anywhere in the app.')}</p>
      <div className="adm-hero-feats">
        <div><Icon name="key" /><span><b>{adminT('Bring any AI.')}</b> {adminT('An API key from Anthropic, OpenAI or Gemini, or a free local model via Ollama.')}</span></div>
        <div><Icon name="shield" /><span><b>{adminT('Private by design.')}</b> {adminT('A strict allowlist decides what leaves; every change needs the user’s yes and can be undone.')}</span></div>
        <div><Icon name="person" /><span><b>{adminT('Each user decides.')}</b> {adminT('Turning it on only makes the Coach available; every person consents for themselves.')}</span></div>
      </div>
      <Button variant="primary" icon="sparkles" disabled={busy} onClick={() => patch({ enabled: true })}>{adminT('Set up the Coach')}</Button>
    </div>
  </div>

  return <div className="card" style={{ borderColor: live ? 'var(--acc)' : undefined }}>
    <div className="row between" style={{ marginBottom: 2 }}>
      <h2 style={{ margin: 0 }}>{adminT('AI Coach')}</h2>
      <Switch checked={!!d.enabled} disabled={busy} onChange={v => patch({ enabled: v })} />
    </div>
    <div className="adm-status">
      <span className={'adm-pill ' + (live ? 'ok' : 'warn')}>{live ? adminT('ready') : adminT('not ready')}</span>
      <span>{status}</span>
    </div>
    {!live && <div className="adm-progress" aria-hidden="true"><i style={{ width: Math.round(doneCount / flags.length * 100) + '%' }} /></div>}
    <div className="adm-lead">
      {live ? adminT('Users find the Coach under Plan → Coach. This switch is the only place it can be turned off for everyone.')
        : adminT('{0} of {1} steps done. Finish the open step and the next one unfolds.', doneCount, flags.length)}
    </div>

      {d.enabled && <>
      {/* ---------- provider ---------- */}
      <Step n={num()} title={adminT('Provider')} hint={meta.label || adminT('Which AI answers the Coach')} done={step1Done} {...stepAt()}>
        <div className="adm-hint">{adminT('Pick who answers. A key or token you save stays with its provider, so you can switch back and forth without pasting it again.')}</div>
        {groups.map(g => !!g.items.length && <div key={g.sourceTitle} className="adm-group">
          <div className="adm-group-t">{adminT(g.sourceTitle)}</div>
          <div className="adm-chips">
            {g.items.map(p => <button key={p.id} className={'chip' + (p.id === d.provider ? ' on' : '')} disabled={busy}
              onClick={() => { setTestResult(null); patch({ provider: p.id }) }}>
              {p.label}{p.connected && <span className="adm-chip-key">{adminT('key saved')}</span>}
            </button>)}
          </div>
          <div className="adm-hint" style={{ margin: '6px 0 0' }}>{adminT(g.hint)}</div>
        </div>)}
      </Step>

      {/* ---------- endpoint (compatible only) ---------- */}
      {needsEndpoint && <Step n={num()} title={adminT('Endpoint')} hint={d.baseUrl || adminT('Where the model runs')} done={step2Done} {...stepAt()}>
        <div className="adm-hint">{adminT('The address of any server that speaks OpenAI’s chat API:')} <b>Ollama</b>, <b>LM Studio</b>, <b>vLLM</b>, <b>OpenRouter</b>, {adminT('or a gateway of your own. The base as your provider documents it, with or without its version')} (<code>/v1</code>, <code>/v4</code>), {adminT('and no key in the URL.')}</div>
        <div className="adm-field">
          <label>{adminT('Base URL')}</label>
          <TextField key={d.baseUrl || ''} defaultValue={d.baseUrl || ''} placeholder="http://ollama:11434  or  https://openrouter.ai/api" inputMode="url" autoCapitalize="none" autoCorrect="off"
            onBlur={e => e.target.value !== (d.baseUrl || '') && patch({ baseUrl: e.target.value })} />
        </div>
        <div className="adm-hint" style={{ margin: 0 }}>{adminT('The host is written to the job log, so you can always see where requests went.')}</div>
        <div className="adm-field">
          <label>{adminT('Extra headers (optional)')}</label>
          <TextArea key={headersToText(d.headers)} defaultValue={headersToText(d.headers)} placeholder={'x-opencode-session: 550e8400-…'} autoCapitalize="none" autoCorrect="off" rows={2}
            onBlur={e => {
              const cur = headersToText(d.headers)
              if (e.target.value === cur) return
              const p = parseHeadersText(e.target.value)
              if (p.error) { toast(p.error); e.target.value = cur; return }
              patch({ headers: p.headers })
            }} />
        </div>
        <div className="adm-hint" style={{ margin: 0 }}>{adminT('One Name: value per line, sent with every request to this endpoint. For gateways that demand routing headers. Never Authorization or Content-Type, those are refused.')}</div>
      </Step>}

      {/* ---------- credential ---------- */}
      {hasCredentialStep && <Step n={num()} title={adminT('Credential')} hint={credentialHint(d.auth, meta)} done={step3Done} {...stepAt()}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          <CredentialPill auth={d.auth} />
        </div>
        {authState === 'connected' ? <>
          <div className="adm-hint">{adminT('Connected')}{d.auth.account ? ' ' + adminT('as') + ' ' + d.auth.account : ''} {adminT('via')} {credentialLabel(d.auth.type)}{d.auth.connectedAt ? ' · ' + adminT('added') + ' ' + rel(d.auth.connectedAt) : ''}. {adminT('The key is stored encrypted and is never shown again.')}</div>
          <div className="adm-actions">
            {meta.apiKey && <Button size="sm" variant="tinted" icon="lock" disabled={busy}
              onClick={() => openSheet(close => <ApiKeySheet close={close} onDone={load} label={meta.label} placeholder={meta.keyPlaceholder} optional={meta.keyOptional} />)}>{adminT('Replace key')}</Button>}
            {/* The key is encrypted at rest and never shown again, so this is the one action on the
                card that cannot be walked back. Every other irreversible action in the app asks first;
                until 2026-09-22 this one did not. */}
            <Button size="sm" danger disabled={busy} onClick={() => confirmSheet({
              title: adminT('Remove this credential?'),
              message: adminT('The Coach stops working for everyone on this instance until a new key is added. The stored key cannot be recovered.'),
              confirmText: adminT('Remove'), danger: true, onConfirm: disconnect,
            })}>{adminT('Remove')}</Button>
          </div>
        </> : <>
          {authState === 'unreadable' && <div className="adm-hint" style={{ color: 'var(--red)' }}>
            {adminT("The stored credential can't be decrypted. This usually means")} <code>./data</code> {adminT('was restored without its')} <code>secret</code> {adminT('file. Add the key again to fix it.')}
          </div>}
          {authState === 'optional' && <div className="adm-hint">{adminT('This endpoint works without a key. Add one only if your server asks for it (OpenRouter does; a model on your own network usually does not).')}</div>}
          {authState === 'none' && <div className="adm-hint">{meta.setupToken
            ? adminT('Paste either a Claude Code setup token (your subscription) or an Anthropic API key (pay per use).')
            : adminT('Paste an API key from the provider’s console. It is stored encrypted on this server and sent to the provider only while a job runs.')}</div>}
          <div className="adm-actions">
            {meta.setupToken && <Button size="sm" variant="primary" icon="key" disabled={busy}
              onClick={() => openSheet(close => <SetupTokenSheet close={close} onDone={load} label={meta.label} />)}>{adminT('Add Claude Code token')}</Button>}
            {meta.apiKey && <Button size="sm" variant={meta.setupToken ? undefined : 'primary'} icon="lock" disabled={busy}
              onClick={() => openSheet(close => <ApiKeySheet close={close} onDone={load} label={meta.label} placeholder={meta.keyPlaceholder} optional={meta.keyOptional} />)}>
              {adminT(meta.keyOptional ? 'Add API key (optional)' : 'Add API key')}</Button>}
          </div>
        </>}
      </Step>}

      {/* ---------- model ---------- */}
      <Step n={num()} title={adminT('Model')} hint={d.model || (meta.defaultModel ? adminT('default: ') + meta.defaultModel : adminT('not chosen yet'))} done={step4Done} {...stepAt()}>
        <div className="adm-hint">{meta.http
          ? adminT('Which model the provider should use. "List models" asks the provider for its current list, so nothing here goes stale.')
          : adminT('Optional. Leave it empty to use the runtime’s own default.')}</div>
        <div className="adm-field">
          <label>{adminT('Model')}</label>
          {models && models.length
            ? <select className="adm-select" value={chosenModel} disabled={busy} onChange={e => patch({ model: e.target.value })}>
              <option value="">{meta.defaultModel ? adminT('Default ({0})', meta.defaultModel) : adminT('Pick a model…')}</option>
              {chosenModel && !models.includes(chosenModel) && <option value={chosenModel}>{chosenModel} ({adminT('not in the list')})</option>}
              {models.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            : <TextField key={d.provider} defaultValue={chosenModel} placeholder={meta.defaultModel ? adminT('Default: {0}', meta.defaultModel) : needsEndpoint ? adminT('e.g. qwen2.5:3b, or press "List models"') : adminT('(runtime default)')}
              onBlur={e => e.target.value !== chosenModel && patch({ model: e.target.value })} />}
        </div>
        {meta.http && <div className="adm-actions">
          <Button size="sm" variant="tinted" icon="reset" disabled={busy} onClick={loadModels}>{models ? adminT('Refresh list') : adminT('List models')}</Button>
          {models && models.length ? <span className="dim small" style={{ alignSelf: 'center' }}>{adminT('{0} served by the provider', models.length)}</span> : null}
        </div>}
      </Step>

      {/* ---------- test ---------- */}
      <Step n={num()} title={adminT('Test')} hint={step5Done ? adminT('passed') : adminT('one real round trip, no user data')} done={step5Done} {...stepAt()} forceOpen={!!testResult}>
        <div className="adm-hint">{adminT('Sends one tiny question to the provider and checks the answer. No training data is involved. Do this after every change above.')}</div>
        <div className="adm-actions">
          <Button size="sm" variant="primary" icon="check" disabled={busy || !authed || !hasEndpoint} onClick={test}>{adminT('Test the Coach')}</Button>
        </div>
        {(!authed || !hasEndpoint) && <div className="adm-hint" style={{ margin: '6px 0 0' }}>
          {!hasEndpoint ? adminT('Finish the Endpoint step first.') : adminT('Finish the Credential step first.')}
        </div>}
        {testResult && <div className={'adm-result ' + (testResult.pending ? '' : testResult.ok ? 'ok' : 'bad')}>
          {testResult.pending ? adminT('Asking the provider…')
            : testResult.ok ? <><b>{adminT('Passed')}</b>{testResult.version ? adminT('Provider: ') + testResult.version : adminT('The provider answered as expected.')}</>
              : <><b>{adminT('Failed')}</b>{testResult.error || adminT('No answer from the provider.')}</>}
        </div>}
        <div className="adm-kv" style={{ marginTop: 10 }}>
          <span className="k">{adminT('Runtime')}</span>
          <span className="v">{d.runtime.ok ? <span className="adm-pill ok">{adminT('ready')}</span> : <span className="adm-pill bad">{adminT('missing')}</span>}{d.runtime.version ? <div className="dim small">{d.runtime.version}</div> : null}{!d.runtime.ok && d.runtime.error ? <div className="small" style={{ color: 'var(--red)' }}>{d.runtime.error}</div> : null}</span>
        </div>
      </Step>

      {/* ---------- advanced ---------- */}
      <details className="adm-fold">
        <summary>{adminT('Advanced')} <Icon name="chevronRight" className="chev" /></summary>
        <div className="adm-fold-b">
          <div className="adm-group-t">{adminT('Limits')}</div>
          <div className="adm-hint">{adminT('How many Coach runs are allowed per day. Every run is one request on the provider account above. 0 means no limit.')}</div>
          <div className="adm-kv"><span className="k">{adminT('Per user, per day')}</span>
            <span className="v"><input className="num" type="number" min="0" max="200" defaultValue={d.caps.perProfileDaily} disabled={busy}
              onBlur={capBlur('perProfileDaily')} /></span></div>
          <div className="adm-kv"><span className="k">{adminT('Whole instance, per day')}</span>
            <span className="v"><input className="num" type="number" min="0" max="5000" defaultValue={d.caps.instanceDaily} disabled={busy}
              onBlur={capBlur('instanceDaily')} /></span></div>
          <div className="adm-hint" style={{ marginTop: 10 }}>{adminT('How long a chat message, refinement or review note can be. The chat composer and the server both enforce this.')}</div>
          <div className="adm-kv"><span className="k">{adminT('Max message length')}</span>
            <span className="v"><input className="num" type="number" min="200" max="4000" defaultValue={d.maxMessageLen} disabled={busy}
              onBlur={e => +e.target.value !== d.maxMessageLen && patch({ maxMessageLen: +e.target.value })} /></span></div>
          <div className="adm-hint" style={{ marginTop: 10 }}>{adminT('The ceiling on a single provider answer. Reasoning models — DeepSeek-style endpoints, or a "thinking" Gemini/OpenAI model — count their hidden reasoning against it, so a plan can fail with "the answer was cut off at the output limit" even though the plan itself is short. Raise it if that happens; keep it within the model’s own output limit.')}</div>
          <div className="adm-kv"><span className="k">{adminT('Max output tokens')}</span>
            <span className="v"><input className="num" type="number" min="1024" max="65536" defaultValue={d.maxOutputTokens} disabled={busy}
              onBlur={e => +e.target.value !== d.maxOutputTokens && patch({ maxOutputTokens: +e.target.value })} /></span></div>

          <div className="adm-group-t" style={{ marginTop: 14 }}>{adminT('Compare with others')}</div>
          <div className="row between" style={{ gap: 12, alignItems: 'flex-start' }}>
            <div className="adm-hint" style={{ margin: 0 }}>
              <b>{adminT('Let people compare with each other.')}</b> {adminT('Anonymous medians (estimated 1RM, sessions per week) across profiles that opt in; at least three must share before anyone sees a number. Each person switches themselves on in the Coach chat, and sees nothing unless they do.')}
            </div>
            <Switch checked={!!d.community} disabled={busy} onChange={v => patch({ community: v })} />
          </div>

          <div className="adm-group-t" style={{ marginTop: 14 }}>{adminT('Whose account pays')}</div>
          <div className="adm-hint">{d.authMode === 'profile'
            ? adminT('Each profile signs in with their own account.')
            : d.auth?.type === 'apikey' || meta.http
              ? adminT('One API key for the whole instance: every profile may use the Coach with it, and the daily limits above are what bound the spend.')
              : d.boundUid
                ? adminT("One personal account, already in use by one profile. Every other profile is refused, so nobody spends somebody else's subscription.")
                : adminT('One personal account. The first profile to use it becomes the only one allowed to; every other profile is then refused. Paste an API key instead if the whole instance should have the Coach.')}</div>

          <div className="adm-group-t" style={{ marginTop: 14 }}>{adminT('Isolation')}</div>
          <div className="adm-hint">{d.unprivileged && !d.unprivileged.ok
            ? <span style={{ color: 'var(--red)' }}>{adminT('Jobs are blocked: {0}. Nothing runs until this is fixed.', d.unprivileged.why)}</span>
            : d.unprivileged?.dropped
              ? adminT('Jobs run as a separate unprivileged user that cannot read your data directory or secrets.')
              : d.unprivileged?.why?.includes('no child process')
                ? adminT('Not needed for this provider. It makes an HTTPS request and starts no program on this server.')
                : adminT('Jobs run with the server’s own user on this host (no separate user to drop to).')}</div>
        </div>
      </details>

      {/* ---------- activity ---------- */}
      <details className="adm-fold">
        <summary>{adminT('Activity')} <Icon name="chevronRight" className="chev" /></summary>
        <div className="adm-fold-b">
          <div className="tiles" style={{ textAlign: 'start', marginBottom: 10 }}>
            <div className="tile"><div className="l">{adminT('Jobs today')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.jobsToday}</div></div>
            <div className="tile"><div className="l">{adminT('Last success')}</div><div className="v" style={{ fontSize: '.85rem' }}>{rel(d.lastSuccess?.at)}</div></div>
          </div>
          {d.lastError && <>
            <div className="adm-group-t">{adminT('Last failure')}</div>
            <div className="adm-result bad" style={{ marginTop: 0, marginBottom: 10 }}>
              <b>{failureTitle(d.lastError.errorClass)}</b>
              {d.lastError.detail ? <span className="small">{d.lastError.detail}</span> : null}
              <div className="dim" style={{ fontSize: '.72rem', marginTop: 4 }}>{rel(d.lastError.at)}</div>
            </div>
          </>}
          <div className="adm-group-t">{adminT('Recent jobs')}</div>
          {d.recent?.length ? <div className="adm-log">
            {d.recent.slice(0, 10).map((e, i) => <div key={i} className="adm-log-row">
              <span>{adminT(e.kind === 'create' ? 'Plan' : 'Review')}{e.trigger === 'scheduled' ? ' · ' + adminT('scheduled') : ''} · <span style={{ color: e.outcome === 'failed' ? 'var(--red)' : e.outcome === 'ready' ? 'var(--acc)' : 'var(--label-2)' }}>{adminT(e.outcome === 'failed' ? 'failed' : e.outcome === 'ready' ? 'ready' : e.outcome)}</span>{e.ms ? ' · ' + adminT('{0} s', Math.round(e.ms / 1000)) : ''}</span>
              <span className="when">{rel(e.at)}</span>
            </div>)}
          </div> : <div className="adm-empty">{adminT('No jobs yet.')}</div>}
          <div className="adm-hint" style={{ margin: '8px 0 0' }}>{adminT('Counts and outcomes only. What people asked the Coach, and what it answered, is never shown here.')}</div>
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
  useLang()
  const s = auth?.state
  if (s === 'connected') return <span className="adm-pill ok">{adminT('connected')}{auth.account ? ' · ' + auth.account : ''}</span>
  if (s === 'not-required') return <span className="adm-pill">{adminT('not needed')}</span>
  if (s === 'optional') return <span className="adm-pill">{adminT('optional, none saved')}</span>
  if (s === 'unreadable') return <span className="adm-pill bad">{adminT("can't be read")}</span>
  return <span className="adm-pill warn">{adminT('needed')}</span>
}

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
      toast(r.test?.ok ? adminT('Connected ✅') : adminT('Token saved'))
      close(); onDone()
    } catch (e) { toast(e.message); setBusy(false) }
  }

  return <>
    <h3>{adminT('Connect {0}', label)}</h3>
    <div className="muted small" style={{ lineHeight: 1.5, marginBottom: 12 }}>
      {adminT('On a trusted computer where you use Claude Code, run Claude setup-token, complete its normal browser sign-in, then paste the token it prints here. This app never opens or handles Claude’s authorization flow.')}
    </div>
    <TextField value={token} autoFocus type="password" placeholder={adminT('paste setup token')} onChange={e => setToken(e.target.value)} />
    <div style={{ height: 8 }} />
    <TextField value={account} placeholder={adminT('whose account is this? (e.g. you@example.com)')} onChange={e => setAccount(e.target.value)} />
    <div style={{ height: 12 }} />
    <Button variant="primary" disabled={busy || !token.trim()} onClick={save}>{adminT('Save token')}</Button>
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
      toast(r.test?.ok ? adminT('Key saved ✅') : adminT('Key saved'))
      close(); onDone()
    } catch (e) { toast(e.message); setBusy(false) }
  }
  return <>
    <h3>{label} {adminT('API key')}</h3>
    <div className="muted small" style={{ lineHeight: 1.5, marginBottom: 12 }}>
      {adminT('Stored encrypted on this server and sent to the provider only while a job runs. It is never shown again and never leaves the server.')}{optional ? ' ' + adminT('For an endpoint that takes no key, you can leave this empty and close the sheet.') : ''}
    </div>
    <TextField value={key} autoFocus type="password" placeholder={placeholder || 'sk-…'} autoCapitalize="none" autoCorrect="off" onChange={e => setKey(e.target.value)} />
    <div style={{ height: 12 }} />
    <Button variant="primary" disabled={busy || !key.trim()} onClick={save}>{adminT('Save key')}</Button>
    <div style={{ height: 8 }} />
  </>
}
