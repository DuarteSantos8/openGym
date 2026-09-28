import crypto from 'node:crypto'
import { z } from 'zod'
import { EXIDX, BODYPARTS } from '../../frontend/src/lib/exercises.js'
import { cleanupSg } from '../../frontend/src/lib/history.js'
import { exerciseMuscleSnapshot } from '../../frontend/src/lib/muscles.js'
import { isWarmupRow } from '../../frontend/src/lib/workout-model.js'
import { todayISO } from '../../frontend/src/lib/format.js'
import { getState, getStateVersion, mutateState } from './state.js'

const version = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).describe('Exact state_version from get_profile_state. Read again after any conflict.')
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(value + 'T12:00:00Z')
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}, 'Use a valid calendar date')
const id = () => `mcp-${crypto.randomUUID()}`
const success = (result, message) => ({ ok: true, ...result, message })

export const getProfileState = {
  name: 'get_profile_state', write: false,
  description: 'Get the current optimistic-lock state_version and profile summary. Call immediately before every write tool and pass its state_version unchanged.',
  schema: {},
  handler: () => {
    const state = getState()
    return { state_version: getStateVersion(), unit: state?.unit || 'kg', goal_weight: state?.targetW ?? null, routines: state?.routines?.length || 0, workouts: state?.workouts?.length || 0, weigh_ins: state?.bodyweight?.length || 0 }
  }
}

export const searchExercises = {
  name: 'search_exercises', write: false,
  description: 'Search the openGym exercise catalogue before creating routines or logging workouts. Returns stable exercise IDs required by write tools.',
  schema: { query: z.string().min(2), limit: z.number().int().min(1).max(50).optional() },
  handler: ({ query, limit = 20 }) => {
    const q = query.trim().toLowerCase()
    const custom = Object.fromEntries((getState()?.customEx || []).map(ex => [ex.id, ex]))
    return { exercises: Object.values({ ...EXIDX, ...custom }).filter(ex => `${ex.n || ''} ${ex.bp || ''}`.toLowerCase().includes(q)).slice(0, limit).map(ex => ({ id: ex.id, name: ex.n, body_part: ex.bp || null })) }
  }
}

export const setBodyweight = {
  name: 'set_bodyweight', write: true,
  description: 'Create or replace one body-weight entry. This changes the openGym profile.',
  schema: { expected_version: version, date: isoDate, weight: z.number().positive().max(1000) },
  handler: ({ expected_version, date, weight }) => {
    const result = mutateState(expected_version, state => {
      const rounded = Math.round(weight * 10) / 10
      const entry = state.bodyweight.find(item => item.d === date)
      if (entry) Object.assign(entry, { w: rounded, t: Date.now() })
      else state.bodyweight.push({ d: date, w: rounded, t: Date.now() })
      state.bodyweight.sort((a, b) => a.d.localeCompare(b.d))
    })
    return success(result, `Body weight saved for ${date}`)
  }
}

export const setGoalWeight = {
  name: 'set_goal_weight', write: true,
  description: 'Set or clear the target body weight. This changes the openGym profile.',
  schema: { expected_version: version, weight: z.number().positive().max(1000).nullable() },
  handler: ({ expected_version, weight }) => success(mutateState(expected_version, state => { state.targetW = weight == null ? null : Math.round(weight * 10) / 10 }), 'Goal weight updated')
}

export const getProfileSettings = {
  name: 'get_profile_settings', write: false,
  description: 'Read all synced profile preferences that are editable in the openGym Settings screen. Device permissions, passkeys and live timers are intentionally excluded.',
  schema: {},
  handler: () => {
    const state = getState() || {}
    return { state_version: getStateVersion(), settings: {
      unit: state.unit || 'kg', rest_seconds: state.restSec ?? 90, sounds: state.sound !== false,
      keep_screen_awake: state.keepAwake !== false, language: state.lang || 'en', theme: state.theme || 'dark',
      accent: state.accent || 'lime', body_diagram: state.body || 'male', exercise_media_size: state.gifSize || 'full',
      effort_scale: state.effort ?? null, reminder: state.reminder || { on: false, time: '08:00', tz: null }
    } }
  }
}

