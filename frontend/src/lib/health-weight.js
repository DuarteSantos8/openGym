import { Capacitor, registerPlugin } from '@capacitor/core'
import { App } from '@capacitor/app'
import { isoOf } from './format.js'
import { t } from './i18n.js'

const HealthKit = registerPlugin('HealthKit')
const POUNDS_PER_KILOGRAM = 2.2046226218

/**
 * A health store a weigh-in can come from.
 * @typedef {object} HealthStore
 * @property {string} platform  the Capacitor platform that has it, e.g. 'ios'; one store per platform
 * @property {string} id        saved on the weigh-in as `src`; never change one that has shipped
 * @property {() => string} getLabel  its name in the user's language; call t with a string literal so the locale check sees it
 */

// A second store adds one line here, and its reader. health-weight.test.js checks every line
// against the shape above, since nothing else in this project would.
/** @type {HealthStore[]} */
export const HEALTH_STORES = [
  { platform: 'ios', id: 'apple-health', getLabel: () => t('Apple Health') },
]

// The store this platform reads, by its id; null where there is none.
export const getHealthSource = () => HEALTH_STORES.find(store => store.platform === Capacitor.getPlatform())?.id ?? null
// The name to show for a weigh-in's source. A typed weigh-in has no `src`. An id this build does
// not know has no name, so it is never passed off as a typed one.
export const getSourceLabel = source =>
  (source ? HEALTH_STORES.find(store => store.id === source)?.getLabel() ?? null : t('Manual'))
export const hasHealthStore = () => !!getHealthSource()
export const readHealthWeight = () => hasHealthStore()
  ? HealthKit.latestBodyMass().then(result => ({ ...result, source: getHealthSource() }))
  : Promise.resolve({ status: 'unsupported' })

const isPositiveWeight = kilograms => Number.isFinite(kilograms) && kilograms > 0
// A number of milliseconds that is also a date the calendar can hold.
const isRealTimestamp = ms => Number.isFinite(ms) && Number.isFinite(new Date(ms).getTime())

// `t` is when the entry was saved, as for a typed weigh-in, so the sync merge (later `t` wins)
// keeps a reading that replaced an earlier guess. `m` is when the reading was measured.
export function buildHealthWeighIn(sample, unit, now = Date.now()) {
  if (!isPositiveWeight(sample.kilograms) || !isRealTimestamp(sample.measuredAt)) {
    throw new Error('Apple Health returned an invalid weight or date')
  }
  const weight = Math.round(sample.kilograms * (unit === 'lb' ? POUNDS_PER_KILOGRAM : 1) * 10) / 10
  // A weight so small it rounds to nothing at one decimal.
  if (weight <= 0) throw new Error('Apple Health returned an unusable weight')
  return { d: isoOf(new Date(sample.measuredAt)), w: weight, t: now, src: sample.source, m: sample.measuredAt }
}

// One weigh-in per day. A typed entry that replaces a health reading drops its `src` but keeps
// `m`, the reading it stands in for, so that reading is not applied over the correction.
// Returns a new list and leaves the one passed in untouched.
export function replaceDailyWeight(weighIns, entry) {
  const replaced = weighIns.find(weighIn => weighIn.d === entry.d)
  const isTypedOverHealthReading = entry.m == null && replaced?.m != null
  const saved = isTypedOverHealthReading ? { ...entry, m: replaced.m } : entry
  return [...weighIns.filter(weighIn => weighIn !== replaced), saved]
    .sort((earlier, later) => earlier.d.localeCompare(later.d))
}

// A weigh-in is the weight before the day's workout: a reading taken once that workout has
// started does not replace the one already logged for the day.
export const wasTakenAfterWorkout = (state, entry) =>
  [...state.workouts, state.active].some(workout => workout && workout.d === entry.d && workout.start <= entry.m)

export function initHealthWeightSync(sync) {
  if (!hasHealthStore()) return () => {}
  let stopped = false
  let listener = null
  const onVisible = () => { if (!stopped && document.visibilityState === 'visible') sync() }
  document.addEventListener('visibilitychange', onVisible)
  App.addListener('appStateChange', ({ isActive }) => { if (!stopped && isActive) sync() })
    .then(handle => { if (stopped) return handle.remove(); listener = handle })
    .catch(error => console.warn('Apple Health foreground listener failed; using page visibility events', error))
  sync()
  return () => {
    stopped = true
    document.removeEventListener('visibilitychange', onVisible)
    if (listener) Promise.resolve(listener.remove()).catch(error => console.warn('Apple Health listener cleanup failed', error))
  }
}
