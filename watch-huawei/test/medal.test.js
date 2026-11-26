// The medal's rules, ported case for case from Wear OS MedalTest.kt (the Apple Watch's MedalTests.swift is the twin).
// The notches, the entrance haptics and the medal size are not ported: the watch draws none of them.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as M from '../entry/src/main/js/MainAbility/common/medal.js'

test('one diamond per record, 7 at most, centred under the time; smaller and closer past 5', () => {
  const two = M.gems(2)
  assert.deepEqual(two.angles, [76.5, 103.5])
  assert.equal(two.radius, 8.6)
  assert.deepEqual(M.gems(1).angles, [90])
  const six = M.gems(6)
  assert.equal(six.radius, 7)
  assert.equal(six.angles[1] - six.angles[0], 21)
  assert.equal(M.gems(12).angles.length, 7)
  assert.deepEqual(M.gems(0).angles, [])
})

test('the time on the face: minutes under an hour, else h:mm; 59:40 rounds to the hour; NaN is 0; a hold\'s clock', () => {
  assert.deepEqual(M.time(52 * 60 + 13), ['52', false])
  assert.deepEqual(M.time(65 * 60), ['1:05', true])
  assert.deepEqual(M.time(59 * 60 + 40), ['1:00', true])
  assert.deepEqual(M.time(NaN), ['0', false])
  assert.deepEqual(M.time(-30), ['0', false])
  assert.equal(M.clock(75), '1:15')
  assert.equal(M.clock(NaN), '0:00')
  assert.equal(M.clock(-4), '0:00')
})

test('numbers: at most two decimals, a comma for the languages that write one', () => {
  assert.equal(M.number(1.234, false), '1.23')
  assert.equal(M.number(62.5, true), '62,5')
  assert.equal(M.number(60, true), '60')
  assert.equal(M.number(NaN, false), '0')
  assert.equal(M.number(0.005, false), '0.01')
  assert.equal(M.usesComma('de'), true)
  assert.equal(M.usesComma('pt-BR'), true)
  assert.equal(M.usesComma('en'), false)
  assert.equal(M.usesComma('zh'), false)
  assert.equal(M.usesComma(undefined), false)
})

test('record texts: weights and reps by number, a hold by its clock', () => {
  assert.deepEqual(M.recordTexts(['B', 'w', 60, 62.5, 'kg'], true), ['60', '62,5'])
  assert.deepEqual(M.recordTexts(['P', 'h', 45, 75, 'kg'], true), ['0:45', '1:15'])
  assert.deepEqual(M.recordTexts(['R', 'r', 8, 10, 'kg'], false), ['8', '10'])
})

test('a record plate: name, old and new, then the unit: the word reps for reps, none for a hold, the unit for a weight', () => {
  assert.deepEqual(M.plate(['Bench', 'w', 100, 105, 'kg'], false, 'reps'), { name: 'Bench', old: '100', now: '105', unit: 'kg', kind: 'w' })
  assert.equal(M.plate(['Row', 'r', 8, 10, 'kg'], false, 'reps').unit, 'reps')
  assert.equal(M.plate(['Plank', 'h', 60, 75, 'kg'], false, 'reps').unit, '')
  assert.equal(M.plate(['Curl', 'w', 30, 35, 'lb'], false, 'reps').unit, 'lb')
})

test('the legend: the set count with no record, "New record" for one, "k Records" for more; the time label', () => {
  assert.deepEqual(M.legend(0), { key: 'n_sets', count: 0 })
  assert.deepEqual(M.legend(1), { key: 'new_record', count: 1 })
  assert.deepEqual(M.legend(3), { key: 'records', count: 3 })
  assert.equal(M.timeLabel(52 * 60), 'min_minutes')
  assert.equal(M.timeLabel(65 * 60), 'hours')
  assert.equal(M.timeLabel(59 * 60 + 40), 'hours')
  assert.equal(M.timeLabel(null), 'sets')
  assert.equal(M.timeLabel(undefined), 'sets')
})

const sum = extra => Object.assign({ name: 'Push', unit: 'kg', dur: 52 * 60 + 13, sets: 16, vol: 5180.4, ended: false, hr: [128, 161], recs: [] }, extra || {})
const rec = (name, kind) => [name, kind || 'w', 100, 105, 'kg']

test('a medal with no records: steel, the set count, the volume under the time', () => {
  const m = M.medalOf(sum(), { comma: false, repsWord: 'reps' })
  assert.equal(m.gold, false)
  assert.deepEqual([m.time, m.timeLabel], ['52', 'min_minutes'])
  assert.deepEqual(m.gems.angles, [])
  assert.deepEqual(m.legend, { key: 'n_sets', count: 16 })
  assert.deepEqual(m.plates, [])
  assert.equal(m.more, 0)
  assert.equal(m.volume, '5180')
  assert.equal(m.unit, 'kg')
})

test('a records day: gold, a diamond each, the legend, up to 4 plates and "N more"', () => {
  const recs = [rec('A'), rec('B'), rec('C', 'r'), rec('D', 'h'), rec('E'), rec('F')]
  const m = M.medalOf(sum({ recs: recs }), { comma: true, repsWord: 'reps' })
  assert.equal(m.gold, true)
  assert.equal(m.gems.angles.length, 6)
  assert.deepEqual(m.legend, { key: 'records', count: 6 })
  assert.deepEqual(m.plates.map(p => p.name), ['A', 'B', 'C', 'D'])
  assert.equal(m.more, 2)
  assert.equal(m.plates[2].unit, 'reps')
  assert.equal(m.plates[3].unit, '')
  assert.deepEqual(M.medalOf(sum({ recs: [rec('A')] }), {}).legend, { key: 'new_record', count: 1 })
  assert.equal(M.medalOf(sum({ recs: recs.slice(0, 4) }), {}).more, 0)
  assert.equal(M.medalOf(sum({ recs: recs }), { maxPlates: 3 }).more, 3)
})

test('a medal still reads with parts missing: no duration shows the sets, no recs is a plain day', () => {
  const m = M.medalOf({ name: 'x', unit: 'lb', sets: 3 }, {})
  assert.deepEqual([m.gold, m.time, m.timeLabel, m.volume, m.more], [false, '3', 'sets', '0', 0])
  assert.equal(M.medalOf(sum({ dur: 65 * 60 }), {}).time, '1:05')
  assert.equal(M.medalOf(sum({ dur: 65 * 60 }), {}).timeLabel, 'hours')
})
