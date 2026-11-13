// The daily-form check-in before a workout (lib/daily-form.js): four quick 1-to-5 answers, all
// optional, then Start. On a rough day it offers to go lighter, never picks it for you. Opened by
// sheets.jsx startFlow; switched in Settings → Workout → Starting.
import { useEffect, useState } from 'react'
import { t } from '../lib/i18n.js'
import { Button, Segmented } from './ui.jsx'
import Icon from './Icon.jsx'
import { FORM_KEYS, isRough, sleepRatingOf } from '../lib/daily-form.js'
import { fmtNum } from '../lib/format.js'

// Each row: its icon, its question, and the words at both ends of the scale.
export const FORM_ROWS = {
  sleep: () => ({ icon: 'moon', label: t('Sleep'), lo: t('Barely slept'), hi: t('Slept like a log') }),
  energy: () => ({ icon: 'bolt', label: t('Energy'), lo: t('Running on fumes'), hi: t('Full of beans') }),
  sore: () => ({ icon: 'figureStrength', label: t('Soreness'), lo: t('Nothing aches'), hi: t('Everything aches') }),
  stress: () => ({ icon: 'cloud', label: t('Stress'), lo: t('Calm'), hi: t('Frazzled') }),
}

function Scale({ k, value, onChange }) {
  const row = FORM_ROWS[k]()
  const id = 'dfc-' + k
  return <div className="dfc-row">
    <div className="dfc-q" id={id}><Icon name={row.icon} /><span>{row.label}</span></div>
    <div className="dfc-scale" role="radiogroup" aria-labelledby={id}>
      {[1, 2, 3, 4, 5].map(n => <button key={n} type="button" role="radio" aria-checked={value === n}
        aria-label={n === 1 ? `1, ${row.lo}` : n === 5 ? `5, ${row.hi}` : String(n)}
        className={'dfc-pip' + (value === n ? ' on' : '')} onClick={() => onChange(value === n ? null : n)}>{n}</button>)}
    </div>
    <div className="dfc-ends" aria-hidden="true"><span>{row.lo}</span><span>{row.hi}</span></div>
  </div>
}

/**
 * `lighter`: which ways of going lighter this
 * session can take (['load', 'sets'], from lib/daily-form.js canGoLighter). `sleep`: a promise of
 * last night's sleep from the phone's health store ({ hours, platform } or null), to fill the sleep row.
 * `onDone({ form, lighter })` starts the workout; `onSkip()` starts it as planned.
 */
export default function DailyCheckin({ lighter = [], sleep = null, onDone, onSkip }) {
  const [f, setF] = useState({ sleep: null, energy: null, sore: null, stress: null })
  const [hours, setHours] = useState(null)
  const [source, setSource] = useState(null)
  const [pick, setPick] = useState('planned')
  useEffect(() => {
    if (!sleep || typeof sleep.then !== 'function') return
    let gone = false
    sleep.then(r => { if (!gone && r?.hours > 0) { setHours(r.hours); setSource(r.platform) } }).catch(() => {})
    return () => { gone = true }
  }, [sleep])
  // The phone's own number fills the row, once, until it is changed by hand.
  useEffect(() => { if (hours > 0) setF(x => (x.sleep == null ? { ...x, sleep: sleepRatingOf(hours) } : x)) }, [hours])
  const set = k => v => setF(x => ({ ...x, [k]: v }))
  const rough = isRough(f) && lighter.length > 0
  const options = [{ value: 'planned', label: t('As planned') },
    ...(lighter.includes('load') ? [{ value: 'load', label: t('10% lighter') }] : []),
    ...(lighter.includes('sets') ? [{ value: 'sets', label: t('One set fewer') }] : [])]
  const answered = FORM_KEYS.some(k => f[k] != null)
  const start = () => onDone({ form: f, lighter: rough && pick !== 'planned' ? pick : null })
  const h = Math.floor(hours || 0), min = Math.round(((hours || 0) - h) * 60)
  return <div className="dfc">
    <h3>{t('How are you today?')}</h3>
    <div className="muted small dfc-sub">{t('Tap what fits, skip what does not.')}</div>
    {FORM_KEYS.map(k => <div key={k}>
      <Scale k={k} value={f[k]} onChange={set(k)} />
      {k === 'sleep' && hours > 0 && <div className="small dim dfc-hint">
        {t('{0} last night, from {1}', min ? t('{0} h {1} min', fmtNum(h), fmtNum(min)) : t('{0} h', fmtNum(h)), source === 'ios' ? t('Apple Health') : t('Health Connect'))}
      </div>}
    </div>)}
    {rough && <div className="dfc-light" role="group" aria-label={t('Take it easier today?')}>
      <div className="dfc-light-t">{t('Rough one. Take it easier today?')}</div>
      <Segmented className="seg-inline" options={options} value={pick} onChange={setPick} />
      <div className="small muted">{pick === 'planned'
        ? t('Your call. Nothing changes unless you pick it.')
        : t('Just today. This session sits out of progression, so your next targets stay put.')}</div>
    </div>}
    <Button variant="primary" icon="play" onClick={start}>{answered ? t('Start workout') : t('Start without answering')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={onSkip}>{t('Skip for today')}</Button>
  </div>
}
