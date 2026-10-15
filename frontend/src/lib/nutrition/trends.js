// Progress › Trends: NutriTrace's Statistics page for the diary (src/routes/Statistics.svelte), pure.
// One metric at a time over a run of days: a nutrient or water per day, the days with nothing
// logged left out, a goal line where the person has a goal, and the average, lowest and highest.
// No React and no network here; `days` is GET /api/diary (every day with a row).
import { t } from '../i18n.js'
import { energyOf, nutritionOf, sumNutrition, waterGoalOf, waterOf, waterTotal } from './diary.js'

const DAY = 86400000

/** The metrics the explorer offers, with the unit NutriTrace stores them in (src/lib/nutrition.js
 *  NUTRIMENTS, minus kilojoules, which is calories shown in the person's energy unit). The label
 *  is read at call time so it follows the language. */
export const nutrientOptions = () => [
  { value: 'calories', label: t('Calories'), unit: 'kcal' },
  { value: 'proteins', label: t('Protein'), unit: 'g' },
  { value: 'carbohydrates', label: t('Carbs'), unit: 'g' },
  { value: 'fat', label: t('Fat'), unit: 'g' },
  { value: 'water', label: t('Water'), unit: 'ml' },
  { value: 'fiber', label: t('Fiber'), unit: 'g' },
  { value: 'sugars', label: t('Sugars'), unit: 'g' },
  { value: 'added-sugars', label: t('Added sugars'), unit: 'g' },
  { value: 'saturated-fat', label: t('Saturated fat'), unit: 'g' },
  { value: 'trans-fat', label: t('Trans fat'), unit: 'g' },
  { value: 'polyunsaturated-fat', label: t('Polyunsaturated fat'), unit: 'g' },
  { value: 'monounsaturated-fat', label: t('Monounsaturated fat'), unit: 'g' },
  { value: 'cholesterol', label: t('Cholesterol'), unit: 'mg' },
  { value: 'sodium', label: t('Sodium'), unit: 'mg' },
  { value: 'salt', label: t('Salt'), unit: 'g' },
  { value: 'potassium', label: t('Potassium'), unit: 'mg' },
  { value: 'calcium', label: t('Calcium'), unit: 'mg' },
  { value: 'iron', label: t('Iron'), unit: 'mg' },
  { value: 'magnesium', label: t('Magnesium'), unit: 'mg' },
  { value: 'zinc', label: t('Zinc'), unit: 'mg' },
  { value: 'phosphorus', label: t('Phosphorus'), unit: 'mg' },
  { value: 'vitamin-a', label: t('Vitamin A'), unit: 'mcg' },
  { value: 'vitamin-c', label: t('Vitamin C'), unit: 'mg' },
  { value: 'vitamin-d', label: t('Vitamin D'), unit: 'mcg' },
  { value: 'vitamin-e', label: t('Vitamin E'), unit: 'mg' },
  { value: 'vitamin-k', label: t('Vitamin K'), unit: 'mcg' },
  { value: 'b1', label: t('Vitamin B1'), unit: 'mg' },
  { value: 'b2', label: t('Vitamin B2'), unit: 'mg' },
  { value: 'b3', label: t('Vitamin B3'), unit: 'mg' },
  { value: 'b6', label: t('Vitamin B6'), unit: 'mg' },
  { value: 'b9', label: t('Folate (B9)'), unit: 'mcg' },
  { value: 'b12', label: t('Vitamin B12'), unit: 'mcg' },
  { value: 'caffeine', label: t('Caffeine'), unit: 'mg' },
  { value: 'alcohol', label: t('Alcohol'), unit: 'g' },
]

/** The four the page opens with, as tiles. */
export const HEADLINE_METRICS = ['calories', 'proteins', 'carbohydrates', 'fat']

export const DEFAULT_METRIC = 'calories'

/** A metric from the address, or the default when it is absent or not one of ours. */
export const metricFrom = value => (nutrientOptions().some(o => o.value === value) ? value : DEFAULT_METRIC)

const round1 = n => Math.round(n * 10) / 10
const dayKey = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
const mean = list => list.reduce((a, b) => a + b, 0) / list.length

/** The calendar days from `from` to `to`, both 'YYYY-MM-DD', oldest first. */
export function daysBetween(from, to) {
  const out = []
  const d = new Date(from + 'T12:00:00')
  const end = new Date(to + 'T12:00:00')
  while (d <= end) {
    out.push(dayKey(d))
    d.setDate(d.getDate() + 1)
  }
  return out
}

