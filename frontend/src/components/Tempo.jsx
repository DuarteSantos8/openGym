import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { queueTones, unlock, vibrate } from '../lib/sound.js'
import { normalizeTempo, parseTempo, tempoSteps, stepAt, tutSec, PHASES, PHASE_LABEL, PHASE_FREQ } from '../lib/tempo.js'
import { Section, Row, Switch, Button, Stepper } from './ui.jsx'
import Icon from './Icon.jsx'

/* Tempo (#572): the editor for a tempo like 3-1-1-0 (an exercise's, or one set's) and the guide
   that counts a set through it, with a tone and a buzz at each phase so the phone can sit on the
   floor. lib/tempo.js holds the rules; this file only draws them. */

const PRESETS = ['3-1-1-0', '2-0-1-0', '3-0-1-0', '4-0-1-0', '2-1-2-1', '5-0-X-0']
const DIGIT_LABEL = { down: 'Lower (s)', bottom: 'Pause at the bottom (s)', up: 'Lift (s)', top: 'Squeeze at the top (s)' }
const COUNT_IN = 3

/** The tempo picker. `onDone(tempo | null)`: null takes the tempo away. */
export function tempoSheet({ title, value, onDone, clearLabel, footer }) {
  useUI.getState().openSheet(close => <TempoEditor title={title} value={value} clearLabel={clearLabel} footer={footer}
    onDone={v => { close(); onDone(v) }} close={close} />)
}

