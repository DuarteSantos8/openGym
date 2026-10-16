import { useEffect, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { fmtNum } from '../lib/format.js'
import { t, tn } from '../lib/i18n.js'
import { nutritionAvailable } from '../lib/nutrition/api.js'
import { foldText } from '../lib/nutrition/diary.js'
import { loadErrorText } from '../lib/nutrition/log-feedback.js'
import { useNutrition } from '../lib/nutrition/store.js'
import {
  DEFAULT_METRIC, HEADLINE_METRICS, goalOf, metricFrom, nutrientOptions, pointsOf, seriesOf, summaryOf, unitOf, windowOf,
} from '../lib/nutrition/trends.js'
import { FASTS_SHOWN_MAX, useFasting } from '../lib/nutrition/use-fasting.js'
import { useFresh, useToday } from '../lib/nutrition/use-freshness.js'
import { useTrends } from '../lib/nutrition/use-trends.js'
import ChartData from '../components/ChartData.jsx'
import FastInsights from '../components/FastInsights.jsx'
import LineChart from '../components/LineChart.jsx'
import { Card, EmptyState, SectionTitle, StatTile, Tiles } from '../components/blocks.jsx'
import { Page, Stack } from '../components/layout.jsx'
import { Button, Section, Segmented, SelectRow } from '../components/ui.jsx'
import { rangeFrom, rangeOptions, storedRange } from '../lib/progress-range.js'

const DAY = 86400000

// Progress › Trends (ia-proposal §3, B21 and B22): NutriTrace's Statistics page for the diary. The
// hub's range control carries in as ?range=; ?metric= picks the nutrient, so a link opens on it.
// Calories and the macros are tiles that set the metric; the explorer under them takes any
// nutrient or water. Fasting insights follow when the tracker is on.
export default function Trends() {
  const nav = useNavigate()
  const { search } = useLocation()
  const user = useStore(s => s.user)
  const available = nutritionAvailable(user)
  const settings = useNutrition(s => s.settings)
  const { status, days, error } = useTrends()
  const fasting = useFasting()
  const range = rangeFrom(search, storedRange())
  const metric = metricFrom(new URLSearchParams(search).get('metric'), settings.data)
  const fastingOn = settings.data?.fastingEnabled === true

  const today = useToday()
  useEffect(() => {
    if (available) useNutrition.getState().loadSettings({ force: true })
  }, [available, today])
  useFresh(useTrends, available, today)
  useEffect(() => {
    if (!available || !fastingOn) return
    useFasting.getState().load({ force: true })
  }, [available, fastingOn, today])

  // Kept in the address, so a reload and a shared link come back to the same view.
  const open = next => {
    const q = new URLSearchParams({ range: String(next.range ?? range) })
    const m = next.metric ?? metric
    if (m !== DEFAULT_METRIC) q.set('metric', m)
    nav('/progress/trends?' + q, { replace: true })
  }

  const win = useMemo(() => windowOf(range, days, today), [range, days, today])
  const options = nutrientOptions(settings.data)
  const series = useMemo(() => Object.fromEntries(
    [...new Set([metric, ...HEADLINE_METRICS])].map(m => [m, seriesOf(days, m, win, settings.data)]),
  ), [metric, days, win, settings.data])
  const chosen = options.find(o => o.value === metric)
  const unit = unitOf(metric, settings.data)
  const summary = summaryOf(series[metric])
  const points = pointsOf(series[metric])
  const goal = goalOf(settings.data, metric)

  let body
  if (!available) {
    body = <Card>
      <EmptyState icon="chart" title={t('Nutrition trends live in the web app')}>{t('Sign in on the web app to see your food over time.')}</EmptyState>
    </Card>
  } else if (status === 'error' && !days.length) {
    body = <Card>
      <Stack gap={4}>
        <div className="nt-error small" role="alert">{loadErrorText(error)}</div>
        <Button variant="tinted" onClick={() => useTrends.getState().load({ force: true })}>{t('Try again')}</Button>
      </Stack>
    </Card>
  } else if (status !== 'ready') {
    body = <div className="muted small fp-note" role="status">{t('Loading…')}</div>
  } else {
    body = <>
      <Segmented className="seg-range" value={range} onChange={v => open({ range: v })} options={rangeOptions()} />
      <Tiles>
        {HEADLINE_METRICS.map(m => {
          const s = summaryOf(series[m])
          return <StatTile key={m} label={options.find(o => o.value === m).label} size="sm" tone={m === metric ? 'acc' : undefined} pressed={m === metric}
            value={s ?fmtNum(s.avg) : '–'} unit={s ? unitOf(m, settings.data) : undefined} onClick={() => open({ metric: m })} />
        })}
      </Tiles>
      <Card title={chosen.label}>
        <Section>
          <SelectRow title={t('Nutrient')} sheetTitle={t('Nutrient')} value={metric} options={options}
            onChange={m => open({ metric: m })}
            search={{
              placeholder: t('Search nutrients'),
              label: t('Search nutrients'),
              emptyLabel: t('No match'),
              match: (option, query) => foldText(option.label).includes(foldText(query)),
            }} />
        </Section>
        {points.length
          ? <>
            <ChartData label={chosen.label} unit={unit} points={points} summary={summary}>
              <LineChart points={points} h={160} unit={unit} goal={goal?.value ?? null} />
            </ChartData>
            <Tiles>
              <StatTile label={t('Daily average')} size="xs" value={fmtNum(summary.avg)} unit={unit} />
              <StatTile label={t('Lowest')} size="xs" value={fmtNum(summary.min)} unit={unit} />
              <StatTile label={t('Highest')} size="xs" value={fmtNum(summary.max)} unit={unit} />
              <StatTile label={t('Logged')} size="xs" value={tn('{0} day', '{0} days', summary.count)} />
            </Tiles>
            {goal && <div className="muted small">{goal.base
              ? t('Base goal: {0} {1}. Your target moves each day; this is the fixed goal under it.', fmtNum(goal.value), unit)
              : t('Goal: {0} {1}', fmtNum(goal.value), unit)}</div>}
          </>
          : <EmptyState icon="chart" title={t('Nothing logged in this range')}>{t('Today is not counted until the day is over.')}</EmptyState>}
      </Card>
      {fastingOn && <>
        <SectionTitle>{t('Fasting')}</SectionTitle>
        {fasting.status === 'error' && <Card>
          <Stack gap={4}>
            <div className="nt-error small" role="alert">{t('Your fasts did not load.')}</div>
            <Button variant="tinted" onClick={() => useFasting.getState().load({ force: true })}>{t('Try again')}</Button>
          </Stack>
        </Card>}
        {fasting.status === 'ready' && <FastInsights since={range ? Date.now() - range * DAY : 0} />}
        {fasting.status === 'ready' && range === 0 && fasting.history.length >= FASTS_SHOWN_MAX
          && <div className="muted small">{t('Counting your latest {0} fasts.', FASTS_SHOWN_MAX)}</div>}
      </>}
    </>
  }

  return <Page title={t('Nutrition trends')}>{body}</Page>
}