/** The first and last day of a range of `range` days ending today (0 = from the first logged
 *  day), as Progress's range control picks it. Today is left out, as Statistics does by default:
 *  a day still being logged reads as a dip. `null` when there is nothing to show. */
export function windowOf(range, days, today) {
  const end = dayKey(new Date(new Date(today + 'T12:00:00').getTime() - DAY))
  if (range > 0) return { from: dayKey(new Date(new Date(end + 'T12:00:00').getTime() - (range - 1) * DAY)), to: end }
  // A day of water alone counts: the explorer charts water too.
  const first = days.filter(d => d.date < today && ((d.items?.length || 0) > 0 || (d.water?.length || 0) > 0)).map(d => d.date).sort()[0]
  return first ? { from: first, to: end } : null
}

/** One day's value of a metric in the stored unit (kcal, ml, g, mg, mcg), or null when the day
 *  has nothing to count: no food for a nutrient, no drink for water. A day with food but none of
 *  this nutrient counts as 0. */
export function valueOf(entry, metric) {
  if (!entry) return null
  if (metric === 'water') {
    const total = waterTotal(entry)
    return total > 0 ? total : null
  }
  const items = entry.items || []
  if (!items.length) return null
  return sumNutrition(items.map(nutritionOf))[metric] || 0
}

/** The unit a metric is shown in, for the person's energy and water settings. */
export function unitOf(metric, settings) {
  if (metric === 'calories') return energyOf(0, settings).unit
  if (metric === 'water') return waterOf(0, settings).unit
  return nutrientOptions().find(o => o.value === metric)?.unit || ''
}

/** A stored value as shown: kcal as kcal or kJ, ml in the water unit. */
export function shown(metric, value, settings) {
  if (value == null) return null
  if (metric === 'calories') return energyOf(value, settings).value
  if (metric === 'water') return waterOf(value, settings).value
  return round1(value)
}

/** The per-day series of a metric over [from, to], in display units: [{ date, value|null }]. */
export function seriesOf(days, metric, window, settings) {
  if (!window) return []
  const byDate = new Map(days.map(d => [d.date, d]))
  return daysBetween(window.from, window.to).map(date => ({ date, value: shown(metric, valueOf(byDate.get(date), metric), settings) }))
}

/** Average, lowest and highest of the days that have a value; null with none. */
export function summaryOf(series) {
  const vals = series.filter(p => p.value != null).map(p => p.value)
  if (!vals.length) return null
  return { avg: round1(mean(vals)), min: round1(Math.min(...vals)), max: round1(Math.max(...vals)), count: vals.length }
}

/** LineChart points for the days that have a value. */
export const pointsOf = series => series
  .filter(p => p.value != null)
  .map(p => ({ t: new Date(p.date + 'T12:00:00').getTime(), y: p.value, d: p.date }))

// One target for a whole range, as Statistics draws it (goal-resolver.js resolveRangeGoal): a shared
// goal is its value, a weekday split the average of its positive days. Zero is no goal.
function rangeGoal(g) {
  if (!g) return null
  const positive = v => (Number(v) > 0 ? Number(v) : null)
  if (g.sharedGoal === false && Array.isArray(g.days) && g.days.length === 7) {
    const days = g.days.map(positive).filter(v => v != null)
    if (days.length) return mean(days)
  }
  return positive(g.max) ?? positive(g.min)
}

const PERCENT_DENSITY = { fat: 9, 'saturated-fat': 9, carbohydrates: 4, sugars: 4, proteins: 4 }

/** The person's goal line for a metric, in display units: `{ value, base }`, or null without one.
 *  `base` is true for the calorie line under a Dynamic or Adaptive target: that target moves every
 *  day with the wearable or the weight trend and is not kept, so the line is the fixed goal under
 *  it, which NutriTrace labels "Base Goal". A percentage macro goal is grams against the fixed
 *  calorie goal (2000 without one), in every mode. */
export function goalOf(settings, metric) {
  if (!settings) return null
  if (metric === 'water') return settings.waterGoalMl > 0 ? { value: shown('water', waterGoalOf(settings), settings), base: false } : null
  const goal = rangeGoal(settings.goals?.[metric])
  if (goal == null) return null
  if (metric === 'calories') return { value: shown('calories', goal, settings), base: (settings.calorieGoalMode || 'fixed') !== 'fixed' }
  const density = PERCENT_DENSITY[metric]
  if (settings.goals[metric].isPercent && density) {
    return { value: Math.round(((rangeGoal(settings.goals.calories) ?? 2000) * goal) / 100 / density), base: false }
  }
  return { value: round1(goal), base: false }
}
