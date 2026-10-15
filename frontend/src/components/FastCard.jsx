import { useState } from 'react'
import { t, dateLocale } from '../lib/i18n.js'
import { fmtAgo, fmtDur } from '../lib/format.js'
import { useUI } from '../store/useUI.js'
import { confirmSheet } from '../sheets.jsx'
import { useNutrition } from '../lib/nutrition/store.js'
import { DEFAULT_GOAL_HOURS, PLANS, lastFinished, leftMs, lengthOf, progressOf, validGoal } from '../lib/nutrition/fasting.js'
import { useFasting, useNow } from '../lib/nutrition/use-fasting.js'
import { writeErrorText } from '../lib/nutrition/log-feedback.js'
import { fastStartSheet } from './FastStartSheet.jsx'
import { Card, Chip, ChipRow, Stat } from './blocks.jsx'
import { Inline, Stack } from './layout.jsx'
import { Button, NumberField } from './ui.jsx'

const pad = n => String(n).padStart(2, '0')
// 3:07:42, the way a stopwatch reads.
const clock = ms => {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`
}

// A moment as the time of day, with the weekday when it is not today.
function whenText(ms, hour12) {
  const d = new Date(ms)
  const sameDay = d.toDateString() === new Date().toDateString()
  return d.toLocaleString(dateLocale(), { ...(sameDay ? {} : { weekday: 'short' }), hour: 'numeric', minute: '2-digit', hour12 })
}

function Running({ fast, hour12 }) {
  const now = useNow(true)
  const [busy, setBusy] = useState(false)
  const p = progressOf(fast, now)

  const end = () => confirmSheet({
    title: t('End your fast?'),
    message: t('You have been fasting for {0}.', fmtDur(p.elapsedMs)),
    confirmText: t('End fast'),
    danger: true,
    onConfirm: async () => {
      setBusy(true)
      try {
        const done = await useFasting.getState().end()
        if (done) useUI.getState().toast(t('Fast ended: {0}', fmtDur(lengthOf(done))))
      } catch (e) {
        useUI.getState().toast(writeErrorText(e))
      }
      setBusy(false)
    },
  })

  return <Card className={'fast-card' + (p.reached ? ' reached' : '')}>
    <Stack gap={4}>
      <div className="lbl2">{p.reached ? t('Goal reached') : t('Fasting')}</div>
      <div className="fast-clock"><Stat value={clock(p.elapsedMs)} /></div>
      <div className="small muted">{p.reached ? t('{0} past your goal', fmtDur(p.elapsedMs - p.goalMs)) : t('{0} to go', fmtDur(leftMs(p.remainingMs)))}</div>
      <div className="macro-track fast-track" role="progressbar" aria-label={t('Progress to your fasting goal')}
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p.pct)}><i style={{ width: p.pct + '%' }} /></div>
      <Inline justify="between" gap={4} className="small muted">
        <span>{t('Started {0}', whenText(Date.parse(fast.start_at), hour12))}</span>
        <span>{t('Goal {0}', whenText(p.targetAt, hour12))}</span>
      </Inline>
      <Button variant="danger" onClick={end} disabled={busy}>{t('End fast')}</Button>
      <Button variant="ghost" icon="pencil" onClick={() => fastStartSheet({ startAt: fast.start_at })}>{t('Change start time')}</Button>
    </Stack>
  </Card>
}

function Idle({ lastFast }) {
  const saved = Number(useNutrition(s => s.settings.data?.fastingDefaultHours))
  const initial = validGoal(saved) ? saved : DEFAULT_GOAL_HOURS
  const known = PLANS.some(p => p.hours === initial)
  const [hours, setHours] = useState(initial)
  const [custom, setCustom] = useState(!known)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const goal = Number(hours)
  const start = async () => {
    if (!validGoal(goal)) { setError(t('Enter a goal between 1 and 168 hours.')); return }
    setBusy(true)
    setError(null)
    try {
      const { started } = await useFasting.getState().start(goal)
      useUI.getState().toast(started ? t('Fast started: {0} h goal', goal) : t('A fast is already running'))
    } catch (e) {
      setError(writeErrorText(e))
    }
    setBusy(false)
  }

  return <Card className="fast-card">
    <Stack gap={4}>
      <div className="lbl2">{t('Start a fast')}</div>
      {lastFast && <div className="small muted">{t('Last fast: {0}, ended {1}', fmtDur(lengthOf(lastFast)), fmtAgo(Date.parse(lastFast.end_at)))}</div>}
      <ChipRow role="radiogroup" aria-label={t('Plan')}>
        {PLANS.map(p => <Chip key={p.label} nocap role="radio" aria-checked={!custom && hours === p.hours} on={!custom && hours === p.hours}
          onClick={() => { setCustom(false); setHours(p.hours) }}>{p.label}</Chip>)}
        <Chip role="radio" aria-checked={custom} on={custom} onClick={() => setCustom(true)}>{t('Custom')}</Chip>
      </ChipRow>
      {custom && <label className="portion-f">
        <span className="small muted">{t('Goal in hours')}</span>
        <NumberField value={hours} onChange={setHours} aria-label={t('Goal in hours')} />
      </label>}
      {error && <div className="nt-error small" role="alert">{error}</div>}
      <Button variant="primary" onClick={start} disabled={busy}>{busy ? t('Saving…') : t('Start fast')}</Button>
    </Stack>
  </Card>
}

// The fast you are in, or the plans to start one (FastingWidget.svelte).
export default function FastCard() {
  const active = useFasting(s => s.active)
  const history = useFasting(s => s.history)
  const hour12 = useNutrition(s => s.settings.data?.timeFormat !== '24h')
  return active ? <Running fast={active} hour12={hour12} /> : <Idle lastFast={lastFinished(history)} />
}
