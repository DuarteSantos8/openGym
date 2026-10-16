// The words for the onboarding's choice values, in the UI language. Literal t() calls, so the
// source-string check sees every key.
import { t } from '../i18n-core.js'

export const experienceLabel = v => ({ new: t('New to lifting'), returning: t('Coming back'), regular: t('Lift regularly') }[v])
export const equipmentLabel = v => ({ gym: t('Full gym'), dumbbells: t('Dumbbells only'), none: t('No equipment') }[v])

export const EXPERIENCE_OPTIONS = () => ['new', 'returning', 'regular'].map(value => ({ value, label: experienceLabel(value) }))
export const EQUIPMENT_OPTIONS = () => ['gym', 'dumbbells', 'none'].map(value => ({ value, label: equipmentLabel(value) }))

/** "Monday", "Mon", "M" for a DAYN weekday (0 Sunday), in the UI's date locale. */
export function weekdayName(day, locale, style = 'long') {
  // 2023-01-01 was a Sunday.
  const d = new Date(Date.UTC(2023, 0, 1 + day, 12))
  return d.toLocaleDateString(locale, { weekday: style, timeZone: 'UTC' })
}