const settingsPatch = z.object({
  unit: z.enum(['kg', 'lb']).optional(), rest_seconds: z.number().int().min(1).max(3600).optional(),
  sounds: z.boolean().optional(), keep_screen_awake: z.boolean().optional(), language: z.string().min(2).max(12).optional(),
  theme: z.enum(['dark', 'light', 'system']).optional(), accent: z.enum(['lime', 'sky', 'orange', 'violet', 'pink', 'red', 'teal', 'gold']).optional(),
  body_diagram: z.enum(['male', 'female']).optional(), exercise_media_size: z.enum(['full', 'mini']).optional(),
  effort_scale: z.enum(['none', 'rir', 'rpe']).nullable().optional(),
  reminder: z.object({ on: z.boolean(), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), tz: z.string().min(1).max(100).nullable() }).optional()
}).refine(value => Object.keys(value).length > 0, 'at least one setting is required')

export const updateProfileSettings = {
  name: 'update_profile_settings', write: true,
  description: 'Update one or more synced preferences from the openGym Settings screen. Only supplied fields change.',
  schema: { expected_version: version, settings: settingsPatch },
  handler: ({ expected_version, settings }) => success(mutateState(expected_version, state => {
    const map = { unit: 'unit', rest_seconds: 'restSec', sounds: 'sound', keep_screen_awake: 'keepAwake', language: 'lang', theme: 'theme', accent: 'accent', body_diagram: 'body', exercise_media_size: 'gifSize', effort_scale: 'effort', reminder: 'reminder' }
    for (const [external, internal] of Object.entries(map)) if (Object.hasOwn(settings, external)) state[internal] = settings[external]
  }), 'Profile settings updated')
}

export const deleteBodyweight = {
  name: 'delete_bodyweight', write: true, destructive: true,
  description: 'Permanently delete one weigh-in by date. Requires confirm=true.',
  schema: { expected_version: version, date: isoDate, confirm: z.literal(true) },
  handler: ({ expected_version, date }) => success(mutateState(expected_version, state => {
    const before = state.bodyweight.length
    state.bodyweight = state.bodyweight.filter(entry => entry.d !== date)
    if (state.bodyweight.length === before) throw Object.assign(new Error(`no body-weight entry on ${date}`), { code: 'ENOENT' })
  }), 'Body-weight entry deleted')
}

const exerciseConfig = z.object({
  exercise_id: z.string().min(1), sets: z.number().int().min(1).max(20), reps: z.number().int().min(1).max(100).optional(),
  weight: z.number().min(0).max(10000).optional(), seconds: z.number().int().min(1).max(86400).optional(),
  minutes: z.number().min(0).max(1440).optional(), speed: z.number().min(0).max(1000).optional(), superset_group: z.string().max(40).nullable().optional(),
  mode: z.enum(['reps', 'time']).optional(), bodyweight: z.boolean().optional(), per_side: z.boolean().optional(),
  increment: z.number().positive().max(1000).optional(), progression: z.enum(['off', 'linear', 'greyskull', 'double', 'time']).optional(),
  reps_min: z.number().int().min(1).max(1000).optional(), reps_max: z.number().int().min(1).max(1000).optional()
})

function validateExercises(state, exercises) {
  const custom = new Set((state.customEx || []).map(ex => ex.id))
  for (const exercise of exercises) if (['__proto__', 'prototype', 'constructor'].includes(exercise.exercise_id) || (!Object.hasOwn(EXIDX, exercise.exercise_id) && !custom.has(exercise.exercise_id))) throw Object.assign(new Error(`unknown exercise_id ${exercise.exercise_id}; use search_exercises first`), { code: 'EINVAL' })
}

function routineExercises(exercises) {
  return exercises.map(ex => ({ id: ex.exercise_id, sets: ex.sets, ...(ex.reps == null ? {} : { reps: ex.reps }), ...(ex.weight == null ? {} : { weight: ex.weight }), ...(ex.seconds == null ? {} : { sec: ex.seconds }), ...(ex.minutes == null ? {} : { min: ex.minutes }), ...(ex.speed == null ? {} : { speed: ex.speed }), ...(ex.superset_group ? { sg: ex.superset_group } : {}), ...(ex.mode ? { mode: ex.mode } : {}), ...(ex.bodyweight == null ? {} : { bodyweight: ex.bodyweight }), ...(ex.per_side ? { side: true } : {}), ...(ex.increment == null ? {} : { inc: ex.increment }), ...(ex.progression ? { prog: ex.progression } : {}), ...(ex.reps_min == null ? {} : { repsMin: ex.reps_min }), ...(ex.reps_max == null ? {} : { repsMax: ex.reps_max }) }))
}

