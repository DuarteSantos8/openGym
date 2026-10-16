import { useNavigate } from 'react-router-dom'
import { t } from '../lib/i18n.js'
import { MacroGauge, MacroGauges, SectionHeader } from './tab-kit.jsx'

const MACROS = [
  { macro: 'protein', id: 'proteins' },
  { macro: 'carbs', id: 'carbohydrates' },
  { macro: 'fat', id: 'fat' },
]

// The day's protein, carbs and fat as gauges against their targets, with "Set targets" opening
// Goals (ux-redesign-tabs §2). Grams are whole, as the diary shows them. Until the day is in the
// gauges rest at 0 with no target, and sweep to the day once it is. `day` is useDiaryDay's.
export default function NutritionMacros({ day }) {
  const nav = useNavigate()
  const ready = day.status === 'ready'
  const grams = n => (ready && n != null ? Math.round(n) : null)
  return <>
    <SectionHeader title={t('Macros')} link={t('Set targets')} onLink={() => nav('/food/goals')} />
    <MacroGauges>
      {MACROS.map(m => <MacroGauge key={m.macro} macro={m.macro} value={grams(day.totals[m.id] || 0) ?? 0} target={grams(day.macros[m.id])} />)}
    </MacroGauges>
  </>
}
