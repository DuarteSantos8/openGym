import { useEffect, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { doneUnits, setsDone, streakWeeks, workoutDay } from '../lib/history.js'
import { fmtNum } from '../lib/format.js'
import { deltaTone, weighInTime } from '../lib/bodyweight.js'
import { t, tn } from '../lib/i18n.js'
import { nutritionAvailable } from '../lib/nutrition/api.js'
import { useNutrition } from '../lib/nutrition/store.js'
import { seriesOf, summaryOf, unitOf, windowOf } from '../lib/nutrition/trends.js'
import { useFresh, useToday } from '../lib/nutrition/use-freshness.js'
import { useTrends, useWellness } from '../lib/nutrition/use-trends.js'
import { headlines, presentMetrics, recoveryWindow } from '../lib/nutrition/wellness.js'
import { rangeFrom, rangeOptions, rangeStart, rememberRange, storedRange } from '../lib/progress-range.js'
import { LB_TO_KG } from '../lib/recovery.js'
import { bwSheet } from '../sheets.jsx'
import { Page } from '../components/layout.jsx'
import { ActionButton, ActionRow, StatSection, TabSection } from '../components/tab-kit.jsx'
import { LineArt } from '../components/line-art.jsx'
import LineChart from '../components/LineChart.jsx'
import { Segmented } from '../components/ui.jsx'
import { measurementLogSheet } from './Measurements.jsx'

const TONE = { toward: 'acc', away: 'danger' }
const signed = n => (n > 0 ? '+' : n < 0 ? '−' : '') + fmtNum(Math.abs(n))

// The Progress tab's root (ux-redesign-tabs §4.3, ui-redesign-components §4): the range for the
// whole tab, the two things to log, then a card per area, each opening its page at the same
// range. Nutrition trends needs NutriTrace, and Recovery shows only once a wearable has reported
// something. The range is the address's when it has one (the tab's stack, a reload), else the one
// this device picked last, else 3M.
export default function ProgressHub() {
  const nav = useNavigate()
  const { search } = useLocation()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const nutrition = nutritionAvailable(user)
  const settings = useNutrition(s => s.settings.data)
  const trends = useTrends()
  const wellness = useWellness()
  const range = rangeFrom(search, storedRange())

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

  const setRange = v => { rememberRange(v); nav('/progress?range=' + v, { replace: true }) }
  const open = path => nav(path + '?range=' + range)
  const from = useMemo(() => rangeStart(range), [range])
  const at = w => new Date(workoutDay(w) + 'T12:00').getTime()

  const weights = S.bodyweight.filter(b => weighInTime(b) >= from)
  const last = S.bodyweight.at(-1)
  const change = weights.length > 1 ? weights.at(-1).w - weights[0].w : null
  const spark = useMemo(() => weights.map(b => ({ t: weighInTime(b), y: b.w, d: b.d })), [S.bodyweight, from])
  const inRange = S.workouts.filter(w => at(w) >= from)
  const prs = inRange.reduce((n, w) => n + (Array.isArray(w.prs) ? w.prs.length : 0), 0)
  const lifted = new Set(inRange.flatMap(w => w.entries.filter(e => e.sets.some(s => doneUnits(s) > 0)).map(e => e.id))).size
  const sets = inRange.reduce((n, w) => n + setsDone(w), 0)

  const trendsStatus = trends.status === 'error' ? 'error' : trends.status !== 'ready' ? 'loading' : calories ? 'ready' : 'empty'
  const kcal = unitOf('calories', settings)

  return <Page root title={t('Progress')}>
    <TabSection>
      <Segmented tone="strong" size="lg" ariaLabel={t('Range')} value={range} onChange={setRange} options={rangeOptions()} />
    </TabSection>
    <TabSection>
      <ActionRow>
        <ActionButton icon="scale" label={t('Weigh in')} onClick={() => bwSheet()} />
        <ActionButton icon="ruler" label={t('Log measurements')} onClick={() => measurementLogSheet()} />
      </ActionRow>
    </TabSection>
    <TabSection>
      <StatSection title={t('Body')} onOpen={() => open('/progress/body')}
        art={<LineArt scene="scale" state={{ kg: last ? (S.unit === 'lb' ? last.w * LB_TO_KG : last.w) : null }} />}
        status={last ? 'ready' : 'empty'}
        values={last
          ? [{ value: fmtNum(last.w), unit: S.unit, label: t('Latest') },
            ...(change == null ? [] : [{ value: signed(change), unit: S.unit, label: t('Weight change'), tone: TONE[deltaTone(change, last.w, S.targetW)] }])]
          : [{ label: t('Latest') }]}
        note={last ? null : t('No weigh-ins yet')}
        action={{ icon: 'plus', label: t('Log weight'), onClick: () => bwSheet() }}
        footer={spark.length > 1 && <div className="chart"><LineChart points={spark} h={56} axes={false} unit={S.unit} goal={S.targetW} decorative /></div>} />
      <StatSection title={t('Strength')} onOpen={() => open('/progress/strength')}
        status={S.workouts.length ? 'ready' : 'empty'}
        values={[{ value: prs, label: t('Personal records') }, { value: lifted, label: t('Exercises trained') }]}
        note={S.workouts.length ? null : t('Finish a workout and your strength curves start here.')} />
      <StatSection title={t('Training load')} onOpen={() => open('/progress/load')}
        values={[{ value: inRange.length, label: t('Workouts') }, { value: sets, label: t('Sets') }]}
        note={t('{0} week streak', streakWeeks(S))} />
      {nutrition && <StatSection title={t('Nutrition trends')} onOpen={() => open('/progress/trends')}
        status={trendsStatus}
        values={[{ value: calories ? fmtNum(calories.avg) : null, unit: kcal, label: t('Calories a day') },
          ...(protein ? [{ value: fmtNum(protein.avg), unit: unitOf('proteins', settings), label: t('Protein a day') }] : [])]}
        note={trendsStatus === 'error' ? t('Nutrition did not load')
          : trendsStatus === 'empty' ? t('No food logged yet')
          : calories ? tn('{0} day logged', '{0} days logged', calories.count) : null}
        onRetry={() => useTrends.getState().load({ force: true })} />}
      {nutrition && hasWearable && <StatSection title={t('Recovery')} onOpen={() => open('/progress/recovery')}
        status={recovery.length ? 'ready' : 'empty'}
        values={recovery.slice(0, 2).map(h => ({ value: fmtNum(h.avg), unit: h.unit || undefined, label: h.label }))}
        note={recovery.length ? t('From your wearable') : t('No readings in this range')} />}
    </TabSection>
  </Page>
}
