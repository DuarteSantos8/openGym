/* The write tool. log_workout files a session the user describes ("dumbbell curls, 12 kg,
   12/12/10, last set to failure") into their history, through their own openGym server
   (api-client.js), as if it had been logged on the phone: every device shows it within the
   half minute they poll the revision.

   The language is the LLM's job and the arithmetic is the lib's (frontend/src/lib/log-workout.js):
   the client turns what was said into exercises and sets, and this builds, checks and files them.
   What the lib will not guess at — a name the library spells twice, an exercise the user has not
   made yet — comes back as `problems` with candidates, for the LLM to put to the user. */
import { z } from 'zod'
import { isoDate, entryView, withCustomsIndexed } from './tools.js'
import { localUid, invalidate } from './state.js'
import { apiConfig, apiFetch, apiBase, redeemPairingCode } from './api-client.js'
import { loadCredentials, saveCredentials } from './credentials.js'
import { buildLoggedWorkout, appendLoggedWorkout, findDuplicate, BODY_PARTS, LOG_LIMITS } from '../../frontend/src/lib/log-workout.js'
import { friendlyDuration } from './labels.js'
import { buildRoutine, appendRoutine, editRoutine, applyRoutineEdit, ROUTINE_LIMITS } from '../../frontend/src/lib/log-routine.js'

