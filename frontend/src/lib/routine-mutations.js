// Transport-independent routine operations. The API runs these against the revision
// the caller confirmed; stdio and remote MCP clients share this validation and behavior.
import { allExercises } from './exercises.js'
import { cleanupSg } from './history.js'
import { deleteRoutine } from './routines.js'

const fail = (message, code = 'EINVAL') => { throw Object.assign(new Error(message), { code }) }
const object = value => value && typeof value === 'object' && !Array.isArray(value)
const policies = ['off', 'linear', 'greyskull', 'double', 'time']
function text(value, name, max, optional = false) {
  if (optional && value === undefined) return
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(`invalid ${name}`)
}
function number(value, name, min, max, integer = false, optional = false) {
  if (optional && value === undefined) return
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) fail(`invalid ${name}`)
}
function validateRoutine(input, editing = false) {
  if (!object(input)) fail('routine input must be an object')
  text(input.name, 'name', 80, editing)
  if (input.emoji !== undefined && (typeof input.emoji !== 'string' || input.emoji.length > 32)) fail('invalid emoji')
  if (input.policy !== undefined && !policies.includes(input.policy)) fail('invalid policy')
  if (editing && input.exercises === undefined) return
  if (!Array.isArray(input.exercises) || !input.exercises.length || input.exercises.length > 20) fail('invalid exercises')
  for (const ex of input.exercises) {
    if (!object(ex)) fail('exercise input must be an object')
    text(ex.id, 'exercise id', 200)
    if (ex.mode !== undefined && !['reps', 'time', 'cardio'].includes(ex.mode)) fail('invalid mode')
    number(ex.sets, 'sets', 1, 10, true)
    for (const [key, min, max, integer] of [['reps', 1, 100, true], ['sec', 5, 3600, true], ['min', 1, 180, true], ['speed', 0, 60, false], ['weight', 0, 1000, false], ['rest_sec', 0, 600, true]]) {
      number(ex[key], key, min, max, integer, true)
    }
  }
}

function slot(input, catalogue, previous = {}) {
  const exercise = catalogue.get(input.id)
  if (!exercise) fail(`Unknown exercise ID ${JSON.stringify(input.id)}. Use search_exercises first.`)
  const mode = input.mode || previous.mode || (exercise.bp === 'cardio' ? 'cardio' : 'reps')
  const target = mode === 'reps' ? 'reps' : mode === 'time' ? 'sec' : 'min'
  const value = input[target] === undefined ? previous[target] : input[target]
  if (value === undefined) fail(`${target} required for exercise ${input.id}`)
  const cfg = { ...previous, id: input.id, mode, sets: input.sets, [target]: value }
  if (input.weight !== undefined) cfg.weight = input.weight
  if (input.speed !== undefined) cfg.speed = input.speed
  if (mode !== 'reps') { delete cfg.reps; delete cfg.repsMin; delete cfg.repsMax }
  if (mode !== 'time') delete cfg.sec
  if (mode !== 'cardio') { delete cfg.min; delete cfg.speed }
  else delete cfg.weight
  if (input.rest_sec !== undefined) {
    if (input.rest_sec > 0) cfg.restSec = input.rest_sec
    else delete cfg.restSec
  }
  return cfg
}

export function mutateRoutines(state, operation, input, makeId) {
  if (!Array.isArray(state.routines)) fail('profile routines are malformed')
  if (!object(input)) fail('input must be an object')
  if (operation === 'create') {
    if (!Array.isArray(input.routines) || !input.routines.length || input.routines.length > 7) fail('invalid routines')
    input.routines.forEach(routine => validateRoutine(routine))
    const weekdays = input.weekdays ?? []
    if (!Array.isArray(weekdays) || weekdays.length > 7) fail('invalid weekdays')
    const seen = new Set()
    for (const day of weekdays) {
      if (!object(day)) fail('invalid weekday')
      number(day.weekday, 'weekday', 0, 6, true)
      if (seen.has(day.weekday)) fail(`weekday ${day.weekday} appears more than once`)
      seen.add(day.weekday)
      if (!Array.isArray(day.routine_indexes) || day.routine_indexes.length > 3) fail('invalid routine_indexes')
      day.routine_indexes.forEach(index => number(index, 'routine index', 0, input.routines.length - 1, true))
      if (new Set(day.routine_indexes).size !== day.routine_indexes.length) fail(`weekday ${day.weekday} repeats a routine index`)
    }
    const catalogue = new Map(allExercises(state).map(ex => [ex.id, ex]))
    const created = input.routines.map(r => ({
      id: makeId(), name: r.name.trim(), ...(r.emoji ? { emoji: r.emoji } : {}),
      ...(r.policy ? { prog: r.policy } : {}), ex: r.exercises.map(ex => slot(ex, catalogue))
    }))
    state.routines.push(...created)
    state.week = { ...(state.week || {}) }
    for (const day of weekdays) {
      const ids = day.routine_indexes.map(index => created[index].id)
      if (ids.length) state.week[day.weekday] = ids
      else delete state.week[day.weekday]
    }
    return {
      created_routines: created.map(r => ({ id: r.id, name: r.name, exercise_count: r.ex.length })),
      changed_weekdays: weekdays.map(day => ({ weekday: day.weekday, routine_ids: state.week[day.weekday] || [] }))
    }
  }
  if (!['edit', 'delete'].includes(operation)) fail('invalid routine operation')
  text(input.routine_id, 'routine_id', 200)
  const routine = state.routines.find(r => r.id === input.routine_id)
  if (!routine) fail(`No routine with id ${JSON.stringify(input.routine_id)}`, 'ENOENT')
  if (operation === 'delete') {
    if (input.confirm !== true) fail('confirm=true required for deletion')
    const changed_weekdays = Object.keys(state.week || {}).filter(day => [].concat(state.week[day]).includes(routine.id)).map(Number)
    const changed_dates = Object.keys(state.dayPlan || {}).filter(day => state.dayPlan[day] === routine.id)
    deleteRoutine(state, routine.id)
    return { deleted_routine: { id: routine.id, name: routine.name }, changed_weekdays, changed_dates }
  }
  if (['name', 'emoji', 'policy', 'exercises'].every(key => input[key] === undefined)) fail('Specify at least one routine field to edit')
  validateRoutine(input, true)
  let nextExercises
  if (input.exercises !== undefined) {
    const catalogue = new Map(allExercises(state).map(ex => [ex.id, ex]))
    const unused = [...(routine.ex || [])]
    nextExercises = input.exercises.map(input => {
      const index = unused.findIndex(ex => ex.id === input.id)
      const previous = index < 0 ? {} : unused.splice(index, 1)[0]
      return slot(input, catalogue, previous)
    })
    cleanupSg(nextExercises)
  }
  if (input.name !== undefined) routine.name = input.name.trim()
  if (input.emoji !== undefined) routine.emoji = input.emoji
  if (input.policy !== undefined) routine.prog = input.policy
  if (nextExercises !== undefined) routine.ex = nextExercises
  return { updated_routine: { id: routine.id, name: routine.name, exercise_count: routine.ex?.length || 0 } }
}
