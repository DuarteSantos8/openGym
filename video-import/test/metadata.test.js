import { test } from 'node:test'
import assert from 'node:assert/strict'
import { metadataDraft, descriptionChapters, sourceOf } from '../src/metadata.js'
import { classify } from '../src/classify.js'
import { canonicalYouTube } from '../src/url.js'

const chapters = list => list.map(([s, e, title]) => ({ start_time: s, end_time: e, title }))

test('chapters that name every exercise are a usable draft', () => {
  const list = [[0, 10, 'Intro'], [10, 70, 'Warm Up'], [70, 110, '1. Burpees'], [110, 130, 'Rest'], [130, 170, '2. Mountain Climbers'], [170, 190, 'Rest'],
    [190, 230, '3. Jump Squats'], [230, 250, 'Rest'], [250, 290, 'Burpees'], [290, 310, 'Rest'], [310, 350, 'Mountain Climbers'], [350, 370, 'Rest'],
    [370, 410, 'Jump Squats'], [410, 470, 'Cool down'], [470, 480, 'Subscribe!']]
  const m = metadataDraft({ duration: 480, chapters: chapters(list) })
  assert.equal(m.usable, true); assert.equal(m.source, 'chapters')
  assert.deepEqual(m.hints.map(h => h.kind), ['warmup', 'stretch'])
  assert.ok(!m.blocks.some(b => /intro|subscribe/.test(b.key)))
  const d = classify(m.blocks, { hints: m.hints })
  const iv = d.sections.find(s => s.kind === 'interval')
  assert.deepEqual(iv.rows.map(r => [r.key, r.sec, r.rest, r.rounds]), [['burpees', 40, 20, 2], ['mountain climbers', 40, 20, 2], ['jump squats', 40, 20, 2]])
})

test('chapters that only say "Round 1, Round 2" are not usable', () => {
  const m = metadataDraft({ duration: 600, chapters: chapters([[0, 60, 'Warm up'], [60, 300, 'Round 1'], [300, 540, 'Round 2'], [540, 600, 'Cool down']]) })
  assert.equal(m.usable, false)
  assert.equal(m.hints.length, 2)
})

test('timestamps in the description stand in for missing chapters', () => {
  const description = 'My favourite workout!\n\n0:00 Warm up\n1:00 Jumping Jacks\n1:45 Burpees (40s)\n2:25 Plank - 40 sec\n3:05 Cool down\nFollow me on insta'
  assert.deepEqual(descriptionChapters(description, 240).map(c => [c.start, c.end, c.title]), [
    [0, 60, 'Warm up'], [60, 105, 'Jumping Jacks'], [105, 145, 'Burpees (40s)'], [145, 185, 'Plank - 40 sec'], [185, 240, 'Cool down']
  ])
  const m = metadataDraft({ duration: 240, description })
  assert.equal(m.source, 'description'); assert.equal(m.usable, true)
  assert.deepEqual(m.blocks.map(b => b.key), ['jumping jacks', 'burpees', 'plank'])
})

test('no chapters and no timestamps is not usable', () => {
  assert.equal(metadataDraft({ duration: 900, description: 'Great workout' }).usable, false)
  assert.equal(metadataDraft(null).usable, false)
})

test('sourceOf keeps only what the result needs', () => {
  const s = sourceOf({ id: 'abcdefghijk', title: 'HIIT', channel: 'Coach', channel_id: 'UC123', duration: 600, formats: [1, 2, 3], description: 'x' }, 'https://www.youtube.com/watch?v=abcdefghijk')
  assert.deepEqual(Object.keys(s).sort(), ['channel', 'channelId', 'duration', 'height', 'id', 'title', 'url', 'width'])
})

test('only YouTube video links pass, in canonical form', () => {
  const ok = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
  for (const u of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123&t=30', 'https://youtu.be/dQw4w9WgXcQ?si=x', 'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com/shorts/dQw4w9WgXcQ', 'https://www.youtube.com/live/dQw4w9WgXcQ', 'http://youtube.com/embed/dQw4w9WgXcQ']) {
    assert.deepEqual(canonicalYouTube(u), { id: 'dQw4w9WgXcQ', url: ok }, u)
  }
  for (const u of ['https://vimeo.com/123', 'https://www.youtube.com/playlist?list=PL123', 'https://evil.com/watch?v=dQw4w9WgXcQ', 'https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ',
    'file:///etc/passwd', '--exec=rm', 'https://www.youtube.com/watch?v=short', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ;ls', '', null]) {
    assert.equal(canonicalYouTube(u), null, String(u))
  }
})

test('chapters that are the parts of a video, not its exercises, are not a draft (a real video, B7-F2UcHmqk)', () => {
  const list = [[0, 80, 'Introduction and warm-up'], [80, 282, 'Mobility warm-up'], [282, 922, 'Group 1: Lower body'], [922, 1521, 'Group 2: Lower body'],
    [1521, 2161, 'Group 3: Upper body'], [2161, 2801, 'Group 4: Upper body'], [2801, 3448, 'Group 5: Core workout'], [3448, 3697, 'Cool down and conclusion']]
  const m = metadataDraft({ duration: 3697, chapters: chapters(list) })
  assert.equal(m.usable, false)
  assert.deepEqual(m.hints.map(h => h.kind), ['warmup', 'warmup', 'stretch'], 'the warm-up and cool-down still say where those sections are')
  assert.ok(!m.blocks.some(b => /group/.test(b.key)))
})

test('long chapters are parts even without a "Group N" title', () => {
  const m = metadataDraft({ duration: 2400, chapters: chapters([[0, 600, 'Legs'], [600, 1200, 'Arms'], [1200, 1800, 'Back'], [1800, 2400, 'Abs']]) })
  assert.equal(m.usable, false); assert.equal(m.why, 'long')
})