const localIso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
const hhmm = t => { const d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') }
// Two writers racing the same profile resolve in a round or two; past that something keeps
// writing, and the user is better told than retried at.
const MAX_ATTEMPTS = 3
// Saves per hour, per MCP process. Logging a week someone forgot is a handful; a client looping on
// the tool is not, and each save is a full profile write on the server that every device pulls.
export const WRITE_LIMIT = 20
const WINDOW_MS = 60 * 60000
let saves = []
export const _resetWriteWindow = () => { saves = [] }

function fail(code, message) {
  const err = new Error(message)
  err.code = code
  return err
}

// The tool's snake_case parameters as the lib's description.
const inputOf = p => ({
  date: p.date,
  start: p.start,
  durationMin: p.duration_min,
  name: p.name,
  note: p.note,
  unit: p.unit,
  exercises: (p.exercises || []).map(ex => ({
    exercise: ex.exercise,
    createCustom: ex.create_custom,
    bodyPart: ex.body_part,
    note: ex.note,
    sets: (ex.sets || []).map(s => ({ reps: s.reps, seconds: s.seconds, weight: s.weight, warmup: s.warmup, failure: s.failure, rir: s.rir, rpe: s.rpe })),
  })),
})

// What was (or would be) saved, read back the way get_workout reads a session, so the user can
// check it in the words the app uses ("12 × 12 kg", "1:00").
function viewOf(w, S, resolved) {
  const withCustoms = { ...S, customEx: [...(S.customEx || []), ...resolved.customEx] }
  return {
    workout_id: w.id,
    date: w.d,
    start: hhmm(w.start),
    duration: w.end > w.start ? friendlyDuration(w.end - w.start) : null,
    name: w.name,
    unit: S.unit === 'lb' ? 'lb' : 'kg',
    volume: w.vol,
    ...(w.note ? { note: w.note } : {}),
    prs: (w.prs || []).map(id => resolved.resolved.find(r => r.id === id)?.name || id),
    exercises: w.entries.map(e => {
      const v = entryView(e, withCustoms)
      const r = resolved.resolved.find(x => x.id === e.id)
      return {
        id: e.id,
        name: v.name,
        ...(r?.input !== undefined && r.input !== v.name ? { you_said: r.input } : {}),
        ...(r?.created ? { new_custom_exercise: true } : {}),
        ...(r?.weightMeans ? { weight_means: r.weightMeans === 'each' ? 'per dumbbell' : 'both dumbbells together' } : {}),
        // The numbers spelled out next to the app's own label ("12×10 F": 12 kg, 10 reps, to
        // failure), so reading it back to the user cannot swap the weight and the reps.
        sets: e.sets.map((row, i) => ({
          label: v.sets[i].label,
          weight: Number(row.w) || 0,
          ...(row.sec != null ? { seconds: row.sec } : { reps: row.r }),
          ...(row.phase === 'warmup' ? { warmup: true } : {}),
          ...(row.failure ? { failure: true } : {}),
          ...(row.rir != null ? { rir: row.rir } : {}),
          ...(row.rpe != null ? { rpe: row.rpe } : {}),
        })),
        ...(e.note ? { note: e.note } : {}),
      }
    }),
  }
}

const setSchema = z.object({
  reps: z.number().int().min(1).max(LOG_LIMITS.maxReps).optional().describe('Reps done. Give reps for a rep exercise, or seconds for a hold, never both in one exercise.'),
  seconds: z.number().min(1).max(LOG_LIMITS.maxSec).optional().describe('Seconds held, for a timed exercise (plank, hang, wall sit).'),
  weight: z.number().min(0).optional().describe('Load in `unit`. Omit or 0 for bodyweight. On an assistance machine it is the help (less is better). For dumbbells: as the profile logs that exercise (see weight_means in the reply).'),
  warmup: z.boolean().optional().describe('A warm-up set: kept out of volume, PRs and the next suggested weight.'),
  failure: z.boolean().optional().describe('Taken to failure.'),
  rir: z.number().min(0).max(10).optional().describe('Reps in reserve, if the user said it. Not with rpe.'),
  rpe: z.number().min(6).max(10).optional().describe('RPE, if the user said it. Not with rir.'),
})

export const logWorkout = {
  name: 'log_workout',
  description: [
    'Log a workout the user describes into their openGym history (it syncs to all their devices). Turn what they said into exercises and one entry per set:',
    '"curls, 12 kg, 12/12/10" is three sets of {reps, weight: 12}; "3 sets of 12, except the last was 10" is 12, 12, 10.',
    'Ask instead of assuming when the weight, the number of sets or the reps are unclear.',
    'Exercises are matched against the user\'s library by name or id. A common name resolves to the library\'s default variant ("shoulder press" is the barbell one): when the reply\'s `name` differs from `you_said` and the variant matters (dumbbell vs barbell, machine vs cable), confirm with the user, or pass an id. If a name matches several exercises, or none, nothing is saved and `problems` lists candidates: ask the user which one, then call again with its id.',
    'Only set create_custom for an exercise the user confirms is not in the library.',
    'Call with dry_run: true first when you had to interpret anything, show the user the preview, and log it once they agree.',
    'Calling again with the same description does not log it twice. Cardio (time and speed) and supersets are not supported here.',
  ].join(' '),
  schema: {
    date: isoDate().optional().describe('YYYY-MM-DD the session was done; defaults to today. Not in the future.'),
    start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM, 24 h').optional().describe('Start time HH:MM, if the user said it. Without it a session logged today ends now; one in the past starts at 18:00.'),
    duration_min: z.number().min(1).max(LOG_LIMITS.maxDurationMin).optional().describe('How long the session took, in minutes, if known.'),
    name: z.string().max(80).optional().describe('A name for the session, e.g. "Arms" or "Push day". Defaults to "Workout".'),
    note: z.string().max(500).optional().describe('A note on the whole session.'),
    unit: z.enum(['kg', 'lb']).optional().describe('The unit the user gave weights in; defaults to the profile\'s. Converted when it differs.'),
    exercises: z.array(z.object({
      exercise: z.string().min(1).max(120).describe('Exercise name as the user said it ("dumbbell curl"), or an exercise id from an earlier answer.'),
      create_custom: z.boolean().optional().describe('Create this as the user\'s own exercise when the library has nothing matching. Only after the user confirms.'),
      body_part: z.enum(BODY_PARTS).optional().describe('Body part of a new custom exercise, when its name does not say.'),
      note: z.string().max(280).optional().describe('A note on this exercise today.'),
      sets: z.array(setSchema).min(1).max(LOG_LIMITS.maxSets),
    })).min(1).max(LOG_LIMITS.maxExercises),
    dry_run: z.boolean().optional().describe('Build and return the preview without saving anything.'),
    allow_duplicate: z.boolean().optional().describe('Log it even though the same sets are already logged that day (a genuine second session). Give it a different start or name too.'),
  },
  handler: async (params, { env = process.env, fetchImpl } = {}) => {
    const cfg = apiConfig(env)
    const opts = fetchImpl ? { fetchImpl } : {}
    // One clock for every attempt: a retry after a conflict files the same workout, not a later one.
    const now = Date.now()
    saves = saves.filter(t => now - t < WINDOW_MS)
    if (!params.dry_run && saves.length >= WRITE_LIMIT) {
      throw fail('ERATE', `log_workout already saved ${WRITE_LIMIT} workouts in the last hour, the most it takes in one go; nothing was saved. Wait a bit, or log the rest in the app.`)
    }
    const input = inputOf({ ...params, date: params.date || localIso(new Date(now)) })

    const me = await apiFetch(cfg, '/api/me', opts)
    const uid = me.body?.user?.id
    // A guard that cannot read whose token this is refuses rather than steps aside.
    if (typeof uid !== 'string' || !uid) throw fail('EAPI', 'the openGym server did not say which profile OPENGYM_TOKEN belongs to (GET /api/me); nothing was saved')
    const local = localUid()
    if (local && local !== uid) {
      // The ids go to the operator on stderr, not into the model's context (state.js ambiguousUid).
      console.error(`[opengym-mcp] OPENGYM_TOKEN is for profile ${uid}, this server reads ${local}`)
      throw fail('EPROFILE', 'OPENGYM_TOKEN belongs to another profile than the one this server reads: pair again from the right profile, or set OPENGYM_UID to match (the ids are on the server\'s stderr)')
    }

    let got = await apiFetch(cfg, '/api/data', opts)
    // A description without a unit is in the profile's, as the profile was when first read: a
    // retry after another device switched kg ↔ lb reads the same numbers the same way.
    let unit = null, meanings = null
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const doc = got.body?.state
      if (!doc || typeof doc !== 'object') {
        throw fail('ENOSTATE', 'this profile has no synced data on the server yet: open openGym and sign in on a device once, then try again')
      }
      // The document exactly as the server sent it, plus the workout: anything else in the PUT —
      // a default filled in here — would be stamped as an edit made now and land on every device.
      const S = structuredClone(doc)
      unit = unit || (S.unit === 'lb' ? 'lb' : 'kg')
      // The profile's own exercises indexed for the build, as the app has them: a custom one-arm
      // dumbbell press counts one bell, a custom assisted machine folds towards less help.
      const built = withCustomsIndexed(S, () => buildLoggedWorkout(S, input, { now, unit, meanings }))
      if (built.problems) {
        return { logged: false, problems: built.problems, next: 'Nothing was saved. Settle these with the user (pick a candidate id, fix a set) and call again.' }
      }
      // What each dumbbell weight meant on the first read stays what it means on a retry.
      meanings = meanings || Object.fromEntries(built.workout.entries.map(e => [e.id, e.target?.dbLoad || 'as']))
      const preview = viewOf(built.workout, S, built)
      if (params.dry_run) {
        const dup = findDuplicate(S, built.workout)
        return { logged: false, dry_run: true, would_log: preview, ...(dup && (dup.sameRequest || !params.allow_duplicate) ? { duplicate_of: dup.workout.id } : {}) }
      }
      const added = withCustomsIndexed({ customEx: [...(S.customEx || []), ...built.customEx] }, () =>
        appendLoggedWorkout(S, built, { now, allowDuplicate: params.allow_duplicate === true }))
      if (!added.added) {
        return { logged: false, duplicate: true, workout_id: added.workout.id, date: added.workout.d, message: 'This session is already in the history; nothing was added. If it really was a second session, call again with allow_duplicate: true and a different start or name.' }
      }
      const put = await apiFetch(cfg, '/api/data', { ...opts, method: 'PUT', body: { state: S, baseRev: got.body.rev ?? 0, ...(typeof doc._wid === 'string' ? { baseWid: doc._wid } : {}) } })
      if (put.status !== 409) {
        invalidate()
        saves.push(now)
        // The operator's trail (stderr, as the profile guard's): which workout went in, for what
        // day and at which revision. Never the token, and nothing the model sees.
        const sets = added.workout.entries.reduce((n, e) => n + e.sets.length, 0)
        console.error(`[opengym-mcp] log_workout saved ${added.workout.id} for ${added.workout.d} (${added.workout.entries.length} exercises, ${sets} sets), rev ${put.body?.rev ?? '?'}`)
        return { logged: true, ...viewOf(added.workout, S, built), revision: put.body?.rev ?? null }
      }
      // Another device wrote in between: the server sent its current document back with the 409,
      // so the workout is built again on top of that one. A 409 without one (a proxy's page) is
      // not something to build on.
      if (!put.body?.state || typeof put.body.state !== 'object' || typeof put.body.rev !== 'number') {
        throw fail('EAPI', 'the openGym server answered 409 without the current profile; nothing was saved')
      }
      got = { status: 200, body: { state: put.body.state, rev: put.body.rev } }
    }
    throw fail('ECONFLICT', `the profile kept changing on the server (${MAX_ATTEMPTS} attempts); nothing was saved, try again in a moment`)
  },
}

