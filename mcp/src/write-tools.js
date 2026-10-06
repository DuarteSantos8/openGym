/* Plan writes go through openGym's authenticated, revision-checked API. This is the same
   path the phone uses, so a concurrent sync cannot silently overwrite a whole state file. */
import { z } from 'zod'
import { getState, getUser } from './state.js'
import { allExercises, searchScore } from '../../frontend/src/lib/exercises.js'

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
    if (res.status === 409) {
      error.message = 'Profile changed; read get_profile_state and confirm the operation again before writing.'
      error.rev = data.rev
      error.state = data.state
    }
    throw error
  }
  return data
}

async function pairedProfile() {
  const me = await api('/api/me')
  if (me.user?.id !== getUser().id) fail('The paired API token belongs to a different OpenGym profile.', 'EAUTH')
}

async function updateState(operation, { expected_version, ...input }) {
  if (!Number.isSafeInteger(expected_version) || expected_version < 0) fail('expected_version required; read get_profile_state before confirming a write')
  await pairedProfile()
  // Never retry a confirmation against different data. The server compares exactly
  // the revision the client read and applies the operation to that current state.
  return api('/api/routines/mutate', { method: 'POST', body: { operation, baseRev: expected_version, input } })
}

export const getProfileState = {
  name: 'get_profile_state',
  description: 'Read the synced profile and its state_version before proposing a change. Pass that exact state_version as expected_version to routine write tools. After a conflict, read again and ask the user to confirm the new proposal.',
  schema: {},
  handler: async () => {
    if (process.env.OPENGYM_API_TOKEN?.trim()) {
      await pairedProfile()
      const { state, rev } = await api('/api/data')
      return { state, state_version: rev }
    }
    const state = getState()
    return { state, state_version: state?._rev || 0 }
  }
}
const version = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).describe('Exact state_version from get_profile_state when this operation was confirmed')

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


export const createTrainingPlan = {
  name: 'create_training_plan',
  description: 'Save new workout routines and optional weekday assignments into the user\'s OpenGym profile. Adds routines; it does not delete or replace existing routines. Only specified weekdays change. Read get_profile_state and show the proposed plan before calling with its exact expected_version; conflicts require fresh confirmation. routine_indexes are zero-based positions in the routines argument.',
  schema: {
    expected_version: version,
    routines: z.array(routineInput).min(1).max(7),
    weekdays: z.array(z.object({
      weekday: z.number().int().min(0).max(6).describe('Sunday=0, Monday=1, ... Saturday=6'),
      routine_indexes: z.array(z.number().int().min(0).max(6)).max(3)
    })).max(7).optional()
  },
  handler: async args => updateState('create', args)
}

export const editRoutine = {
  name: 'edit_routine',
  description: 'Edit an existing routine by ID from list_routines. Omitted fields remain unchanged. exercises, when supplied, is the complete ordered exercise list (omitted exercises are removed); configuration on retained exercise IDs is preserved except for supplied targets. Read get_profile_state and show the proposed changes before calling with its exact expected_version; conflicts require fresh confirmation. Use preview_session afterwards to check targets affected by progression.',
  annotations: { readOnlyHint: false, destructiveHint: true },
  schema: {
    expected_version: version,
    routine_id: z.string().min(1),
    name: routineInput.shape.name.optional(),
    emoji: routineInput.shape.emoji.optional(),
    policy: routineInput.shape.policy,
    exercises: routineInput.shape.exercises.optional()
  },
  handler: async args => updateState('edit', args)
}

export const deleteRoutine = {
  name: 'delete_routine',
  description: 'Delete a saved routine by ID from list_routines and clear its weekday and date-specific schedule assignments. Preserves logged workouts and exercise history. Read get_profile_state, show which routine will be deleted, and call with its exact expected_version and confirm=true; conflicts require fresh confirmation.',
  annotations: { readOnlyHint: false, destructiveHint: true },
  schema: { expected_version: version, routine_id: z.string().min(1), confirm: z.literal(true) },
  handler: async args => updateState('delete', args)
}

export const WRITE_TOOLS = [getProfileState, searchExercises, listExercises, createTrainingPlan, editRoutine, deleteRoutine]
