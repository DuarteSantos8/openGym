import { dateLocale } from '../i18n-core.js'
const formats = new Map()
// Nutrition's saved amounts have three decimal places, independent of workout weight display.
export function formatNutrition(value) {
  const locale = dateLocale()
  if (!formats.has(locale)) formats.set(locale, new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }))
  return formats.get(locale).format(value)
}