/* The plumbing the plan-editing tools share with log_workout's: whose token this is, the
   profile as the server sent it, the change built on top of that and nothing else, a conditional
   write, and a rebuild on the document a 409 carries. `build(S, dryRun)` gets a copy of the profile
   and answers either { early } (problems, a duplicate, a dry run: nothing is written) or
   { view, log }, having changed `S` in place. */
async function changeProfile(toolName, { env = process.env, fetchImpl } = {}, dryRun, build) {
  const cfg = apiConfig(env)
  const opts = fetchImpl ? { fetchImpl } : {}
  const now = Date.now()
  saves = saves.filter(t => now - t < WINDOW_MS)
  if (!dryRun && saves.length >= WRITE_LIMIT) {
    throw fail('ERATE', `The MCP already saved ${WRITE_LIMIT} changes in the last hour, the most it takes in one go; nothing was saved. Wait a bit, or do the rest in the app.`)
  }
  const me = await apiFetch(cfg, '/api/me', opts)
  const uid = me.body?.user?.id
  if (typeof uid !== 'string' || !uid) throw fail('EAPI', 'the openGym server did not say which profile OPENGYM_TOKEN belongs to (GET /api/me); nothing was saved')
  const local = localUid()
  if (local && local !== uid) {
    console.error(`[opengym-mcp] OPENGYM_TOKEN is for profile ${uid}, this server reads ${local}`)
    throw fail('EPROFILE', 'OPENGYM_TOKEN belongs to another profile than the one this server reads: pair again from the right profile, or set OPENGYM_UID to match (the ids are on the server\'s stderr)')
  }

  let got = await apiFetch(cfg, '/api/data', opts)
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const doc = got.body?.state
    if (!doc || typeof doc !== 'object') {
      throw fail('ENOSTATE', 'this profile has no synced data on the server yet: open openGym and sign in on a device once, then try again')
    }
    // The document exactly as the server sent it, plus the change: nothing else in the PUT.
    const S = structuredClone(doc)
    const out = withCustomsIndexed(S, () => build(S, dryRun === true))
    if (out.early) return out.early
    const put = await apiFetch(cfg, '/api/data', { ...opts, method: 'PUT', body: { state: S, baseRev: got.body.rev ?? 0, ...(typeof doc._wid === 'string' ? { baseWid: doc._wid } : {}) } })
    if (put.status !== 409) {
      invalidate()
      saves.push(now)
      console.error(`[opengym-mcp] ${toolName} saved ${out.log}, rev ${put.body?.rev ?? '?'}`)
      return { ...out.view, revision: put.body?.rev ?? null }
    }
    if (!put.body?.state || typeof put.body.state !== 'object' || typeof put.body.rev !== 'number') {
      throw fail('EAPI', 'the openGym server answered 409 without the current profile; nothing was saved')
    }
    got = { status: 200, body: { state: put.body.state, rev: put.body.rev } }
  }
  throw fail('ECONFLICT', `the profile kept changing on the server (${MAX_ATTEMPTS} attempts); nothing was saved, try again in a moment`)
}

