import { healthDeletionOwner } from './apple-health-deletions.js'

// Phone/account-local consent and weather values. Coordinates never cross the bridge.
const ENABLED = 'opengym_workout_weather_owner'
const RESULT = 'opengym_workout_weather_result'
let pending = null
let attempted = ''
let generation = 0

const ownerOf = store => healthDeletionOwner(store)
export const workoutWeatherEnabled = store => {
  try { return localStorage.getItem(ENABLED) === ownerOf(store) } catch { return false }
}
async function plugin() {
  const { Capacitor, registerPlugin } = await import('@capacitor/core')
  if (Capacitor.getPlatform() !== 'ios') throw new Error('Apple Health is unavailable')
  return { native: registerPlugin('HealthSync') }
}
export async function enableWorkoutWeather(store) {
  const owner = ownerOf(store), token = ++generation
  await (await plugin()).native.authorizeWeather()
  if (ownerOf(store) !== owner || generation !== token) return
  localStorage.setItem(ENABLED, owner)
  attempted = ''
  captureWorkoutWeather(store)
}
export function disableWorkoutWeather() {
  generation++; attempted = ''; pending = null
  try { localStorage.removeItem(ENABLED); localStorage.removeItem(RESULT) } catch { /* unavailable storage */ }
  plugin().then(({ native }) => native.cancelWeather()).catch(() => {})
}
export function captureWorkoutWeather(store, healthEnabled = true, retry = false) {
  const owner = ownerOf(store)
  const active = store.getState().S?.active
  if (!healthEnabled || !workoutWeatherEnabled(store)) {
    if (pending) {
      generation++; pending = null; attempted = ''
      plugin().then(({ native }) => native.cancelWeather()).catch(() => {})
    }
    return
  }
  if (!active?.id || active.backfill || active.editingWorkoutId || !Number.isFinite(active.start) ||
      active.start > Date.now() || Date.now() - active.start > 21600000) return
  if (typeof document !== 'undefined' && document.hidden) return
  const key = JSON.stringify([owner, String(active.id), active.start])
  if (attempted === key) {
    if (!retry || pending) return
    try {
      const history = JSON.parse(localStorage.getItem(RESULT) || '[]')
      if (Array.isArray(history) && history.some(w => w.owner === owner && w.id === String(active.id) && w.start === active.start && validWeather(w))) return
    } catch { /* damaged cache */ }
  }
  attempted = key
  const token = ++generation
  const capture = { owner, id: String(active.id), start: active.start }
  pending = { ...capture, promise: (async () => {
    try {
      const result = await (await plugin()).native.captureWeather({ start: capture.start })
      if (generation !== token || !workoutWeatherEnabled(store) || ownerOf(store) !== owner) return
      // Drop any unexpected fields from the native result, including provider coordinates.
      const value = { ...capture, celsius: result.celsius, humidity: result.humidity, observedAt: result.observedAt }
      if (validWeather(value) && value.observedAt >= capture.start) {
        let history = []
        try { const saved = JSON.parse(localStorage.getItem(RESULT) || '[]'); if (Array.isArray(saved)) history = saved } catch { /* damaged cache */ }
        history = history.filter(w => w.owner === owner && !(w.id === capture.id && w.start === capture.start))
        localStorage.setItem(RESULT, JSON.stringify([...history.slice(-29), value]))
      }
    } catch { /* Weather is optional; a refusal/offline provider never blocks workout export. */ }
    finally { if (generation === token) pending = null }
  })() }
}
export async function waitForWorkoutWeather(store) {
  const capture = pending
  if (capture?.owner === ownerOf(store) && store.getState().S.workouts.some(w => String(w.id) === capture.id && w.start === capture.start)) {
    await capture.promise
  }
}
function validWeather(value) {
  return Number.isFinite(value.celsius) && value.celsius >= -90 && value.celsius <= 60 &&
    Number.isFinite(value.humidity) && value.humidity >= 0 && value.humidity <= 100 &&
    Number.isFinite(value.observedAt) && value.observedAt > 0
}
export function weatherForWorkout(store, workout) {
  if (!workoutWeatherEnabled(store)) return null
  try {
    const history = JSON.parse(localStorage.getItem(RESULT) || '[]')
    const value = Array.isArray(history) ? history.find(w => w.owner === ownerOf(store) && w.id === String(workout.id) && w.start === workout.start) : null
    if (!value || value.owner !== ownerOf(store) || value.id !== String(workout.id) ||
        value.start !== workout.start || !validWeather(value) ||
        value.observedAt < workout.start || value.observedAt > workout.end) return null
    return { celsius: value.celsius, humidity: value.humidity, observedAt: value.observedAt }
  } catch { return null }
}
