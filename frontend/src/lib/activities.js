// Activities (v1.4.5, gm-hooks): a run, a ride, a football match, a climbing night. Sport that is
// not a gym workout: no sets, no volume, no PRs, and they stay out of everything that reads
// S.workouts, the way recovery sessions do (lib/recovery-sessions.js). They come from three places:
//
//   - the phone's health store (Apple Health / Health Connect, lib/health-sync.js `sport` read),
//     where Strava, Garmin, Apple Workout, Runna and friends save them ('ah' / 'hc');
//   - an import from another app (Apple Health export.xml workouts, or a Hevy/Strong session that
//     was only sport) ('import');
//   - typed in by hand on the day sheet or in History ('manual');
//   - later openRunning, over the pairing contract in docs/dev/SISTER_APPS.md ('or').
//
// They show in History and the month calendar, they load the muscles they use in the recovery
// model (lib/recovery.js `activities`), and they count for the week streak only when the profile
// asks for it (`S.activityStreak`, Settings → Look & Home; the walk is api/coach/core/streak.js,
// shared with the server).
//
// Stored one entry per session, keyed by its id, like recovery sessions:
//
//   S.activities = { '<id>': { d: '2026-11-06', sport: 'run', min: 42, km?: 8.1, at?: ms, title?: '…',
//                              src: 'hc' | 'ah' | 'import' | 'manual' | 'or', _ts }, … }
//
// A removal is a stamped empty entry (`{ _ts }`), never a deleted key, so it syncs. An entry that
// came from the health store keeps its id (derived from the store's own id), so reading it again
// never makes a second one, and a removed one is never brought back (the stamp stays).
import { NOTE_MAX } from './history.js'
import { hashId } from './weigh-ins.js'

export const SPORTS = ['run', 'ride', 'swim', 'hike', 'row', 'ski', 'football', 'racket', 'ball', 'climb', 'fight', 'yoga', 'dance', 'other']
export const SPORT_LABEL = {
  run: 'Run', ride: 'Ride', swim: 'Swim', hike: 'Hike', row: 'Rowing', ski: 'Skiing', football: 'Football',
  racket: 'Racket sports', ball: 'Ball games', climb: 'Climbing', fight: 'Boxing & martial arts', yoga: 'Yoga & pilates',
  dance: 'Dance', other: 'Other sport',
}
export const SPORT_ICON = {
  run: 'figureRun', ride: 'bike', swim: 'swim', hike: 'tree', row: 'arm', ski: 'snowflake', football: 'target',
  racket: 'bolt', ball: 'trophy', climb: 'pullup', fight: 'boxing', yoga: 'stretch', dance: 'sparkles', other: 'flag',
}
// The durations the sheet offers in one tap, in minutes.
export const SPORT_PRESETS = [30, 60, 90]
export const ACTIVITY_MIN_MAX = 24 * 60
export const SOURCES = ['hc', 'ah', 'import', 'manual', 'or']
const TITLE_MAX = 80