// A routine as the model reads it back: names beside the ids, so "squat 3 x 12" can be checked.
const routineView = (S, r, days) => ({
  routine_id: r.id,
  name: r.name,
  ...(r.emoji ? { emoji: r.emoji } : {}),
  days: days ?? Object.keys(S.week || {}).filter(d => [].concat(S.week[d] || []).includes(r.id)).map(Number).sort(),
  exercises: (r.ex || []).map(e => ({
    id: e.id,
    name: entryView({ id: e.id, sets: [] }, S).name,
    sets: e.sets,
    ...(e.mode === 'time' ? { seconds: e.sec } : { reps: e.reps }),
    ...(e.weight ? { weight: e.weight } : {}),
    ...(e.restSec ? { rest_sec: e.restSec } : {}),
  })),
})

const daysSchema = z.array(z.union([z.number().int().min(0).max(6), z.string().min(3).max(9)])).max(7)
const exerciseSchema = z.object({
  exercise: z.string().min(1).max(120).describe('Exercise name as the user said it ("squat"), or an exercise id from an earlier answer.'),
  sets: z.number().int().min(1).max(ROUTINE_LIMITS.maxSets),
  reps: z.number().int().min(1).max(ROUTINE_LIMITS.maxReps).optional().describe('Target reps per set. Give reps for a rep exercise, or seconds for a hold, never both.'),
  seconds: z.number().int().min(1).max(ROUTINE_LIMITS.maxSec).optional().describe('Target seconds per set, for a timed exercise (plank, hang, wall sit).'),
  weight: z.number().min(0).optional().describe('Starting load in the profile\'s unit. Omit or 0 for bodyweight.'),
  rest_sec: z.number().int().min(1).max(ROUTINE_LIMITS.maxRestSec).optional().describe('This exercise\'s own rest in seconds; omit to use the app\'s timer.'),
})
const specOf = e => ({ exercise: e.exercise, sets: e.sets, reps: e.reps, seconds: e.seconds, weight: e.weight, rest_sec: e.rest_sec })

