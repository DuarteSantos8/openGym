import { t } from '../lib/i18n.js'
import { mealItems } from '../lib/nutrition/diary.js'
import { mealLabels } from '../lib/nutrition/meal-name.js'
import MealRow from './MealRow.jsx'
import ActivityRows from './ActivityRows.jsx'
import { Card } from './blocks.jsx'

// The day's meals as collapsed rows, then its activity (ia-proposal §2). `day` is useDiaryDay's.
export default function MealsCard({ date, day }) {
  const names = mealLabels(day.settings)
  return <Card className="meals-card">
    <h2 className="sr-only">{t('Meals')}</h2>
    {names.map((name, slot) => <MealRow key={slot} date={date} slot={slot} name={name} items={mealItems(day.entry, slot)} />)}
    <ActivityRows rows={day.activityRows} target={day.target} sum={day.activitySum} policy={day.settings?.manualActivityPolicy} />
  </Card>
}
