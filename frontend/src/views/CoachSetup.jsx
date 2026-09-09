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
import { t } from '../lib/i18n.js'
import { MOBILE } from '../lib/mobile.js'
import { CATEGORY_TEXT } from '../lib/coach.js'
import { getApiKey, setApiKey, clearApiKey } from '../lib/coach-secrets.js'
import { HTTP_PROVIDERS, HTTP_PROVIDER_IDS, baseUrlFor, validateBaseUrl } from '../../../api/coach/core/providers.js'
import { DATA_CATEGORIES } from '../../../api/coach/core/categories.js'
import { ConnectSheet } from './MobileOnboarding.jsx'
import Icon from '../components/Icon.jsx'
import { Section, Row, Button, TextField } from '../components/ui.jsx'

const STEPS = ['Loading the exercise catalogue…', 'Checking the endpoint…', 'Ready']

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
  const [step, setStep] = useState(-1)                     // -1 idle, 0..2 running, 3 done
  const [busy, setBusy] = useState(false)

  useEffect(() => { if (!MOBILE) nav('/settings', { replace: true }) }, [])
  useEffect(() => { getApiKey().then(k => setHasKey(!!k)) }, [])
  // Ask the paired server afresh: the admin may have switched the Coach on since this phone booted.
  useEffect(() => { if (user) refreshConfig() }, [user])
  useEffect(() => { setModels(null); setModel(coachLocal?.provider === provider ? (coachLocal?.model || '') : '') }, [provider])

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
  const prepare = async () => {
    const v = validateBaseUrl(meta.baseUrl ? baseUrl : '')
    if (!v.ok) return toast(v.error)
    if (!meta.keyOptional && !key.trim() && !hasKey) return toast(t('Enter your API key'))
    setBusy(true); setStep(0)
    try {
      const local = await import('../lib/coach-local.js')
      setStep(1)
      const k = key.trim() || await getApiKey()
      const r = await local.localModels({ provider, baseUrl: v.value }, k)
      if (!r.ok) { setStep(-1); toast(t('Could not reach the provider: {0}', r.error)); return }
      setModels(r.models)
      setStep(2)
      if (!model && meta.defaultModel && r.models.includes(meta.defaultModel)) setModel(meta.defaultModel)
    } catch (e) {
      setStep(-1); toast(e.message || t('Could not connect'))
    } finally { setBusy(false) }
  }

  const save = async () => {
    const chosen = model || meta.defaultModel
    if (!chosen) return toast(t('Pick a model'))
    setBusy(true)
    try {
      // The mode first, the key second: the settings file is the cheap, reliable write, the
      // key goes through the platform's secure store, which is the step that can misbehave.
      // Either way the user hears what happened instead of watching a greyed-out button (#42).
      await setCoachLocal({ mode: 'byok', provider, model: chosen, baseUrl: meta.baseUrl ? (validateBaseUrl(baseUrl).value || null) : null })
      if (key.trim()) { await setApiKey(key.trim()); setHasKey(true); setKey('') }
      toast(t('The Coach is on'))
      nav('/coach')
    } catch (e) {
      toast(e?.message || t('Could not connect'))
    } finally { setBusy(false) }
  }

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
    : t('Off — choose how the Coach should run.')

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>{t('AI Coach')}</h1></div>
    </div>

    <Section title={t('How should the Coach run?')} footer={current}>
      <Row icon="rocket" iconTint="var(--indigo)" title={t('Use my self-hosted openGym')}
        subtitle={user ? (serverHasCoach ? t('Your server runs the Coach with whatever provider its admin set up. Nothing new leaves this phone beyond what already syncs.') : config == null ? t('Loading…') : t('Your server has no Coach enabled — ask its admin, or bring your own key below.')) : t('Connect to my server')}
        accessory="chevron" onClick={() => { if (!user || serverHasCoach) useServer(); else setChoice('server') }} />
      <Row icon="key" iconTint="var(--acc)" title={t('Bring my own API key')}
        subtitle={t('This phone calls the provider directly with your key. Every request is charged to your account.')}
        accessory="chevron" onClick={() => setChoice('byok')} />
    </Section>

    {choice === 'server' && !serverHasCoach && <div className="card">
      <div className="muted small">{t('Your server has no Coach enabled — ask its admin, or bring your own key below.')}</div>
    </div>}

    {choice === 'byok' && <>
      <Section title={t('Provider')}>
        <div className="row" style={{ flexWrap: 'wrap', gap: 7, padding: '8px 12px' }}>
          {HTTP_PROVIDER_IDS.map(id => <button key={id} className={'chip' + (id === provider ? ' on' : '')} disabled={busy}
            onClick={() => setProvider(id)}>{HTTP_PROVIDERS[id].label}</button>)}
        </div>
      </Section>

      {meta.baseUrl && <Section title={t('Endpoint')}>
        <div style={{ padding: '8px 12px' }}>
          <TextField value={baseUrl} placeholder="http://ollama.lan:11434" inputMode="url" autoCapitalize="none" autoCorrect="off"
            onChange={e => setBaseUrl(e.target.value)} />
        </div>
      </Section>}

      <Section title={t('API key')} footer={t('The key is stored in this phone’s secure storage and never leaves it except to call the provider.')}>
        <div style={{ padding: '8px 12px' }}>
          <TextField value={key} type="password" placeholder={hasKey ? '••••••••  ' + t('(saved)') : (meta.keyPlaceholder || 'sk-…')} autoCapitalize="none" autoCorrect="off"
            onChange={e => setKey(e.target.value)} />
        </div>
      </Section>

      <Section title={t('What leaves this phone')}>
        {DATA_CATEGORIES.map(k => {
          const [title, sub] = CATEGORY_TEXT[k] || [k, '']
          return <Row key={k} icon="check" iconTint="var(--acc)" title={t(title)} subtitle={t(sub)} />
        })}
      </Section>
      <p className="sect-f" style={{ marginTop: -18, marginBottom: 22, lineHeight: 1.5 }}>
        {t('Each request goes straight to {0} with your key — nobody else sees it, and you pay for it.', host || meta.label)}
      </p>

      {step >= 0 && <div className="card">
        {STEPS.map((s, i) => <div key={s} className="row" style={{ gap: 8, padding: '3px 0', opacity: i > step ? .4 : 1 }}>
          <span style={{ color: i < step || step === 2 ? 'var(--green)' : i === step ? 'var(--acc)' : 'var(--dim)' }}><Icon name={i < step || step === 2 ? 'check' : 'timer'} /></span>
          <span className="small">{t(s)}</span>
        </div>)}
      </div>}

      {models && <Section title={t('Model')}>
        <div style={{ padding: '8px 12px' }}>
          <select className="input" value={model} disabled={busy} onChange={e => setModel(e.target.value)} style={{ width: '100%' }}>
            <option value="">{meta.defaultModel ? `(${meta.defaultModel})` : t('Pick a model')}</option>
            {models.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      </Section>}

      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {!models
          ? <Button variant="primary" icon="sparkles" disabled={busy} onClick={prepare}>{t('List models')}</Button>
          : <Button variant="primary" icon="check" disabled={busy} onClick={save}>{t('Save and use the Coach')}</Button>}
        {models && <Button disabled={busy} onClick={prepare}>{t('List models')}</Button>}
      </div>
    </>}

    {coachLocal?.mode && coachLocal.mode !== 'off' && <Section title={t('Controls')}>
      <Row icon="signOut" iconTint="var(--red)" title={t('Turn the Coach off on this phone')} danger onClick={turnOff} />
    </Section>}
  </div>
}

const hostOf = url => { try { return new URL(url).host } catch { return '' } }