export const createRoutine = {
  name: 'create_routine',
  description: [
    'Create a routine in the user\'s openGym plan (the same list the Plan screen shows) and, if asked, put it on weekdays. It syncs to all their devices.',
    'Turn what they said into exercises with sets and either reps or seconds: "squat 3 x 12, plank 3 x 25 s" is {exercise: "squat", sets: 3, reps: 12} and {exercise: "plank", sets: 3, seconds: 25}.',
    'Ask instead of assuming when the sets, the reps or the days are unclear.',
    'Exercises are matched against the user\'s library by name or id, exactly as log_workout does: when a name matches several exercises, or none, nothing is saved and `problems` lists candidates; ask the user which one, then call again with its id.',
    'Weekdays are 0 (Sunday) to 6 (Saturday) or English names; days not named keep what they have, and a routine is added to a day that already has one rather than replacing it.',
    'Call with dry_run: true first when you had to interpret anything, show the user the preview, and create it once they agree.',
    'A routine with the same name is never added twice. Cardio by time and speed, supersets and progression rules are not set here: the user adds those in the app. To change a routine that exists, use update_routine.',
  ].join(' '),
  schema: {
    name: z.string().min(1).max(80).describe('The routine\'s name, e.g. "Forza corpo libero".'),
    emoji: z.string().max(8).optional().describe('One emoji for the routine, if the user wants one.'),
    days: daysSchema.optional().describe('Weekdays to plan it on: 0 (Sunday) to 6 (Saturday) or English names. Omit to leave it off the week.'),
    exercises: z.array(exerciseSchema).min(1).max(ROUTINE_LIMITS.maxExercises),
    dry_run: z.boolean().optional().describe('Build and return the preview without saving anything.'),
  },
  handler: (params, ctx) => changeProfile('create_routine', ctx, params.dry_run, (S, dry) => {
    const built = buildRoutine(S, { name: params.name, emoji: params.emoji, days: params.days, exercises: (params.exercises || []).map(specOf) })
    if (built.problems) return { early: { created: false, problems: built.problems, next: 'Nothing was saved. Settle these with the user (pick a candidate id, fix a number) and call again.' } }
    if (built.duplicate) return { early: { created: false, duplicate: true, routine_id: built.duplicate.id, message: `A routine called "${built.duplicate.name}" already exists; nothing was added. Use update_routine to change it, or pick another name.` } }
    const view = routineView({ ...S, week: built.week }, built.routine, built.days)
    if (dry) return { early: { created: false, dry_run: true, would_create: view } }
    appendRoutine(S, built)
    return { view: { created: true, ...view }, log: `${built.routine.id} created (${built.routine.ex.length} exercises, days ${built.days.join(',') || 'none'})` }
  }),
}

