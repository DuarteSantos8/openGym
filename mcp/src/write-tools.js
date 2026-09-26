/* Plan writes go through openGym's authenticated, revision-checked API. This is the same
   path the phone uses, so a concurrent sync cannot silently overwrite a whole state file. */
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { getState, getUser } from './state.js'
import { allExercises, searchScore } from '../../frontend/src/lib/exercises.js'
import { cleanupSg } from '../../frontend/src/lib/history.js'

const apiBase = () => (process.env.OPENGYM_API_URL || 'http://127.0.0.1:8080').replace(/\/+$/, '')
const fail = (message, code = 'EINVAL') => { const error = new Error(message); error.code = code; throw error }

async function api(path, { method = 'GET', body } = {}) {
  const token = process.env.OPENGYM_API_TOKEN?.trim()
  if (!token) fail('Plan saving needs OPENGYM_API_TOKEN. Pair this MCP as a device from openGym Settings, then set the token in mcp/.private/tunnel.env.', 'EAUTH')
  const url = new URL(path, apiBase() + '/')
  if (url.origin !== new URL(apiBase()).origin) fail('invalid API path')
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000)
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const error = new Error(data.error || `openGym API returned HTTP ${res.status}`)
    error.code = res.status === 401 ? 'EAUTH' : res.status === 409 ? 'ECONFLICT' : 'EAPI'
    error.status = res.status
    throw error
  }
  return data
}

async function updateState(change) {
  const me = await api('/api/me')
  if (me.user?.id !== getUser().id) fail('The paired API token belongs to a different OpenGym profile.', 'EAUTH')
  for (let attempt = 0; attempt < 3; attempt++) {
    const { state, rev } = await api('/api/data')
    if (!state) fail('This profile has no synced state yet. Sign in on a device first.', 'ENOENT')
    const next = structuredClone(state)
    const result = change(next)
    next._ts = Math.max(Date.now(), Number(state._ts || 0) + 1)
    try {
      const saved = await api('/api/data', { method: 'PUT', body: { state: next, baseRev: rev } })
      return { ...result, rev: saved.rev }
    } catch (error) {
      if (error.status !== 409 || attempt === 2) throw error
    }
  }
}

export const searchExercises = {
  name: 'search_exercises',
  description: 'Find real exercise IDs in the user\'s OpenGym catalogue before creating a training plan. Includes the user\'s custom exercises. Use the returned IDs in create_training_plan.',
  schema: {
    query: z.string().min(2).max(80),
    limit: z.number().int().min(1).max(30).optional()
  },
  handler: ({ query, limit = 15 }) => {
    const state = getState()
    if (!state) fail('no synced state yet', 'ENOENT')
    const matches = allExercises(state).map(ex => ({ ex, score: searchScore(ex, query) }))
      .filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, limit)
    return { exercises: matches.map(({ ex }) => ({ id: ex.id, name: ex.n, body_part: ex.bp || null, equipment: ex.eq || null })) }
  }
}

const exerciseSummary = ex => ({ id: ex.id, name: ex.n, body_part: ex.bp || null, equipment: ex.eq || null })

export const listExercises = {
  name: 'list_exercises',
  description: 'Browse all available OpenGym exercises, including custom exercises. Results are paginated; follow next_offset until it is null to get the full catalogue. Use search_exercises to find exercises by name.',
  schema: {
    offset: z.number().int().min(0).optional(),
    limit: z.number().int().min(1).max(200).optional()
  },
  handler: ({ offset = 0, limit = 100 }) => {
    const exercises = allExercises(getState() || {})
    const end = Math.min(offset + limit, exercises.length)
    return {
      exercises: exercises.slice(offset, end).map(exerciseSummary),
      total: exercises.length, offset,
      next_offset: end < exercises.length ? end : null
    }
  }
}