// What a sport asks of the muscles, for the recovery model: per 30 minutes, in hard-set
// equivalents, spread over the muscles by weight (the way musclesOf weights an exercise). Rough on
// purpose and on the gentle side: 90 minutes of football leaves the legs "recovering", a 45-minute
// easy run tired calves, a yoga class next to nothing. lib/recovery.js caps one session at 12 sets
// per muscle, like a workout.
export const SPORT_LOAD = {
  run: { sets: 3, muscles: { calves: 0.8, quadriceps: 0.6, hamstring: 0.5, gluteal: 0.5, 'hip-flexors': 0.3 } },
  ride: { sets: 2.5, muscles: { quadriceps: 0.9, gluteal: 0.5, hamstring: 0.3, calves: 0.3 } },
  swim: { sets: 2, muscles: { lats: 0.7, 'front-delts': 0.4, 'side-delts': 0.3, triceps: 0.3, 'upper-back': 0.3 } },
  hike: { sets: 1.5, muscles: { quadriceps: 0.6, gluteal: 0.6, calves: 0.5, hamstring: 0.3 } },
  row: { sets: 2.5, muscles: { lats: 0.6, 'upper-back': 0.6, quadriceps: 0.5, gluteal: 0.4, biceps: 0.3, hamstring: 0.3 } },
  ski: { sets: 2.5, muscles: { quadriceps: 0.9, gluteal: 0.5, adductors: 0.4, abs: 0.2 } },
  football: { sets: 3, muscles: { quadriceps: 0.7, hamstring: 0.7, calves: 0.6, gluteal: 0.5, adductors: 0.5, 'hip-flexors': 0.4 } },
  racket: { sets: 2, muscles: { calves: 0.5, quadriceps: 0.5, forearm: 0.5, 'front-delts': 0.3, obliques: 0.3, adductors: 0.3 } },
  ball: { sets: 2.5, muscles: { quadriceps: 0.6, calves: 0.6, gluteal: 0.4, hamstring: 0.4, 'front-delts': 0.2 } },
  climb: { sets: 3.5, muscles: { forearm: 1, lats: 0.7, biceps: 0.6, 'upper-back': 0.5, 'rear-delts': 0.3 } },
  fight: { sets: 2.5, muscles: { 'front-delts': 0.5, 'side-delts': 0.3, triceps: 0.3, obliques: 0.4, abs: 0.3, calves: 0.3 } },
  yoga: { sets: 0.5, muscles: { abs: 0.3, 'hip-flexors': 0.3, hamstring: 0.2 } },
  dance: { sets: 1.5, muscles: { calves: 0.5, quadriceps: 0.4, gluteal: 0.3 } },
  other: { sets: 1, muscles: { quadriceps: 0.3, calves: 0.3 } },
}

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v)
const ISO = /^\d{4}-\d{2}-\d{2}$/
const roundKm = v => Math.round(v * 100) / 100

/** One stored entry read back: { d, sport, min, km?, at?, title?, src } or null for a cleared or broken one. */
export function readActivity(entry) {
  if (!isMap(entry) || !ISO.test(String(entry.d || ''))) return null
  const sport = SPORTS.includes(entry.sport) ? entry.sport : 'other'
  const min = Math.round(Number(entry.min))
  if (!Number.isFinite(min) || min < 1) return null
  const km = Number(entry.km)
  const at = Number(entry.at)
  const title = typeof entry.title === 'string' ? entry.title.trim().slice(0, TITLE_MAX) : ''
  const note = typeof entry.note === 'string' ? entry.note.trim().slice(0, NOTE_MAX) : ''
  return {
    d: entry.d, sport, min: Math.min(ACTIVITY_MIN_MAX, min),
    ...(km > 0 && km < 1000 ? { km: roundKm(km) } : {}),
    ...(at > 0 ? { at } : {}),
    ...(title ? { title } : {}),
    ...(note ? { note } : {}),
    src: SOURCES.includes(entry.src) ? entry.src : 'manual',
  }
}

/** Every activity, newest day first, as { id, d, sport, min, … }. */
export function activitiesOf(S) {
  const map = isMap(S?.activities) ? S.activities : {}
  const out = []
  for (const [id, e] of Object.entries(map)) {
    const a = readActivity(e)
    if (a) out.push({ id, ...a, _ts: Number(e._ts) || 0 })
  }
  return out.sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : (b.at || 0) - (a.at || 0) || b._ts - a._ts))
}

/** The activities on `iso`. */
export const activitiesOn = (S, iso) => activitiesOf(S).filter(a => a.d === iso)

/** The days that hold one, as a Set of ISO dates. */
export const activityDays = S => new Set(activitiesOf(S).map(a => a.d))

/** Whether the week streak counts these days too (off unless asked for). */
export const activityCountsStreak = S => S?.activityStreak === true