export const updateRoutine = {
  name: 'update_routine',
  description: [
    'Change a routine that exists in the user\'s openGym plan: rename it, change its emoji, move it to other weekdays, or change its exercises. It syncs to all their devices.',
    'Find it first with list_routines and read it with get_routine; `routine` is its id or, when only one routine has it, its name.',
    'Send only what changes. `days` is the routine\'s weekdays from now on (it replaces the old ones; [] takes it off the week; other routines on those days stay). `exercises` is the whole new list in order and replaces the old one: an exercise it already had keeps what you do not mention (its progression rule, its own rest). For a smaller change use `add_exercises` (appended) and `remove_exercises` (names or ids), which cannot come together with `exercises`.',
    'Exercises are matched against the library by name or id, as in create_routine: an ambiguous or unknown name saves nothing and `problems` lists candidates.',
    'Call with dry_run: true first, show the user the result, and save once they agree. Deleting a routine is not done here.',
  ].join(' '),
  schema: {
    routine: z.string().min(1).max(120).describe('The routine\'s id, or its exact name when unique.'),
    name: z.string().min(1).max(80).optional().describe('A new name.'),
    emoji: z.string().max(8).optional().describe('A new emoji; an empty string removes it.'),
    days: daysSchema.optional().describe('The routine\'s weekdays from now on: 0 (Sunday) to 6 (Saturday) or English names. [] takes it off the week; omit to leave the week alone.'),
    exercises: z.array(exerciseSchema).min(1).max(ROUTINE_LIMITS.maxExercises).optional().describe('The whole new exercise list, replacing the old.'),
    add_exercises: z.array(exerciseSchema).min(1).max(ROUTINE_LIMITS.maxExercises).optional().describe('Exercises to append to the current list.'),
    remove_exercises: z.array(z.string().min(1).max(120)).min(1).max(ROUTINE_LIMITS.maxExercises).optional().describe('Exercises to take out of the routine, by name or id.'),
    dry_run: z.boolean().optional().describe('Build and return the result without saving anything.'),
  },
  handler: (params, ctx) => changeProfile('update_routine', ctx, params.dry_run, (S, dry) => {
    const edit = editRoutine(S, {
      routine: params.routine,
      name: params.name,
      emoji: params.emoji,
      days: params.days,
      exercises: params.exercises?.map(specOf),
      add_exercises: params.add_exercises?.map(specOf),
      remove_exercises: params.remove_exercises,
    })
    if (edit.problems) return { early: { updated: false, problems: edit.problems, next: 'Nothing was saved. Settle these with the user (pick a candidate id, fix a number) and call again.' } }
    if (!edit.changed.length) return { early: { updated: false, unchanged: true, message: 'Nothing to change: send at least one of name, emoji, days, exercises, add_exercises or remove_exercises.' } }
    const view = { changed: edit.changed, ...routineView({ ...S, week: edit.week }, edit.routine, edit.days ?? undefined) }
    if (dry) return { early: { updated: false, dry_run: true, would_update: view } }
    applyRoutineEdit(S, edit)
    return { view: { updated: true, ...view }, log: `${edit.routine.id} updated (${edit.changed.join(', ')})` }
  }),
}

