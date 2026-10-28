/* End to end on a generated video: ffmpeg draws exercise names and a countdown onto a plain
   background (the way follow-along videos show them), and the real pipeline — crops, threshold,
   Tesseract, segmentation, sections — reads it back. Nothing here touches YouTube.

   Needs ffmpeg with drawtext (libfreetype), tesseract and a TTF font. The worker image has all
   three (the `test` target adds the font); elsewhere the test skips, unless REQUIRE_E2E=1 says
   that skipping would hide a broken image. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { run } from '../src/proc.js'
import { analyse, roiSetup } from '../src/pipeline.js'
import { similarity } from '../src/text.js'

const FONTS = ['/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/Library/Fonts/Arial Bold.ttf']

async function ready() {
  const font = FONTS.find(f => fs.existsSync(f))
  if (!font) return { why: 'no TTF font' }
  try {
    const { stdout } = await run('ffmpeg', ['-hide_banner', '-filters'])
    if (!/\bdrawtext\b/.test(stdout)) return { why: 'ffmpeg has no drawtext' }
    await run('tesseract', ['--version'])
  } catch { return { why: 'ffmpeg or tesseract missing' } }
  return { font }
}

// [caption, seconds]. 10 s of work and 5 s of rest keep the video at under three minutes.
const SCRIPT = [
  ['JUMPING JACKS', 15], ['ARM CIRCLES', 10],
  ...Array.from({ length: 3 }, () => [['BURPEES', 10], ['REST', 5], ['MOUNTAIN CLIMBERS', 10], ['REST', 5], ['JUMP SQUATS', 10], ['REST', 5]]).flat(),
  ['QUAD STRETCH LEFT', 15], ['QUAD STRETCH RIGHT', 15], ['CHILD POSE', 20]
]
SCRIPT.splice(SCRIPT.findIndex((s, i) => i > 2 && s[0] === 'QUAD STRETCH LEFT') - 1, 1)   // no rest before the stretch

const esc = s => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/:/g, '\\:')

async function makeVideo(file, font) {
  const filters = ['drawbox=x=0:y=270:w=iw:h=80:color=black@0.6:t=fill']
  let t = 0
  for (const [name, sec] of SCRIPT) {
    const a = t, b = t + sec
    const en = `enable='between(t,${a},${b - 0.001})'`
    filters.push(`drawtext=fontfile='${esc(font)}':text='${esc(name)}':fontsize=38:fontcolor=white:x=30:y=290:${en}`)
    filters.push(`drawtext=fontfile='${esc(font)}':text='0\\:%{eif\\:${b}-t+0.999\\:d\\:2}':fontsize=44:fontcolor=yellow:x=520:y=22:${en}`)
    t = b
  }
  // Something moving outside the boxes, so the crops are not the only thing changing.
  const src = `color=c=0x1d2b53:s=640x360:r=10:d=${t}`
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-f', 'lavfi', '-i', src,
    '-vf', `drawbox=x='mod(t*40,600)':y=120:w=40:h=40:color=orange:t=fill,${filters.join(',')}`,
    '-c:v', 'mpeg4', '-q:v', '3', '-an', file], { timeoutMs: 5 * 60000 })
  return t
}

const ROI = { name: { x: 0.03, y: 0.77, w: 0.75, h: 0.2 }, timer: { x: 0.78, y: 0.02, w: 0.2, h: 0.17 } }

test('a generated follow-along video reads back as warm-up, 3 rounds of intervals and a stretch', { timeout: 10 * 60000 }, async t => {
  const env = await ready()
  if (!env.font) {
    if (process.env.REQUIRE_E2E === '1') assert.fail('end-to-end prerequisites missing: ' + env.why)
    t.skip(env.why); return
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ogvi-e2e-'))
  try {
    const file = path.join(dir, 'video.mp4')
    const total = await makeVideo(file, env.font)

    const setup = await roiSetup(file, { workDir: dir })
    assert.equal(setup.samples.length, 3)
    assert.match(setup.samples[0].src, /^data:image\/jpeg;base64,/)
    if (setup.suggest.name) {
      const n = setup.suggest.name
      assert.ok(n.y < 0.95 && n.y + n.h > 0.8, 'the suggested name box covers the caption: ' + JSON.stringify(n))
    }

    // The countdown in the top right corner is found by its counting, not by a whole-frame read.
    assert.ok(setup.suggest.timer, 'a timer box is suggested')
    const tm = setup.suggest.timer
    assert.ok(tm.x + tm.w > 0.8 && tm.x < 0.95 && tm.y < 0.15, 'the suggested timer box covers the countdown: ' + JSON.stringify(tm))

    const stages = new Set()
    const out = await analyse(file, ROI, { workDir: dir, progress: s => stages.add(s) })
    assert.deepEqual([...stages], ['frames', 'ocr', 'thumbs'])
    assert.ok(Math.abs(out.stats.seconds - total) <= 1, `one frame per second (${out.stats.seconds} of ${total})`)
    assert.ok(out.stats.uniqueName < 30, `identical captions are read once (${out.stats.uniqueName} distinct)`)

    const d = out.draft
    assert.deepEqual(d.sections.map(s => s.kind), ['warmup', 'interval', 'stretch'], JSON.stringify(d.sections.map(s => [s.kind, s.rows.map(r => r.key)])))
    const near = (a, b) => similarity(a, b) >= 0.75
    const [warm, iv, stretch] = d.sections
    assert.ok(near(warm.rows[0].key, 'jumping jacks') && near(warm.rows[1].key, 'arm circles'), JSON.stringify(warm.rows.map(r => r.key)))
    assert.equal(iv.rounds, 3)
    assert.equal(iv.rows.length, 3)
    for (const [row, name] of iv.rows.map((r, i) => [r, ['burpees', 'mountain climbers', 'jump squats'][i]])) {
      assert.ok(near(row.key, name), `${row.key} ≈ ${name}`)
      assert.equal(row.rounds, 3, row.key)
      assert.ok(Math.abs(row.sec - 10) <= 1, `${row.key} works ${row.sec} s`)
      assert.ok(Math.abs(row.rest - 5) <= 1, `${row.key} rests ${row.rest} s`)
      assert.match(row.thumb, /^data:image\/jpeg;base64,/)
    }
    const quad = stretch.rows.find(r => near(r.key, 'quad stretch'))
    assert.ok(quad && quad.side && Math.abs(quad.sec - 15) <= 1, JSON.stringify(stretch.rows.map(r => [r.key, r.sec, r.side])))
    assert.ok(stretch.rows.some(r => near(r.key, 'child pose')))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