export const upsertRoutine = {
  name: 'upsert_routine', write: true,
  description: 'Create a routine or replace an existing routine definition. Use search_exercises first. Replacing requires the routine_id returned by list_routines.',
  schema: { expected_version: version, routine_id: z.string().min(1).optional(), name: z.string().min(1).max(100), icon: z.string().max(40).optional(), progression: z.enum(['off', 'linear', 'greyskull', 'double']).optional(), exercises: z.array(exerciseConfig).max(100) },
  handler: ({ expected_version, routine_id, name, icon, progression, exercises }) => {
    let savedId = routine_id || id()
    const result = mutateState(expected_version, state => {
      validateExercises(state, exercises)
      const next = { id: savedId, name: name.trim(), emoji: icon || 'dumbbell', prog: progression || 'linear', ex: routineExercises(exercises) }
      const index = state.routines.findIndex(routine => routine.id === savedId)
      if (routine_id && index < 0) throw Object.assign(new Error(`no routine with id ${routine_id}`), { code: 'ENOENT' })
      if (index < 0) state.routines.push(next); else state.routines[index] = { ...state.routines[index], ...next }
    })
    return success({ ...result, routine_id: savedId }, 'Routine saved')
  }
}

export const setWeekPlan = {
  name: 'set_week_plan', write: true,
  description: 'Assign a routine or rest day to one weekday (Sunday=0 through Saturday=6). Use null to clear the assignment.',
  schema: { expected_version: version, weekday: z.number().int().min(0).max(6), routine_id: z.string().min(1).nullable() },
  handler: ({ expected_version, weekday, routine_id }) => success(mutateState(expected_version, state => {
    if (routine_id && routine_id !== 'rest' && !state.routines.some(r => r.id === routine_id)) throw Object.assign(new Error(`no routine with id ${routine_id}`), { code: 'ENOENT' })
    if (routine_id == null || routine_id === 'rest') delete state.week[weekday]; else state.week[weekday] = routine_id
  }), 'Weekly plan updated')
}

export const setDayOverride = {
  name: 'set_day_override', write: true,
  description: 'Override one calendar date with a routine, an explicit rest day, or null to return to the weekly plan.',
  schema: { expected_version: version, date: isoDate, routine_id: z.string().min(1).nullable(), rest: z.boolean().optional() },
  handler: ({ expected_version, date, routine_id, rest = false }) => success(mutateState(expected_version, state => {
    if (rest && routine_id) throw Object.assign(new Error('choose either a routine_id or rest=true'), { code: 'EINVAL' })
    if (routine_id && !state.routines.some(routine => routine.id === routine_id)) throw Object.assign(new Error(`no routine with id ${routine_id}`), { code: 'ENOENT' })
    if (rest) state.dayPlan[date] = 'rest'
    else if (routine_id) state.dayPlan[date] = routine_id
    else delete state.dayPlan[date]
  }), 'Day override updated')
}

export const upsertCustomExercise = {
  name: 'upsert_custom_exercise', write: true,
  description: 'Create or edit a custom exercise, with the same name, body-part and description fields as the app.',
  schema: { expected_version: version, exercise_id: z.string().min(1).optional(), name: z.string().min(1).max(200), body_part: z.enum(BODYPARTS), description: z.string().max(1000).optional() },
  handler: ({ expected_version, exercise_id, name, body_part, description = '' }) => {
    const savedId = exercise_id || `c${crypto.randomUUID()}`
    const result = mutateState(expected_version, state => {
      const duplicate = [...Object.values(EXIDX), ...(state.customEx || [])].find(exercise => exercise.n.toLowerCase() === name.trim().toLowerCase() && exercise.id !== savedId)
      if (duplicate) throw Object.assign(new Error(`exercise named ${name.trim()} already exists`), { code: 'CONFLICT' })
      const next = { id: savedId, n: name.trim(), bp: body_part, desc: description.trim(), tg: '', eq: 'custom', custom: true }
      const index = state.customEx.findIndex(exercise => exercise.id === savedId)
      if (exercise_id && index < 0) throw Object.assign(new Error(`no custom exercise with id ${exercise_id}`), { code: 'ENOENT' })
      if (index < 0) state.customEx.push(next); else state.customEx[index] = next
    })
    return success({ ...result, exercise_id: savedId }, 'Custom exercise saved')
  }
}

