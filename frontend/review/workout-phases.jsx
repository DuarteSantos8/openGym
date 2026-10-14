// Development-only entry: real app components, synthetic data, session-local persistence.
// Vite's production entry remains index.html. This page never connects to an account.
import React from 'react'
import { createRoot } from 'react-dom/client'
import App from '../src/App.jsx'
import { useStore, normalizeState } from '../src/store/useStore.js'
import { SECTION_PRESETS, addSection, assignSection, moveSection } from '../src/lib/workout-sections.js'
import { buildRoutineSession as buildSessionEntries } from '../src/lib/session-start.js'
import { buildCompletedWorkout } from '../src/lib/finish-workout.js'
import { todayISO } from '../src/lib/format.js'
import { workoutVolume } from '../src/lib/history.js'
import '../src/index.css'

const params = new URLSearchParams(location.search)
const flat = params.has('flat')
const chips = params.has('chips')
const key = `opengym-phases-review-v141-${flat ? 'flat' : 'phased'}`
if (params.has('reset')) sessionStorage.removeItem(key)
const routine = { id: 'review', name: 'Upper body', emoji: 'dumbbell', prog: 'off', ex: [
  { id: '0025', mode: 'reps', sets: 1, reps: 8, weight: 20 },
  { id: '0025', mode: 'reps', sets: 2, reps: 5, weight: 60, sg: 'pair' },
  { id: '0047', mode: 'reps', sets: 2, reps: 8, weight: 35, sg: 'pair' },
  { id: '1259', mode: 'time', sets: 1, sec: 30, weight: 0, bodyweight: true },
] }
if (chips) routine.ex.splice(1, 0, { ...routine.ex[0] })
const warmEntries = routine.ex.slice(0, chips ? 2 : 1)
if (!flat) {
  const warm = addSection(routine, SECTION_PRESETS[0])
  warmEntries.forEach(entry => assignSection(routine, entry.occurrenceId, warm))
  moveSection(routine, warm, -1)
  const stretch = addSection(routine, SECTION_PRESETS[5])
  assignSection(routine, routine.ex.find(e => e.id === '1259').occurrenceId, stretch)
}
const seed = normalizeState({ routines: [routine], week: { 1: 'review', 3: 'review', 5: 'review' }, theme: params.has('light') ? 'light' : 'dark', lang: 'en', langAuto: false, gifSize: 'mini', keepAwake: false, sound: false, vibrate: false, rest: chips ? 60 : 0, checkIn: false })
const completed = { ...buildSessionEntries(seed, routine), id: 'review-history', name: routine.name, routineId: routine.id, d: todayISO(), start: Date.now() - 1800000, bw: 75 }
completed.entries.forEach(e => e.sets.forEach(s => { s.done = true }))
seed.workouts = [buildCompletedWorkout(completed, { end: Date.now() - 60000 })]
seed.workouts[0].vol = workoutVolume(seed.workouts[0])
if (chips) {
  seed.active = { ...buildSessionEntries(seed, routine), id: 'review-active', name: routine.name, routineId: routine.id, d: todayISO(), start: Date.now(), cur: 1, workoutView: 'cards' }
  seed.active.entries[0].sets.forEach(set => { set.done = true })
}
let saved
try { saved = JSON.parse(sessionStorage.getItem(key)) } catch { /* fresh fixture */ }
for (const workout of saved?.workouts || []) if (workout.vol == null) workout.vol = workoutVolume(workout)
const persist = state => {
  const S = normalizeState(state)
  sessionStorage.setItem(key, JSON.stringify(S))
  useStore.setState({ S })
}
useStore.setState({
  S: saved ? normalizeState(saved) : seed,
  ready: true, user: null, boot: async () => {}, isGuest: () => true,
  update: mut => { const S = structuredClone(useStore.getState().S); mut(S); persist(S) },
  replaceState: persist,
})
if (!location.hash) location.hash = '/plan/r/review'
createRoot(document.getElementById('root')).render(<App />)
