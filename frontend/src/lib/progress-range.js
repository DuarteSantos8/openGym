// The Progress tab's date range: 1M / 3M / 1Y / All, in days, 0 being everything. The root picks
// it for the whole tab and each card opens its page at the same range, as ?range= (deep-link
// safe). The last pick is kept on the device (redesign-native, Owner decision 10); a first visit
// starts at 3M.
import { t } from './i18n.js'

const KEY = 'gains.progressRange'
export const DEFAULT_RANGE = 90

// A function because the label for All follows the current language.
export const rangeOptions = () => [{ value: 30, label: '1M' }, { value: 90, label: '3M' }, { value: 365, label: '1Y' }, { value: 0, label: t('All') }]

const valid = v => rangeOptions().some(o => o.value === v)

/** The range in an address's ?range=, or `fallback` when it has none or one that is not offered. */
export const rangeFrom = (search, fallback) => {
  const params = new URLSearchParams(search)
  const raw = params.get('range')
  const v = raw ? Number(raw) : NaN
  return valid(v) ? v : fallback
}

const store = () => { try { return globalThis.localStorage || null } catch { return null } }

/** The range this device last picked, or 3M. */
export function storedRange() {
  try {
    const raw = store()?.getItem(KEY)
    const v = raw ? Number(raw) : NaN
    return valid(v) ? v : DEFAULT_RANGE
  } catch { return DEFAULT_RANGE }
}

export function rememberRange(v) {
  if (!valid(v)) return
  try { store()?.setItem(KEY, String(v)) } catch { /* private mode: the next visit starts at 3M */ }
}

/** Where a range starts, in ms (0 for All). Worked out once per pick rather than from each
 *  render's clock, so the charts' memoised points keep their identity (LineChart drops its hover
 *  on a new array). */
export const rangeStart = days => (days ? Date.now() - days * 86400000 : 0)
