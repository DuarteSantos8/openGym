import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { validateBulkSelection, resolveBulkTargets, deleteTargets } from '../src/bulkDelete.js'

const hash = value => crypto.createHash('sha256').update(value).digest('base64url')
const TODAY = '2026-10-23'
const today = () => TODAY
const SEL = /^Error: invalid_bulk_selection$/
const CONF = /^Error: invalid_confirmation$/
const profile = () => ({
  routines: [
    { id: 'r1', name: 'Squats', ex: [{ id: 'squat' }], media: ['/media/a.gif'] },
    { id: 'r2', name: 'Bench', ex: [] },
    { id: 'r3', name: 'Deadlift', ex: [] },
  ],
  workouts: [
    { id: 'w1', name: 'Monday', d: '2026-10-19', entries: [], media: [{ url: '/media/p.webp', bytes: 10, hash: 'h1' }] },
    { id: 'w2', name: 'Tuesday', d: '2026-10-20', entries: [] },
    { id: 'w3', name: 'Wednesday', d: '2026-10-21', entries: [], media: [{ url: '/media/q.webp' }, { url: '/media/r.webp' }] },
    { id: 'w4', name: 'NoDate' },
    { id: 'w5', name: 'Thursday', d: '2026-10-22', entries: [] },
  ],
  week: { mon: ['r1', 'r2'], tue: ['r3'] },
  dayPlan: { '2026-10-19': 'r1', '2026-10-20': 'r2' },
  unit: 'kg',
})

test('validate: rejects empty, 26, duplicates, mixed, unknown kind, bad or future dates, malformed ids', () => {
  for (const sel of [
    undefined, null, [], 'workouts',
    { kind: 'workouts', ids: [] },
    { kind: 'workouts', ids: ['w1', 'w1'] },
    { kind: 'workouts', ids: ['w1'], before: '2026-10-01' },
    { kind: 'routines', before: '2026-10-01' },
    { kind: 'exercises', ids: ['w1'] },
    { kind: 'workouts', ids: ['w1'], extra: 1 },
    { kind: 'workouts' },
    { kind: 'workouts', before: '2026-13-01' },
    { kind: 'workouts', before: '2026-02-30' },
    { kind: 'workouts', before: '2025-02-29' },
    { kind: 'workouts', before: '20261023' },
    { kind: 'workouts', before: '2026-10-24' },
    { kind: 'workouts', before: 20261001 },
    { kind: 'routines', ids: ['r1', 5] },
    { kind: 'routines', ids: ['r1', ''] },
    { kind: 'routines', ids: ['r1', 'x'.repeat(201)] },
  ]) assert.throws(() => validateBulkSelection(sel, { today }), SEL, JSON.stringify(sel))
  assert.throws(() => validateBulkSelection({ kind: 'workouts', ids: Array.from({ length: 26 }, (_, i) => `w${i}`) }, { today }), /^Error: too many targets; narrow the request$/)
  const many = { ...profile(), workouts: Array.from({ length: 26 }, (_, i) => ({ id: `w${i}`, name: 'x', d: '2026-01-01' })) }
  assert.throws(() => resolveBulkTargets(many, { kind: 'workouts', before: TODAY }), /^Error: too many targets; narrow the request$/)
})

test('validate: accepts explicit ids and a past or today date, returning a fresh copy', () => {
  const ids = ['r1', 'r2']
  const out = validateBulkSelection({ kind: 'routines', ids }, { today })
  assert.deepEqual(out, { kind: 'routines', ids: ['r1', 'r2'] })
  assert.notEqual(out.ids, ids)
  assert.deepEqual(validateBulkSelection({ kind: 'workouts', before: TODAY }, { today }), { kind: 'workouts', before: TODAY })
  assert.deepEqual(validateBulkSelection({ kind: 'workouts', before: '2024-02-29' }, { today }), { kind: 'workouts', before: '2024-02-29' })
})

test('resolve: explicit ids keep their order, digest each whole record, and reject unknown ids', () => {
  const p = profile()
  const { ids, digests, summary } = resolveBulkTargets(p, { kind: 'routines', ids: ['r2', 'r1'] })
  assert.deepEqual(ids, ['r2', 'r1'])
  assert.deepEqual(digests, { r2: hash(JSON.stringify(p.routines[1])), r1: hash(JSON.stringify(p.routines[0])) })
  assert.deepEqual(summary, { rows: [{ id: 'r2', name: 'Bench' }, { id: 'r1', name: 'Squats' }], total: 2, affected: 2, mediaCount: 1 })
  assert.throws(() => resolveBulkTargets(p, { kind: 'workouts', ids: ['w1', 'nope'] }), SEL)
  assert.throws(() => resolveBulkTargets(p, { kind: 'routines', ids: ['w1'] }), SEL)
})

