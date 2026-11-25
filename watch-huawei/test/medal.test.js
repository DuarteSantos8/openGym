// The medal's rules, ported case for case from Wear OS MedalTest.kt (the Apple Watch's MedalTests.swift is the twin).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as M from '../entry/src/main/js/MainAbility/common/medal.js'

test('one notch per set up to 48, the first at 12 o\'clock', () => {
  const a = M.notchAngles(16)
  assert.equal(a.length, 16)
  assert.equal(a[0], -90)
  assert.equal(a[1] - a[0], 22.5)
  assert.deepEqual(M.notchAngles(0), [])
  assert.deepEqual(M.notchAngles(-3), [])
  assert.equal(M.notchAngles(120).length, 48)
  assert.deepEqual(M.notchAngles(NaN), [])
})

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

test('the entrance haptics: a strike and a settle on a plain day; a strike and up to three rising taps on a records day', () => {
  const plain = M.beats(0)
  assert.deepEqual(plain.map(b => b[1]), ['strike', 'settled'])
  assert.deepEqual(plain.map(b => b[0]), [0.3, 1.15])
  for (let n = 1; n <= 9; n++) {
    const b = M.beats(n)
    assert.equal(b[0][1], 'strike')
    assert.equal(b.length, 1 + Math.min(n, 3))
    for (let i = 1; i < b.length; i++) assert.ok(b[i][0] - b[i - 1][0] >= 0.35 - 1e-9)
  }
  assert.equal(M.gemTimes(9).length, 7)
  assert.ok(M.entranceEnds(2) > M.gemTimes(7)[6] + 0.5)
})

test('the medal size per watch, and how small it ends', () => {
  assert.ok(Math.abs(M.diameter(192, 192) - 149.76) < 0.01)
  assert.ok(Math.abs(M.diameter(227, 227) - 177.06) < 0.01)
  assert.equal(M.diameter(100, 251), 76)
  assert.equal(M.endScale(0), 0.6)
  assert.equal(M.endScale(2), 0.46)
})

const sum = extra => Object.assign({ name: 'Push', unit: 'kg', dur: 52 * 60 + 13, sets: 16, vol: 5180.4, ended: false, hr: [128, 161], recs: [] }, extra || {})
const rec = (name, kind) => [name, kind || 'w', 100, 105, 'kg']

test('a medal with no records: steel, notches, the set count, the volume under the time', () => {
  const m = M.medalOf(sum(), { comma: false, repsWord: 'reps' })
  assert.equal(m.gold, false)
  assert.deepEqual([m.time, m.hours, m.timeLabel], ['52', false, 'min_minutes'])
  assert.equal(m.notches.length, 16)
  assert.deepEqual(m.gems.angles, [])
  assert.deepEqual(m.legend, { key: 'n_sets', count: 16 })
  assert.deepEqual(m.plates, [])
  assert.equal(m.more, 0)
  assert.equal(m.volume, '5180')
  assert.equal(m.unit, 'kg')
  assert.equal(m.sets, 16)
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

test('a medal still reads with parts missing: no duration shows the sets, no recs is a plain day, no heart rate', () => {
  const m = M.medalOf({ name: 'x', unit: 'lb', sets: 3 }, {})
  assert.deepEqual([m.gold, m.time, m.timeLabel, m.sets, m.volume, m.more], [false, '3', 'sets', 3, '0', 0])
  assert.equal(m.hrLine, null)
  const h = M.medalOf(sum(), {})
  assert.deepEqual(h.hrLine, { avg: 128, max: 161 })
  assert.equal(M.medalOf(sum({ hr: null }), {}).hrLine, null)
  assert.equal(M.medalOf(sum({ dur: 65 * 60 }), {}).time, '1:05')
  assert.equal(M.medalOf(sum({ dur: 65 * 60 }), {}).timeLabel, 'hours')
})
