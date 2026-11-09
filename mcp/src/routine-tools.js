/* The plan's write tools: create_routine, update_routine and delete_routine (#960, #310). They save
   through the openGym api like log_workout (api-client.js), with a paired session or a scoped token
   that holds Plans at "Change directly". The rules are frontend/src/lib/routine-write.js.

   The revision contract (#310): list_routines and get_routine say the profile's `revision`. An edit
   given `expected_revision` and a delete (which always needs one, and confirm: true) are written over
   exactly that revision or not at all: when the profile moved, the answer is a conflict to read again
   and put to the user, never a retry against data the user did not see. A new routine, or an edit
   without expected_revision, is built again on the current document after a conflict, like a
   logged workout. */
import crypto from 'node:crypto'
import { z } from 'zod'
import { getRoutine } from './tools.js'
import { localUid, invalidate, withProfile, currentProfile } from './state.js'
import { apiConfig, apiFetch, profilePaths } from './api-client.js'
import { savesOf, WRITE_LIMIT } from './write-tools.js'
import { createRoutine, updateRoutine, removeRoutine, routineWeekdays, ROUTINE_LIMITS, WEEKDAYS } from '../../frontend/src/lib/routine-write.js'

const MAX_ATTEMPTS = 3
const fail = (code, message) => Object.assign(new Error(message), { code })

/**
 * Reads the profile, applies `change(S)` (→ { problems } | { result }), and writes it back.
 * `exact`: a revision the write must land on, no retry. → the tool's answer.
 */
async function writePlan({ change, exact = null, dryRun = false, env, fetchImpl, view }) {
  const cfg = apiConfig(env)
  const opts = fetchImpl ? { fetchImpl } : {}
  const paths = profilePaths(cfg)
  const now = Date.now()
  const saves = savesOf(crypto.createHash('sha256').update(cfg.token).digest('hex'), now)
  if (!dryRun && saves.length >= WRITE_LIMIT) throw fail('ERATE', `already ${WRITE_LIMIT} saves in the last hour, the most this takes in one go; nothing was saved`)
  const me = await apiFetch(cfg, paths.me, opts)
  const uid = me.body?.user?.id
  if (typeof uid !== 'string' || !uid) throw fail('EAPI', `the openGym server did not say which profile the token belongs to (GET ${paths.me}); nothing was saved`)
  const local = localUid()
  if (local && local !== uid) {
    console.error(`[opengym-mcp] the token is for profile ${uid}, this server reads ${local}`)
    throw fail('EPROFILE', 'the token belongs to another profile than the one this server reads: nothing was saved (the ids are on the server\'s stderr)')
  }
  let got = await apiFetch(cfg, paths.data, opts)
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const doc = got.body?.state
    if (!doc || typeof doc !== 'object') throw fail('ENOSTATE', 'this profile has no synced data on the server yet: open openGym and sign in on a device once, then try again')
    const rev = got.body.rev ?? 0
    if (exact != null && rev !== exact) {
      return { saved: false, conflict: true, revision: rev, message: `The profile changed since revision ${exact} (it is at ${rev} now). Nothing was saved: read the routine again (get_routine), show the user what it is now, and ask before trying again.` }
    }
    const S = structuredClone(doc)
    const out = change(S)
    if (out.problems) return { saved: false, problems: out.problems, next: 'Nothing was saved. Settle these with the user (pick a candidate id, fix a number) and call again.' }
    const shown = view(S, out)
    if (dryRun) return { saved: false, dry_run: true, would_save: shown, revision: rev }
    const put = await apiFetch(cfg, paths.data, { ...opts, method: 'PUT', body: { state: S, baseRev: rev, ...(typeof got.body.wid === 'string' ? { baseWid: got.body.wid } : typeof doc._wid === 'string' ? { baseWid: doc._wid } : {}) } })
    if (put.status !== 409) {
      invalidate()
      saves.push(now)
      console.error(`[opengym-mcp] plan saved (${out.what}), rev ${put.body?.rev ?? '?'}`)
      return { saved: true, ...shown, revision: put.body?.rev ?? null }
    }
    if (exact != null) {
      return { saved: false, conflict: true, revision: put.body?.rev ?? null, message: 'Another device saved in between. Nothing was saved: read the routine again and ask the user before trying again.' }
    }
    if (!put.body?.state || typeof put.body.state !== 'object' || typeof put.body.rev !== 'number') throw fail('EAPI', 'the openGym server answered 409 without the current profile; nothing was saved')
    got = { status: 200, body: { state: put.body.state, rev: put.body.rev, wid: put.body.wid } }
  }
  throw fail('ECONFLICT', `the profile kept changing on the server (${MAX_ATTEMPTS} attempts); nothing was saved, try again in a moment`)
}

// The routine as get_routine reads it, from the document just built.
const routineView = (S, id) => {
  const p = currentProfile()
  const v = withProfile({ ...(p || {}), state: S, user: p?.user || { id: localUid() || 'profile', name: '' } }, () => getRoutine.handler({ routine_id: id }))
  delete v.revision
  return { routine: { ...v, weekdays: routineWeekdays(S, id) } }
}

