// Jobs: one import at a time per profile, a short queue, and nothing left on disk afterwards.
//
// A job walks these stages, each reported with a fraction for the progress bar:
//   queued → metadata → (done, from chapters) | download → [needs_roi] → frames → ocr → thumbs → done
// and can end in error or cancelled from any of them. `needs_roi` waits for the boxes the user
// draws (or the ones the API sends for a channel it has seen before) for up to ROI_WAIT_MS.
//
// The working directory — the video, the crops — is deleted in a finally when the job ends,
// however it ends. Only the result is kept, in memory, for RESULT_TTL_MS: the API copies what it
// needs and the worker never writes anything a backup would have to know about.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { canonicalYouTube } from './url.js'
import { metadata, download, VideoError } from './youtube.js'
import { metadataDraft, sourceOf } from './metadata.js'
import { classify } from './classify.js'
import { analyse, roiSetup } from './pipeline.js'
import { probe } from './frames.js'
import { cleanBox, cleanNames, cleanTimers } from './roi-suggest.js'

export const MAX_CONCURRENT = Math.max(1, +process.env.VIDEO_IMPORT_CONCURRENCY || 1)
export const MAX_QUEUE = 8
export const ROI_WAIT_MS = 30 * 60000
export const RESULT_TTL_MS = 60 * 60000
const WORK_ROOT = process.env.VIDEO_IMPORT_TMP || os.tmpdir()

export class JobError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code }
}

const jobs = new Map()
// Slots: a job holds one while it downloads and reads frames, and gives it back while it waits
// for the user to draw boxes — a job sitting on the ROI screen for twenty minutes must not hold
// up everyone else's.
const waiters = []
let running = 0

function acquire(job) {
  return new Promise((resolve, reject) => {
    if (job.abort.signal.aborted) return reject(cancelledError())
    if (running < MAX_CONCURRENT) { running++; return resolve() }
    const w = { job, resolve, reject }
    waiters.push(w)
    job.abort.signal.addEventListener('abort', () => {
      const i = waiters.indexOf(w)
      if (i >= 0) { waiters.splice(i, 1); reject(cancelledError()) }
    }, { once: true })
  })
}

function release() {
  running = Math.max(0, running - 1)
  const w = waiters.shift()
  if (w) { running++; w.resolve() }
}

const cancelledError = () => Object.assign(new Error('cancelled'), { cancelled: true })

// The stages and how much of the bar each one fills, in order.
const WEIGHTS = { queued: 0, metadata: 0.03, download: 0.25, needs_roi: 0.28, frames: 0.45, ocr: 0.9, thumbs: 0.98, done: 1 }
const STAGES = Object.keys(WEIGHTS)

function setStage(job, stage, frac = 0) {
  const i = STAGES.indexOf(stage)
  const from = i > 0 ? WEIGHTS[STAGES[i - 1]] : 0
  job.stage = stage
  job.pct = Math.round((from + (WEIGHTS[stage] - from) * Math.min(1, Math.max(0, frac))) * 100)
  job.updated = Date.now()
}

/** What the API (and through it the app) sees of a job. */
export function view(job) {
  return {
    id: job.id, owner: job.owner, status: job.status, stage: job.stage, pct: job.pct,
    source: job.source || null, method: job.method || null,
    error: job.error || null, code: job.code || null,
    ...(job.status === 'needs_roi' ? { roiSetup: job.roiSetup } : {}),
    ...(job.result ? { result: job.result } : {}),
    created: job.created, updated: job.updated
  }
}

export function get(id) {
  const job = jobs.get(String(id || ''))
  return job || null
}

/**
 * Start a job. `rois` is the profile's saved boxes by channel id — the API keeps them, so the
 * worker can be thrown away and rebuilt without losing anyone's setup. `mode`: 'auto' takes the
 * chapters when they are good enough, 'video' always reads the frames.
 */
export function create({ url, owner, rois = {}, mode = 'auto' } = {}) {
  const yt = canonicalYouTube(url)
  if (!yt) throw new JobError(400, 'bad-url', 'not a YouTube video link')
  const who = String(owner || '').slice(0, 80)
  if (!who) throw new JobError(400, 'bad-owner', 'owner missing')
  for (const j of jobs.values()) {
    if (j.owner === who && !isFinished(j)) throw new JobError(409, 'busy', 'an import is already running for this profile')
  }
  if ([...jobs.values()].filter(j => j.status === 'queued').length >= MAX_QUEUE) throw new JobError(429, 'queue-full', 'too many imports waiting, try again in a few minutes')
  const job = {
    id: crypto.randomBytes(12).toString('hex'), owner: who, url: yt.url, videoId: yt.id,
    rois: rois && typeof rois === 'object' ? rois : {}, mode: mode === 'video' ? 'video' : 'auto',
    status: 'queued', stage: 'queued', pct: 0, created: Date.now(), updated: Date.now(),
    abort: new AbortController(), roiWaiter: null
  }
  jobs.set(job.id, job)
  execute(job).catch(e => console.error('job', job.id, e))
  return job
}