const exerciseInput = z.object({
  id: z.string().min(1),
  mode: z.enum(['reps', 'time', 'cardio']).optional(),
  sets: z.number().int().min(1).max(10),
  reps: z.number().int().min(1).max(100).optional(),
  sec: z.number().int().min(5).max(3600).optional(),
  min: z.number().int().min(1).max(180).optional(),
  speed: z.number().finite().min(0).max(60).optional(),
  weight: z.number().finite().min(0).max(1000).optional(),
  rest_sec: z.number().int().min(0).max(600).optional()
})
const routineInput = z.object({
  name: z.string().trim().min(1).max(80),
  emoji: z.string().max(32).optional(),
  policy: z.enum(['off', 'linear', 'greyskull', 'double', 'time']).optional(),
  exercises: z.array(exerciseInput).min(1).max(20)
})

function buildExercise(input, catalogue) {
  const ex = catalogue.get(input.id)
  if (!ex) fail(`Unknown exercise ID ${JSON.stringify(input.id)}. Use search_exercises first.`)
  const mode = input.mode || (ex.bp === 'cardio' ? 'cardio' : 'reps')
  if (mode === 'reps' && input.reps == null) fail(`reps required for exercise ${input.id}`)
  if (mode === 'time' && input.sec == null) fail(`sec required for exercise ${input.id}`)
  if (mode === 'cardio' && input.min == null) fail(`min required for exercise ${input.id}`)
  const cfg = { id: input.id, mode, sets: input.sets }
  if (mode === 'reps') cfg.reps = input.reps
  if (mode === 'time') cfg.sec = input.sec
  if (mode === 'cardio') { cfg.min = input.min; if (input.speed != null) cfg.speed = input.speed }
  if (mode !== 'cardio' && input.weight != null) cfg.weight = input.weight
  if (input.rest_sec > 0) cfg.restSec = input.rest_sec
  return cfg
}

export const createTrainingPlan = {
  name: 'create_training_plan',
  description: 'Save new workout routines and optional weekday assignments into the user\'s OpenGym profile. Adds routines; it does not delete or replace existing routines. Only specified weekdays change. Show the proposed plan to the user before calling this write tool. routine_indexes are zero-based positions in the routines argument.',
  schema: {
    routines: z.array(routineInput).min(1).max(7),
    weekdays: z.array(z.object({
      weekday: z.number().int().min(0).max(6).describe('Sunday=0, Monday=1, ... Saturday=6'),
      routine_indexes: z.array(z.number().int().min(0).max(6)).max(3)
    })).max(7).optional()
  },
  handler: async ({ routines, weekdays = [] }) => updateState(state => {
    if (!Array.isArray(state.routines)) fail('profile routines are malformed')
    const catalogue = new Map(allExercises(state).map(ex => [ex.id, ex]))
    const days = new Set()
    for (const day of weekdays) {
      if (days.has(day.weekday)) fail(`weekday ${day.weekday} appears more than once`)
      days.add(day.weekday)
      if (day.routine_indexes.some(index => index >= routines.length)) fail(`weekday ${day.weekday} references a missing routine index`)
      if (new Set(day.routine_indexes).size !== day.routine_indexes.length) fail(`weekday ${day.weekday} repeats a routine index`)
    }
    const created = routines.map(input => ({
      id: randomUUID(), name: input.name, ...(input.emoji ? { emoji: input.emoji } : {}),
      ...(input.policy ? { prog: input.policy } : {}),
      ex: input.exercises.map(ex => buildExercise(ex, catalogue))
    }))
    state.routines.push(...created)
    state.week = { ...(state.week || {}) }
    for (const day of weekdays) {
      const ids = day.routine_indexes.map(index => created[index].id)
      state.week[day.weekday] = ids
    }
    return {
      created_routines: created.map(r => ({ id: r.id, name: r.name, exercise_count: r.ex.length })),
      changed_weekdays: weekdays.map(day => ({ weekday: day.weekday, routine_ids: state.week[day.weekday] }))
    }
  })
}

