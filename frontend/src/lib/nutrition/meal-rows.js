import { dateLocale, t } from '../i18n.js'
import { nutritionOf } from './diary.js'

const amountOf = item => `${item.quantity && Number(item.quantity) !== 1 ? item.quantity + ' × ' : ''}${item.portion ?? ''} ${item.unit || ''}`.trim()

/** The time an entry was logged, in the person's clock (`timeFormat` '12h' | '24h'; unset follows the language). */
export function loggedAt(item, timeFormat) {
  const at = new Date(item.addedAt)
  if (Number.isNaN(at.getTime())) return ''
  const opts = { hour: '2-digit', minute: '2-digit', ...(timeFormat === '12h' ? { hour12: true } : timeFormat === '24h' ? { hour12: false } : {}) }
  try { return at.toLocaleTimeString(dateLocale(), opts) } catch { return at.toTimeString().slice(0, 5) }
}

/**
 * The rows of one meal in the diary: what each entry is called, its line under the name (the brand
 * when `brands`, the amount, the time logged when `times`) and its energy in kcal. With `summed`
 * (Profile › Diary & meals › Quick calories shown) the quick-calorie entries are one row.
 * @returns {{ key: string, name: string, sub: string, kcal: number }[]}
 */
export function mealRows(items, { summed = true, brands = true, times = false, timeFormat } = {}) {
  const rows = []
  let quick = null
  for (const item of items) {
    const kcal = nutritionOf(item).calories || 0
    if (item.type === 'quick_calories') {
      if (summed && quick) { quick.kcal += kcal; quick.count += 1; continue }
      const row = { key: item.uuid || item.addedAt, name: item.name || t('Quick kcal'), sub: t('Quick kcal'), kcal, count: 1 }
      if (summed) quick = row
      else if (times) row.sub = [row.sub, loggedAt(item, timeFormat)].filter(Boolean).join(' · ')
      rows.push(row)
      continue
    }
    const sub = [brands ? item.brand : '', amountOf(item), times ? loggedAt(item, timeFormat) : ''].filter(Boolean).join(' · ')
    rows.push({ key: item.uuid || item.addedAt, name: item.name, sub, kcal })
  }
  return rows.map(({ count, ...row }) => (count > 1 ? { ...row, name: t('Quick kcal'), sub: t('{0} entries', count) } : row))
}
