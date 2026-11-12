// Mobile build only: how the Coach should run on this phone.
//
// Two answers. "Use my self-hosted openGym" hands the whole thing to the paired server — the
// same Coach the web app has, with whatever provider its admin configured; the phone only has
// to be paired. "Bring my own API key" runs the pipeline on the phone against Anthropic,
// OpenAI, Gemini or an OpenAI-compatible endpoint, with a key that stays in secure storage.
//
// The promise this screen keeps: nothing AI-shaped is loaded until a mode is chosen. Its only
// imports from the Coach core are the provider table and the five category names — the
// catalogue, the prompts and the validator arrive through one dynamic import, behind a
// progress line that reports real steps rather than a pretend byte counter.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, tn } from '../lib/i18n.js'
import { MOBILE } from '../lib/mobile.js'
import { CATEGORY_TEXT } from '../lib/coach.js'
import { getApiKey, setApiKey, clearApiKey } from '../lib/coach-secrets.js'
import { coachLimits, clampCoachLimit, COACH_LIMITS } from '../lib/coach-device.js'
import { HTTP_PROVIDERS, HTTP_PROVIDER_IDS, baseUrlFor, validateBaseUrl, phoneMayCall, providerOfKey, priceTier } from '../../../api/coach/core/providers.js'
import { DATA_CATEGORIES } from '../../../api/coach/core/categories.js'
import { ConnectSheet } from './MobileOnboarding.jsx'
import { AiConsentSection } from '../components/CoachConsentSheet.jsx'
import Icon from '../components/Icon.jsx'
import { Section, Row, Button, TextField } from '../components/ui.jsx'

// Literal t() calls, so check-source-strings sees the three lines; t(s) over a list of keys hid them.
const STEPS = () => [t('Loading the exercise catalogue…'), t('Checking the endpoint…'), t('Ready')]

// The phone calls the provider through CapacitorHttp, native networking. A model on the home
// network (llama.cpp, Ollama, LM Studio on 192.168.x.x) has no certificate a phone trusts, so
// plain http:// is allowed there (#913), and only there: providers.js phoneMayCall says what
// counts as the home network. Android lets the app speak cleartext to any host
// (network_security_config.xml, #428: it cannot scope that to address ranges) and iOS to local
// addresses (Info.plist NSAllowsLocalNetworking), so this check is what keeps a key and training
// data from ever going over the internet unencrypted. It runs again before every call
// (coach-local.js). The web app has no such screen: in a browser the Coach always runs on the
// server, which reaches http:// on its own network (an https page could not call http:// itself).
// The big cards: the ways most people get going. `local` is the compatible endpoint, found on the
// network; MiniMax and a hand-typed compatible endpoint stay one tap further, as chips.
const CARDS = [
  { id: 'openrouter', provider: 'openrouter', icon: 'sparkles', tint: 'var(--indigo)', line: () => t('One sign-in for Claude, GPT, Gemini and more') },
  { id: 'anthropic', provider: 'anthropic', icon: 'key', tint: 'var(--orange)', line: () => t('Claude, with an API key') },
  { id: 'openai', provider: 'openai', icon: 'key', tint: 'var(--green)', line: () => t('GPT, with an API key') },
  { id: 'gemini', provider: 'gemini', icon: 'key', tint: 'var(--blue)', line: () => t('Gemini, with a free tier to start') },
  { id: 'local', provider: 'compatible', icon: 'house', tint: 'var(--teal)', title: () => t('On my network'), line: () => t('Ollama or LM Studio at home, nothing leaves your Wi-Fi') }
]
const TIER = { free: () => t('free'), low: () => '$', mid: () => '$$', high: () => '$$$' }
const tierOf = (m, prices) => { const k = priceTier(m, prices && prices[m]); return k ? TIER[k]() : '' }

const isCleartext = url => /^http:\/\//i.test(String(url || '').trim())
const cleartextRefused = () => t('Plain http:// only works for an address on your home network, like 192.168.x.x, a .local name or a Tailscale 100.x address. Anything on the internet needs https://.')