const isFinished = j => j.status === 'done' || j.status === 'error' || j.status === 'cancelled'

/** The boxes for a job waiting at needs_roi. */
export function submitRoi(id, roi) {
  const job = get(id)
  if (!job) throw new JobError(404, 'not-found', 'no such job')
  if (job.status !== 'needs_roi' || !job.roiWaiter) throw new JobError(409, 'not-waiting', 'this job is not waiting for boxes')
  const name = cleanNames(roi?.name)
  const timer = cleanTimers(roi?.timer)
  if (!name) throw new JobError(400, 'bad-roi', 'draw a box around the exercise name')
  job.roiWaiter({ name, timer })
  return job
}

export function cancel(id) {
  const job = get(id)
  if (!job) throw new JobError(404, 'not-found', 'no such job')
  if (isFinished(job)) return job
  job.abort.abort()
  return job
}

function finish(job, status, extra = {}) {
  Object.assign(job, { status, ...extra })
  if (status === 'done') setStage(job, 'done', 1)
  job.updated = Date.now()
  job.roiWaiter = null
  delete job.roiSetup
  delete job.rois
  // A finished job is kept for the API to read, then forgotten.
  setTimeout(() => jobs.delete(job.id), RESULT_TTL_MS).unref()
}

function waitForRoi(job) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new JobError(408, 'roi-timeout', 'nobody drew the boxes in time')), ROI_WAIT_MS)
    timer.unref?.()
    job.abort.signal.addEventListener('abort', () => { clearTimeout(timer); reject(cancelledError()) }, { once: true })
    job.roiWaiter = roi => { clearTimeout(timer); job.roiWaiter = null; resolve(roi) }
  })
}

// The tools a job calls, replaceable in tests (which have no network and may have no ffmpeg).
let toolDeps = {}
export function _setDeps(d) { toolDeps = { ...toolDeps, ...d } }

export async function execute(job) {
  const d = { metadata, download, analyse, roiSetup, probe, ...toolDeps }
  const signal = job.abort.signal
  let holding = false, workDir = null
  try {
    await acquire(job)
    holding = true
    workDir = fs.mkdtempSync(path.join(WORK_ROOT, 'ogvi-'))
    job.status = 'running'
    setStage(job, 'metadata')
    const info = await d.metadata(job.url, { signal })
    job.source = sourceOf(info, job.url)
    const meta = metadataDraft(info)
    if (meta.usable && job.mode !== 'video') {
      job.method = meta.source
      const draft = classify(meta.blocks, { hints: meta.hints })
      finish(job, 'done', { result: { source: job.source, method: meta.source, draft, stats: { blocks: meta.blocks.length } } })
      return
    }
    job.method = 'video'
    setStage(job, 'download')
    const file = await d.download(job.url, workDir, { signal, onProgress: f => setStage(job, 'download', f) })
    const dims = await d.probe(file, { signal })
    const saved = job.source.channelId && job.rois[job.source.channelId]
    let roi = saved ? { name: cleanNames(saved.name), timer: cleanTimers(saved.timer) } : null
    if (!roi?.name) {
      job.roiSetup = await d.roiSetup(file, { workDir, signal, dims })
      job.status = 'needs_roi'
      setStage(job, 'needs_roi')
      release(); holding = false
      roi = await waitForRoi(job)
      delete job.roiSetup
      job.status = 'queued'
      await acquire(job)
      holding = true
      job.status = 'running'
    }
    const out = await d.analyse(file, roi, { workDir, signal, dims, hints: meta.hints, parts: meta.parts, progress: (stage, f) => setStage(job, stage, f) })
    finish(job, 'done', {
      result: {
        source: job.source, method: 'video', roi, roiSaved: !!saved,
        draft: out.draft,
        // The raw timeline, small: what the review screen shows when a row needs explaining.
        blocks: out.blocks.map(b => ({ start: b.start, dur: b.dur, kind: b.kind, text: b.text, conf: b.conf })),
        stats: out.stats
      }
    })
  } catch (e) {
    if (e.cancelled || signal.aborted) finish(job, 'cancelled')
    else {
      const known = e instanceof VideoError || e instanceof JobError
      if (!known) console.error('job', job.id, e)
      finish(job, 'error', { code: e.code && typeof e.code === 'string' ? e.code : 'failed', error: known ? e.message : 'the video could not be processed' })
    }
  } finally {
    if (workDir) fs.rmSync(workDir, { recursive: true, force: true })
    if (holding) release()
  }
}

/** For tests: forget everything. */
export function _reset() { for (const j of jobs.values()) j.abort.abort(); jobs.clear(); waiters.length = 0; running = 0; toolDeps = {} }
export { jobs as _jobs }