/**
 * S.activities with `id` set to `activity`, stamped `now`. Null (or an unusable one) clears it with
 * a stamped empty entry, so the removal syncs.
 */
export function withActivity(map, id, activity, now = Date.now()) {
  const clean = activity ? readActivity(activity) : null
  return { ...(isMap(map) ? map : {}), [id]: clean ? { ...clean, _ts: now } : { _ts: now } }
}

/** What a row calls it: its own title when it came with one, else the sport. */
export const activityName = (a, tr = s => s) => (a?.title ? a.title : tr(SPORT_LABEL[a?.sport] || SPORT_LABEL.other))

/** "Run · 42 min · 8.1 km" (km in the profile's unit is the caller's business: `dist` formats it). */
export function activityLine(a, tr = s => s, dist = km => `${km} km`) {
  if (!a) return ''
  return [activityName(a, tr), tr('{0} min', a.min), a.km ? dist(a.km) : null].filter(Boolean).join(' · ')
}

/** Minutes, sessions and km per sport in the days [from, to], for a month or a report line. */
export function activityTotals(S, from, to) {
  const by = {}
  let min = 0, n = 0, km = 0
  const days = new Set()
  for (const a of activitiesOf(S)) {
    if (a.d < from || a.d > to) continue
    const s = by[a.sport] = by[a.sport] || { sport: a.sport, n: 0, min: 0, km: 0 }
    s.n++; s.min += a.min; s.km += a.km || 0
    n++; min += a.min; km += a.km || 0
    days.add(a.d)
  }
  const sports = Object.values(by).map(s => ({ ...s, km: roundKm(s.km) })).sort((a, b) => b.min - a.min || (a.sport < b.sport ? -1 : 1))
  return { n, min, km: roundKm(km), days: days.size, sports }
}

/* ---------------------------------------------------------------- recovery ---- */

const localNoon = iso => new Date(iso + 'T12:00:00').getTime()

/**
 * What lib/recovery.js fatigueOf takes as `activities`: one item per activity of the last
 * `windowMs`, { timestamp, sets: { slug: hard-set equivalents } }. The session's end, if it has
 * a start, else the day's noon. Off with S.activityRecovery === false.
 */
export function activityStimuli(S, now = Date.now(), windowMs = 30 * 86400e3) {
  if (S?.activityRecovery === false) return []
  const out = []
  for (const a of activitiesOf(S)) {
    const ts = a.at > 0 ? a.at + a.min * 60e3 : localNoon(a.d)
    if (!(ts <= now) || now - ts > windowMs) continue
    const load = SPORT_LOAD[a.sport] || SPORT_LOAD.other
    const scale = load.sets * a.min / 30
    const sets = {}
    for (const [slug, w] of Object.entries(load.muscles)) sets[slug] = scale * w
    out.push({ timestamp: ts, sets })
  }
  return out
}

/* ----------------------------------------------------------- from elsewhere ---- */

// The names the native readWorkouts answer with (HealthConnectPlugin.java / AppleHealthPlugin.swift
// sportName): the sports above, plus three that are not activities. 'strength' and 'gym' (an
// elliptical, a stair machine, a treadmill, a spin bike, HIIT) belong in a workout, where openGym
// logs them itself; 'walk' would bring every stroll a watch noticed.
export const NOT_ACTIVITY = new Set(['strength', 'gym', 'walk'])

// openGym's own records in the hub, and the watch app's: never read back as activities.
const OWN_ORIGIN = /^(ch\.duartesantos\.opengym|ch\.opengym\.app)(\.|$)/

/** Whether a health-store workout record is one openGym (or its watch) wrote itself. */
export const isOwnRecord = rec => /^opengym-/.test(String(rec?.clientId || '')) || OWN_ORIGIN.test(String(rec?.origin || ''))

/** The id an activity read from the store gets: the same record always the same id. */
export const healthActivityId = (rec, src) => src + hashId(String(rec?.id || `${rec?.start}|${rec?.sport}`))

