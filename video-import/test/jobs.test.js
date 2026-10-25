import { test, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ogvi-jobs-test-'))
process.env.VIDEO_IMPORT_TMP = TMP
const jobs = await import('../src/jobs.js')
after(() => { jobs._reset(); fs.rmSync(TMP, { recursive: true, force: true }) })

const URL_OK = 'https://youtu.be/dQw4w9WgXcQ'
const settle = async (job, until = j => ['done', 'error', 'cancelled'].includes(j.status)) => {
  for (let i = 0; i < 200 && !until(job); i++) await new Promise(r => setTimeout(r, 5))
  return job
}
const chapterInfo = { id: 'dQw4w9WgXcQ', title: 'HIIT', channel: 'Coach', channel_id: 'UC1', duration: 300,
  chapters: [['Burpees', 0, 40], ['Rest', 40, 60], ['Plank Jacks', 60, 100], ['Rest', 100, 120], ['Jump Squats', 120, 160], ['Rest', 160, 180], ['Burpees', 180, 220], ['Rest', 220, 240], ['Plank Jacks', 240, 280]]
    .map(([title, start_time, end_time]) => ({ title, start_time, end_time })) }
// What a video read off the screen looks like to the job: one move with its name.
const readOne = async () => ({ frames: [], blocks: [], stats: {}, draft: { sections: [{ kind: 'interval', rows: [{ id: 'v1', name: 'Burpees', key: 'burpees', conf: 0.9, occurrences: [{ start: 0, dur: 40 }] }] }] } })
const noChapters = { id: 'dQw4w9WgXcQ', title: 'HIIT', channel: 'Coach', channel_id: 'UC1', duration: 300 }

let downloads = 0, workDirs = []
const fakeAnalyse = async (file, roi, { workDir, progress }) => {
  workDirs.push(workDir)
  assert.ok(fs.existsSync(file), 'the video is there while the job runs')
  progress('frames', 1); progress('ocr', 0.5)
  return { frames: [], blocks: [{ start: 0, dur: 40, kind: 'work', text: 'BURPEES', conf: 0.9 }], draft: { sections: [], roi }, stats: { seconds: 300 } }
}
beforeEach(() => {
  jobs._reset(); downloads = 0; workDirs = []
  jobs._setDeps({
    metadata: async () => noChapters,
    download: async (url, dir) => { downloads++; const f = path.join(dir, 'video.mp4'); fs.writeFileSync(f, 'x'); return f },
    probe: async () => ({ width: 640, height: 360, duration: 300 }),
    roiSetup: async () => ({ samples: [{ t: 150, src: 'data:image/jpeg;base64,AA' }], suggest: { name: null, timer: null }, width: 640, height: 360 }),
    autoRoi: async () => null,
    analyse: fakeAnalyse
  })
})

test('a video with good chapters is still read frame by frame: the chapters are not the answer', async () => {
  jobs._setDeps({ metadata: async () => chapterInfo, analyse: readOne })
  const job = await settle(jobs.create({ url: URL_OK, owner: 'u1', rois: { UC1: { name: { x: 0, y: 0.8, w: 0.5, h: 0.1 } } } }))
  assert.equal(job.status, 'done', job.error)
  assert.equal(downloads, 1)
  assert.equal(job.result.method, 'video')
  assert.ok(!job.result.fallback)
})

test('the old mode argument changes nothing: a video is always read', async () => {
  jobs._setDeps({ metadata: async () => chapterInfo, analyse: readOne })
  const job = await settle(jobs.create({ url: URL_OK, owner: 'u1', mode: 'auto', rois: { UC1: { name: { x: 0, y: 0.8, w: 0.5, h: 0.1 } } } }))
  assert.equal(job.status, 'done', job.error)
  assert.equal(downloads, 1)
  assert.equal(job.result.method, 'video')
})

test('a video with no names on screen falls back to its chapters, and says so', async () => {
  jobs._setDeps({ metadata: async () => chapterInfo })   // fakeAnalyse reads no rows at all
  const job = await settle(jobs.create({ url: URL_OK, owner: 'u1', rois: { UC1: { name: { x: 0, y: 0.8, w: 0.5, h: 0.1 } } } }))
  assert.equal(job.status, 'done', job.error)
  assert.equal(downloads, 1, 'the video was read first')
  const v = jobs.view(job)
  assert.equal(v.result.method, 'chapters')
  assert.equal(v.result.fallback, 'no-text')
  const iv = v.result.draft.sections.find(s => s.kind === 'interval')
  assert.deepEqual(iv.rows.map(r => [r.key, r.rounds]), [['burpees', 2], ['plank jacks', 2], ['jump squats', 1]])
})

test('without chapters, a video with no names on screen is an empty draft, not an error', async () => {
  const job = await settle(jobs.create({ url: URL_OK, owner: 'u1', rois: { UC1: { name: { x: 0, y: 0.8, w: 0.5, h: 0.1 } } } }))
  assert.equal(job.status, 'done', job.error)
  assert.equal(job.result.method, 'video')
})

test('the chapters name the rows the screen left without a name', async () => {
  jobs._setDeps({
    metadata: async () => chapterInfo,
    analyse: async () => ({ frames: [], blocks: [], stats: {},
      draft: { sections: [{ kind: 'interval', rows: [
        { id: 'v1', name: 'Burpees', key: 'burpees', conf: 0.9, occurrences: [{ start: 0, dur: 40 }] },
        { id: 'v2', name: '', key: '', conf: 0, unnamed: true, occurrences: [{ start: 62, dur: 36 }] }] }] } })
  })
  const job = await settle(jobs.create({ url: URL_OK, owner: 'u1', rois: { UC1: { name: { x: 0, y: 0.8, w: 0.5, h: 0.1 } } } }))
  assert.equal(job.status, 'done', job.error)
  assert.equal(job.result.method, 'video')
  const rows = job.result.draft.sections[0].rows
  assert.deepEqual(rows.map(r => r.name), ['Burpees', 'Plank Jacks'])
  assert.ok(rows[1].fromChapter && !rows[0].fromChapter)
})

test('no saved boxes: the job waits for them, then finishes and removes its files', async () => {
  const job = jobs.create({ url: URL_OK, owner: 'u1' })
  await settle(job, j => j.status === 'needs_roi')
  const v = jobs.view(job)
  assert.equal(v.status, 'needs_roi')
  assert.equal(v.roiSetup.samples.length, 1)
  assert.throws(() => jobs.submitRoi(job.id, { name: { x: 0, y: 0, w: 0, h: 0 } }), /draw a box/)
  jobs.submitRoi(job.id, { name: { x: 0.1, y: 0.8, w: 0.5, h: 0.1 }, timer: { x: 0.8, y: 0, w: 0.15, h: 0.1 } })
  await settle(job)
  assert.equal(job.status, 'done', job.error)
  assert.deepEqual(job.result.roi.timer, { x: 0.8, y: 0, w: 0.15, h: 0.1 })
  assert.equal(job.result.roiSaved, false)
  assert.ok(!('roiSetup' in jobs.view(job)), 'the stills go once the boxes are in')
  assert.equal(fs.existsSync(workDirs[0]), false, 'the working directory is gone')
  assert.deepEqual(fs.readdirSync(TMP), [], 'nothing left behind')
})

test('saved boxes for the channel skip the setup', async () => {
  const job = await settle(jobs.create({ url: URL_OK, owner: 'u1', rois: { UC1: { name: { x: 0.1, y: 0.8, w: 0.5, h: 0.1 } } } }))
  assert.equal(job.status, 'done', job.error)
  assert.equal(job.result.roiSaved, true)
})

test('one running import per profile; others may queue', async () => {
  const a = jobs.create({ url: URL_OK, owner: 'u1' })
  assert.throws(() => jobs.create({ url: URL_OK, owner: 'u1' }), e => e.status === 409)
  const b = jobs.create({ url: URL_OK, owner: 'u2', rois: { UC1: { name: { x: 0, y: 0.8, w: 0.5, h: 0.1 } } } })
  await settle(a, j => j.status === 'needs_roi')
  await settle(b)
  assert.equal(b.status, 'done')
  jobs.cancel(a.id)
  await settle(a)
  assert.equal(a.status, 'cancelled')
})

test('cancelling a waiting job ends it and cleans up', async () => {
  const job = jobs.create({ url: URL_OK, owner: 'u1' })
  await settle(job, j => j.status === 'needs_roi')
  jobs.cancel(job.id)
  await settle(job)
  assert.equal(job.status, 'cancelled')
  assert.deepEqual(fs.readdirSync(TMP), [])
})

test('a URL that is not a YouTube video is refused before anything runs', () => {
  assert.throws(() => jobs.create({ url: 'https://example.com/x', owner: 'u1' }), e => e.status === 400 && e.code === 'bad-url')
  assert.throws(() => jobs.create({ url: URL_OK }), e => e.code === 'bad-owner')
})

test('a failing tool ends the job with its message and still cleans up', async () => {
  jobs._setDeps({ metadata: async () => { const { VideoError } = await import('../src/youtube.js'); throw new VideoError('too-long', 'the video is longer than 90 minutes') } })
  const job = await settle(jobs.create({ url: URL_OK, owner: 'u1' }))
  assert.equal(job.status, 'error'); assert.equal(job.code, 'too-long')
  assert.match(job.error, /90 minutes/)
  assert.deepEqual(fs.readdirSync(TMP), [])
})

const AUTO = { name: { x: 0.05, y: 0.8, w: 0.4, h: 0.08 }, timer: { x: 0.85, y: 0.02, w: 0.12, h: 0.18 }, captions: 9 }

test('boxes the program finds by itself skip the step where the user marks them', async () => {
  let seen = null
  jobs._setDeps({ autoRoi: async () => { await new Promise(r => setTimeout(r, 40)); return AUTO }, analyse: async (file, roi, o) => { seen = roi; return fakeAnalyse(file, roi, o) } })
  const stages = []
  const job = jobs.create({ url: URL_OK, owner: 'u1' })
  const poll = setInterval(() => { if (stages[stages.length - 1] !== job.stage) stages.push(job.stage) }, 1)
  await settle(job)
  clearInterval(poll)
  assert.equal(job.status, 'done', job.error)
  assert.ok(!stages.includes('needs_roi'), 'the user was never asked: ' + stages.join(' > '))
  assert.ok(stages.includes('detect'))
  assert.deepEqual(seen, { name: AUTO.name, timer: AUTO.timer })
  assert.equal(job.result.roiAuto, true)
  assert.equal(job.result.roiSaved, false)
})

test('boxes the user drew for this channel are used, and nothing is detected', async () => {
  let asked = 0
  jobs._setDeps({ autoRoi: async () => { asked++; return AUTO } })
  const saved = { name: { x: 0.1, y: 0.7, w: 0.5, h: 0.1 }, timer: null }
  const job = await settle(jobs.create({ url: URL_OK, owner: 'u1', rois: { UC1: saved } }))
  assert.equal(job.status, 'done', job.error)
  assert.equal(asked, 0)
  assert.equal(job.result.roiSaved, true)
  assert.ok(!job.result.roiAuto)
})

test('when nothing is found the user is asked, as before', async () => {
  jobs._setDeps({ autoRoi: async () => null })
  const job = jobs.create({ url: URL_OK, owner: 'u1' })
  await settle(job, j => j.status === 'needs_roi')
  assert.equal(job.status, 'needs_roi')
})

test('"mark them myself" asks even when the program found boxes, and starts from what it found', async () => {
  jobs._setDeps({ autoRoi: async () => AUTO })
  const job = jobs.create({ url: URL_OK, owner: 'u1', manual: true })
  await settle(job, j => j.status === 'needs_roi')
  assert.equal(job.status, 'needs_roi')
  const v = jobs.view(job)
  assert.deepEqual(v.roiSetup.suggest.name, AUTO.name)
  assert.deepEqual(v.roiSetup.suggest.timer, AUTO.timer)
})

test('a detection that fails does not fail the import: the user is asked', async () => {
  jobs._setDeps({ autoRoi: async () => { throw new Error('tesseract exploded') } })
  const job = jobs.create({ url: URL_OK, owner: 'u1' })
  await settle(job, j => j.status === 'needs_roi')
  assert.equal(job.status, 'needs_roi')
})

const rowsOf = (n, named) => ({ frames: [], blocks: [], stats: {}, quality: { timed: true, rows: n, namedShare: named, meanConf: named ? 0.8 : 0.2, runCover: 0.9 },
  draft: { sections: [{ kind: 'interval', rows: [{ id: 'v1', name: 'Burpees', occurrences: [] }] }] } })

test('a read the program is not sure of is not handed over: the user is asked, with its boxes, and the video is not downloaded again', async () => {
  const reads = []
  jobs._setDeps({ autoRoi: async () => AUTO, analyse: async (file, roi) => { reads.push(roi); return rowsOf(30, reads.length === 1 ? 0.3 : 0.9) } })
  const job = jobs.create({ url: URL_OK, owner: 'u1' })
  await settle(job, j => j.status === 'needs_roi')
  assert.equal(job.status, 'needs_roi')
  const v = jobs.view(job)
  assert.equal(v.roiSetup.unsure, true)
  assert.deepEqual(v.roiSetup.suggest.name, AUTO.name)
  jobs.submitRoi(job.id, { name: { x: 0.1, y: 0.7, w: 0.5, h: 0.1 } })
  await settle(job)
  assert.equal(job.status, 'done', job.error)
  assert.equal(downloads, 1)
  assert.equal(reads.length, 2)
  assert.ok(!job.result.roiAuto, 'the second read used the user\'s boxes')
})

test('a good automatic read is handed over without asking', async () => {
  jobs._setDeps({ autoRoi: async () => AUTO, analyse: async () => rowsOf(30, 0.95) })
  const job = await settle(jobs.create({ url: URL_OK, owner: 'u1' }))
  assert.equal(job.status, 'done', job.error)
  assert.equal(job.result.roiAuto, true)
})
