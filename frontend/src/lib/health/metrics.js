// The health area's metrics: one entry per kind of reading. Everything Apple Health records comes
// from the shared catalogue (api/health/catalogue.js), the one place such a type is added; the
// body composition values only a scale or an analyser gives (muscle mass, body water…) are listed
// here. Every value is stored in the canonical unit named here, whatever the profile shows
// (lib/health/units.js converts at the screen's edge), so a unit switch rewrites nothing and two
// devices on different settings never disagree about a number — the rule lib/speed.js and
// lib/measurements.js already follow.
//
//   unit     canonical unit of a stored value (kg, cm, km, kcal, %, bpm, count, min, g, mg, mL…)
//   dim      how it converts (catalogue.js DIMS); the screen shows mass in kg or lb, lengths in cm
//            or inches, distances and speeds in km or mi, temperatures in °C or °F
//   daily    how several readings of one day become that day's value: 'last' (a body reading:
//            the latest one counts), 'mean', 'sum' (a day's total, which a source hands over
//            already summed), 'max' (a symptom's worst level of the day)
//   group    the tab it lives on in the health area
//   levels   for a symptom, a flow or a test: what each stored value 1, 2, 3… reads as
//   bia      offered in the body composition form (the "+" of the health area)
//   dec      decimals shown
//   min/max  what a value may be, in the canonical unit
//
// A type this list does not know (one a newer version of the app added) is still kept by
// lib/health/records.js, just not shown — an older app must not drop a newer one's data.
import { TYPES, LEVELS } from '../../../../api/health/catalogue.js'
import { COMPOSITION } from '../../../../api/health/composition.js'

export const HEALTH_GROUPS = ['overview', 'body', 'activity', 'heart', 'vitals', 'sleep', 'mobility', 'hearing', 'nutrition',
  'cycle', 'symptoms', 'mindfulness', 'workouts']
// Each group's tab label and the look of its cards.
export const GROUPS = {
  overview: { label: 'Overview' },
  body: { label: 'Body', icon: 'scale', color: 'var(--blue)' },
  activity: { label: 'Activity', icon: 'flame', color: 'var(--green)' },
  heart: { label: 'Heart', icon: 'heart', color: 'var(--red)' },
  vitals: { label: 'Vitals', icon: 'gauge', color: 'var(--teal)' },
  sleep: { label: 'Sleep', icon: 'moon', color: 'var(--indigo)' },
  mobility: { label: 'Mobility', icon: 'steps', color: 'var(--orange)' },
  hearing: { label: 'Hearing', icon: 'speaker', color: 'var(--purple)' },
  nutrition: { label: 'Nutrition', icon: 'clipboard', color: 'var(--yellow)' },
  cycle: { label: 'Cycle tracking', icon: 'calendar', color: 'var(--pink)' },
  symptoms: { label: 'Symptoms', icon: 'warning', color: 'var(--orange)' },
  mindfulness: { label: 'Mindfulness', icon: 'sparkles', color: 'var(--teal)' },
  workouts: { label: 'Workouts', icon: 'dumbbell', color: 'var(--green)' },
}

const DAILY = { sample: 'last', sum: 'sum', range: 'mean', mean: 'mean', hour: 'mean', sleep: 'sum', min: 'sum', ev: 'sum', lvl: 'max', val: 'last', wo: 'sum' }
// The cards that had a look of their own before the catalogue; every other type takes its group's.
const LOOK = {
  weight: ['scale', 'var(--blue)'], bmi: ['person', 'var(--indigo)'], bodyFat: ['chartLine', 'var(--orange)'],
  leanMass: ['figureStrength', 'var(--green)'], height: ['ruler', 'var(--grey)'], steps: ['steps', 'var(--green)'],
  distance: ['figureRun', 'var(--teal)'], activeEnergy: ['flame', 'var(--orange)'], restingEnergy: ['flame', 'var(--yellow)'],
  heartRate: ['heart', 'var(--red)'], restingHeartRate: ['heart', 'var(--pink)'], sleep: ['moon', 'var(--indigo)'],
}
const BIA = new Set(['weight', 'bmi', 'bodyFat', 'leanMass'])
// Display units that are not the stored one's name.
const SHOWN = { bpm: 'bpm', 'count/min': '/min', 'km/hr': 'km/h', 'mL/kg·min': 'mL/kg·min', 'kcal/hr·kg': 'kcal/h·kg', degC: '°C', dBASPL: 'dB', mcS: 'µS', mcg: 'µg' }