export default function CoachSetup() {
  const nav = useNavigate()
  const user = useStore(s => s.user)
  const config = useStore(s => s.config)
  const coachLocal = useStore(s => s.coachLocal)
  const setCoachLocal = useStore(s => s.setCoachLocal)
  const refreshConfig = useStore(s => s.refreshConfig)
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)

  const [choice, setChoice] = useState(null)              // 'server' | 'byok' | null
  const [provider, setProvider] = useState(coachLocal?.provider || 'anthropic')
  const [baseUrl, setBaseUrl] = useState(coachLocal?.baseUrl || '')
  const [model, setModel] = useState(coachLocal?.model || '')
  const [key, setKey] = useState('')
  const [hasKey, setHasKey] = useState(false)
  const [models, setModels] = useState(null)
  const [prices, setPrices] = useState(null)
  const cardFor = id => (id === 'compatible' ? 'local' : CARDS.some(c => c.id === id) ? id : null)
  const [card, setCard] = useState(cardFor(coachLocal?.provider || 'anthropic'))
  const [found, setFound] = useState(null)               // local discovery: null idle, [] none, [...]
  const [orSession, setOrSession] = useState(null)       // a running OpenRouter sign-in, for the paste fallback
  const [orCode, setOrCode] = useState('')
  const [step, setStep] = useState(-1)                     // -1 idle, 0..2 running, 3 done
  const [busy, setBusy] = useState(false)
  // The three dials the server's admin card has and the phone never did (issue #527). Read from
  // the device file as clamped, effective values; kept in local state so a number can be typed
  // freely and is only clamped and saved when the field is left.
  const [limits, setLimits] = useState(() => coachLimits(coachLocal))

  useEffect(() => { if (!MOBILE) nav('/settings', { replace: true }) }, [])
  useEffect(() => { getApiKey().then(k => setHasKey(!!k)) }, [])
  // Ask the paired server afresh: the admin may have switched the Coach on since this phone booted.
  useEffect(() => { if (user) refreshConfig() }, [user])
  useEffect(() => { setModels(null); setPrices(null); setModel(coachLocal?.provider === provider ? (coachLocal?.model || '') : '') }, [provider])
  useEffect(() => { setLimits(coachLimits(coachLocal)) }, [coachLocal])

  const editLimit = (k, raw) => setLimits(l => ({ ...l, [k]: raw }))
  const commitLimit = k => {
    const clamped = clampCoachLimit(k, limits[k])
    setLimits(l => ({ ...l, [k]: clamped }))
    setCoachLocal({ limits: { ...limits, [k]: clamped } })
  }

  const meta = HTTP_PROVIDERS[provider] || {}
  const host = hostOf(baseUrlFor(provider, { providerOptions: { [provider]: { baseUrl } } }))
  const serverHasCoach = !!(user && config?.coach?.enabled)

  const useServer = async () => {
    if (!user) return openSheet(close => <ConnectSheet close={close} />)
    await setCoachLocal({ mode: 'server' })
    toast(t('The Coach is on'))
    nav('/coach')
  }

  // The lazy load, and the reachability check, as three real steps.
  // `typed`: a key just pasted, tested before React has the state for it (the Gemini flow).
  const prepare = async (typed) => {
    const fresh = typeof typed === 'string' ? typed : key
    const v = validateBaseUrl(meta.baseUrl ? baseUrl : '')
    if (!v.ok) return toast(v.error)
    // An empty field passes the validator on purpose: for a provider with a fixed endpoint,
    // empty means the default. This one has no default, so empty is nowhere to call.
    if (meta.baseUrl && !meta.defaultBase && !v.value) return toast(t('Enter the endpoint URL'))
    if (v.value && !phoneMayCall(v.value)) return toast(cleartextRefused())
    if (!meta.keyOptional && !fresh.trim() && !hasKey) return toast(t('Enter your API key'))
    setBusy(true); setStep(0)
    try {
      const local = await import('../lib/coach-local.js')
      setStep(1)
      const k = fresh.trim() || await getApiKey()
      const r = await local.localModels({ provider, baseUrl: v.value }, k)
      if (!r.ok) { setStep(-1); toast(t('Could not reach the provider: {0}', r.error)); return }
      setModels(r.models)
      setPrices(r.prices || null)

      setStep(2)
      if (!model && meta.defaultModel && r.models.includes(meta.defaultModel)) setModel(meta.defaultModel)
    } catch (e) {
      setStep(-1); toast(e.message || t('Could not connect'))
    } finally { setBusy(false) }
  }

  const save = async () => {
    // The same check "List models" makes. The endpoint field stays editable after a successful
    // listing, and taking `.value` off an unchecked result turned a typo into `baseUrl: null` —
    // saved, "The Coach is on", and the phone pointed at nothing.
    const v = validateBaseUrl(meta.baseUrl ? baseUrl : '')
    if (!v.ok) return toast(v.error)
    if (meta.baseUrl && !meta.defaultBase && !v.value) return toast(t('Enter the endpoint URL'))
    const chosen = model || meta.defaultModel
    if (!chosen) return toast(t('Pick a model'))
    // The endpoint can still be edited after the models were listed.
    if (v.value && !phoneMayCall(v.value)) return toast(cleartextRefused())
    setBusy(true)
    try {
      // The mode first, the key second: the settings file is the cheap, reliable write, the
      // key goes through the platform's secure store, which is the step that can misbehave.
      // Either way the user hears what happened instead of watching a greyed-out button (#42).
      await setCoachLocal({ mode: 'byok', provider, model: chosen, baseUrl: meta.baseUrl ? v.value : null })
      if (key.trim()) { await setApiKey(key.trim()); setHasKey(true); setKey('') }
      toast(t('The Coach is on'))
      nav('/coach')
    } catch (e) {
      toast(e?.message || t('Could not connect'))
    } finally { setBusy(false) }
  }

  // A pasted key that has another provider's shape switches to that provider, said out loud.
  const onKey = v => {
    const before = key
    setKey(v)
    const other = providerOfKey(v)
    if (other && other !== provider && HTTP_PROVIDERS[other]) {
      setProvider(other)
      setCard(cardFor(other))
      toast(t('That looks like a {0} key, so I switched to {0}.', HTTP_PROVIDERS[other].label))
      return
    }
    // A whole key pasted in one go, of this provider's shape: test it straight away, so the
    // one-minute Gemini flow ends on "It works!" without another tap.
    if (other === provider && v.trim().length >= 30 && v.length - before.length > 20 && !busy) prepare(v)
  }
  const pasteKey = async () => {
    let v = ''
    try { v = (await navigator.clipboard?.readText?.()) || '' } catch { /* refused: say so below */ }
    if (!v.trim()) return toast(t('Nothing to paste. Copy the key first, then try again.'))
    onKey(v.trim())
  }
  const pick = c => { setCard(c.id); setProvider(c.provider); setFound(null); setOrSession(null) }

  // A key from OpenRouter's own sign-in goes where a pasted one would, then the models are listed.
  const gotOpenRouterKey = async k => {
    await setApiKey(k); setHasKey(true); setKey(''); setOrSession(null); setOrCode('')
    toast(t('Signed in with OpenRouter'))
    await prepare()
  }
  const signInOpenRouter = async () => {
    setBusy(true)
    const m = await import('../lib/openrouter-signin.js')
    const sess = await m.phoneSession()
    setOrSession(sess)
    try { await gotOpenRouterKey(await m.phoneSignIn({ session: sess })) }
    catch (e) { if (e?.code !== 'cancelled') toast(t('The OpenRouter sign-in did not work: {0}', e.message)) }
    finally { setBusy(false) }
  }
  const redeemOpenRouter = async () => {
    if (!orSession) return
    setBusy(true)
    try { await gotOpenRouterKey(await orSession.redeem(orCode)) }
    catch (e) { toast(e?.code === 'nocode' ? t('That doesn’t look like a code from OpenRouter.') : t('The OpenRouter sign-in did not work: {0}', e.message)) }
    finally { setBusy(false) }
  }
  const pasteInstead = async () => {
    const sess = orSession || await (await import('../lib/openrouter-signin.js')).phoneSession()
    setOrSession(sess)
    window.open(sess.headlessUrl, '_blank', 'noopener')
  }

  // Ollama, LM Studio or llama.cpp: the paired server's machine first, then this phone's own names.
  const findLocal = async () => {
    setBusy(true); setFound(null)
    try {
      const { candidatesFor, discoverLocal } = await import('../../../api/coach/core/local-discovery.js')
      const { loadRemote } = await import('../lib/remote.js')
      const remote = await loadRemote().catch(() => null)
      const hosts = [hostOf(remote?.url || '').replace(/:\d+$/, ''), 'localhost', 'ollama.local', 'lmstudio.local'].filter(Boolean)
      const local = await import('../lib/coach-local.js')
      setFound(await discoverLocal(candidatesFor(hosts), { fetch: local.guardedFetch }))
    } catch { setFound([]) }
    finally { setBusy(false) }
  }
  const useFound = f => { setBaseUrl(f.base); setModels(f.models); setPrices(null); setStep(2); if (f.models[0]) setModel(f.models[0]) }

  const turnOff = async () => {
    await clearApiKey(); setHasKey(false)
    await setCoachLocal({ mode: 'off' })
    const local = await import('../lib/coach-local.js').catch(() => null)
    if (local) await local.localForget()
    setChoice(null)
    toast(t('The Coach is off'))
  }

  const current = coachLocal?.mode === 'server' ? t('Runs on your openGym server')
    : coachLocal?.mode === 'byok' ? t('Runs on this phone with your own API key')
    : t('Off. Choose how the Coach should run.')

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" data-back="/settings" onClick={() => nav('/settings')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginInlineStart: 12 }}><h1>{t('AI Coach')}</h1></div>
    </div>

    <Section footer={t('No API key needed: Claude, ChatGPT or Gemini come to openGym as a connector, on the plan you already pay for.')}>
      <Row icon="chat" iconTint="var(--acc)" title={t('Use your Claude, ChatGPT or Gemini plan')} subtitle={t('Add openGym to the assistant app you already pay for')}
        accessory="chevron" onClick={() => nav('/assistants')} />
    </Section>

    <Section title={t('How should the Coach run?')} footer={current}>
      <Row icon="rocket" iconTint="var(--indigo)" title={t('Use my self-hosted openGym')}
        subtitle={user ? (serverHasCoach ? t('Your server runs the Coach with whatever provider its admin set up. Nothing new leaves this phone beyond what already syncs.') : config == null ? t('Loading…') : t('Your server has no Coach enabled. Ask its admin, or bring your own key below.')) : t('Connect to my server')}
        accessory="chevron" onClick={() => { if (!user || serverHasCoach) useServer(); else setChoice('server') }} />
      <Row icon="key" iconTint="var(--acc)" title={t('Bring my own API key')}
        subtitle={t('This phone calls the provider directly with your key. Every request is charged to your account.')}
        accessory="chevron" onClick={() => setChoice('byok')} />
    </Section>

    {choice === 'server' && !serverHasCoach && <div className="card">
      <div className="muted small">{t('Your server has no Coach enabled. Ask its admin, or bring your own key below.')}</div>
    </div>}

    {choice === 'byok' && <>
      <Section title={t('Pick your AI')}>
        <div className="cs-cards">
          {CARDS.map(c => <button key={c.id} type="button" className={'cs-card' + (card === c.id ? ' on' : '')} disabled={busy} aria-pressed={card === c.id} onClick={() => pick(c)}>
            <span className="cs-card-i" style={{ color: c.tint }}><Icon name={c.icon} /></span>
            <span className="cs-card-t">{c.title ? c.title() : HTTP_PROVIDERS[c.provider].label}</span>
            <span className="cs-card-s">{c.line()}</span>
          </button>)}
        </div>
        <div className="row" style={{ flexWrap: 'wrap', gap: 7, padding: '4px 12px 10px' }}>
          {HTTP_PROVIDER_IDS.filter(id => !CARDS.some(c => c.provider === id && c.id !== 'local')).map(id => <button key={id} className={'chip' + (id === provider && !card ? ' on' : '')} disabled={busy}
            onClick={() => { setCard(null); setProvider(id); setFound(null) }}>{HTTP_PROVIDERS[id].label}</button>)}
        </div>
      </Section>

      {card === 'local' && <Section title={t('On my network')} footer={t('Looks for Ollama, LM Studio and llama.cpp on the machine running your openGym server and on this phone.')}>
        <Row icon="magnifier" iconTint="var(--teal)" title={t('Find it for me')} accessory="chevron" onClick={busy ? undefined : findLocal} />
        {found && !found.length && <div className="muted small" style={{ padding: '4px 12px 10px' }}>{t('Nothing answered. Type its address below, like http://192.168.1.20:11434.')}</div>}
        {(found || []).map(f => <Row key={f.base} icon="check" iconTint="var(--green)" title={f.kind} subtitle={f.base + ' · ' + tn('{0} model', '{0} models', f.models.length)} accessory="chevron" onClick={() => useFound(f)} />)}
      </Section>}

      {meta.baseUrl && <Section title={t('Endpoint')}
        footer={isCleartext(baseUrl) && !phoneMayCall(baseUrl) ? <span style={{ color: 'var(--red)' }}>{cleartextRefused()}</span> : t('Plain http only on your home network')}>
        <div style={{ padding: '8px 12px' }}>
          <TextField value={baseUrl} placeholder="https://ollama.example.com" inputMode="url" autoCapitalize="none" autoCorrect="off"
            onChange={e => setBaseUrl(e.target.value)} />
        </div>
      </Section>}

      {meta.signIn === 'pkce' && <Section title={t('Sign in')} footer={t('OpenRouter makes a key just for this phone, billed to your OpenRouter credits. You can revoke it there any time.')}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', padding: '8px 12px' }}>
          <Button variant="primary" icon="person" disabled={busy} onClick={signInOpenRouter}>{t('Sign in with OpenRouter')}</Button>
          <Button variant="tinted" disabled={busy} onClick={pasteInstead}>{t('Paste a code instead')}</Button>
        </div>
        {orSession && <div className="row" style={{ gap: 8, padding: '0 12px 10px' }}>
          <div style={{ flex: 1 }}><TextField value={orCode} placeholder={t('Code from OpenRouter')} autoCapitalize="none" autoCorrect="off" onChange={e => setOrCode(e.target.value)} /></div>
          <Button disabled={busy || !orCode.trim()} onClick={redeemOpenRouter}>{t('Use code')}</Button>
        </div>}
      </Section>}

      <Section title={meta.signIn === 'pkce' ? t('Or paste a key') : t('API key')} footer={t('The key is stored in this phone’s secure storage and never leaves it except to call the provider.')}>
        <div style={{ padding: '8px 12px' }}>
          <TextField value={key} type="password" placeholder={hasKey ? '••••••••  ' + t('(saved)') : (meta.keyPlaceholder || 'sk-…')} autoCapitalize="none" autoCorrect="off"
            onChange={e => onKey(e.target.value)} />
        </div>
        {provider === 'gemini' && <ol className="cs-steps">
          <li>{t('Open Google AI Studio and sign in with your Google account.')}</li>
          <li>{t('Press Create API key and copy it.')}</li>
          <li>{t('Come back and paste it. openGym tests it on its own.')}</li>
        </ol>}
        {meta.keyUrl && <Row icon="link" iconTint="var(--acc)" title={provider === 'gemini' ? t('Open Google AI Studio') : t('Get a key from {0}', meta.label)} subtitle={hostOf(meta.keyUrl)} accessory="chevron" onClick={() => window.open(meta.keyUrl, '_blank', 'noopener')} />}
        {provider === 'anthropic' && <Row icon="lightbulb" iconTint="var(--yellow)" title={t('Got Claude Max? Your plan includes monthly API credits: create a key here')}
          subtitle={t('Max, Ultra and Team plans. Link the Console once under Billing on claude.ai.')} accessory="chevron" onClick={() => window.open('https://platform.claude.com/settings/keys', '_blank', 'noopener')} />}
        <Row icon="clipboard" iconTint="var(--grey)" title={t('Paste the key')} accessory="none" onClick={busy ? undefined : pasteKey} />
      </Section>

      <Section title={t('What leaves this phone')}>
        {DATA_CATEGORIES.map(k => {
          const [title, sub] = CATEGORY_TEXT[k]?.() || [k, '']
          return <Row key={k} icon="check" iconTint="var(--acc)" title={title} subtitle={sub} />
        })}
      </Section>
      <p className="sect-f" style={{ marginTop: -18, marginBottom: 22, lineHeight: 1.5 }}>
        {t('Each request goes straight to {0} with your key. Nobody else sees it, and you pay for it.', host || meta.label)}
      </p>

      {step >= 0 && <div className="card">
        {STEPS().map((s, i) => <div key={s} className="row" style={{ gap: 8, padding: '3px 0', opacity: i > step ? .4 : 1 }}>
          <span style={{ color: i < step || step === 2 ? 'var(--green)' : i === step ? 'var(--acc)' : 'var(--dim)' }}><Icon name={i < step || step === 2 ? 'check' : 'hourglass'} /></span>
          <span className="small">{s}</span>
        </div>)}
      </div>}

      {models && step === 2 && <div className="cs-ok" role="status"><Icon name="checkCircle" /> {tn('It works! {0} model to pick from.', 'It works! {0} models to pick from.', models.length)}</div>}

      {models && <Section title={t('Model')}>
        <div style={{ padding: '8px 12px' }}>
          <select className="input" value={model} disabled={busy} onChange={e => setModel(e.target.value)} style={{ width: '100%' }}>
            <option value="">{meta.defaultModel ? `(${meta.defaultModel})` : t('Pick a model')}</option>
            {models.map(m => { const tier = tierOf(m, prices); return <option key={m} value={m}>{tier ? `${m}  ·  ${tier}` : m}</option> })}
          </select>
        </div>
      </Section>}

      {/* The server's admin card, for the person who owns this phone: in BYOK mode there is no
          other profile, so the limits protect nobody but the account already holding the key. */}
      <Section title={t('Advanced')}>
        <LimitRow label={t('Max output tokens')} hint={t('The ceiling on one answer. Reasoning models count its hidden thinking against it, so raise it if a plan is cut off.')}
          value={limits.maxOutputTokens} min={COACH_LIMITS.maxOutputTokens.min} max={COACH_LIMITS.maxOutputTokens.max}
          onChange={v => editLimit('maxOutputTokens', v)} onCommit={() => commitLimit('maxOutputTokens')} />
        <LimitRow label={t('Daily runs')} hint={t('Every Coach run is one request on your provider account. 0 means no limit.')}
          value={limits.daily} min={COACH_LIMITS.daily.min} max={COACH_LIMITS.daily.max}
          onChange={v => editLimit('daily', v)} onCommit={() => commitLimit('daily')} />
        <LimitRow label={t('Max message length')} hint={t('How long a message, refinement or review note can be.')}
          value={limits.maxMessageLen} min={COACH_LIMITS.maxMessageLen.min} max={COACH_LIMITS.maxMessageLen.max}
          onChange={v => editLimit('maxMessageLen', v)} onCommit={() => commitLimit('maxMessageLen')} />
      </Section>

      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {!models
          ? <Button variant="primary" icon="sparkles" disabled={busy} onClick={prepare}>{t('Test it')}</Button>
          : <Button variant="primary" icon="check" disabled={busy} onClick={save}>{t('Save and use the Coach')}</Button>}
        {models && <Button disabled={busy} onClick={prepare}>{t('Test it')}</Button>}
      </div>
    </>}

    {coachLocal?.mode && coachLocal.mode !== 'off' && <AiConsentSection />}

    {coachLocal?.mode && coachLocal.mode !== 'off' && <Section title={t('Controls')}>
      <Row icon="signOut" iconTint="var(--red)" title={t('Turn the Coach off on this phone')} danger onClick={turnOff} />
    </Section>}
  </div>
}

const hostOf = url => { try { return new URL(url).host } catch { return '' } }

// One numeric dial of the Advanced section: a label and its hint on the left, a plain number
// field on the right, clamped and saved when it is left rather than on every keystroke — a
// floor applied mid-typing turns a just-typed "1" into "1024".
function LimitRow({ label, hint, value, min, max, onChange, onCommit }) {
  return <div className="row between" style={{ gap: 12, padding: '10px 12px', alignItems: 'flex-start' }}>
    <div style={{ minWidth: 0 }}>
      <div style={{ fontWeight: 500 }}>{label}</div>
      <div className="muted small">{hint}</div>
    </div>
    <div style={{ width: 118, flex: 'none' }}>
      <TextField type="number" inputMode="numeric" min={min} max={max} value={value}
        onChange={e => onChange(e.target.value)} onBlur={onCommit} />
    </div>
  </div>
}
