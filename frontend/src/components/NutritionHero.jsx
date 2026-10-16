import { t } from '../lib/i18n.js'
import { fmtDate, todayISO } from '../lib/format.js'
import { loadErrorText } from '../lib/nutrition/log-feedback.js'
import { useUnits } from '../lib/nutrition/use-units.js'
import { HeroStatus } from './tab-kit.jsx'

// Nutrition's hero for the selected day (ux-redesign-tabs §4.2): what is left of the energy
// target at display size, eaten · goal under it, and what activity added to the goal. Over the
// target it says how far over, in orange ink, not red. No number until the target's inputs are
// in: a default that then jumps reads as a real one, and the loading text names the day when it
// is not today. `day` is useDiaryDay's; `ref` reaches the hero's box, for the header's readout.
export default function NutritionHero({ date, day, ref }) {
  const units = useUnits()
  if (day.status === 'error') {
    return <HeroStatus ref={ref} status="error" caption={<span role="alert">{loadErrorText(day.error)}</span>} onRetry={day.reload} />
  }
  const over = day.left < 0
  const eaten = day.totals.calories
  const loadingLabel = date === todayISO() ? undefined : t('Loading {0}', fmtDate(date, true))
  return <HeroStatus ref={ref} status={day.status === 'ready' ? 'ready' : 'loading'} loadingLabel={loadingLabel} tone={over ? 'over' : undefined}
    value={units.energyValue(Math.abs(day.left))}
    unit={over ? t('{0} over', units.energyUnit) : t('{0} left', units.energyUnit)}
    caption={t('{0} eaten · {1} goal', units.energy(eaten), units.energy(day.target.target))}>
    {day.target.added > 0 && <p className="hero-c">{t('incl. {0} from activity', units.energy(day.target.added))}</p>}
  </HeroStatus>
}
