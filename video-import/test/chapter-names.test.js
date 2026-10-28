import { test } from 'node:test'
import assert from 'node:assert/strict'
import { exerciseLike, enrichFromChapters } from '../src/chapter-names.js'

const chapter = (text, start, dur) => ({ kind: 'work', key: text.toLowerCase(), text, start, dur })
const row = (name, occurrences, extra = {}) => ({ id: 'v1', name, key: name.toLowerCase(), conf: name ? 0.8 : 0, occurrences, ...extra })
const draft = rows => ({ sections: [{ kind: 'interval', rows }] })

test('a chapter title that reads like an exercise is one; a song, a talk or a section is not', () => {
  for (const t of ['Hip Thrusts', 'Step Up (Right + Left)', 'Chest Press (Right)', 'Heel Elevated Squats', 'Alt Skull Crusher with Triceps Press']) assert.ok(exerciseLike(t), t)
  for (const t of ['HUGEL - Better.', 'Joe Stone, Camden Cox - Mind Control.', 'Why perceived effort fools you without data', '', 'Subscribe to the channel and ring the bell for more']) assert.ok(!exerciseLike(t), t)
})

test('an unnamed row takes the name of the chapter it runs in', () => {
  const d = draft([row('', [{ start: 340, dur: 30 }]), row('Burpees', [{ start: 400, dur: 40 }])])
  const n = enrichFromChapters(d, [chapter('Alt Shoulder Press', 338, 66), chapter('Burpees', 398, 50)])
  assert.equal(n, 1)
  const [a, b] = d.sections[0].rows
  assert.equal(a.name, 'Alt Shoulder Press')
  assert.equal(a.key, 'alt shoulder press')
  assert.ok(a.conf >= 0.5 && a.fromChapter)
  assert.equal(b.name, 'Burpees', 'a row that was read is left alone')
  assert.ok(!b.fromChapter)
})

test('a chapter that is not an exercise names nothing', () => {
  const d = draft([row('', [{ start: 10, dur: 40 }])])
  assert.equal(enrichFromChapters(d, [chapter('HUGEL - Better.', 0, 172)]), 0)
  assert.equal(d.sections[0].rows[0].name, '')
})

test('a row has to run mostly inside the chapter, not just touch it', () => {
  const d = draft([row('', [{ start: 95, dur: 40 }])])
  assert.equal(enrichFromChapters(d, [chapter('Wall Sit', 0, 100)]), 0)   // 5 of its 40 seconds
  assert.equal(enrichFromChapters(d, [chapter('Wall Sit', 90, 60)]), 1)
})

test('a name read with little confidence that looks like the chapter becomes the chapter\'s', () => {
  const d = draft([row('Hip Thrus', [{ start: 240, dur: 50 }], { conf: 0.35 })])
  assert.equal(enrichFromChapters(d, [chapter('Hip Thrusts', 235, 60)]), 1)
  assert.equal(d.sections[0].rows[0].name, 'Hip Thrusts')
  // A confident reading is not overruled, and a doubtful one that looks nothing like it stays.
  const keep = draft([row('Hip Thrusts', [{ start: 240, dur: 50 }], { conf: 0.9 }), row('Wall Sit', [{ start: 300, dur: 50 }], { conf: 0.3 })])
  assert.equal(enrichFromChapters(keep, [chapter('Step Ups', 235, 130)]), 0)
})

test('no chapters, an empty draft, or rows without times change nothing', () => {
  assert.equal(enrichFromChapters(draft([row('', [{ start: 1, dur: 5 }])]), []), 0)
  assert.equal(enrichFromChapters({ sections: [] }, [chapter('Burpees', 0, 40)]), 0)
  assert.equal(enrichFromChapters(draft([row('', [])]), [chapter('Burpees', 0, 40)]), 0)
  assert.equal(enrichFromChapters(null, [chapter('Burpees', 0, 40)]), 0)
})
