// The video-import worker's HTTP surface. Internal: only the openGym API talks to it, over the
// compose network, and it is never published on a host port. With VIDEO_IMPORT_TOKEN set (the
// API sends the same value) anything else that reaches the port is refused.
//
//   GET    /health              tools present, jobs running
//   POST   /jobs                { url, owner, rois?, mode? } → 202 job
//   GET    /jobs/<id>           job
//   POST   /jobs/<id>/roi       { name: box, timer?: box } → job
//   DELETE /jobs/<id>           cancel → job
//
// No session, no users, no /data: the API decides who may start a job and whose job is whose,
// and passes the owner along only so one profile cannot queue ten imports.

import http from 'node:http'
import crypto from 'node:crypto'
import { pathToFileURL } from 'node:url'
import * as jobs from './jobs.js'
import { has } from './proc.js'
import { ENGINE } from './ocr.js'

const PORT = +(process.env.PORT || 3100)
const TOKEN = process.env.VIDEO_IMPORT_TOKEN || ''
const MAX_BODY = 256 * 1024

function json(res, code, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0
    req.on('data', d => { size += d.length; if (size > MAX_BODY) { reject(new jobs.JobError(413, 'too-large', 'body too large')); req.destroy() } else chunks.push(d) })
    req.on('end', () => {
      if (!chunks.length) return resolve({})
      try {
        const b = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        if (!b || typeof b !== 'object' || Array.isArray(b)) throw new Error('not an object')
        resolve(b)
      } catch { reject(new jobs.JobError(400, 'bad-json', 'invalid json')) }
    })
    req.on('error', reject)
  })
}

/**
 * Why this process should not start, or null. Any container on the compose network can reach the
 * port, and a job keeps a core busy for minutes: without the shared secret anyone who can reach
 * it can use it. So a production worker (the images set NODE_ENV) needs a token of some length;
 * VIDEO_IMPORT_ALLOW_NO_TOKEN=1 is for the one who has put the port behind something else.
 */
export function startupProblem(env = process.env) {
  if (env.NODE_ENV !== 'production' || env.VIDEO_IMPORT_ALLOW_NO_TOKEN === '1') return null
  const token = env.VIDEO_IMPORT_TOKEN || ''
  if (!token) return 'VIDEO_IMPORT_TOKEN is not set. Set the same long random string for the API and this worker in .env (or VIDEO_IMPORT_ALLOW_NO_TOKEN=1 to run without one).'
  if (token.length < 16) return 'VIDEO_IMPORT_TOKEN has to be at least 16 characters.'
  return null
}

function authorised(req) {
  if (!TOKEN) return true
  const got = Buffer.from(String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''))
  const want = Buffer.from(TOKEN)
  return got.length === want.length && crypto.timingSafeEqual(got, want)
}

let toolCache = null
async function tools() {
  if (!toolCache) {
    const [ytdlp, ffmpeg, tesseract] = await Promise.all([has('yt-dlp', ['--version']), has('ffmpeg'), has('tesseract', ['--version'])])
    toolCache = { ytdlp, ffmpeg, tesseract }
  }
  return toolCache
}

export async function handle(req, res) {
  const url = new URL(req.url, 'http://x')
  if (req.method === 'GET' && url.pathname === '/health') {
    const t = await tools()
    return json(res, t.ytdlp && t.ffmpeg && t.tesseract ? 200 : 503, { ok: t.ytdlp && t.ffmpeg && t.tesseract, tools: t, engine: ENGINE })
  }
  if (!authorised(req)) return json(res, 401, { error: 'unauthorised' })
  try {
    if (req.method === 'POST' && url.pathname === '/jobs') {
      const b = await readBody(req)
      const job = jobs.create({ url: b.url, owner: b.owner, rois: b.rois, mode: b.mode })
      return json(res, 202, jobs.view(job))
    }
    const m = /^\/jobs\/([0-9a-f]{24})(\/roi)?$/.exec(url.pathname)
    if (m) {
      const job = jobs.get(m[1])
      if (!job) return json(res, 404, { error: 'no such job', code: 'not-found' })
      if (req.method === 'GET' && !m[2]) return json(res, 200, jobs.view(job))
      if (req.method === 'DELETE' && !m[2]) return json(res, 200, jobs.view(jobs.cancel(job.id)))
      if (req.method === 'POST' && m[2]) {
        const b = await readBody(req)
        return json(res, 200, jobs.view(jobs.submitRoi(job.id, b)))
      }
    }
    return json(res, 404, { error: 'not found' })
  } catch (e) {
    if (e instanceof jobs.JobError) return json(res, e.status, { error: e.message, code: e.code })
    console.error(req.method, url.pathname, e)
    return json(res, 500, { error: 'server error' })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const problem = startupProblem()
  if (problem) { console.error('video-import: ' + problem); process.exit(1) }
  const server = http.createServer((req, res) => { handle(req, res).catch(() => { if (!res.headersSent) json(res, 500, { error: 'server error' }) }) })
  server.listen(PORT, () => console.log(`video-import on :${server.address().port} (ocr=${ENGINE}${TOKEN ? ', token required' : ''})`))
}
