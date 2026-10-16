import { t } from '../lib/i18n.js'
import { mealItems } from '../lib/nutrition/diary.js'
import { mealLabels } from '../lib/nutrition/meal-name.js'
import MealRow from './MealRow.jsx'
import ActivityRows from './ActivityRows.jsx'
import YesterdayMealRow from './YesterdayMealRow.jsx'
import { Card } from './blocks.jsx'

// The day's meals as collapsed rows, then its activity (ia-proposal §2). `day` is useDiaryDay's.
// `find`: the uuid of an entry to show (a search's Day result, FoodHub `?find=`): the meal that
// holds it opens and the entry flashes. `again`: the meal (today's, by the clock) that offers
// yesterday's to log again, inside it while it is empty (ux-redesign-tabs §4.2); null for none.
export default function MealsCard({ date, day, find = null, again = null }) {
  const names = mealLabels(day.settings)
  return <Card className="meals-card">
    <h2 className="sr-only">{t('Meals')}</h2>
    {names.map((name, slot) => {
      const items = mealItems(day.entry, slot)
      return <MealRow key={slot} date={date} slot={slot} name={name} items={items} find={items.some(i => i.uuid === find) ? find : null}>
        {slot === again && <YesterdayMealRow settings={day.settings} meal={slot} whileEmpty inline />}
      </MealRow>
    })}
    <ActivityRows rows={day.activityRows} target={day.target} sum={day.activitySum} policy={day.settings?.manualActivityPolicy} />
  </Card>
}
