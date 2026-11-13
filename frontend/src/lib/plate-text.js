// The words of one plate line (lib/plates.js rowLoad), shared by the set list and the focus card.
// The first line of an exercise names the bar it counts with, so a log that leaves the bar out
// (10 kg plates logged as 20 kg) sees why "5 per side" is said, and a weight under the bar says
// that instead of "Bar only" (Discord, 2026-11-04).
import { t } from './i18n-core.js'
import { fmtPlate } from './format.js'

// `bar`: the base is a real bar. A plate-loaded machine with a weight of its own is no "50 lb bar".
export function plateText(L, { unit, base = 0, first = false, bar = true } = {}) {
  if (!L) return ''
  if (L.underBar && bar) return t('Lighter than the {0} bar', fmtPlate(L.bar) + ' ' + unit)
  if (L.barOnly) return t('Bar only')
  const stack = L.plates.map(w => fmtPlate(w)).join(' + ') || '–'
  if (L.kind !== 'pairs') return t('Load {0}', stack)
  return first && bar && base > 0 ? t('{0} per side on a {1} bar', stack, fmtPlate(base) + ' ' + unit) : t('{0} per side', stack)
}
