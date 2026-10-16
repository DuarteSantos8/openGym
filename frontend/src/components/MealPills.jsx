import { useNavigate } from 'react-router-dom'
import { t } from '../lib/i18n.js'
import { todayISO } from '../lib/format.js'
import { mealItems, totalsOf } from '../lib/nutrition/diary.js'
import { mealLabels } from '../lib/nutrition/meal-name.js'
import { useDiarySelection } from '../lib/nutrition/selection.js'
import { useUnits } from '../lib/nutrition/use-units.js'
import { foodPickerSheet } from './FoodPickerSheet.jsx'
import Icon from './Icon.jsx'
import { Chip, ChipRow } from './blocks.jsx'
import { SectionHeader } from './tab-kit.jsx'

// The day's food on Home, one pill a meal (ux-redesign-tabs §1.5): "Breakfast 420" or "Lunch +".
// A pill opens Log food for that meal: it picks the meal the way the picker's own header does
// (selection.js setMeal, held for half an hour), then opens the same sheet. "Diary" opens the
// whole day on Nutrition. Not the diary itself: no items, nothing expands. `day` is useDiaryDay's.
export default function MealPills({ date, day }) {
  const nav = useNavigate()
  const units = useUnits()
  const names = mealLabels(day.settings)
  const open = slot => { useDiarySelection.getState().setMeal(slot); foodPickerSheet() }
  return <>
    <SectionHeader title={date === todayISO() ? t('Today’s food') : t('Food')} link={t('Diary')} onLink={() => nav('/food')} />
    <ChipRow className="meal-pills">
      {names.map((name, slot) => {
        const items = day.dayReady ? mealItems(day.entry, slot) : []
        const kcal = items.length ? totalsOf(items).calories : null
        return <Chip key={slot} nocap onClick={() => open(slot)} data-meal-slot={slot}
          aria-label={kcal != null ? `${name} ${units.energy(kcal)}, ${t('Log food')}` : t('Log food to {0}', name)}>
          {name}{kcal != null ? <span className="meal-pill-v">{units.energyValue(kcal)}</span> : <Icon name="plus" />}
        </Chip>
      })}
    </ChipRow>
  </>
}