export const pairOpengym = {
  name: 'pair_opengym',
  description: [
    'Connect this MCP server to the user\'s openGym server so the writing tools (log_workout, create_routine, update_routine) work. Do this when one of them says it is not paired, or when the token expired.',
    'The user opens the app signed in as their profile, Settings, Account, "Pair the mobile app", approves with their passkey or password, and gives you the code it shows (8 letters and digits, good for five minutes, one use). Pass it as `code`.',
    '`url` is the address they open openGym at (https, or http for localhost or *.localhost); leave it out when this server is already paired and only the token needs renewing.',
    'The token it gets back is saved in a private file on this machine and is never shown to you or to anyone: you will not see it, and there is nothing to copy or put in a config. No restart is needed.',
  ].join(' '),
  schema: {
    code: z.string().min(4).max(20).describe('The pairing code the app shows, e.g. K7WQ2MZP (dashes and case do not matter).'),
    url: z.string().max(300).optional().describe('The address openGym is served at, e.g. http://opengym.docker.localhost. Optional when already paired.'),
  },
  handler: async (params, { env = process.env, fetchImpl } = {}) => {
    const code = String(params.code).replace(/[\s-]/g, '').toUpperCase()
    if (!/^[A-Z0-9]{4,16}$/.test(code)) throw fail('EPAIR', 'that is not a pairing code: it is 8 letters and digits, shown by the app under Settings, Account, "Pair the mobile app"')
    const known = loadCredentials(env)
    const where = (params.url || '').trim() || (env.OPENGYM_URL || '').trim() || known?.url || ''
    if (!where) throw fail('EPAIR', 'which address is openGym at? Pass `url`, the one the user opens it at (for example http://opengym.docker.localhost)')
    const base = apiBase(where)
    const { token, user } = await redeemPairingCode(base, code, fetchImpl ? { fetchImpl } : {})
    // A token for another profile than the one this server reads would be refused on every write;
    // better to say so now than to save it.
    const local = localUid()
    if (local && user?.id && local !== user.id) {
      console.error(`[opengym-mcp] the code is for profile ${user.id}, this server reads ${local}`)
      throw fail('EPROFILE', 'that code belongs to another profile than the one this server reads: pair from the app signed in as the right profile (nothing was saved)')
    }
    const file = saveCredentials(env, { url: base, token, user: user ? { id: user.id, name: user.name } : null })
    invalidate()
    console.error(`[opengym-mcp] paired with ${user?.name || 'your profile'} (${user?.id || '?'}) at ${base}; token kept in ${file}`)
    return {
      paired: true,
      profile: user?.name || null,
      url: base,
      saved_in: file,
      next: 'Done. The writing tools work now, no restart needed. If OPENGYM_TOKEN is set in this server\'s config it takes precedence over the saved one: remove it there.',
    }
  },
}

export const WRITE_TOOLS = [logWorkout, createRoutine, updateRoutine, pairOpengym]
