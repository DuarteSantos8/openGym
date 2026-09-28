import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-write-'))
const uid = 'owner'
fs.writeFileSync(path.join(root, 'db.json'), JSON.stringify({ users: [{ id: uid, name: 'Owner' }, { id: 'other', name: 'Other' }] }))
fs.writeFileSync(path.join(root, `state-${uid}.json`), JSON.stringify({ _rev: 10, unit: 'kg', bodyweight: [], routines: [], week: {}, dayPlan: {}, exWeights: {}, workouts: [], customEx: [] }))
fs.writeFileSync(path.join(root, 'state-other.json'), JSON.stringify({ _rev: 3, unit: 'lb', bodyweight: [], routines: [], workouts: [] }))
process.env.OPENGYM_DATA = root
process.env.OPENGYM_UID = uid
const tools = await import('../src/write-tools.js')
const { executeTool } = await import('../src/server.js')

afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

describe('remote tool calls', () => {
  it('run as the user the grant belongs to', async () => {
    const auth = uid => ({ scopes: ['opengym:read'], extra: { userId: uid } })
    expect((await executeTool(tools.getProfileState, {}, auth('other'))).unit).toBe('lb')
    expect((await executeTool(tools.getProfileState, {}, auth(uid))).unit).toBe('kg')
  })
  it('refuse writes on a read-only connection', async () => {
    const auth = { scopes: ['opengym:read'], extra: { userId: uid } }
    await expect(executeTool(tools.setGoalWeight, { expected_version: 10, weight: 70 }, auth)).rejects.toThrow(/read-only/)
  })
})

describe('MCP write tools', () => {
  it('queues remote deletions until the UI approves the exact request', async () => {
    const version = tools.getProfileState.handler({}).state_version
    const saved = tools.setBodyweight.handler({ expected_version: version, date: '2026-08-18', weight: 81 })
    const auth = { scopes: ['opengym:read', 'opengym:write'], extra: { userId: uid } }
    let queued
    const result = await executeTool(tools.deleteBodyweight, { expected_version: saved.state_version, date: '2026-08-18', confirm: true }, auth, (_auth, tool, params) => {
      queued = { tool, params }
      return { approval_required: true }
    })
    expect(result.approval_required).toBe(true)
    expect(JSON.parse(fs.readFileSync(path.join(root, `state-${uid}.json`))).bodyweight.some(entry => entry.d === '2026-08-18')).toBe(true)
    await executeTool(queued.tool, queued.params, { ...auth, extra: { ...auth.extra, approvedRequest: 'approved' } })
    expect(JSON.parse(fs.readFileSync(path.join(root, `state-${uid}.json`))).bodyweight.some(entry => entry.d === '2026-08-18')).toBe(false)
  })
  it('uses optimistic locking for body-weight writes', () => {
    const before = tools.getProfileState.handler({}).state_version
    const saved = tools.setBodyweight.handler({ expected_version: before, date: '2026-08-19', weight: 80.4 })
    expect(saved.ok).toBe(true)
    expect(saved.state_version).toBeGreaterThan(10)
    expect(() => tools.setBodyweight.handler({ expected_version: before, date: '2026-08-20', weight: 80 })).toThrow('state changed')
    expect(JSON.parse(fs.readFileSync(path.join(root, `state-${uid}.json`))).bodyweight[0].w).toBe(80.4)
  })

  it('creates a routine, schedules it and logs/deletes a workout', () => {
    let version = tools.getProfileState.handler({}).state_version
    const exercise = tools.searchExercises.handler({ query: 'bench', limit: 1 }).exercises[0]
    expect(exercise.id).toBeTruthy()
    const routine = tools.upsertRoutine.handler({ expected_version: version, name: 'Push', exercises: [{ exercise_id: exercise.id, sets: 3, reps: 8, weight: 50 }] })
    version = routine.state_version
    const planned = tools.setWeekPlan.handler({ expected_version: version, weekday: 1, routine_id: routine.routine_id })
    version = planned.state_version
    const workout = tools.logWorkout.handler({ expected_version: version, date: '2026-08-19', routine_id: routine.routine_id, duration_minutes: 45, entries: [{ exercise_id: exercise.id, sets: [{ weight: 50, reps: 8 }] }] })
    const deleted = tools.deleteWorkout.handler({ expected_version: workout.state_version, workout_id: workout.workout_id, confirm: true })
    expect(deleted.ok).toBe(true)
  })

  it('covers settings, calendar overrides, custom exercises and workout corrections', () => {
    let version = tools.getProfileState.handler({}).state_version
    version = tools.updateProfileSettings.handler({ expected_version: version, settings: { rest_seconds: 120, effort_scale: 'rir', accent: 'sky' } }).state_version
    expect(tools.getProfileSettings.handler({}).settings).toMatchObject({ rest_seconds: 120, effort_scale: 'rir', accent: 'sky' })
    const custom = tools.upsertCustomExercise.handler({ expected_version: version, name: 'Sled march', body_part: 'cardio', description: 'Controlled pace' })
    version = custom.state_version
    const routine = tools.upsertRoutine.handler({
      expected_version: version, name: 'Conditioning', progression: 'off',
      exercises: [{ exercise_id: custom.exercise_id, sets: 4, minutes: 2, speed: 6 }]
    })
    version = routine.state_version
    version = tools.setDayOverride.handler({ expected_version: version, date: '2026-08-21', routine_id: routine.routine_id }).state_version
    const logged = tools.logWorkout.handler({ expected_version: version, date: '2026-08-21', routine_id: routine.routine_id, name: 'Conditioning', duration_minutes: 30, entries: [{ exercise_id: custom.exercise_id, sets: [{ minutes: 2, speed: 6, effort_scale: 'rir', effort: 2 }] }] })
    const updated = tools.updateWorkout.handler({ expected_version: logged.state_version, workout_id: logged.workout_id, date: '2026-08-21', routine_id: routine.routine_id, name: 'Conditioning corrected', duration_minutes: 32, entries: [{ exercise_id: custom.exercise_id, sets: [{ minutes: 3, speed: 6 }] }] })
    expect(updated.ok).toBe(true)
    const saved = JSON.parse(fs.readFileSync(path.join(root, `state-${uid}.json`)))
    expect(saved.dayPlan['2026-08-21']).toBe(routine.routine_id)
    expect(saved.workouts.find(workout => workout.id === logged.workout_id).name).toBe('Conditioning corrected')
  })
})