export const HEALTH_METRICS = {}
for (const x of Object.values(TYPES)) {
  const [icon, color] = LOOK[x.type] || [GROUPS[x.group].icon, GROUPS[x.group].color]
  HEALTH_METRICS[x.type] = {
    label: x.label, unit: x.unit, dim: x.dim, daily: DAILY[x.kind], group: x.group, dec: x.dec, min: x.min, max: x.max,
    icon, color, kind: x.kind, ...(SHOWN[x.unit] ? { shown: SHOWN[x.unit] } : {}),
    ...(x.cat ? { levels: LEVELS[x.cat] } : {}), ...(BIA.has(x.type) ? { bia: true } : {}),
  }
}
// What only a body composition scale or analyser measures (api/health/composition.js, shared with
// the server): the "+" form offers the ones marked for it; a segmental reading (`seg`) is shown in
// the body tab's segmental analysis instead of a card of its own.
const LOOK_BIA = {
  fatMass: ['chartLine', 'var(--orange)'], muscleMass: ['arm', 'var(--green)'], bodyWater: ['gauge', 'var(--teal)'],
  visceralFat: ['target', 'var(--red)'], boneMass: ['shield', 'var(--grey)'], protein: ['bolt', 'var(--purple)'],
  bmr: ['flame', 'var(--orange)'], metabolicAge: ['hourglass', 'var(--grey)'], skeletalMuscle: ['arm', 'var(--mint)'],
  subcutaneousFat: ['chartLine', 'var(--yellow)'], smi: ['figureStrength', 'var(--indigo)'], whr: ['ruler', 'var(--teal)'],
  bodyScore: ['star', 'var(--yellow)'], cardiacIndex: ['heart', 'var(--pink)'], impedance: ['bolt', 'var(--grey)'],
  impedance2: ['bolt', 'var(--grey)'],
}
for (const x of Object.values(COMPOSITION)) {
  const [icon, color] = LOOK_BIA[x.type] || (x.seg?.kind === 'segMuscle' ? ['arm', 'var(--green)'] : x.seg?.kind === 'segFat' ? ['chartLine', 'var(--orange)'] : ['bolt', 'var(--grey)'])
  HEALTH_METRICS[x.type] = {
    label: x.label, unit: x.unit, dim: x.dim, daily: 'last', group: 'body', bia: x.form !== false, dec: x.dec, min: x.min, max: x.max,
    icon, color, kind: 'sample', ...(x.seg ? { seg: x.seg } : {}),
  }
}

// The form's order: weight first, then what a scale reports, height last.
const FORM = ['weight', 'bmi', 'bodyFat', 'fatMass', 'leanMass', 'muscleMass', 'bodyWater', 'visceralFat', 'boneMass', 'protein', 'bmr', 'metabolicAge']
export const HEALTH_TYPES = Object.keys(HEALTH_METRICS)
export const BIA_TYPES = FORM.filter(k => HEALTH_METRICS[k]?.bia)
export const metricOf = type => HEALTH_METRICS[type] || null
export const typesInGroup = group => HEALTH_TYPES.filter(k => HEALTH_METRICS[k].group === group)

// The cards on the health area's first tab, in this order; each shows only once it has data.
export const OVERVIEW_TYPES = ['weight', 'bodyFat', 'muscleMass', 'steps', 'restingHeartRate', 'sleep']
// The body composition tab always lists these, empty or not: the five the area is about.
export const BODY_CORE = ['weight', 'bodyFat', 'muscleMass', 'leanMass', 'bodyWater']
// The other tabs always list these; every other card shows once it has data, so a tab is not a
// wall of empty cards for what the phone never records.
export const GROUP_CORE = {
  activity: ['steps', 'distance', 'activeEnergy', 'restingEnergy'],
  heart: ['heartRate', 'restingHeartRate'],
  sleep: ['sleep'],
}