const exerciseSchema = z.object({
  exercise: z.string().min(1).max(120).describe('Exercise name as the user said it ("barbell squat"), or an exercise id from search_exercises or an earlier answer (an id never matches the wrong exercise).'),
  sets: z.number().int().min(1).max(ROUTINE_LIMITS.maxSets).optional().describe('Number of sets. Omit for the profile\'s default (3 unless they set their own).'),
  reps: z.number().int().min(1).max(ROUTINE_LIMITS.maxReps).optional().describe('Reps per set, for a rep exercise.'),
  seconds: z.number().int().min(1).max(ROUTINE_LIMITS.maxSec).optional().describe('Seconds per set, for a hold (plank). Not with reps.'),
  weight: z.number().min(0).optional().describe('Planned load in `unit`; omit or 0 to start from what the user lifted last time.'),
  rest_sec: z.number().int().min(0).max(ROUTINE_LIMITS.maxRestSec).optional().describe('Rest after each set, seconds. 0 or omitted: the global rest timer.'),
  note: z.string().max(ROUTINE_LIMITS.maxNote).optional().describe('A note shown with this exercise in the workout.'),
})
const weekdaysSchema = z.array(z.enum(WEEKDAYS)).max(7)

export const createRoutineTool = {
  name: 'create_routine',
  description: [
    'Create a routine in the user\'s openGym plan (it syncs to all their devices), e.g. "squat 5 × 5 at 100 kg, plank 3 × 60 s, Tuesdays and Fridays".',
    'Exercises are matched against the library like log_workout: when a name matches several or none, nothing is saved and `problems` lists candidates to put to the user.',
    'Each exercise starts the way picking it in the app starts it; only what you pass is set on top. `weekdays` puts it on those days of the weekly plan, next to whatever is planned there already.',
    'Call with dry_run: true first when you interpreted anything, show the preview, and save once the user agrees.',
  ].join(' '),
  schema: {
    name: z.string().min(1).max(ROUTINE_LIMITS.maxName),
    exercises: z.array(exerciseSchema).min(1).max(ROUTINE_LIMITS.maxExercises),
    weekdays: weekdaysSchema.optional().describe('The weekdays to plan it on.'),
    unit: z.enum(['kg', 'lb']).optional().describe('The unit weights are given in; defaults to the profile\'s.'),
    dry_run: z.boolean().optional(),
  },
  handler: async (p, { env = process.env, fetchImpl } = {}) => writePlan({
    env, fetchImpl, dryRun: p.dry_run === true,
    change: S => { const r = createRoutine(S, p); return r.problems ? r : { ...r, what: `new routine ${r.routine.id}` } },
    view: (S, out) => routineView(S, out.routine.id),
  }),
}

export const updateRoutineTool = {
  name: 'update_routine',
  description: [
    'Change a routine: rename it, replace its exercise list, append exercises, or move it to other weekdays. Use routine_id from list_routines.',
    '`exercises` is the whole new list in order; an exercise named again keeps everything its slot had (rest, warm-ups, progression, notes) except what you pass. `add_exercises` appends. `weekdays` is every day it should be on (it leaves the others); omit it to leave the schedule alone.',
    'Pass expected_revision (from get_routine) when the user confirmed a change against what they saw: if the profile moved since, nothing is saved and you get a conflict to read again.',
  ].join(' '),
  schema: {
    routine_id: z.string().min(1),
    name: z.string().min(1).max(ROUTINE_LIMITS.maxName).optional(),
    exercises: z.array(exerciseSchema).min(1).max(ROUTINE_LIMITS.maxExercises).optional(),
    add_exercises: z.array(exerciseSchema).min(1).max(ROUTINE_LIMITS.maxExercises).optional(),
    weekdays: weekdaysSchema.optional(),
    unit: z.enum(['kg', 'lb']).optional(),
    expected_revision: z.number().int().min(0).optional(),
    dry_run: z.boolean().optional(),
  },
  handler: async (p, { env = process.env, fetchImpl } = {}) => {
    if (p.name == null && p.exercises == null && p.add_exercises == null && p.weekdays == null) {
      return { saved: false, problems: [{ field: 'routine', problem: 'nothing to change: pass name, exercises, add_exercises or weekdays' }] }
    }
    return writePlan({
      env, fetchImpl, dryRun: p.dry_run === true, exact: p.expected_revision ?? null,
      change: S => { const r = updateRoutine(S, p.routine_id, p); return r.problems ? r : { ...r, what: `routine ${p.routine_id} changed` } },
      view: S => routineView(S, p.routine_id),
    })
  },
}

export const deleteRoutineTool = {
  name: 'delete_routine',
  description: 'Delete a routine from the plan, and from every weekday and date it was planned on. Logged workouts stay. Only after the user said yes to deleting that routine by name: pass confirm: true and expected_revision from get_routine or list_routines. If the profile changed since, nothing is deleted and you get a conflict to read again.',
  schema: {
    routine_id: z.string().min(1),
    confirm: z.literal(true).describe('The user agreed to delete this routine.'),
    expected_revision: z.number().int().min(0),
    dry_run: z.boolean().optional(),
  },
  handler: async (p, { env = process.env, fetchImpl } = {}) => {
    if (p.confirm !== true) return { saved: false, problems: [{ field: 'confirm', problem: 'ask the user first, then pass confirm: true' }] }
    if (!Number.isInteger(p.expected_revision)) return { saved: false, problems: [{ field: 'expected_revision', problem: 'read the routine first (get_routine) and pass its revision' }] }
    return writePlan({
      env, fetchImpl, dryRun: p.dry_run === true, exact: p.expected_revision,
      change: S => { const r = removeRoutine(S, p.routine_id); return r.problems ? r : { ...r, what: `routine ${p.routine_id} deleted` } },
      view: (S, out) => ({ deleted: { id: out.routine.id, name: out.routine.name }, ...(Object.keys(out.dropped || {}).length ? { dates_cleared: Object.keys(out.dropped) } : {}) }),
    })
  },
}

export const ROUTINE_TOOLS = [createRoutineTool, updateRoutineTool, deleteRoutineTool]
