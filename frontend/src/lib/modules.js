// Modules (v1.4.4, Settings → Modules): whole feature areas switched on and off, so the app can
// be just a training log or the whole thing. Discord (seals187, Shadowbyte): "it's important not
// to overload the app with 1000 functions and settings", "like a plugin system where you can
// enable, disable plugins". These are built-in parts of the app, not third-party plugins.
//
// THE RULES
//   - One source of truth: every view asks isOn(S, id), never S.modules directly.
//   - S.modules is { [id]: boolean }, only the choices someone made. A missing key is on, so a
//     profile from before 1.4.4 keeps every surface it had. The one exception is the gym check-in,
//     which had a switch of its own before (S.checkIn): until Modules decides, that one does.
//   - Off hides the module's surfaces (cards, Stats parts, Settings pages and rows, search hits,
//     notifications, widget fields) and pauses what it would send (health sync, the watch, the
//     webhooks, scheduled Coach reviews). It never deletes anything: switched back on, it is all
//     there, and the paused syncs catch up.
//   - The Coach and the MCP server read the data whatever the modules say: hiding is about the
//     screen, the data is the same (docs/MODULES.md).
//   - S.modules syncs per key (lib/sync-merge.js PER_KEY and api/sync-stamps.js), so switching
//     Body off on the phone and Seasonal off on the laptop keeps both.
//   - A module whose surfaces split cleanly has a switch per part (PARTS, #1087). Screens ask
//     partOn(S, module, part): the module on and the part's switch. The module wins: off, every
//     part is hidden whatever its switch; back on, each part is as it was left. A part never set
//     is on, and the presets set modules only. Stored in S.modules as 'module.part' keys, so a
//     part syncs per key like a module; everything that walks the modules walks MODULE_IDS.
//
// The core (logging, plans, history, the exercise library, the basic stats) is not a module.
// Pure: no imports, so lib/ helpers such as history.js effortOf can use it without a cycle.

/* `title` and `desc` are English keys, translated where they are shown. Order is the page's. */
export const MODULES = [
  { id: 'effort', group: 'training', icon: 'gauge', tint: 'var(--purple)', title: 'Effort',
    desc: 'Rate each set in RIR or RPE, and see in Stats how hard you really push.' },
  { id: 'plates', group: 'training', icon: 'plate', tint: 'var(--orange)', title: 'Plates and warm-ups',
    desc: 'The plates to load under every set, and warm-ups that build themselves.' },
  { id: 'strength', group: 'training', icon: 'medal', tint: 'var(--yellow)', title: 'Strength levels',
    desc: 'Beginner to Elite for your main lifts, measured against your body weight.' },
  { id: 'videos', group: 'training', icon: 'camera', tint: 'var(--teal)', title: 'Form videos',
    desc: 'Film a set and watch it back right under the row.' },
  { id: 'watch', group: 'training', icon: 'watch', tint: 'var(--grey)', title: 'Watch',
    desc: 'Log sets from your wrist on an Apple Watch, Wear OS, Garmin or Zepp watch.' },
  { id: 'exercise', group: 'training', icon: 'dumbbell', tint: 'var(--acc)', title: 'Exercise settings',
    desc: 'Progression, plate loading, set types and units in an exercise’s settings.' },
  { id: 'checkin', group: 'training', icon: 'qr', tint: 'var(--blue)', title: 'Gym check-in',
    desc: 'Your membership codes on Home, and NFC stickers that start a workout.' },
  { id: 'body', group: 'body', icon: 'scale', tint: 'var(--teal)', title: 'Body',
    desc: 'Weigh-ins, measurements, progress photos and your weight goal.' },
  { id: 'health', group: 'body', icon: 'heart', tint: 'var(--red)', title: 'Health',
    desc: 'Apple Health or Health Connect, heart rate and recovery tips.' },
  { id: 'motivation', group: 'extras', icon: 'flame', tint: 'var(--orange)', title: 'Motivation',
    desc: 'Streaks, challenges, badges, recaps and your year in openGym.' },
  { id: 'coach', group: 'extras', icon: 'sparkles', tint: 'var(--green)', title: 'AI Coach',
    desc: 'Reviews your training and suggests changes. You still say yes or no.' },
  { id: 'integrations', group: 'extras', icon: 'webhook', tint: 'var(--indigo)', title: 'Integrations',
    desc: 'Webhooks for Home Assistant and friends, and the MCP server.' },
  { id: 'community', group: 'extras', icon: 'globe', tint: 'var(--blue)', title: 'Community',
    desc: 'Exercises, plans and sounds people on your server shared, and a way to share yours.' },
  { id: 'seasonal', group: 'extras', icon: 'pumpkin', tint: 'var(--orange)', title: 'Seasonal themes',
    desc: 'Halloween and friends, little extras for the time of year. All optional.' },
]
export const MODULE_IDS = MODULES.map(m => m.id)
export const MODULE = Object.fromEntries(MODULES.map(m => [m.id, m]))