export const deleteCustomExercise = {
  name: 'delete_custom_exercise', write: true, destructive: true,
  description: 'Delete a custom exercise and remove it from routines. Logged workouts keep a name and muscle snapshot. Requires confirm=true.',
  schema: { expected_version: version, exercise_id: z.string().min(1), confirm: z.literal(true) },
  handler: ({ expected_version, exercise_id }) => success(mutateState(expected_version, state => {
    const exercise = state.customEx.find(item => item.id === exercise_id)
    if (!exercise) throw Object.assign(new Error(`no custom exercise with id ${exercise_id}`), { code: 'ENOENT' })
    const snapshot = exerciseMuscleSnapshot(exercise)
    for (const workout of state.workouts) for (const entry of workout.entries || []) if (entry.id === exercise_id) {
      entry.n = exercise.n
      if (!entry.muscleSnapshot || !Object.keys(entry.muscleSnapshot).length) entry.muscleSnapshot = snapshot
    }
    state.customEx = state.customEx.filter(item => item.id !== exercise_id)
    for (const routine of state.routines) { routine.ex = routine.ex.filter(item => item.id !== exercise_id); cleanupSg(routine.ex) }
    delete state.exWeights[exercise_id]
  }), 'Custom exercise deleted')
}

const loggedSet = z.object({
  weight: z.number().min(0).max(10000).optional(), reps: z.number().int().min(0).max(1000).optional(),
  seconds: z.number().int().min(0).max(86400).optional(), minutes: z.number().min(0).max(1440).optional(), speed: z.number().min(0).max(1000).optional(),
  phase: z.enum(['warmup', 'work']).optional(), effort_scale: z.enum(['rir', 'rpe']).optional(), effort: z.number().min(0).max(10).optional()
})
const loggedEntry = z.object({ exercise_id: z.string().min(1), target: exerciseConfig.omit({ exercise_id: true }).optional(), sets: z.array(loggedSet).min(1).max(100) })

function workoutEntries(entries) {
  return entries.map(entry => ({
    id: entry.exercise_id,
    ...(entry.target ? { target: routineExercises([{ exercise_id: entry.exercise_id, ...entry.target }])[0] } : {}),
    sets: entry.sets.map(set => ({
      done: true, w: set.weight || 0, r: set.reps || 0, sec: set.seconds || 0, min: set.minutes || 0, speed: set.speed || 0,
      ...(set.phase ? { phase: set.phase } : {}), ...(set.effort_scale ? { effortKind: set.effort_scale } : {}), ...(set.effort == null ? {} : { effort: set.effort })
    }))
  }))
}

function refreshExerciseWeights(state, date, entries) {
  if (date < todayISO()) return // Historical/backfilled sessions do not advance confirmed loads.
  for (const entry of entries) {
    const max = Math.max(0, ...entry.sets.filter(set => !isWarmupRow(set)).map(set => set.w || 0))
    if (max > (state.exWeights[entry.id]?.w || 0)) state.exWeights[entry.id] = { w: max, d: date }
  }
}

