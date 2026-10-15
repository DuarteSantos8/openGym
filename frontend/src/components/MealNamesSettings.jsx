import { t } from '../lib/i18n.js'
import { mealLabels } from '../lib/nutrition/meal-name.js'
import { MEAL_NAMES_MAX } from '../lib/nutrition/settings-lists.js'
import { useNtSettings } from '../lib/nutrition/use-nt-settings.js'
import { Row, Section } from './ui.jsx'
import { mealNameSheet } from './MealNameSheet.jsx'

// The meals of a day, in the order the diary shows them (NutriTrace Settings › Diary › Meal
// names). A tap edits one; the last row adds one. A name you never changed shows in the app's
// language and is saved as shown the first time the list changes.
export default function MealNamesSettings() {
  const { data } = useNtSettings()
  const names = mealLabels(data)
  return (
    <Section title={t('Meals')} footer={t('The order here is the order in the diary. Moving or removing a meal moves what was logged under it.')}>
      {names.map((name, slot) => (
        <Row key={slot} icon="utensils" iconTint="var(--orange)" title={name} accessory="chevron" onClick={() => mealNameSheet(slot)} />
      ))}
      {names.length < MEAL_NAMES_MAX && <Row icon="plusCircle" iconTint="var(--green)" title={t('Add a meal')} accessory="chevron" onClick={() => mealNameSheet(names.length)} />}
    </Section>
  )
}
