import { useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { fmtNum } from '../lib/format.js'
import { t, tn } from '../lib/i18n.js'
import { nutritionAvailable } from '../lib/nutrition/api.js'
import { pointsOf, summaryOf } from '../lib/nutrition/trends.js'
import { useFresh, useToday } from '../lib/nutrition/use-freshness.js'
import { useWellness } from '../lib/nutrition/use-trends.js'
import { presentMetrics, recoverySeries, recoveryWindow } from '../lib/nutrition/wellness.js'
import ChartData from '../components/ChartData.jsx'
import LineChart from '../components/LineChart.jsx'
import { Card, EmptyState, StatTile, Tiles } from '../components/blocks.jsx'
import { Page, Stack } from '../components/layout.jsx'
import { Button, Segmented } from '../components/ui.jsx'
import { rangeFrom, rangeOptions, storedRange } from '../lib/progress-range.js'

// Progress › Recovery (ia-proposal §3, B23 and B28 to B30): what a connected wearable reports,
// sleep, heart and activity, over the hub's range. NutriTrace holds the data; the web app only
// reads it, so a person without a wearable sees the empty state and no card on the hub.
// ?metric= picks the metric, as on Trends.
export default function Recovery() {
  const nav = useNavigate()
  const { search } = useLocation()
  const user = useStore(s => s.user)
  const available = nutritionAvailable(user)
  const { status, byDate, unavailable } = useWellness()
  const range = rangeFrom(search, storedRange())
  const today = useToday()
  useFresh(useWellness, available, today)

  const metrics = useMemo(() => presentMetrics(byDate), [byDate])
  const asked = new URLSearchParams(search).get('metric')
  const metric = metrics.find(m => m.value === asked) ?? metrics[0]
  const win = useMemo(() => recoveryWindow(range, today), [range, today])
  const summaries = useMemo(() => Object.fromEntries(metrics.map(m => [m.value, summaryOf(recoverySeries(byDate, m.value, win))])), [metrics, byDate, win])

  const open = next => nav('/progress/recovery?' + new URLSearchParams({ range: String(next.range ?? range), metric: next.metric ?? metric?.value ?? '' }), { replace: true })

  let body
  if (!available) {
    body = <Card>
      <EmptyState icon="heart" title={t('Recovery lives in the web app')}>{t('Sign in on the web app to see your wearable data here.')}</EmptyState>
    </Card>
  } else if (unavailable) {
    body = <Card>
      <EmptyState icon="heart" title={t('Not available yet')}>{t('Wearable data will show up here once your server supports it.')}</EmptyState>
    </Card>
  } else if (status === 'error') {
    body = <Card>
      <Stack gap={4}>
        <div className="nt-error small" role="alert">{t('Your wearable data did not load.')}</div>
        <Button variant="tinted" onClick={() => useWellness.getState().load({ force: true })}>{t('Try again')}</Button>
      </Stack>
    </Card>
  } else if (status !== 'ready') {
    body = <div className="muted small fp-note" role="status">{t('Loading…')}</div>
  } else if (!metric) {
    body = <Card>
      <EmptyState icon="heart" title={t('No wearable data yet')}>{t('Connect a wearable in NutriTrace and its sleep, heart and activity readings show up here.')}</EmptyState>
    </Card>
  } else {
    const summary = summaries[metric.value]
    const points = pointsOf(recoverySeries(byDate, metric.value, win))
    body = <>
      <Segmented className="seg-range" value={range} onChange={v => open({ range: v })} options={rangeOptions()} />
      <Tiles>
        {metrics.map(m => <StatTile key={m.value} label={m.label} size="sm" tone={m.value === metric.value ? 'acc' : undefined} pressed={m.value === metric.value}
          value={summaries[m.value] ? fmtNum(summaries[m.value].avg) : '–'} unit={summaries[m.value] && m.unit ? m.unit : undefined}
          onClick={() => open({ metric: m.value })} />)}
      </Tiles>
      <Card title={metric.label}>
        {summary
          ? <>
            <ChartData label={metric.label} unit={metric.unit} points={points} summary={summary}>
              <LineChart points={points} h={160} unit={metric.unit} />
            </ChartData>
            <Tiles>
              <StatTile label={t('Daily average')} size="xs" value={fmtNum(summary.avg)} unit={metric.unit} />
              <StatTile label={t('Lowest')} size="xs" value={fmtNum(summary.min)} unit={metric.unit} />
              <StatTile label={t('Highest')} size="xs" value={fmtNum(summary.max)} unit={metric.unit} />
              <StatTile label={t('Recorded')} size="xs" value={tn('{0} day', '{0} days', summary.count)} />
            </Tiles>
          </>
          : <EmptyState icon="heart" title={t('Nothing recorded in this range')}>{t('Pick a longer range to see earlier days.')}</EmptyState>}
      </Card>
    </>
  }

  return <Page title={t('Recovery')}>{body}</Page>
}
