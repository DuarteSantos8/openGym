import { t } from '../i18n.js'
import { mealsOf } from './diary.js'

// NutriTrace's default meal names are English; a name the person saved is theirs, as saved.
const DEFAULTS = {
  Breakfast: () => t('Breakfast'),
  Lunch: () => t('Lunch'),
  Dinner: () => t('Dinner'),
  Snacks: () => t('Snacks'),
}

/** The meal names to show, by slot. */
export const mealLabels = settings =>
  mealsOf(settings).map(m => (m.isDefault && DEFAULTS[m.name] ? DEFAULTS[m.name]() : m.name))
