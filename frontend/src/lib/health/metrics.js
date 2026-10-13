// The health area's metrics: one entry per kind of reading, and the one place a new metric is
// added. Every value is stored in the canonical unit named here, whatever the profile shows
// (lib/health/units.js converts at the screen's edge), so a unit switch rewrites nothing and two
// devices on different settings never disagree about a number — the rule lib/speed.js and
// lib/measurements.js already follow.
//
//   unit     canonical unit of a stored value: kg, cm, km, kcal, %, bpm, count, min, ''
//   dim      what the screen converts it as: 'mass' (kg/lb), 'height' (cm/ft-in), 'distance'
//            (km/mi), or 'none' (shown as stored)
//   daily    how several readings of one day become that day's value: 'last' (a body reading:
//            the latest one counts), 'mean' (heart rate), 'sum' (a day's total, which a source
//            hands over already summed: steps, distance, energy, sleep)
//   group    the tab it lives on in the health area
//   bia      offered in the body composition form (the "+" of the health area)
//   dec      decimals shown
//   min/max  what a typed value may be, in the canonical unit
//
// A type this list does not know (one a newer version of the app added) is still kept by
// lib/health/records.js, just not shown — an older app must not drop a newer one's data.

export const HEALTH_GROUPS = ['overview', 'body', 'activity', 'heart', 'sleep']

export const HEALTH_METRICS = {
  // Body composition. Weight also has a home of its own, the weigh-in log (S.bodyweight).
  weight: { label: 'Weight', unit: 'kg', dim: 'mass', daily: 'last', group: 'body', bia: true, dec: 1, min: 1, max: 700, icon: 'scale', color: 'var(--blue)' },
  bmi: { label: 'BMI', unit: '', dim: 'none', daily: 'last', group: 'body', bia: true, dec: 1, min: 5, max: 150, icon: 'person', color: 'var(--indigo)' },
  bodyFat: { label: 'Body fat', unit: '%', dim: 'none', daily: 'last', group: 'body', bia: true, dec: 1, min: 1, max: 80, icon: 'chartLine', color: 'var(--orange)' },
  fatMass: { label: 'Fat mass', unit: 'kg', dim: 'mass', daily: 'last', group: 'body', bia: true, dec: 1, min: 0.5, max: 400, icon: 'chartLine', color: 'var(--orange)' },
  leanMass: { label: 'Lean mass', unit: 'kg', dim: 'mass', daily: 'last', group: 'body', bia: true, dec: 1, min: 1, max: 400, icon: 'figureStrength', color: 'var(--green)' },
  muscleMass: { label: 'Muscle mass', unit: 'kg', dim: 'mass', daily: 'last', group: 'body', bia: true, dec: 1, min: 1, max: 300, icon: 'arm', color: 'var(--green)' },
  bodyWater: { label: 'Body water', unit: '%', dim: 'none', daily: 'last', group: 'body', bia: true, dec: 1, min: 10, max: 90, icon: 'gauge', color: 'var(--teal)' },
  visceralFat: { label: 'Visceral fat', unit: '', dim: 'none', daily: 'last', group: 'body', bia: true, dec: 1, min: 1, max: 60, icon: 'target', color: 'var(--red)' },
  boneMass: { label: 'Bone mass', unit: 'kg', dim: 'mass', daily: 'last', group: 'body', bia: true, dec: 1, min: 0.1, max: 20, icon: 'shield', color: 'var(--grey)' },
  protein: { label: 'Protein', unit: '%', dim: 'none', daily: 'last', group: 'body', bia: true, dec: 1, min: 1, max: 50, icon: 'bolt', color: 'var(--purple)' },
  bmr: { label: 'Basal metabolic rate', unit: 'kcal', dim: 'none', daily: 'last', group: 'body', bia: true, dec: 0, min: 300, max: 6000, icon: 'flame', color: 'var(--orange)' },
  metabolicAge: { label: 'Metabolic age', unit: 'years', dim: 'none', daily: 'last', group: 'body', bia: true, dec: 0, min: 5, max: 120, icon: 'hourglass', color: 'var(--grey)' },
  height: { label: 'Height', unit: 'cm', dim: 'height', daily: 'last', group: 'body', dec: 0, min: 50, max: 260, icon: 'ruler', color: 'var(--grey)' },
  // Activity: a day's totals.
  steps: { label: 'Steps', unit: 'count', dim: 'none', daily: 'sum', group: 'activity', dec: 0, min: 0, max: 200000, icon: 'steps', color: 'var(--green)' },
  distance: { label: 'Distance', unit: 'km', dim: 'distance', daily: 'sum', group: 'activity', dec: 2, min: 0, max: 500, icon: 'figureRun', color: 'var(--teal)' },
  activeEnergy: { label: 'Active calories', unit: 'kcal', dim: 'none', daily: 'sum', group: 'activity', dec: 0, min: 0, max: 20000, icon: 'flame', color: 'var(--orange)' },
  restingEnergy: { label: 'Resting calories', unit: 'kcal', dim: 'none', daily: 'sum', group: 'activity', dec: 0, min: 0, max: 10000, icon: 'flame', color: 'var(--yellow)' },
  // Heart.
  heartRate: { label: 'Heart rate', unit: 'bpm', dim: 'none', daily: 'mean', group: 'heart', dec: 0, min: 20, max: 250, icon: 'heart', color: 'var(--red)' },
  restingHeartRate: { label: 'Resting heart rate', unit: 'bpm', dim: 'none', daily: 'mean', group: 'heart', dec: 0, min: 20, max: 200, icon: 'heart', color: 'var(--pink)' },
  // Sleep: minutes asleep in the night that ended on that day.
  sleep: { label: 'Sleep', unit: 'min', dim: 'none', daily: 'sum', group: 'sleep', dec: 0, min: 0, max: 1440, icon: 'moon', color: 'var(--indigo)' },
}

export const HEALTH_TYPES = Object.keys(HEALTH_METRICS)
export const BIA_TYPES = HEALTH_TYPES.filter(k => HEALTH_METRICS[k].bia)
export const metricOf = type => HEALTH_METRICS[type] || null
export const typesInGroup = group => HEALTH_TYPES.filter(k => HEALTH_METRICS[k].group === group)

// The cards on the health area's first tab, in this order; each shows only once it has data.
export const OVERVIEW_TYPES = ['weight', 'bodyFat', 'muscleMass', 'steps', 'restingHeartRate', 'sleep']
// The body composition tab always lists these, empty or not: the five the area is about.
export const BODY_CORE = ['weight', 'bodyFat', 'muscleMass', 'leanMass', 'bodyWater']
