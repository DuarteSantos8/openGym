import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { exOr } from '../lib/exercises.js'
import { t, exerciseNameFor, exerciseNameClass, instrFor, instrTranslated, getLang } from '../lib/i18n.js'
import { applyGuidedWarmupAction, pendingGuidedWarmup, warmupRemainingMs } from '../lib/guided-warmup-session.js'
import { confirmSheet } from '../sheets.jsx'
import Media from '../components/Media.jsx'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import './GuidedWarmup.css'

export default function GuidedWarmup() {
  const active = useStore(s => s.S.active)
  const update = useStore(s => s.update)
  const nav = useNavigate()
  const [now, setNow] = useState(Date.now)
  const warmup = active?.warmup
  const running = Number.isFinite(warmup?.timer?.endsAt)
  useEffect(() => { window.scrollTo(0, 0) }, [active?.id, warmup?.current])
  // The interval only repaints a persisted deadline. Expiry never logs or advances anything.
  useEffect(() => {
    setNow(Date.now())
    if (!running) return
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [running, warmup?.timer?.endsAt])
  if (!pendingGuidedWarmup(active)) return null
  const step = warmup.steps[warmup.current]
  if (!step) return null
  const ex = exOr(step.id), instructions = instrFor(ex)
  const sessionId = active.id, stepId = step.id
  const action = kind => update(s => { applyGuidedWarmupAction(s.active, sessionId, stepId, kind) }, true)
  const remaining = Math.ceil(warmupRemainingMs(warmup, now) / 1000)
  const countdown = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`
  const discard = () => confirmSheet({
    title: t('Discard workout?'), message: t('The sets you logged in this session will be lost.'), confirmText: t('Discard'), danger: true,
    onConfirm: () => {
      const current = useStore.getState().S.active
      if (current?.id !== sessionId) return
      update(s => { if (s.active?.id === sessionId) s.active = null })
      useUI.getState().stopRest()
      useUI.getState().stopWork()
      nav('/home')
    },
  })
  return <div className="narrow guided-warmup">
    <div className="hdr">
      <button className="iconbtn" aria-label={t('Minimize')} title={t('Minimize')} onClick={() => nav('/home')}><Icon name="chevronDown" /></button>
      <div className="grow"><h1>{t('Guided warm-up')}</h1><div className="sub">{active.name}</div></div>
      <button className="iconbtn" aria-label={t('Discard workout')} title={t('Discard workout')} onClick={discard}><Icon name="trash" /></button>
    </div>
    <div className="row between"><span className="muted small">{t('Movement {0} of {1}', warmup.current + 1, warmup.steps.length)}</span><button className="btn pill" onClick={() => action('skip_all')}>{t('Skip warm-up')}</button></div>
    <div className="wprog" role="progressbar" aria-label={t('Warm-up progress')} aria-valuemin={0} aria-valuemax={warmup.steps.length} aria-valuenow={warmup.current}><i style={{ width: `${warmup.current / warmup.steps.length * 100}%` }} /></div>
    <div className="card guided-warmup-card">
      <h2 className={exerciseNameClass(ex)}>{exerciseNameFor(ex)}</h2>
      <Media key={step.id} ex={ex} />
      <div className="guided-warmup-target accent">{step.mode === 'time' ? t('{0} seconds', step.sec) : t('{0} reps', step.reps)}{step.perSide ? ` · ${t('per side')}` : ''}</div>
      {step.perSide && <p className="muted small">{t('Complete both sides before continuing.')}</p>}
      {step.mode === 'time' && <div className="guided-warmup-timer">
        <div className="guided-warmup-countdown" role="timer" aria-label={t('Warm-up timer')}>{countdown}</div>
        {step.perSide && <p className="muted small">{t('Timer covers both sides. Switch sides halfway through.')}</p>}
        <Button icon={running && remaining > 0 ? 'pause' : 'play'} onClick={() => action(running && remaining > 0 ? 'pause_timer' : 'start_timer')}>{running && remaining > 0 ? t('Pause timer') : remaining === 0 ? t('Restart timer') : warmup.timer ? t('Resume timer') : t('Start timer')}</Button>
        {remaining === 0 && <p className="muted small" role="status">{t('Timer finished. Continue when you are ready.')}</p>}
      </div>}
      {instructions.length > 0 && <details className="guided-warmup-instructions"><summary>{t('How to')}</summary>{getLang() !== 'en' && !instrTranslated(ex) && <p className="muted small">{t('instructions in English')}</p>}<ol className="steps-list">{instructions.map((instruction, index) => <li key={index}>{instruction}</li>)}</ol></details>}
    </div>
    <div className="guided-warmup-actions"><Button disabled={warmup.current === 0} onClick={() => action('previous')}>{t('Previous')}</Button><Button variant="primary" icon="check" onClick={() => action('done')}>{warmup.current === warmup.steps.length - 1 ? t('Start workout') : t('Done & next')}</Button></div>
    <Button className="guided-warmup-skip" onClick={() => action('skip')}>{t('Skip movement')}</Button>
  </div>
}