export function TempoEditor({ title, value, onDone, clearLabel, footer, close }) {
  const start = parseTempo(value) || { down: 3, bottom: 0, up: 1, top: 0, x: [] }
  const [p, setP] = useState({ down: start.down, bottom: start.bottom, up: start.x.includes('up') ? 1 : start.up, top: start.top })
  const [explosive, setExplosive] = useState(start.x.includes('up'))
  const tempo = normalizeTempo(PHASES.map(ph => (ph === 'up' && explosive ? 'X' : String(p[ph]))).join('-'))
  const pick = s => { const q = parseTempo(s); setExplosive(q.x.includes('up')); setP({ down: q.down, bottom: q.bottom, up: q.x.includes('up') ? 1 : q.up, top: q.top }) }
  return <>
    <h3>{title || t('Tempo')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Seconds for each part of a rep: lower, pause, lift, squeeze. 3-1-1-0 is three down, one at the bottom, one up, straight into the next.')}</div>
    <div className="tempo-big" aria-live="polite">{tempo || '0-0-0-0'}</div>
    <div className="intg-chips" style={{ marginBottom: 14 }}>
      {PRESETS.map(s => <button key={s} type="button" className={'btn xs intg-chip' + (s === tempo ? ' tinted' : '')} aria-pressed={s === tempo} onClick={() => pick(s)}>{s}</button>)}
    </div>
    {PHASES.map(ph => <div key={ph} className="row cfgrow" style={{ marginBottom: 8 }}>
      <Stepper label={t(DIGIT_LABEL[ph])} value={p[ph]} step={1} min={0} max={9} decimal={false} disabled={ph === 'up' && explosive}
        display={ph === 'up' && explosive ? 'X' : null}
        onChange={v => setP(x => ({ ...x, [ph]: Math.max(0, Math.min(9, Math.round(v) || 0)) }))} />
    </div>)}
    <Section>
      <Row icon="bolt" iconTint="var(--orange)" title={t('Explosive lift (X)')} subtitle={t('Up as fast as you can. The guide gives it one quick second.')}>
        <Switch aria-label={t('Explosive lift (X)')} checked={explosive} onChange={setExplosive} />
      </Row>
    </Section>
    {footer && <p className="sect-f" style={{ marginTop: -8 }}>{footer}</p>}
    <Button variant="primary" disabled={!tempo} onClick={() => onDone(tempo)}>{t('Save')}</Button>
    {value && <><div style={{ height: 8 }} /><Button variant="plain" onClick={() => onDone(null)}>{clearLabel || t('No tempo')}</Button></>}
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

/** The guide for one set: `reps` reps at `tempo`. `onTick` ticks the set off when it is done. */
export function tempoGuideSheet({ tempo, reps, name, onTick }) {
  useUI.getState().openSheet(close => <TempoGuide tempo={tempo} reps={reps} name={name} close={close}
    onTick={onTick ? () => { close(); onTick() } : null} />)
}

export function TempoGuide({ tempo, reps: planned, name, close, onTick }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const soundOn = S.tempoSound !== false
  const buzzOn = S.tempoVibrate !== false
  const [reps, setReps] = useState(Math.max(1, Math.min(50, Math.round(planned) || 8)))
  const [t0, setT0] = useState(null)         // ms when the first rep starts (after the count-in)
  const [now, setNow] = useState(Date.now())
  const timers = useRef([])
  const silence = useRef(() => {})
  const steps = tempoSteps(tempo, reps)
  const clear = () => { for (const id of timers.current) clearTimeout(id); timers.current = []; silence.current(); silence.current = () => {} }
  useEffect(() => clear, [])
  useEffect(() => {
    if (t0 == null) return
    const id = setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(id)
  }, [t0])

  const start = () => {
    clear()
    unlock(soundOn)
    const at0 = Date.now() + COUNT_IN * 1000
    // Every tone is queued in Web Audio now, inside the tap: it plays on the audio clock, so a
    // phone that locks or a tab in the background still hears each phase.
    const end = steps.length ? steps[steps.length - 1].at + steps[steps.length - 1].sec : 0
    silence.current = queueTones(soundOn, [
      ...Array.from({ length: COUNT_IN }, (_, i) => [440, 0.08, i]),
      ...steps.map(s => [PHASE_FREQ[s.phase], s.phase === 'up' || s.phase === 'down' ? 0.14 : 0.09, COUNT_IN + s.at]),
      [1047, 0.3, COUNT_IN + end],
    ])
    if (buzzOn) {
      for (const s of steps) timers.current.push(setTimeout(() => vibrate(s.phase === 'up' ? [40, 60, 40] : 40), COUNT_IN * 1000 + s.at * 1000))
    }
    setT0(at0)
    setNow(Date.now())
  }
  const stop = () => { clear(); setT0(null) }

  const elapsed = t0 == null ? -1 : (now - t0) / 1000
  const where = t0 == null ? null : elapsed < 0 ? { countIn: Math.ceil(-elapsed) } : stepAt(steps, elapsed)
  const done = where?.done === true
  const tut = tutSec(tempo, reps)
  return <>
    <h3>{t('Tempo {0}', tempo)}</h3>
    {name && <div className="muted small" style={{ marginBottom: 10 }}>{name}</div>}
    <div className={'tempo-stage' + (where?.step ? ' ph-' + where.step.phase : '')} role="timer" aria-live="polite">
      {t0 == null && <>
        <div className="tempo-phase">{t('{0} reps', reps)}</div>
        <div className="tempo-sub">{t('{0} s under tension', tut)}</div>
      </>}
      {where?.countIn != null && <>
        <div className="tempo-count">{where.countIn}</div>
        <div className="tempo-sub">{t('Get set')}</div>
      </>}
      {where?.step && <>
        <div className="tempo-phase">{t(PHASE_LABEL[where.step.phase])}</div>
        <div className="tempo-count">{where.left}</div>
        <div className="tempo-sub">{t('Rep {0} of {1}', where.step.rep, reps)}</div>
      </>}
      {done && <>
        <div className="tempo-phase">{t('Done')}</div>
        <div className="tempo-sub">{t('{0} s under tension. Lovely and slow.', tut)}</div>
      </>}
    </div>
    {t0 == null && <div className="row cfgrow" style={{ marginBottom: 8 }}>
      <Stepper label={t('Reps')} value={reps} step={1} min={1} max={50} decimal={false} onChange={v => setReps(Math.max(1, Math.min(50, Math.round(v) || 1)))} />
    </div>}
    <Section>
      <Row icon="speaker" iconTint="var(--pink)" title={t('A tone for each phase')}>
        <Switch aria-label={t('A tone for each phase')} checked={soundOn} disabled={t0 != null && !done} onChange={v => update(s => { s.tempoSound = v })} />
      </Row>
      <Row icon="vibrate" iconTint="var(--orange)" title={t('A buzz for each phase')}>
        <Switch aria-label={t('A buzz for each phase')} checked={buzzOn} disabled={t0 != null && !done} onChange={v => update(s => { s.tempoVibrate = v })} />
      </Row>
    </Section>
    {t0 == null || done
      ? <Button variant="primary" icon={done ? 'reset' : 'play'} onClick={start}>{done ? t('Again') : t('Start')}</Button>
      : <Button variant="tinted" icon="pause" onClick={stop}>{t('Stop')}</Button>}
    {done && onTick && <><div style={{ height: 8 }} /><Button icon="check" onClick={onTick}>{t('Tick the set')}</Button></>}
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={() => { stop(); close() }}>{t('Close')}</Button>
  </>
}

/** The tag on an exercise in a workout: the tempo, one tap from its guide. */
export function TempoTag({ tempo, onClick }) {
  if (!tempo) return null
  return <button type="button" className="tag acc nocap tempo-tag" onClick={onClick} aria-label={t('Tempo {0}, start the guide', tempo)}>
    <Icon name="stopwatch" />{t('Tempo {0}', tempo)}
  </button>
}
