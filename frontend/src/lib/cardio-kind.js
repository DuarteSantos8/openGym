// What kind of cardio an exercise is, read off its name and equipment: a run, a ride, a walk...
// A leaf module (no imports): the weekly cardio goals (lib/cardio-goals.js) sort sessions by it,
// and a new cardio exercise starts at a pace that fits its kind (cardioStartSpeed below).

// A name to a kind, first match wins (lowercase, the catalogue's English plus the big European
// languages, since people name their own exercises in theirs). Machines before what you do on them:
// "elliptical machine walk" is the elliptical, "walking on stepmill" the stairs.
const NAME_KIND = [
  [/swim|schwimm|natation|nata[cç]|nuoto|p[lł]ywan/, 'swim'],
  [/elliptic|cross.?trainer|wave machine|ellittic|el[ií]ptic/, 'elliptical'],
  [/stair|step.?mill|stepper|treppe|escalier|escada|escalera/, 'stairs'],
  [/jump.?rope|skip.?rope|skipping|seilspring|springseil|corde [aà] sauter|comba|corda/, 'rope'],
  [/ski.?erg|\bski(ing|en)?\b|langlauf|skifahr/, 'ski'],
  [/\brow(ing|er)?\b|rudern|ruder|aviron|remo\b|vogatore/, 'row'],
  [/aquabike|bike|bicycl|cycl|\bspin|ergometer|velo|v[ée]lo|\brad(fahren)?\b|hometrainer|bici|cicl/, 'ride'],
  [/hike|hiking|wander|randonn|trekking|senderismo|escursion/, 'hike'],
  [/walk|gehen|spazier|\bmarche\b|caminhada|caminar|camminat/, 'walk'],
  [/treadmill|\brun\b|runn|\bjog|sprint|trot|laufen|laufband|joggen|course|corrida|correr|corsa|\bbieg/, 'run'],
]
// Drills done on the spot: cardio, but no run or walk.
const DRILL = /high knee|butt kick|in place|on spot|on the spot|place jog|quick feet|against wall|wheel run|push to run|run and |shuffle|ski step|wind sprint/
const DRILL_KINDS = new Set(['run', 'walk', 'ski'])
// When the name says nothing: the machine.
const EQ_KIND = { 'stationary bike': 'ride', 'elliptical machine': 'elliptical', 'stepmill machine': 'stairs', 'skierg machine': 'ski', 'upper body ergometer': 'ride' }

/** The kind an exercise name (and its equipment) says, or null for cardio of no kind ("burpee"). */
export function kindOfName(name, eq) {
  const s = String(name || '').toLowerCase()
  for (const [re, kind] of NAME_KIND) {
    if (!re.test(s)) continue
    return DRILL_KINDS.has(kind) && DRILL.test(s) ? null : kind
  }
  return EQ_KIND[String(eq || '').toLowerCase()] || null
}

/* ---------------------------------------------------------------- a pace to start at ---- */

// What a new cardio exercise opens at, in the unit it will be read in: a round number on the
// machine's display. Every cardio exercise used to start at 8 km/h, a jog, so "Walking on
// treadmill" asked for one too, and a bike for a crawl (app test 2026-11-11, P6).
// Only the kinds where 8 km/h is plainly wrong have a pace of their own; a run stays at 8, and a
// rower, a cross trainer or a stepper keep it too (their displays do not agree on what speed is).
export const START_SPEED = { kmh: 8, mph: 8 / 1.609344 }
const KIND_SPEED = {
  walk: { kmh: 5, mph: 3 },
  hike: { kmh: 5, mph: 3 },
  ride: { kmh: 20, mph: 12 },
  swim: { kmh: 3, mph: 2 },
}
// A bike in a pool goes nowhere fast.
const NO_PACE = /aqua/i

/**
 * The speed a new cardio slot of this exercise starts at, in km/h as speeds are stored.
 * `unit`: the profile's speed unit ('kmh' or 'mph'), so an mph profile reads a round "3 mph"
 * and not "3.11".
 */
export function cardioStartSpeed(name, eq, unit = 'kmh') {
  const own = NO_PACE.test(String(name || '')) ? null : KIND_SPEED[kindOfName(name, eq)]
  if (!own) return 8
  return unit === 'mph' ? Math.round(own.mph * 1.609344 * 100) / 100 : own.kmh
}