export const GROUPS = [
  { id: 'training', title: 'Training' },
  { id: 'body', title: 'Body and health' },
  { id: 'extras', title: 'Extras' },
]

/* The presets, smallest first. Each names the modules it turns on; every other one is off. */
const TRAINING = ['effort', 'plates', 'exercise', 'watch']
export const PRESETS = [
  { id: 'training', title: 'Just training', desc: 'Log, plan, progress. Nothing else on the screen.', on: TRAINING },
  { id: 'body', title: 'Training and body', desc: 'Plus weigh-ins, measurements, photos and your health apps.', on: [...TRAINING, 'strength', 'body', 'health'] },
  { id: 'all', title: 'Everything', desc: 'Streaks, the Coach, themes, the lot.', on: MODULE_IDS },
]
export const PRESET = Object.fromEntries(PRESETS.map(p => [p.id, p]))

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v)

// Modules this build cannot have at all (lib/build-caps.js: the Coach, Integrations and Community
// in openGym Offline, which has no network). Off whatever S.modules says, and not offered on the
// Modules page; the choice itself is kept, so the same profile on a normal build is unchanged.
let unavailable = new Set()
export function setUnavailableModules(ids) { unavailable = new Set(Array.isArray(ids) ? ids : []) }
/** Whether this build has module `id` at all. */
export const moduleBuilt = id => !unavailable.has(id)

/** Whether module `id` is on for this profile. Unknown ids are on (a newer client's module). */
export function isOn(S, id) {
  if (unavailable.has(id)) return false
  const v = isMap(S?.modules) ? S.modules[id] : undefined
  if (typeof v === 'boolean') return v
  // Before 1.4.4 the check-in had its own switch in Look & Home; it decides until Modules does.
  if (id === 'checkin') return S?.checkIn !== false
  return true
}

/** { [id]: boolean } for every module, as this profile has them now. */
export function moduleStates(S) {
  return Object.fromEntries(MODULE_IDS.map(id => [id, isOn(S, id)]))
}

/** The full modules map a preset stands for. */
export function presetModules(presetId) {
  const p = PRESET[presetId]
  if (!p) return null
  const on = new Set(p.on)
  return Object.fromEntries(MODULE_IDS.map(id => [id, on.has(id)]))
}

/** 'training' | 'body' | 'all' when the modules match a preset exactly, else 'custom'. */
export function presetOf(S) {
  const now = moduleStates(S)
  // A module this build lacks is left out of the comparison: "Everything" is still everything here.
  const ids = MODULE_IDS.filter(moduleBuilt)
  for (const p of PRESETS) {
    const want = presetModules(p.id)
    if (ids.every(id => now[id] === want[id])) return p.id
  }
  return 'custom'
}

/** How many modules are on. */
export const onCount = S => MODULE_IDS.filter(id => isOn(S, id)).length

