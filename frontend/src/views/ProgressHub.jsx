import { useEffect, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { doneUnits, setsDone, streakWeeks, workoutDay } from '../lib/history.js'
import { fmtNum } from '../lib/format.js'
import { weighInTime } from '../lib/bodyweight.js'
import { t, tn } from '../lib/i18n.js'
import { nutritionAvailable } from '../lib/nutrition/api.js'
import { useNutrition } from '../lib/nutrition/store.js'
import { seriesOf, summaryOf, unitOf, windowOf } from '../lib/nutrition/trends.js'
import { useFresh, useToday } from '../lib/nutrition/use-freshness.js'
import { useTrends, useWellness } from '../lib/nutrition/use-trends.js'
import { headlines, presentMetrics, recoveryWindow } from '../lib/nutrition/wellness.js'
import { bwDeltaColor } from '../sheets.jsx'
import { tappable } from '../lib/use-sheet-keyboard.js'
import Icon from '../components/Icon.jsx'
import RootHeader from '../components/RootHeader.jsx'
import { Segmented } from '../components/ui.jsx'
import { rangeFrom, rangeOptions } from './Stats.jsx'

const DAY = 86400000

// One live card that opens a pushed page: a title, the number that matters over the range, and a
// line of context under it.
function HubCard({ icon, tint, title, value, note, onOpen }) {
  return (
    <div className="card tappable hub-card" role="button" {...tappable(onOpen)}>
      <div className="row between">
        <div className="row" style={{ gap: 9, minWidth: 0 }}>
          <span className="lrow-i" style={{ '--tint': tint }}><Icon name={icon} /></span>
          <div style={{ minWidth: 0 }}>
            <div className="hub-card-t">{title}</div>
            <div className="hub-card-v">{value}</div>
            {note && <div className="hub-card-n">{note}</div>}
          </div>
        </div>
        <Icon name="chevronRight" className="chev" />
      </div>
    </div>
  )
}

// What the Nutrition trends card says: the daily calorie average over the range and the protein
// next to it, or why there is none yet.
function trendsLine(status, summary, protein, unit, proteinUnit) {
  if (status === 'error') return { value: t('Nutrition did not load'), note: t('Open to try again') }
  if (status !== 'ready') return { value: t('Loading…'), note: null }
  if (!summary) return { value: t('No food logged yet'), note: t('Calories, macros and any nutrient over time') }
  return {
    value: t('{0} {1} a day', fmtNum(summary.avg), unit),
    note: protein
      ? tn('{0} day logged · protein {1} {2}', '{0} days logged · protein {1} {2}', summary.count, fmtNum(protein.avg), proteinUnit)
      : tn('{0} day logged', '{0} days logged', summary.count),
  }
}

const readout = h => (h.unit ? t('{0} {1} {2}', h.label, fmtNum(h.avg), h.unit) : t('{0} {1}', h.label, fmtNum(h.avg)))

// The Progress tab's root: one range for the whole page, and a card per area — Body, Strength,
// Training load, Nutrition trends, Recovery — each opening its page at the same range. The last
// two are the web app's: Nutrition trends needs NutriTrace, and Recovery shows only when a wearable
// has reported something.
export default function ProgressHub() {
  const nav = useNavigate()
  const { search } = useLocation()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const nutrition = nutritionAvailable(user)
  const settings = useNutrition(s => s.settings.data)
  const trends = useTrends()
  const wellness = useWellness()
  const range = rangeFrom(search, 90)

  const today = useToday()
  useEffect(() => {
    if (nutrition) useNutrition.getState().loadSettings({ force: true })
  }, [nutrition, today])
  useFresh(useTrends, nutrition, today)
  useFresh(useWellness, nutrition, today)
  const win = useMemo(() => windowOf(range, trends.days, today), [range, trends.days, today])
  const calories = useMemo(() => summaryOf(seriesOf(trends.days, 'calories', win, settings)), [trends.days, win, settings])
  const protein = useMemo(() => summaryOf(seriesOf(trends.days, 'proteins', win, settings)), [trends.days, win, settings])
  const recovery = useMemo(() => headlines(wellness.byDate, recoveryWindow(range, today)), [wellness.byDate, range, today])
  const hasWearable = wellness.status === 'ready' && presentMetrics(wellness.byDate).length > 0
  const trendsText = trendsLine(trends.status, calories, protein, unitOf('calories', settings), unitOf('proteins', settings))
  // Kept in the address, so the tab's stack (and a reload) comes back to the range it was left on.
  const setRange = v => nav('/progress?range=' + v, { replace: true })
  const from = range ? Date.now() - range * DAY : 0
  const at = w => new Date(workoutDay(w) + 'T12:00').getTime()

  const weights = S.bodyweight.filter(b => weighInTime(b) >= from)
  const last = S.bodyweight[S.bodyweight.length - 1]
  const change = weights.length > 1 ? weights[weights.length - 1].w - weights[0].w : null
  const inRange = S.workouts.filter(w => at(w) >= from)
  const prs = inRange.reduce((n, w) => n + (Array.isArray(w.prs) ? w.prs.length : 0), 0)
  const lifted = new Set(inRange.flatMap(w => w.entries.filter(e => e.sets.some(s => doneUnits(s) > 0)).map(e => e.id))).size
  const sets = inRange.reduce((n, w) => n + setsDone(w), 0)
  const open = path => nav(path + '?range=' + range)

  return <div>
    <RootHeader title={t('Progress')} />
    <Segmented className="seg-range" value={range} onChange={setRange} options={rangeOptions()} />
    <HubCard icon="scale" tint="var(--teal)" title={t('Body')}
      value={last ? fmtNum(last.w) + ' ' + S.unit : t('No weigh-ins yet')}
      note={change === null ? t('Weight, measurements and photos')
        : <span style={{ color: bwDeltaColor(change, last?.w || 0) }}>{(change > 0 ? '+' : '') + fmtNum(change) + ' ' + S.unit}</span>}
      onOpen={() => open('/progress/body')} />
    <HubCard icon="trophy" tint="var(--orange)" title={t('Strength')}
      value={t('Personal records: {0}', prs)}
      note={t('Exercises trained: {0}', lifted)}
      onOpen={() => open('/progress/strength')} />
    <HubCard icon="flame" tint="var(--red)" title={t('Training load')}
      value={tn('{0} workout', '{0} workouts', inRange.length)}
      note={tn('{0} set', '{0} sets', sets) + ' · ' + t('{0} week streak', streakWeeks(S))}
      onOpen={() => open('/progress/load')} />
    {nutrition && <HubCard icon="utensils" tint="var(--green)" title={t('Nutrition trends')}
      value={trendsText.value} note={trendsText.note}
      onOpen={() => open('/progress/trends')} />}
    {nutrition && hasWearable && <HubCard icon="heart" tint="var(--pink)" title={t('Recovery')}
      value={recovery.length ? readout(recovery[0]) : t('No readings in this range')}
      note={recovery[1] ? readout(recovery[1]) : t('From your wearable')}
      onOpen={() => open('/progress/recovery')} />}
  </div>
}
