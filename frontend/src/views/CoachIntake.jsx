// The questionnaire — the first thing the Coach asks, the moment somebody first opens it.
//
// One question per screen, big targets, as little copy as the question allows. Only goal and
// experience are required; everything after them makes the plan better without gating it,
// and someone who wants to just get training can skip through. The consent disclosure is the
// first screen of this flow rather than a separate card, because "what leaves the server" is
// the first thing to know, not a setting to find later.
//
// `?edit=1` reuses every screen as the profile editor: consent is skipped, answers are
// prefilled, and the last button saves instead of building.
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { DAYN } from '../lib/format.js'
import { EXDB } from '../lib/exercises.js'
import { emptyCoach, coachAvailable, hasConsent, CONSENT_VERSION, CATEGORY_TEXT, appendChat } from '../lib/coach.js'
import { requestPlan, disclosure } from '../lib/coach-api.js'
import { DEMO } from '../lib/demo.js'
import { MOBILE } from '../lib/mobile.js'
import Icon from '../components/Icon.jsx'
import { Button, TextArea } from '../components/ui.jsx'
import '../coach.css'

const GOALS = [
  ['strength', 'Get stronger', 'Heavier lifts, lower reps.', 'barbell'],
  ['muscle', 'Build muscle', 'Volume and progression.', 'arm'],
  ['general', 'General fitness', 'Balanced, sustainable training.', 'heart'],
  ['fatloss', 'Lose fat', 'Keep strength while leaning out.', 'flame'],
  ['endurance', 'Endurance', 'Higher reps, less rest, cardio.', 'figureRun']
]
const EXPERIENCE = [
  ['new', 'New to lifting', 'First months in the gym.', 'sparkles'],
  ['returning', 'Coming back after a break', 'You know the movements; the numbers need rebuilding.', 'reset'],
  ['regular', 'Training regularly', 'Consistent for a while now.', 'trophy']
]

// Equipment options come from the library's own taxonomy, most common first, so every choice
// on screen has exercises behind it.
const EQUIPMENT = (() => {
  const count = {}
  EXDB.forEach(e => { if (e.eq) count[e.eq] = (count[e.eq] || 0) + 1 })
  return Object.keys(count).sort((a, b) => count[b] - count[a]).slice(0, 14)
})()

const QUICK_MIN = [30, 45, 60, 90]
const toHHMM = min => String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0')
const fromHHMM = v => { const [h, m] = String(v || '').split(':').map(Number); return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null }

