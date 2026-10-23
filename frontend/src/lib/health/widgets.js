// The health widgets on Home: which metrics, in which order (S.homeWidgets). A setting like any
// other, so it follows the profile to every device. null — a profile that never chose — is the
// default set; an empty list is "none", which hides the card.
import { HEALTH_METRICS, HEALTH_TYPES } from './metrics.js'
import { hasData } from './records.js'

export const DEFAULT_WIDGETS = ['steps', 'sleep', 'restingHeartRate', 'bodyFat']
export const MAX_WIDGETS = 6

/** The chosen metrics, known ones only, at most MAX_WIDGETS, each once. */
export function widgetsOf(S) {
  const raw = Array.isArray(S?.homeWidgets) ? S.homeWidgets : DEFAULT_WIDGETS
  return [...new Set(raw.filter(k => typeof k === 'string' && HEALTH_METRICS[k]))].slice(0, MAX_WIDGETS)
}

/** The widgets the Home card shows: the chosen ones that have a reading. Empty hides the card. */
export const visibleWidgets = S => widgetsOf(S).filter(k => hasData(S, k))

// What the chooser always offers; any other kind of reading once the profile has one, so the
// list is not a hundred kinds the phone never records.
const ALWAYS = ['weight', 'bmi', 'bodyFat', 'fatMass', 'leanMass', 'muscleMass', 'bodyWater', 'visceralFat', 'boneMass',
  'protein', 'bmr', 'metabolicAge', 'height', 'steps', 'distance', 'activeEnergy', 'restingEnergy', 'heartRate', 'restingHeartRate', 'sleep']

/** The metrics the chooser lists: the main ones and every other one the profile has a reading of. */
export function widgetChoices(S) {
  const present = new Set((S?.health || []).map(r => r?.type))
  return HEALTH_TYPES.filter(k => ALWAYS.includes(k) || present.has(k))
}

/** The list with `type` switched on (at the end) or off; refuses a seventh. */
export function toggleWidget(list, type) {
  if (list.includes(type)) return list.filter(k => k !== type)
  return list.length >= MAX_WIDGETS ? list : [...list, type]
}

/** The list with `type` moved one place up (dir -1) or down (+1). */
export function moveWidget(list, type, dir) {
  const i = list.indexOf(type), j = i + dir
  if (i < 0 || j < 0 || j >= list.length) return list
  const out = list.slice()
  ;[out[i], out[j]] = [out[j], out[i]]
  return out
}
