import MetricCard from '../MetricCard.jsx'
import { t } from '../../lib/i18n.js'
import { fmtNum } from '../../lib/format.js'
import { dailyTotals } from '../../lib/nutrition/diary.js'
export const nutrientLabels = () => ({ energyKcal: t('Energy (kcal)'), proteinG: t('Protein (g)'), carbohydrateG: t('Carbohydrate (g)'), fatG: t('Fat (g)') })
export default function DiarySummary({ S, day }) {
  const totals = dailyTotals(S, day), labels = nutrientLabels()
  return <section aria-label={t('Daily totals')} className="nutrition-summary">
    {Object.entries(totals).map(([key, { value, unknown }]) => <MetricCard key={key} label={labels[key]} value={fmtNum(value, 3)}>
      <span className="ss">{t('{0} entries unknown', unknown)}</span>
    </MetricCard>)}
  </section>
}