export default function CoachIntake() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const editing = params.get('edit') === '1'
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const config = useStore(s => s.config)
  const coachMode = useStore(s => s.coachLocal?.mode)
  const update = useStore(s => s.update)
  const toast = useUI(s => s.toast)
  const [needConsent] = useState(() => !editing && !hasConsent(S))
  const STEPS = [...(needConsent ? ['consent'] : []), 'goal', 'experience', 'days', 'length', 'equipment', 'limits', 'extras']
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [p, setP] = useState(() => ({
    goal: null, experience: null, daysPerWeek: 3, preferredDays: [1, 3, 5],
    sessionMin: 60, equipment: [], limitations: '', likes: '', dislikes: '', notes: '',
    ...(S.coach?.profile || {})
  }))
  const set = patch => setP(v => ({ ...v, ...patch }))

  if (!coachAvailable(config, user, { demo: DEMO, mobile: MOBILE, coachMode })) { nav('/home', { replace: true }); return null }

  const key = STEPS[step]
  const last = step === STEPS.length - 1
  const canNext = key === 'goal' ? !!p.goal : key === 'experience' ? !!p.experience : key === 'length' ? p.sessionMin >= 10 : true
  const optional = ['equipment', 'limits', 'extras'].includes(key)

  const next = () => (last ? finish() : setStep(step + 1))
  const back = () => (step ? setStep(step - 1) : nav(editing ? '/coach' : '/plan'))

  const agree = () => {
    update(s => { s.coach = { ...(s.coach || emptyCoach()), consent: { agreedAt: new Date().toISOString(), version: CONSENT_VERSION } } })
    setStep(step + 1)
  }

  const finish = async () => {
    const profile = { ...p, daysPerWeek: Math.min(7, Math.max(1, p.daysPerWeek || 3)) }
    update(s => {
      const c = (s.coach = s.coach || emptyCoach())
      c.profile = profile
      // The conversation opens with the answers — rendered from the profile, so an edit later
      // is reflected rather than duplicated.
      if (!editing || !(c.chat || []).some(m => m.kind === 'intake')) appendChat(s, { role: 'user', kind: 'intake' })
    })
    if (editing) { toast(t('Saved')); nav('/coach'); return }
    setBusy(true)
    try {
      await requestPlan(profile)
      nav('/coach', { replace: true })
    } catch (e) { toast(e.message || t('Could not ask the Coach')); setBusy(false) }
  }

  const toggleDay = d => set({
    preferredDays: p.preferredDays.includes(d) ? p.preferredDays.filter(x => x !== d) : [...p.preferredDays, d].sort()
  })
  const toggleEq = e => set({
    equipment: p.equipment.includes(e) ? p.equipment.filter(x => x !== e) : [...p.equipment, e]
  })

  const dots = STEPS.filter(s => s !== 'consent')
  const dotIndex = dots.indexOf(key)

  return <div className="narrow ob">
    <div className="ob-top">
      <button className="iconbtn" onClick={back} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      {key !== 'consent' && <div className="ob-dots">
        {dots.map((s, i) => <span key={s} className={'ob-dot' + (i === dotIndex ? ' on' : i < dotIndex ? ' done' : '')} />)}
      </div>}
      {optional && !last ? <button className="ob-skip" onClick={next}>{t('Skip')}</button> : <span style={{ width: 36 }} />}
    </div>

    <div className="ob-body">
      {key === 'consent' && <Consent onAgree={agree} onDecline={() => nav('/plan')} />}

      {key === 'goal' && <>
        <div className="ob-eyebrow">{t('Your goal')}</div>
        <h1 className="ob-h">{t('What are you training for?')}</h1>
        <p className="ob-p">{t('The Coach builds the whole plan around this.')}</p>
        <div className="ob-choices">
          {GOALS.map(([v, label, sub, icon]) => <Choice key={v} on={p.goal === v} icon={icon} title={t(label)} sub={t(sub)} onClick={() => set({ goal: v })} />)}
        </div>
      </>}

      {key === 'experience' && <>
        <div className="ob-eyebrow">{t('Experience')}</div>
        <h1 className="ob-h">{t('Where are you starting from?')}</h1>
        <p className="ob-p">{t('Sets the pace of progression, and how much the Coach assumes you know.')}</p>
        <div className="ob-choices">
          {EXPERIENCE.map(([v, label, sub, icon]) => <Choice key={v} on={p.experience === v} icon={icon} title={t(label)} sub={t(sub)} onClick={() => set({ experience: v })} />)}
        </div>
      </>}

      {key === 'days' && <>
        <div className="ob-eyebrow">{t('Schedule')}</div>
        <h1 className="ob-h">{t('How many days a week?')}</h1>
        <p className="ob-p">{t('Pick what you will actually keep, not the best week you can imagine.')}</p>
        <div className="ob-days">
          {[1, 2, 3, 4, 5, 6, 7].map(n => <button key={n} className={'ob-day' + (p.daysPerWeek === n ? ' on' : '')} onClick={() => set({ daysPerWeek: n })}>{n}</button>)}
        </div>
        <div className="ob-sub">{t('Which days suit you? (optional)')}</div>
        <div className="ob-week">
          {[1, 2, 3, 4, 5, 6, 0].map(d => <button key={d} className={'ob-wd' + (p.preferredDays.includes(d) ? ' on' : '')} onClick={() => toggleDay(d)}>{t(DAYN[d]).slice(0, 2)}</button>)}
        </div>
      </>}

      {key === 'length' && <>
        <div className="ob-eyebrow">{t('Session length')}</div>
        <h1 className="ob-h">{t('How long is a session?')}</h1>
        <p className="ob-p">{t('The Coach fits the volume to the time you actually have, including rest between sets.')}</p>
        {/* A duration, not a clock time — so two wheels (hours, minutes in fives), never the
            native time input, which insists on AM/PM. */}
        <div className="ob-time" role="group" aria-label={t('How long is a session?')}>
          <select className="ob-wheel" value={Math.floor((p.sessionMin || 60) / 60)}
            onChange={e => set({ sessionMin: (+e.target.value) * 60 + ((p.sessionMin || 60) % 60) || 5 })}>
            {[0, 1, 2, 3].map(h => <option key={h} value={h}>{String(h).padStart(2, '0')}</option>)}
          </select>
          <span className="ob-time-sep">:</span>
          <select className="ob-wheel" value={(p.sessionMin || 60) % 60}
            onChange={e => set({ sessionMin: Math.floor((p.sessionMin || 60) / 60) * 60 + (+e.target.value) || 5 })}>
            {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map(m => <option key={m} value={m}>{String(m).padStart(2, '0')}</option>)}
          </select>
          <span className="ob-time-l">{t('h:mm')}</span>
        </div>
        <div className="ob-quick">
          {QUICK_MIN.map(m => <button key={m} className={'chip' + (p.sessionMin === m ? ' on' : '')} onClick={() => set({ sessionMin: m })}>{m} {t('min')}</button>)}
        </div>
      </>}

      {key === 'equipment' && <>
        <div className="ob-eyebrow">{t('Equipment')}</div>
        <h1 className="ob-h">{t('What can you train with?')}</h1>
        <p className="ob-p">{t('Pick everything you have access to. Leave it empty and the Coach will use the whole library.')}</p>
        <div className="ob-chips">
          {EQUIPMENT.map(e => <button key={e} className={'chip' + (p.equipment.includes(e) ? ' on' : '')} onClick={() => toggleEq(e)}>{e}</button>)}
        </div>
      </>}

      {key === 'limits' && <>
        <div className="ob-eyebrow">{t('Limits')}</div>
        <h1 className="ob-h">{t('Anything to work around?')}</h1>
        <p className="ob-p">{t('Injuries, joints that complain, movements you cannot do, or practical limits like training at 6am in a flat.')}</p>
        <div className="ob-field">
          <TextArea rows={4} maxLength={600} value={p.limitations} onChange={e => set({ limitations: e.target.value })}
            placeholder={t('e.g. “dodgy left shoulder — no barbell overhead press”')} />
        </div>
        <div className="ob-note warn">{t('If something actually hurts, see a professional — the Coach will program conservatively but it cannot diagnose anything.')}</div>
      </>}

      {key === 'extras' && <>
        <div className="ob-eyebrow">{t('Almost there')}</div>
        <h1 className="ob-h">{t('Anything else?')}</h1>
        <p className="ob-p">{t('All optional. The more the Coach knows, the less it guesses.')}</p>
        <div className="ob-sub" style={{ marginTop: 0 }}>{t('Exercises you love')}</div>
        <div className="ob-field"><TextArea rows={2} maxLength={300} value={p.likes} onChange={e => set({ likes: e.target.value })} placeholder={t('e.g. “deadlifts, anything with a kettlebell”')} /></div>
        <div className="ob-sub" style={{ marginTop: 4 }}>{t('Exercises you would rather not')}</div>
        <div className="ob-field"><TextArea rows={2} maxLength={300} value={p.dislikes} onChange={e => set({ dislikes: e.target.value })} placeholder={t('e.g. “I hate lunges”')} /></div>
        <div className="ob-sub" style={{ marginTop: 4 }}>{t('Anything you want the Coach to know')}</div>
        <div className="ob-field"><TextArea rows={3} maxLength={600} value={p.notes} onChange={e => set({ notes: e.target.value })} placeholder={t('e.g. “I want visible arms progress by spring”')} /></div>
      </>}
    </div>

    {key !== 'consent' && <div className="ob-foot">
      <Button variant="primary" style={{ flex: 1 }} disabled={!canNext || busy} icon={last ? 'sparkles' : undefined} onClick={next}>
        {last ? (editing ? t('Save') : t('Build my plan')) : t('Continue')}
      </Button>
    </div>}
    {(key === 'goal' || key === 'experience') && !canNext && <div className="ob-hint">{t('Pick one to continue.')}</div>}
  </div>
}

