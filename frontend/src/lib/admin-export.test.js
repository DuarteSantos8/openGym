import { describe, it, expect } from 'vitest'
import { workoutExport, everyoneExport, planExport, fileSlug } from './admin-export.js'
import { parsePlan } from './plan-share.js'

const now = Date.parse('2026-11-05T12:00:00Z')
const wk = (id, d, w = 50) => ({ id, d, name: 'Push ' + id, start: Date.parse(d + 'T10:00:00Z'), end: Date.parse(d + 'T11:00:00Z'), media: ['x'], entries: [{ id: '0001', sets: [{ w, r: 8, done: true }] }] })
const doc = { user: { id: 'u1', name: 'João Silva' }, unit: 'kg', workouts: [wk('a', '2026-10-01'), wk('b', '2026-10-02', 60)] }

describe('workoutExport', () => {
  it('writes the chosen workouts as the app\'s own CSV, one row per set', () => {
    const f = workoutExport(doc, ['b'], 'csv', now)
    expect(f.name).toBe('workouts-joao-silva-2026-11-05.csv')
    const lines = f.text.replace(/^﻿/, '').trim().split('\r\n')
    expect(lines[0].startsWith('date,start_time')).toBe(true)
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain('Push b')
    expect(lines[1]).toContain(',60,')
  })
  it('writes everything when no ids are given, oldest first', () => {
    const lines = workoutExport(doc, null, 'csv', now).text.trim().split('\r\n')
    expect(lines).toHaveLength(3)
    expect(lines[1]).toContain('Push a')
  })
  it('writes JSON without the photo and video references', () => {
    const f = workoutExport(doc, ['a'], 'json', now)
    const j = JSON.parse(f.text)
    expect(f.mime).toBe('application/json')
    expect(j.user).toEqual({ id: 'u1', name: 'João Silva' })
    expect(j.workouts).toHaveLength(1)
    expect(j.workouts[0].media).toBeUndefined()
  })
  it('skips shapeless entries instead of throwing', () => {
    const f = workoutExport({ user: { name: 'x' }, workouts: [null, { id: 'z', d: '2026-10-01' }, wk('a', '2026-10-01')] }, null, 'csv', now)
    expect(f.text.trim().split('\r\n')).toHaveLength(2)
  })
})

describe('everyoneExport', () => {
  const other = { user: { id: 'u2', name: 'Ana' }, unit: 'lb', workouts: [wk('c', '2026-10-03', 100)] }
  it('prefixes every row with who it belongs to', () => {
    const f = everyoneExport([doc, other], 'csv', now)
    const lines = f.text.replace(/^﻿/, '').trim().split('\r\n')
    expect(lines[0].startsWith('user,date')).toBe(true)
    expect(lines).toHaveLength(4)
    expect(lines.slice(1).map(l => l.split(',')[0]).sort()).toEqual(['Ana', 'João Silva', 'João Silva'])
    expect(f.name).toBe('workouts-everyone-2026-11-05.csv')
  })
  it('keeps each person\'s unit in JSON', () => {
    const j = JSON.parse(everyoneExport([doc, other], 'json', now).text)
    expect(j.users.map(u => [u.name, u.unit, u.workouts.length])).toEqual([['João Silva', 'kg', 2], ['Ana', 'lb', 1]])
  })
})

describe('fileSlug', () => {
  it('is safe in a file name', () => {
    expect(fileSlug('João / Silva?')).toBe('joao-silva')
    expect(fileSlug('')).toBe('user')
  })
})

describe('planExport: the file another student (or another Plan tab) can import', () => {
  const ficha = (id, name, exId) => ({ id, name, emoji: '', ex: [{ id: exId, sets: 3, reps: 10, weight: 20 }] })
  const plans = { user: { id: 'u1', name: 'Karine' }, unit: 'kg', customEx: [], routines: [ficha('r1', 'TREINO A', '0001'), ficha('r2', 'TREINO B', '0002')], week: { 1: ['r1'], 3: ['r2'], 5: ['r1', 'r2'] } }

  it('round-trips through the plan importer, all plans with their weekdays', () => {
    const f = planExport(plans, null, now)
    expect(f.name).toBe('plan-karine-2026-11-05.json')
    expect(f.routines).toBe(2)
    const p = parsePlan(f.text, 'kg')
    expect([p.routineCount, p.exerciseCount, p.scheduledDays, p.dropped]).toEqual([2, 2, 3, 0])
    expect(p.routines.map(r => r.name)).toEqual(['TREINO A', 'TREINO B'])
  })
  it('exports one plan alone, with only its own weekdays', () => {
    const f = planExport(plans, ['r1'], now)
    expect(f.name).toBe('plan-treino-a-2026-11-05.json')
    const p = parsePlan(f.text, 'kg')
    expect(p.routineCount).toBe(1)
    expect(Object.keys(p.week).sort()).toEqual(['1', '5'])
    expect(p.week[5]).toEqual(['r1'])
  })
  it('carries the student\'s own exercise along when a plan uses it', () => {
    const d = { ...plans, customEx: [{ id: 'cx1', n: 'Cable fly', bp: 'chest' }, { id: 'cx2', n: 'Unused', bp: 'back' }], routines: [ficha('r1', 'A', 'cx1')], week: {} }
    const p = parsePlan(planExport(d, null, now).text, 'kg')
    expect(p.customEx.map(c => c.id)).toEqual(['cx1'])
    expect(p.dropped).toBe(0)
  })
  it('skips shapeless routines and survives an empty profile', () => {
    expect(planExport({ user: { name: 'x' }, routines: [null, { id: 'z' }] }, null, now).routines).toBe(0)
    expect(planExport({}, null, now).routines).toBe(0)
  })
})

describe('a workout history is not a plan, and the importer says so', () => {
  it('names what the file is instead of the blunt refusal', () => {
    const history = workoutExport(doc, null, 'json', now).text
    expect(() => parsePlan(history, 'kg')).toThrowError(/workout history, not a plan/)
    try { parsePlan(history, 'kg') } catch (e) { expect(e.code).toBe('not-plan') }
  })
  it('still refuses anything else the old way', () => {
    expect(() => parsePlan('{"hello":1}', 'kg')).toThrowError(/plan file/)
  })
})

describe('workoutExport rows', () => {
  it('counts the rows so the screen can say when a spreadsheet would be empty', () => {
    const empty = { ...doc, workouts: [{ id: 'e', d: '2026-11-04', name: 'Empty', start: 1, end: 2, entries: [] }] }
    expect(workoutExport(empty, null, 'csv', now).rows).toBe(0)
    expect(workoutExport(doc, null, 'csv', now).rows).toBe(2)
  })
})
