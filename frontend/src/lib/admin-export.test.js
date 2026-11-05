import { describe, it, expect } from 'vitest'
import { workoutExport, everyoneExport, fileSlug } from './admin-export.js'

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
