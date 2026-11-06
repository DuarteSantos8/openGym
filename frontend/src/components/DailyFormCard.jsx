// Stats → Overview → Daily form (v1.4.5, gm-insights): the vitals the phone's health store has
// (lib/vitals.js: last night's sleep, resting heart rate, HRV, today's steps, each next to your own
// usual), and what your check-ins and sleep say about how the workouts went (lib/form-insights.js).
// Patterns only once there is enough to compare, with the counts on both sides and a plain word on
// how sure it is. Shown with the Health module on, once there is a check-in or a vital to show.
import { useEffect, useMemo, useState } from 'react'
import { t, tn } from '../lib/i18n.js'
import { fmtNum, todayISO } from '../lib/format.js'
import { MOBILE, nativePlatform } from '../lib/mobile.js'
import { loadHealth, onHealthChange } from '../lib/health-sync.js'
import { vitalsSummary } from '../lib/vitals.js'
import { formDays, formScore } from '../lib/daily-form.js'
import { formInsights, insightProgress, workoutPerformance } from '../lib/form-insights.js'
import { displayScale } from '../lib/effort.js'
import CardHead from './CardHead.jsx'

// The good side of each factor, as the row's title.
const FACTOR_LABEL = {
  sleepHours: 'After 7 hours of sleep or more',
  sleep: 'When you rate your sleep 4 or 5',
  energy: 'When your energy is 4 or 5',
  sore: 'When soreness is 1 or 2',
  stress: 'When stress is 1 or 2',
  form: 'On your good-form days',
}
const METRIC_LABEL = { strength: 'Estimated strength', volume: 'Volume', effort: 'Reps in reserve' }
const SURE = { chance: 'Could easily be chance', maybe: 'Leaning that way', consistent: 'Pretty consistent so far' }

const signed = (n, digits = 0) => (n > 0 ? '+' : n < 0 ? '−' : '±') + fmtNum(Math.abs(Math.round(n * 10 ** digits) / 10 ** digits))

/** The words of one insight row: { title, value, sub }. */
export function insightWords(x, S) {
  const value = x.flat ? t('About the same')
    : x.metric === 'effort'
      ? (displayScale(S) === 'rpe' ? t('{0} RPE', signed(-x.diff, 1)) : t('{0} RIR', signed(x.diff, 1)))
      : signed(x.diff) + ' %'
  const sub = [t(METRIC_LABEL[x.metric]), t('{0} vs {1} workouts', fmtNum(x.good.n), fmtNum(x.other.n)), t(SURE[x.confidence])].join(' · ')
  return { title: t(FACTOR_LABEL[x.factor]), value, sub }
}

function Vital({ label, value, unit, usual }) {
  return <div className="dfc-vital">
    <span className="dfc-vital-k">{label}</span>
    <b>{value}{unit && <i> {unit}</i>}</b>
    <span className="dfc-vital-s">{usual || ' '}</span>
  </div>
}

export default function DailyFormCard({ S }) {
  const [h, setH] = useState(null)
  const [platform, setPlatform] = useState(null)
  useEffect(() => {
    if (!MOBILE) return
    let gone = false
    loadHealth().then(f => { if (!gone) setH(f) }).catch(() => {})
    nativePlatform().then(p => { if (!gone) setPlatform(p) }).catch(() => {})
    const off = onHealthChange(f => { if (!gone) setH(f) })
    return () => { gone = true; off() }
  }, [])
  const vitals = h?.readVitals ? h.vitals : null
  const today = todayISO()
  const perf = useMemo(() => workoutPerformance(S), [S.workouts, S.unit, S.formula]) // eslint-disable-line react-hooks/exhaustive-deps
  const insights = useMemo(() => formInsights(S, { vitals, perf }), [perf, S.dayForm, vitals]) // eslint-disable-line react-hooks/exhaustive-deps
  const days = formDays(S)
  const vs = vitals ? vitalsSummary(vitals, today) : null
  const anyVital = vs && Object.values(vs).some(Boolean)
  if (!days.length && !anyVital && S.dailyForm !== true) return null

  const recent = days.filter(d => d.d > isoBack(today, 14))
  const todays = days.find(d => d.d === today)
  const score = todays ? formScore(todays) : null
  const title = score != null
    ? (score >= 3.5 ? t('Today looks like a good one') : score > 2.5 ? t('Today is a middling sort of day') : t('Today is a take-it-easy day'))
    : t('How your days and your workouts line up')
  const sub = recent.length ? tn('{0} check-in in the last two weeks', '{0} check-ins in the last two weeks', recent.length) : null

  const shown = insights.filter(x => !x.flat).slice(0, 3)
  const flatOnes = insights.filter(x => x.flat)
  const progress = !insights.length ? insightProgress(S, { vitals, perf }) : null
  const hm = m => { const hh = Math.floor(m / 60), mm = Math.round(m % 60); return mm ? t('{0} h {1} min', fmtNum(hh), fmtNum(mm)) : t('{0} h', fmtNum(hh)) }
  const usual = (u, f) => (u ? t('Usually {0}', f(u)) : null)

  return <div className="card dform-card" data-daily-form>
    <CardHead icon="moon" tint="var(--indigo)" eyebrow={t('Daily form')} title={title} sub={sub} />
    {anyVital && <>
      <div className="dfc-vitals">
        {vs.sleep && <Vital label={t('Sleep')} value={hm(vs.sleep.v)} usual={usual(vs.sleep.usual, hm)} />}
        {vs.rhr && <Vital label={t('Resting heart rate')} value={fmtNum(vs.rhr.v)} unit="bpm" usual={usual(vs.rhr.usual, v => fmtNum(v))} />}
        {vs.hrv && <Vital label={vitals.hrvKind === 'sdnn' ? t('HRV (SDNN)') : t('HRV (RMSSD)')} value={fmtNum(vs.hrv.v)} unit="ms" usual={usual(vs.hrv.usual, v => fmtNum(v))} />}
        {vs.steps && <Vital label={vs.steps.d === today ? t('Steps today') : t('Steps')} value={fmtNum(vs.steps.v)} usual={usual(vs.steps.usual, v => fmtNum(v))} />}
      </div>
      <div className="small dim dfc-src">{platform === 'ios' ? t('From Apple Health, read-only, on this phone only.') : t('From Health Connect, read-only, on this phone only.')}</div>
    </>}
    {shown.length > 0 && <div className="dfc-ins" data-insights>
      {shown.map(x => { const w = insightWords(x, S); return <div className="dfc-in" key={x.factor + x.metric}>
        <div className="dfc-in-m"><span className="dfc-in-t">{w.title}</span><span className="dfc-in-s">{w.sub}</span></div>
        <span className={'dfc-in-v' + (x.diff > 0 ? ' up' : ' down')}>{w.value}</span>
      </div> })}
    </div>}
    {!shown.length && flatOnes.length > 0 && <div className="small muted dfc-note">{t('So far your good and rough days end in about the same workouts. Nice and steady.')}</div>}
    {progress && <div className="small muted dfc-note">{t('Insights show up once there is enough to compare: {0} of {1} workouts so far.', fmtNum(Math.min(progress.have, progress.need)), fmtNum(progress.need))}</div>}
    {insights.length > 0 && <div className="small dim dfc-note">{t('Patterns, not proof. Sleep is rarely the only thing that changed that day.')}</div>}
  </div>
}

function isoBack(iso, n) {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() - n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
