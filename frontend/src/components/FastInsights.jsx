import { t, tn, dateLocale } from '../lib/i18n.js'
import { dayInitial, fastingStats, recentDays } from '../lib/nutrition/fasting.js'
import { useFasting, useNow } from '../lib/nutrition/use-fasting.js'
import { Card, Stat } from './blocks.jsx'
import { Stack } from './layout.jsx'

const BAR_FLOOR_HOURS = 16

// Fasting insights (FastingInsights.svelte): average and longest fast, the streaks, and the last
// 14 days as bars. A day's bar is its longest fast, the running one counting for today.
// `since` (ms, 0 = all) keeps the numbers to the fasts that ended from then on, for Progress's range.
export default function FastInsights({ since = 0 }) {
  const all = useFasting(s => s.history)
  const active = useFasting(s => s.active)
  const now = useNow(!!active, 60000)
  const history = since ? all.filter(f => Date.parse(f.end_at) >= since) : all
  const stats = fastingStats(history, active, now)
  const days = recentDays(history, active, now)
  const top = Math.max(BAR_FLOOR_HOURS, ...days.map(d => d.hours))

  return <Card className="fast-insights" title={t('Insights')}>
    <Stack gap={6}>
      <div className="fast-stats">
        <div><Stat size="sm" value={t('{0} h', stats.avgHours)} /><div className="small muted">{t('Average fast')}</div></div>
        <div><Stat size="sm" value={t('{0} h', stats.longestHours)} /><div className="small muted">{t('Longest fast')}</div></div>
        <div><Stat size="sm" value={tn('{0} day', '{0} days', stats.currentStreak)} /><div className="small muted">{t('Current streak')}</div></div>
        <div><Stat size="sm" value={tn('{0} day', '{0} days', stats.longestStreak)} /><div className="small muted">{t('Longest streak')}</div></div>
      </div>
      <div className="fast-bars" role="img" aria-label={t('Fasting hours over the last 14 days')}>
        {days.map(d => <div key={d.day} className="fast-bar-col" title={t('{0}: {1} h', d.day, Math.round(d.hours * 10) / 10)}>
          <div className="fast-bar-wrap"><i style={{ height: (d.hours / top) * 100 + '%' }} /></div>
          <div className="fast-bar-day small muted" aria-hidden="true">{dayInitial(d.day, dateLocale())}</div>
        </div>)}
      </div>
      <div className="small muted">{tn('{0} fast logged', '{0} fasts logged', stats.count)}</div>
    </Stack>
  </Card>
}
