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
    analyse: fakeAnalyse
  })
})

test('good chapters finish the job without downloading anything', async () => {
  jobs._setDeps({ metadata: async () => chapterInfo, download: async () => { downloads++; throw new Error('no') } })
  const job = await settle(jobs.create({ url: URL_OK, owner: 'u1' }))
  assert.equal(job.status, 'done', job.error)
  assert.equal(downloads, 0)
  const v = jobs.view(job)
  assert.equal(v.result.method, 'chapters')
  assert.equal(v.result.source.channelId, 'UC1')
  const iv = v.result.draft.sections.find(s => s.kind === 'interval')
  assert.deepEqual(iv.rows.map(r => [r.key, r.rounds]), [['burpees', 2], ['plank jacks', 2], ['jump squats', 1]])
  assert.equal(v.pct, 100)
})

test('mode "video" reads the frames even when chapters exist', async () => {
  jobs._setDeps({ metadata: async () => chapterInfo })
  const job = await settle(jobs.create({ url: URL_OK, owner: 'u1', mode: 'video', rois: { UC1: { name: { x: 0, y: 0.8, w: 0.5, h: 0.1 } } } }))
  assert.equal(job.status, 'done', job.error)
  assert.equal(downloads, 1)
  assert.equal(job.result.method, 'video')
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
