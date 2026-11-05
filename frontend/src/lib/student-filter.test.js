import { describe, it, expect } from 'vitest'
import { filterStudents, filterCounts, quietDays, hubSummary } from './student-filter.js'

const now = Date.parse('2026-11-03T12:00:00Z')
const ago = d => now - d * 86400000
const users = [
  { id: 'me', name: 'Teacher', admin: true, lastSync: ago(0) },
  { id: 'a', name: 'João Silva', email: 'joao@x.com', teacher: 'me', lastSync: ago(1), live: { name: 'Push' }, routines: 3 },
  { id: 'b', name: 'Maria', teacher: 'me', lastSync: ago(12), routines: 0, pending: 1 },
  { id: 'c', name: 'Carlos', teacher: 'other', lastSync: ago(3) },
  { id: 'd', name: 'Ana', teacher: 'me', lastSync: null, routines: 0 },
  { id: 'e', name: 'Off', teacher: 'me', disabled: true, lastSync: ago(30) }
]
const ids = r => r.map(u => u.id)

describe('filterStudents', () => {
  it('finds by name or e-mail, ignoring case and accents', () => {
    expect(ids(filterStudents(users, { query: 'joao', now }))).toEqual(['a'])
    expect(ids(filterStudents(users, { query: 'JOÃO', now }))).toEqual(['a'])
    expect(ids(filterStudents(users, { query: 'x.com', now }))).toEqual(['a'])
    expect(filterStudents(users, { query: 'zzz', now })).toEqual([])
  })
  it('keeps only who is training now', () => {
    expect(ids(filterStudents(users, { filter: 'live', now }))).toEqual(['a'])
  })
  it('lists who went quiet, never-synced included, disabled profiles left out', () => {
    expect(ids(filterStudents(users, { filter: 'quiet', sort: 'quiet', now }))).toEqual(['d', 'b'])
  })
  it('lists my students, not me', () => {
    expect(ids(filterStudents(users, { filter: 'mine', me: 'me', sort: 'name', now }))).toEqual(['d', 'a', 'b', 'e'])
  })
  it('sorts by latest sync, by name, and by longest away', () => {
    expect(ids(filterStudents(users, { sort: 'recent', now }))).toEqual(['me', 'a', 'c', 'b', 'e', 'd'])
    expect(filterStudents(users, { sort: 'name', now })[0].name).toBe('Ana')
    expect(ids(filterStudents(users, { sort: 'quiet', now }))[0]).toBe('d')
  })
  it('does not reorder the caller\'s list', () => {
    const copy = users.slice()
    filterStudents(users, { sort: 'name', now })
    expect(users).toEqual(copy)
  })
})

describe('filterCounts / quietDays', () => {
  it('counts each filter for the chips', () => {
    expect(filterCounts(users, 'me', now)).toEqual({ all: 6, live: 1, quiet: 2, mine: 4, noplan: 1, disabled: 1 })
  })
  it('counts whole days since the last sync', () => {
    expect(quietDays({ lastSync: ago(12) }, now)).toBe(12)
    expect(quietDays({ lastSync: null }, now)).toBeNull()
  })
})

describe('noplan and hubSummary', () => {
  it('lists who has no plan and none on its way', () => {
    expect(ids(filterStudents(users, { filter: 'noplan', now }))).toEqual(['d'])
  })
  it('sums up the teacher\'s students without counting admins or the teacher', () => {
    expect(hubSummary(users, 'me', now)).toEqual({ students: 5, live: 1, quiet: 2, noplan: 1, pending: 1 })
  })
})