export const logWorkout = {
  name: 'log_workout', write: true,
  description: 'Append a completed workout to history. Every supplied set is marked done. Use search_exercises first; use delete_workout to correct a bad entry.',
  schema: { expected_version: version, date: isoDate, routine_id: z.string().min(1).nullable().optional(), name: z.string().min(1).max(100).optional(), duration_minutes: z.number().positive().max(1440), bodyweight: z.number().positive().max(1000).nullable().optional(), entries: z.array(loggedEntry).min(1).max(100) },
  handler: ({ expected_version, date, routine_id, name, duration_minutes, bodyweight, entries }) => {
    const workoutId = id()
    const result = mutateState(expected_version, state => {
      validateExercises(state, entries)
      const routine = routine_id ? state.routines.find(item => item.id === routine_id) : null
      if (routine_id && !routine) throw Object.assign(new Error(`no routine with id ${routine_id}`), { code: 'ENOENT' })
      const end = Date.parse(`${date}T12:00:00Z`)
      const completedEntries = workoutEntries(entries)
      state.workouts.push({ id: workoutId, d: date, start: end - duration_minutes * 60000, end, routineId: routine_id || null, name: name || routine?.name || 'MCP workout', bw: bodyweight || null, entries: completedEntries, prs: [], ...(routine?.excludeFromProgression ? { excludeFromProgression: true } : {}) })
      refreshExerciseWeights(state, date, completedEntries)
    })
    return success({ ...result, workout_id: workoutId }, 'Workout logged')
  }
}

export const updateWorkout = {
  name: 'update_workout', write: true,
  description: 'Replace the editable details and completed sets of an existing workout. This is the correction counterpart to log_workout and preserves its stable workout_id.',
  schema: { expected_version: version, workout_id: z.string().min(1), date: isoDate, routine_id: z.string().min(1).nullable().optional(), name: z.string().min(1).max(100), duration_minutes: z.number().positive().max(1440), bodyweight: z.number().positive().max(1000).nullable().optional(), entries: z.array(loggedEntry).min(1).max(100) },
  handler: ({ expected_version, workout_id, date, routine_id, name, duration_minutes, bodyweight, entries }) => success(mutateState(expected_version, state => {
    validateExercises(state, entries)
    if (routine_id && !state.routines.some(routine => routine.id === routine_id)) throw Object.assign(new Error(`no routine with id ${routine_id}`), { code: 'ENOENT' })
    const index = state.workouts.findIndex(workout => workout.id === workout_id)
    if (index < 0) throw Object.assign(new Error(`no workout with id ${workout_id}`), { code: 'ENOENT' })
    const previous = state.workouts[index]
    const end = Date.parse(`${date}T12:00:00Z`)
    const completedEntries = workoutEntries(entries)
    state.workouts[index] = { ...previous, d: date, start: end - duration_minutes * 60000, end, routineId: routine_id || null, name: name.trim(), bw: bodyweight || null, entries: completedEntries }
  }), 'Workout updated')
}

export const deleteWorkout = {
  name: 'delete_workout', write: true, destructive: true,
  description: 'Permanently delete one logged workout. Requires confirm=true and the exact workout_id from list_workouts.',
  schema: { expected_version: version, workout_id: z.string().min(1), confirm: z.literal(true) },
  handler: ({ expected_version, workout_id }) => success(mutateState(expected_version, state => {
    const before = state.workouts.length
    state.workouts = state.workouts.filter(workout => workout.id !== workout_id)
    if (state.workouts.length === before) throw Object.assign(new Error(`no workout with id ${workout_id}`), { code: 'ENOENT' })
  }), 'Workout deleted')
}

export const deleteRoutine = {
  name: 'delete_routine', write: true, destructive: true,
  description: 'Permanently delete one routine and clear its weekly assignments. Logged workout history is retained. Requires confirm=true.',
  schema: { expected_version: version, routine_id: z.string().min(1), confirm: z.literal(true) },
  handler: ({ expected_version, routine_id }) => success(mutateState(expected_version, state => {
    const before = state.routines.length
    state.routines = state.routines.filter(routine => routine.id !== routine_id)
    if (state.routines.length === before) throw Object.assign(new Error(`no routine with id ${routine_id}`), { code: 'ENOENT' })
    for (const day of Object.keys(state.week)) if (state.week[day] === routine_id) delete state.week[day]
    for (const date of Object.keys(state.dayPlan)) if (state.dayPlan[date] === routine_id) delete state.dayPlan[date]
  }), 'Routine deleted')
}

export const WRITE_TOOLS = [
  getProfileState, getProfileSettings, searchExercises,
  setBodyweight, deleteBodyweight, setGoalWeight, updateProfileSettings,
  upsertRoutine, deleteRoutine, setWeekPlan, setDayOverride,
  upsertCustomExercise, deleteCustomExercise,
  logWorkout, updateWorkout, deleteWorkout
]