/**
 * Writes a preset or one module into a draft state (useStore update). Every key is written
 * explicitly, so the choice syncs per module and an older default never decides later.
 */
export function applyPreset(s, presetId) {
  const m = presetModules(presetId)
  if (!m) return
  s.modules = { ...(isMap(s.modules) ? s.modules : {}), ...m }
}
export function setModule(s, id, on) {
  if (!MODULE[id]) return
  s.modules = { ...(isMap(s.modules) ? s.modules : {}), [id]: !!on }
}

/* The parts of a module, in the order its row lists them. `title` and `desc` are English keys,
   translated where they are shown (lib/modules-copy.js partCopy). An exercise's sets, reps,
   weight, rests and note are not a part: they always show. */
export const PARTS = {
  strength: [
    { id: 'details', title: 'In an exercise’s details', desc: 'Your level on a main lift, beside its records.' },
    { id: 'list', title: 'Strength levels in Stats', desc: 'Every main lift with its level, in one card.' },
  ],
  exercise: [
    { id: 'progression', title: 'Progression', desc: 'The rule that moves the weight or the reps up.' },
    { id: 'plates', title: 'Plate loading', desc: 'The bar, the plates and the weight stack of an exercise.' },
    { id: 'intensity', title: 'Drop-sets, rest-pause and pyramids', desc: 'Sets that change shape, and the last set to failure.' },
    { id: 'units', title: 'Weight unit and dumbbells', desc: 'An exercise’s own kg or lb, and what a dumbbell weight means.' },
  ],
  body: [
    { id: 'weight', title: 'Body weight', desc: 'The Home card, the weigh-in before a workout, your goal and the weight chart.' },
    { id: 'measurements', title: 'Body measurements', desc: 'Circumferences and your own fields.' },
    { id: 'photos', title: 'Progress photos', desc: 'Photos of you over time, side by side.' },
  ],
  motivation: [
    { id: 'streak', title: 'Week streak', desc: 'Your streak on Home, in Stats, in the calendar and on the watch.' },
    { id: 'challenges', title: 'Monthly challenges', desc: 'Three goals a month and the trophy shelf, on Home and in Stats.' },
    { id: 'recaps', title: 'Week and month recap', desc: 'Your week and Your month, once one is over.' },
    { id: 'year', title: 'Your year in openGym', desc: 'Your year in December and January, and its notification.' },
    { id: 'share', title: 'Share as image', desc: 'A finished workout or a recap as a picture to send.' },
  ],
}

/** The parts of module `id` (an empty list for a module that is one switch). */
export const partsOf = id => PARTS[id] || []

/** A part's own switch, whatever its module says: the stored choice, else on. */
export function partSwitch(S, id, part) {
  const v = isMap(S?.modules) ? S.modules[id + '.' + part] : undefined
  return typeof v === 'boolean' ? v : true
}

/** Whether part `part` of module `id` shows: the module on, and the part's switch. */
export const partOn = (S, id, part) => isOn(S, id) && partSwitch(S, id, part)

/** Whether any part of module `id` shows (a screen that holds only its parts, like Stats → Body). */
export const anyPartOn = (S, id) => isOn(S, id) && (!partsOf(id).length || partsOf(id).some(p => partSwitch(S, id, p.id)))

/** How many parts of module `id` have their switch on, the module aside ("2 of 3"). */
export const partsOnCount = (S, id) => partsOf(id).filter(p => partSwitch(S, id, p.id)).length

/** Sets a part's switch into a draft state, as setModule does a module's. */
export function setPart(s, id, part, on) {
  if (!partsOf(id).some(p => p.id === part)) return
  s.modules = { ...(isMap(s.modules) ? s.modules : {}), [id + '.' + part]: !!on }
}

/** The modules a change from `S` to `next` (a modules map) switches off. */
export function turnedOff(S, next) {
  return MODULE_IDS.filter(id => isOn(S, id) && next[id] === false)
}