function Choice({ on, icon, title, sub, onClick }) {
  return <button className={'ob-choice' + (on ? ' on' : '')} onClick={onClick}>
    <Icon name={icon} />
    <span className="ob-choice-t">{title}{sub && <span className="ob-choice-s">{sub}</span>}</span>
    <Icon name="check" className="ob-k" />
  </button>
}

/* The disclosure: what leaves, where to, who pays. Rendered from the same category list the
   payload is built from, so the promise on screen cannot drift from what actually goes. */
function Consent({ onAgree, onDecline }) {
  const config = useStore(s => s.config)
  const [info, setInfo] = useState(null)
  useEffect(() => { disclosure().then(setInfo).catch(() => {}) }, [])
  const who = info?.payer === 'you'
    ? t('Sent straight to {0} with your own API key — you pay for every request.', info.host || info.providerLabel)
    : t('Sent to {0}, running on this server under the instance owner’s account.', info?.providerLabel || config?.coach?.providerLabel || t('the configured AI provider'))
  return <>
    <div className="ob-eyebrow">{t('Before we start')}</div>
    <h1 className="ob-h">{t('Meet the Coach')}</h1>
    <p className="ob-p">{t('It designs your plan from a few answers and adjusts it from what you actually log. It never changes anything without your say-so, and you can undo every change.')}</p>
    <div className="ob-sub" style={{ marginTop: 0 }}>{t('What it reads')}</div>
    <div className="ob-consent">
      {(info?.categories || Object.keys(CATEGORY_TEXT)).map(k => {
        const [title, sub] = CATEGORY_TEXT[k] || [k, '']
        return <div key={k} className="ob-consent-row"><Icon name="check" /><div><b>{t(title)}</b><span>{t(sub)}</span></div></div>
      })}
    </div>
    <div className="ob-fine">
      <div>{who}</div>
      <div>{t('Your name, your sign-in details and everything else about your account stay here. Other people’s data is never included.')}</div>
      <div style={{ color: 'var(--yellow)' }}>{t('The Coach is not a doctor or a physiotherapist. If something hurts, ask a professional.')}</div>
    </div>
    <div className="ob-foot" style={{ flexDirection: 'column' }}>
      <Button variant="primary" onClick={onAgree}>{t('I understand — let’s go')}</Button>
      <Button onClick={onDecline}>{t('Not now')}</Button>
    </div>
  </>
}