// A workout logged in openGym over the same time (a treadmill run the watch also saved as a run).
function overlapsWorkout(S, start, end) {
  for (const w of Array.isArray(S?.workouts) ? S.workouts : []) {
    const ws = Number(w?.start), we = Number(w?.end) || ws
    if (ws > 0 && start < we && end > ws) return true
  }
  return false
}

const isoLocal = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

/**
 * One workout record from the health store (`{ id, sport, start, end, title?, km?, origin?, clientId? }`)
 * as an activity, or null when it is not one: openGym's own, strength or gym cardio, a walk, under
 * five minutes, in the future, or over a workout logged here.
 */
export function activityFromHealth(rec, S, src, now = Date.now()) {
  if (!rec || isOwnRecord(rec)) return null
  const sport = String(rec.sport || '')
  if (NOT_ACTIVITY.has(sport)) return null
  const start = Number(rec.start), end = Number(rec.end)
  if (!(start > 0) || !(end > start) || end > now + 60e3) return null
  const min = Math.round((end - start) / 60e3)
  if (min < 5) return null
  if (overlapsWorkout(S, start, end)) return null
  return readActivity({ d: isoLocal(start), sport: SPORTS.includes(sport) ? sport : 'other', min, at: start, km: Number(rec.km) || 0, title: typeof rec.title === 'string' ? rec.title : '', src })
}

/**
 * Health-store workouts into S.activities (mutates S): new ones added, nothing removed, a removed one
 * (a stamped empty entry) never brought back, one already here left as it is. Returns the ids added.
 */
export function mergeHealthActivities(S, records, { src, now = Date.now() } = {}) {
  const map = isMap(S.activities) ? S.activities : {}
  const added = []
  for (const rec of Array.isArray(records) ? records : []) {
    const a = activityFromHealth(rec, S, src, now)
    if (!a) continue
    const id = healthActivityId(rec, src)
    if (Object.hasOwn(map, id)) continue
    map[id] = { ...a, _ts: now }
    added.push(id)
  }
  if (added.length) S.activities = map
  return added
}

/* -------------------------------------------------------------- by its name ---- */

// A session name (Hevy, Strong, an export's title) to a sport, first match wins. The words are
// English plus the big European languages, since people name their exercises in their own.
const NAME_SPORT = [
  [/\b(padel|tennis|squash|badminton|pickleball|racquetball|table tennis|ping ?pong|tischtennis)\b/, 'racket'],
  [/\b(football|soccer|fu(ss|ß)ball|futsal|futebol|f[uú]tbol|calcio)\b/, 'football'],
  [/\b(basketball|volleyball|handball|rugby|hockey|baseball|softball|cricket|netball|lacrosse|frisbee|water polo|basquete|v[oô]lei)\b/, 'ball'],
  [/\b(climb|climbing|bouldering|boulder|klettern|bouldern|escalade|escalada)\b/, 'climb'],
  [/\b(boxing|kickboxing|muay thai|mma|bjj|jiu.?jitsu|judo|karate|taekwondo|martial arts|wrestling|boxen|kampfsport)\b/, 'fight'],
  [/\b(yoga|pilates)\b/, 'yoga'],
  [/\b(dance|dancing|zumba|salsa|tanzen|danse|dan[cç]a)\b/, 'dance'],
  [/\b(hike|hiking|wandern|trekking|randonn[ée]e|senderismo)\b/, 'hike'],
  [/\b(ski|skiing|snowboard|snowboarding|skifahren|langlauf|cross.?country ski)\b/, 'ski'],
  [/\b(swim|swimming|schwimmen|natation|nata[cç][aã]o|nuoto)\b/, 'swim'],
  [/\b(kayak|canoe|paddle|paddling|sup|rudern)\b/, 'row'],
  [/\b(cycling|bike ride|road bike|mountain bike|mtb|gravel|velo|radfahren|rennrad|outdoor ride)\b/, 'ride'],
  [/\b(running|outdoor run|trail run|jogging|joggen|laufen|course [aà] pied|corrida|run)\b/, 'run'],
]
// Gym cardio by its name: stays a workout entry, never an activity.
const GYM_CARDIO = /\b(treadmill|stationary|indoor|spin|elliptical|cross.?trainer|stair|stepper|erg|ergometer|assault|air bike|rowing machine|laufband|hometrainer)\b/