export const editRoutine = {
  name: 'edit_routine',
  description: 'Edit an existing routine by ID from list_routines. Omitted fields remain unchanged. exercises, when supplied, is the complete ordered exercise list (omitted exercises are removed); configuration on retained exercise IDs is preserved except for supplied targets. Show the proposed changes to the user before calling. Use preview_session afterwards to check targets affected by progression.',
  annotations: { readOnlyHint: false, destructiveHint: true },
  schema: {
    routine_id: z.string().min(1),
    name: routineInput.shape.name.optional(),
    emoji: routineInput.shape.emoji.optional(),
    policy: routineInput.shape.policy,
    exercises: routineInput.shape.exercises.optional()
  },
  handler: async ({ routine_id, name, emoji, policy, exercises }) => {
    if ([name, emoji, policy, exercises].every(value => value === undefined)) fail('Specify at least one routine field to edit')
    return updateState(state => {
      const routine = state.routines?.find(r => r.id === routine_id)
      if (!routine) fail(`No routine with id ${JSON.stringify(routine_id)}`, 'ENOENT')
      if (name !== undefined) routine.name = name
      if (emoji !== undefined) routine.emoji = emoji
      if (policy !== undefined) routine.prog = policy
      if (exercises !== undefined) {
        const catalogue = new Map(allExercises(state).map(ex => [ex.id, ex]))
        const seen = new Set()
        routine.ex = exercises.map(input => {
          if (seen.has(input.id)) fail(`Exercise ${input.id} appears more than once`)
          seen.add(input.id)
          const previous = routine.ex?.find(ex => ex.id === input.id)
          const cfg = { ...previous, ...buildExercise({ ...input, mode: input.mode || previous?.mode }, catalogue) }
          if (cfg.mode !== 'reps') { delete cfg.reps; delete cfg.repsMin; delete cfg.repsMax }
          if (cfg.mode !== 'time') delete cfg.sec
          if (cfg.mode !== 'cardio') { delete cfg.min; delete cfg.speed }
          else delete cfg.weight
          if (input.rest_sec !== undefined) {
            if (input.rest_sec > 0) cfg.restSec = input.rest_sec
            else delete cfg.restSec
          }
          return cfg
        })
        // A removed superset partner must not leave a dangling link.
        cleanupSg(routine.ex)
      }
      return { updated_routine: { id: routine.id, name: routine.name, exercise_count: routine.ex?.length || 0 } }
    })
  }
}

export const deleteRoutine = {
  name: 'delete_routine',
  description: 'Delete a saved routine by ID from list_routines and clear its weekday and date-specific schedule assignments. Preserves logged workouts and exercise history. Show which routine will be deleted to the user before calling.',
  annotations: { readOnlyHint: false, destructiveHint: true },
  schema: { routine_id: z.string().min(1) },
  handler: async ({ routine_id }) => updateState(state => {
    const routine = state.routines?.find(r => r.id === routine_id)
    if (!routine) fail(`No routine with id ${JSON.stringify(routine_id)}`, 'ENOENT')
    state.routines = state.routines.filter(r => r.id !== routine_id)
    const changedWeekdays = [], changedDates = []
    for (const key of Object.keys(state.week || {})) {
      const ids = [].concat(state.week[key])
      if (!ids.includes(routine_id)) continue
      const remaining = ids.filter(id => id !== routine_id)
      if (remaining.length) state.week[key] = remaining
      else delete state.week[key]
      changedWeekdays.push(Number(key))
    }
    for (const key of Object.keys(state.dayPlan || {})) {
      if (state.dayPlan[key] !== routine_id) continue
      delete state.dayPlan[key]
      changedDates.push(key)
    }
    return { deleted_routine: { id: routine.id, name: routine.name }, changed_weekdays: changedWeekdays, changed_dates: changedDates }
  })
}

export const WRITE_TOOLS = [searchExercises, listExercises, createTrainingPlan, editRoutine, deleteRoutine]
