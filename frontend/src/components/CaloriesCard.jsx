import { forwardRef } from 'react'
import { t, dateLocale } from '../lib/i18n.js'
import { loadErrorText } from '../lib/nutrition/log-feedback.js'
import { useUnits } from '../lib/nutrition/use-units.js'
import { Button } from './ui.jsx'
import { Card } from './blocks.jsx'
import { Inline } from './layout.jsx'

const R = 44
const C = 2 * Math.PI * R
const grams = n => Math.round(n || 0).toLocaleString(dateLocale())

function MacroBar({ label, cls, value, goal }) {
  const pct = goal ? Math.min(100, (value / goal) * 100) : 0
  return <div className="macro-bar">
    <Inline justify="between" className="small"><span><i className={'mdot ' + cls} aria-hidden="true" />{label}</span>
      <span className="muted">{grams(value)}{goal ? ' / ' + grams(goal) : ''} g</span></Inline>
    <div className="macro-track" aria-hidden="true"><i className={cls} style={{ width: pct + '%' }} /></div>
  </div>
}

// The day's energy against its target, as a ring with what is left in the middle, and protein,
// carbs and fat under it (ia-proposal §2). `day` is useDiaryDay's answer.
const CaloriesCard = forwardRef(function CaloriesCard({ day }, ref) {
  const units = useUnits()
  if (day.status === 'error') return <Card ref={ref}>
    <div className="nt-error small" role="alert">{loadErrorText(day.error)}</div>
    <Button size="sm" onClick={day.reload}>{t('Try again')}</Button>
  </Card>
  // Until the target's inputs are in, no number: a default that then jumps reads as a real one.
  const loading = day.status !== 'ready'
  const eaten = day.totals.calories
  const goal = day.target.target
  const frac = !loading && goal > 0 ? Math.min(1, eaten / goal) : 0
  const over = !loading && day.left < 0
  const DASH = '–'
  return <Card className={'kcal-card' + (loading ? ' loading' : '')} ref={ref} aria-busy={loading || undefined}>
    <div className="kcal-top">
      <svg className="kcal-ring" viewBox="0 0 100 100" role="img"
        aria-label={loading ? t('Loading…') : t('{0} of {1} eaten', units.energy(eaten), units.energy(goal))}>
        <circle cx="50" cy="50" r={R} className="kcal-ring-bg" />
        <circle cx="50" cy="50" r={R} className={'kcal-ring-fg' + (over ? ' over' : '')}
          strokeDasharray={C} strokeDashoffset={C * (1 - frac)} transform="rotate(-90 50 50)" />
      </svg>
      <div className="kcal-mid" aria-hidden="true">
        <div className="kcal-left">{loading ? DASH : units.energyValue(Math.abs(day.left))}</div>
        <div className="small muted">{over ? t('{0} over', units.energyUnit) : t('{0} left', units.energyUnit)}</div>
      </div>
      <div className="kcal-side small">
        <div><span className="muted">{t('Eaten')}</span> {loading ? DASH : units.energy(eaten)}</div>
        <div><span className="muted">{t('Target')}</span> {loading ? DASH : units.energy(goal)}</div>
        {!loading && day.target.added > 0 && <div className="muted">{t('incl. {0} from activity', units.energy(day.target.added))}</div>}
      </div>
    </div>
    <MacroBar label={t('Protein')} cls="p" value={day.totals.proteins} goal={day.macros.proteins} />
    <MacroBar label={t('Carbs')} cls="c" value={day.totals.carbohydrates} goal={day.macros.carbohydrates} />
    <MacroBar label={t('Fat')} cls="f" value={day.totals.fat} goal={day.macros.fat} />
  </Card>
})

export default CaloriesCard