test('resolve: before selects workouts strictly older than the date, in profile order', () => {
  const p = profile()
  p.workouts.push({ id: 'w6', name: 'Blank', d: '' }, { id: 'w7', name: 'Odd', d: '19/10/2026' })
  const { ids, summary } = resolveBulkTargets(p, { kind: 'workouts', before: '2026-10-21' })
  assert.deepEqual(ids, ['w1', 'w2'])
  assert.deepEqual(summary, { rows: [{ id: 'w1', name: 'Monday', date: '2026-10-19' }, { id: 'w2', name: 'Tuesday', date: '2026-10-20' }], total: 2, affected: 2, mediaCount: 1 })
})

test('resolve: zero matches refuses; 26 matches asks to narrow instead of truncating', () => {
  assert.throws(() => resolveBulkTargets(profile(), { kind: 'workouts', before: '2020-01-01' }), SEL)
  const many = { ...profile(), workouts: Array.from({ length: 26 }, (_, i) => ({ id: `w${i}`, name: 'x', d: '2026-01-01' })) }
  assert.throws(() => resolveBulkTargets(many, { kind: 'workouts', before: TODAY }), /^Error: too many targets; narrow the request$/)
  many.workouts.pop()
  assert.equal(resolveBulkTargets(many, { kind: 'workouts', before: TODAY }).summary.total, 25)
})

test('resolve: a matching record without a usable id, or with a duplicated id, refuses the whole set', () => {
  const noId = profile(); noId.workouts.push({ name: 'ghost', d: '2026-10-01' })
  assert.throws(() => resolveBulkTargets(noId, { kind: 'workouts', before: '2026-10-21' }), SEL)
  const dup = profile(); dup.workouts.push({ id: 'w1', name: 'twin', d: '2026-10-30' })
  assert.throws(() => resolveBulkTargets(dup, { kind: 'workouts', before: '2026-10-21' }), SEL)
  assert.throws(() => resolveBulkTargets(dup, { kind: 'workouts', ids: ['w1'] }), SEL)
})

test('summary carries only rows, counts and a media count: no paths, bytes or hashes', () => {
  const { summary } = resolveBulkTargets(profile(), { kind: 'workouts', ids: ['w1', 'w3'] })
  assert.equal(summary.mediaCount, 3)
  assert.doesNotMatch(JSON.stringify(summary), /\/media\/|webp|bytes|"hash"|h1|url/)
  assert.deepEqual(Object.keys(summary), ['rows', 'total', 'affected', 'mediaCount'])
})

test('deleteTargets removes routines, cleans week/dayPlan, and preserves everything else', () => {
  const p = profile()
  const { ids, digests } = resolveBulkTargets(p, { kind: 'routines', ids: ['r1', 'r3'] })
  const next = deleteTargets(structuredClone(p), 'routines', ids, digests)
  assert.deepEqual(next.routines.map(r => r.id), ['r2'])
  assert.deepEqual(next.week, { mon: ['r2'] })
  assert.deepEqual(next.dayPlan, { '2026-10-20': 'r2' })
  assert.deepEqual(next.workouts, p.workouts)
  assert.equal(next.unit, 'kg')
})

test('deleteTargets removes workouts and leaves routines and plan untouched', () => {
  const p = profile()
  const { ids, digests } = resolveBulkTargets(p, { kind: 'workouts', ids: ['w1', 'w4'] })
  const next = deleteTargets(structuredClone(p), 'workouts', ids, digests)
  assert.deepEqual(next.workouts.map(w => w.id), ['w2', 'w3', 'w5'])
  assert.deepEqual([next.routines, next.week, next.dayPlan], [p.routines, p.week, p.dayPlan])
})

test('deleteTargets refuses on any drifted or missing target, deleting nothing', () => {
  const p = profile()
  const { ids, digests } = resolveBulkTargets(p, { kind: 'workouts', ids: ['w1', 'w2'] })
  const changed = structuredClone(p); changed.workouts[1].name = 'Edited'
  assert.throws(() => deleteTargets(changed, 'workouts', ids, digests), CONF)
  assert.equal(changed.workouts.length, 5)
  const dropped = structuredClone(p); dropped.workouts.splice(1, 1)
  assert.throws(() => deleteTargets(dropped, 'workouts', ids, digests), CONF)
  assert.throws(() => deleteTargets(structuredClone(p), 'workouts', ['w1', 'w3'], digests), CONF)
})