/** The sport a name says, or null ("Padel with Tom" → 'racket'; "Treadmill run" → null). */
export function sportOfName(name) {
  const s = String(name || '').toLowerCase()
  if (!s || GYM_CARDIO.test(s)) return null
  for (const [re, sport] of NAME_SPORT) if (re.test(s)) return sport
  return null
}

/* ---------------------------------------------------------------- imports ---- */

// Apple Health's export names (HKWorkoutActivityType…) to the native names above.
const HK_SPORT = {
  Running: 'run', Cycling: 'ride', HandCycling: 'ride', Swimming: 'swim', SwimBikeRun: 'swim', WaterSports: 'swim', SurfingSports: 'swim',
  Hiking: 'hike', Climbing: 'climb', Rowing: 'row', PaddleSports: 'row', Sailing: 'row',
  DownhillSkiing: 'ski', CrossCountrySkiing: 'ski', Snowboarding: 'ski', SnowSports: 'ski', SkatingSports: 'ski',
  Soccer: 'football',
  Tennis: 'racket', Badminton: 'racket', Squash: 'racket', TableTennis: 'racket', Racquetball: 'racket', Pickleball: 'racket',
  Basketball: 'ball', Volleyball: 'ball', Handball: 'ball', Rugby: 'ball', Hockey: 'ball', Baseball: 'ball', Softball: 'ball',
  Cricket: 'ball', AmericanFootball: 'ball', AustralianFootball: 'ball', Lacrosse: 'ball', WaterPolo: 'ball', DiscSports: 'ball',
  Boxing: 'fight', Kickboxing: 'fight', MartialArts: 'fight', Wrestling: 'fight', Fencing: 'fight',
  Yoga: 'yoga', Pilates: 'yoga', MindAndBody: 'yoga', TaiChi: 'yoga',
  SocialDance: 'dance', CardioDance: 'dance', Dance: 'dance', DanceInspiredTraining: 'dance', Barre: 'dance',
  Walking: 'walk', WheelchairWalkPace: 'walk', WheelchairRunPace: 'walk',
  TraditionalStrengthTraining: 'strength', FunctionalStrengthTraining: 'strength', CoreTraining: 'strength',
  Elliptical: 'gym', StairClimbing: 'gym', Stairs: 'gym', StepTraining: 'gym', HighIntensityIntervalTraining: 'gym',
  MixedCardio: 'gym', MixedMetabolicCardioTraining: 'gym', CrossTraining: 'gym', JumpRope: 'gym', Flexibility: 'gym',
  Cooldown: 'gym', PreparationAndRecovery: 'gym', FitnessGaming: 'gym',
}
export const hkSportName = type => HK_SPORT[String(type || '').replace(/^HKWorkoutActivityType/, '')] || 'other'

const attr = (tag, name) => { const m = new RegExp('\\s' + name + '="([^"]*)"').exec(tag); return m ? m[1] : null }
const UNIT_MIN = { min: 1, s: 1 / 60, sec: 1 / 60, hr: 60, h: 60 }
const UNIT_KM = { km: 1, m: 0.001, mi: 1.609344, ft: 0.0003048, yd: 0.0009144 }

/**
 * The workouts of an Apple Health export (`export.xml`) that are sport, as activities to import:
 * [{ id, d, sport, min, km?, at, src: 'import' }]. openGym's own (sourceName openGym), strength,
 * gym cardio and walks are left out, like the live read does. A scan, not a DOM: the file can be
 * hundreds of MB (lib/import-csv.js parseBodyweight reads the weigh-ins the same way).
 */
export function activitiesFromHealthExport(text) {
  const s = String(text || '')
  if (!s.includes('<Workout ')) return []
  const out = []
  const re = /<Workout\s[^>]*>/g
  let m
  while ((m = re.exec(s))) {
    const tag = m[0]
    if (/opengym/i.test(attr(tag, 'sourceName') || '')) continue
    const sport = hkSportName(attr(tag, 'workoutActivityType'))
    if (NOT_ACTIVITY.has(sport)) continue
    const start = Date.parse(String(attr(tag, 'startDate') || '').replace(' ', 'T').replace(/ ([+-]\d{2})(\d{2})$/, '$1:$2'))
    if (!Number.isFinite(start)) continue
    const dur = Number(attr(tag, 'duration'))
    const min = Number.isFinite(dur) ? dur * (UNIT_MIN[attr(tag, 'durationUnit') || 'min'] ?? 1) : NaN
    const dist = Number(attr(tag, 'totalDistance'))
    const km = Number.isFinite(dist) ? dist * (UNIT_KM[attr(tag, 'totalDistanceUnit') || 'km'] ?? 0) : 0
    const a = readActivity({ d: String(attr(tag, 'startDate')).slice(0, 10), sport, min: Math.round(min), at: start, km, src: 'import' })
    if (!a || a.min < 5) continue
    out.push({ id: 'i' + hashId(`${start}|${sport}|${a.min}`), ...a })
  }
  return out
}

/**
 * The workouts of another app's import that were only sport ("Padel", "Football" in Hevy or Strong:
 * an exercise of its own with minutes and nothing else) taken out of `parsed.workouts` and turned
 * into activities. `nameOf(entry)` names an entry (the custom exercise the import made, or the
 * catalogue's). A workout with one real set in it stays a workout, sport and all.
 * Returns { workouts, activities }.
 */
export function splitSportWorkouts(workouts, nameOf) {
  const keep = [], activities = []
  for (const w of Array.isArray(workouts) ? workouts : []) {
    const entries = Array.isArray(w?.entries) ? w.entries : []
    const sports = entries.map(e => sportOfName(nameOf(e)))
    const timedOnly = entries.every(e => (e.sets || []).length > 0 && (e.sets || []).every(s => !(s.r > 0) && !(s.w > 0) && Number(s.min) > 0))
    const first = sports.find(Boolean)
    if (!entries.length || !first || sports.some(x => !x) || !timedOnly) { keep.push(w); continue }
    const setMin = entries.reduce((n, e) => n + e.sets.reduce((m, s) => m + Number(s.min), 0), 0)
    const span = Number(w.end) > Number(w.start) ? (w.end - w.start) / 60e3 : 0
    const km = entries.reduce((n, e) => n + e.sets.reduce((m, s) => m + (Number(s.speed) > 0 ? s.speed * s.min / 60 : 0), 0), 0)
    const title = typeof w.name === 'string' && w.name && w.name !== 'Imported' ? w.name : nameOf(entries[0])
    const a = readActivity({ d: w.d, sport: first, min: Math.round(setMin || span), at: Number(w.start) || 0, km, title, note: w.note, src: 'import' })
    if (!a) { keep.push(w); continue }
    activities.push({ id: 'i' + hashId(`${w.d}|${w.start || ''}|${first}|${a.min}`), ...a })
  }
  return { workouts: keep, activities }
}

/** Imported activities into S.activities (mutates S): one already here (or removed) is left alone. Returns how many came in. */
export function mergeImportedActivities(S, list, now = Date.now()) {
  const map = isMap(S.activities) ? S.activities : {}
  let n = 0
  for (const { id, ...a } of Array.isArray(list) ? list : []) {
    if (!id || Object.hasOwn(map, id)) continue
    const clean = readActivity(a)
    if (!clean) continue
    map[id] = { ...clean, _ts: now }
    n++
  }
  if (n) S.activities = map
  return n
}
