#!/usr/bin/env node
// The routines service behind opengym.ch/routines/api/: takes routine submissions, sends each to
// Telegram for a person to approve or reject, commits approved ones to the routines-inbox branch on
// GitHub, and counts "Copy to openGym" clicks. Plain node:http, no dependencies; the photo is
// re-encoded by cwebp (libwebp-tools), which also drops every bit of metadata.
//
// Privacy: no cookies, nothing about a visitor is written to disk. Rate limits key on a hash of
// the address with a random salt that changes every day and lives only in memory.
//
// Every routine is checked by scripts/routines/lib.mjs checkRoutine, the same code CI runs.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  catalogueFrom, checkRoutine, sessionsFromPlan, decodePayload, payloadFromLink, slugify, imageInfo,
  cleanHttpsUrl, LIMITS, ROUTINE_ID
} from '../lib.mjs'

const MAX_PHOTO = 8 * 1024 * 1024
export const LIMITS_HTTP = { copy: 1024, preview: 300 * 1024, submit: Math.ceil(MAX_PHOTO * 1.4) + 400 * 1024 }

export function configFromEnv(env = process.env) {
  const base = (env.SITE_BASE || '/routines/').replace(/\/?$/, '/')
  return {
    port: Number(env.PORT || 8080),
    base,
    api: base + 'api/',
    siteDir: env.SITE_DIR || '',
    dataDir: env.DATA_DIR || './data',
    catalogue: env.CATALOGUE || '',
    label: env.ENV_LABEL || '',            // "STAGING" on staging: marks Telegram messages and noindexes the site
    origin: env.PUBLIC_ORIGIN || 'https://opengym.ch',
    tgToken: env.TELEGRAM_BOT_TOKEN || '',
    tgChat: String(env.TELEGRAM_CHAT_ID || ''),
    ghToken: env.GITHUB_TOKEN || '',
    ghRepo: env.GITHUB_REPO || 'DuarteSantos8/openGym',
    ghBranch: env.GITHUB_BRANCH || 'routines-inbox',
    ghBase: env.GITHUB_BASE || 'main',
    cwebp: env.CWEBP || 'cwebp',
    poll: env.TELEGRAM_POLL !== '0'
  }
}

/* ------------------------------- small helpers ------------------------------- */

export class Limiter {
  constructor(max, windowMs, now = Date.now) { this.max = max; this.windowMs = windowMs; this.now = now; this.hits = new Map() }
  take(key) {
    const t = this.now()
    const list = (this.hits.get(key) || []).filter(x => t - x < this.windowMs)
    if (list.length >= this.max) { this.hits.set(key, list); return false }
    list.push(t)
    this.hits.set(key, list)
    if (this.hits.size > 50000) this.hits.clear()
    return true
  }
}

// A visitor as a short hash with a salt that is new every day and never leaves memory.
export function visitorHasher(now = Date.now) {
  let day = '', salt = null
  return req => {
    const d = new Date(now()).toISOString().slice(0, 10)
    if (d !== day) { day = d; salt = crypto.randomBytes(32) }
    const ip = String(req.headers['cf-connecting-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0] || req.socket?.remoteAddress || '').trim()
    return crypto.createHmac('sha256', salt).update(ip).digest('hex').slice(0, 20)
  }
}

function readBody(req, max) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] || 0)
    if (declared > max) { reject(Object.assign(new Error('too big'), { status: 413 })); req.resume(); return }
    const parts = []
    let size = 0
    req.on('data', c => {
      size += c.length
      if (size > max) { reject(Object.assign(new Error('too big'), { status: 413 })); req.destroy(); return }
      parts.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(parts)))
    req.on('error', reject)
  })
}

async function readJSON(req, max) {
  const ct = String(req.headers['content-type'] || '')
  if (!/^(application\/json|text\/plain)/.test(ct)) throw Object.assign(new Error('Send JSON.'), { status: 415 })
  const buf = await readBody(req, max)
  try { return JSON.parse(buf.toString('utf8')) } catch { throw Object.assign(new Error('That is not JSON.'), { status: 400 }) }
}

const SECURITY = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'SAMEORIGIN'
}
function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body)
  const text = isBuf || typeof body === 'string' ? body : JSON.stringify(body)
  res.writeHead(status, { ...SECURITY, ...(isBuf || typeof body === 'string' ? {} : { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }), ...headers })
  res.end(status === 204 ? undefined : text)
}

function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = file + '.' + process.pid + '.tmp'
  fs.writeFileSync(tmp, data)
  fs.renameSync(tmp, file)
}

/* ------------------------------- the photo ------------------------------- */

/** The upload as a clean webp: type checked by its bytes, at most 1600 px, no metadata. */
export function reencodeWith(cwebp) {
  return async (buf, tmpDir) => {
    const info = imageInfo(buf)
    if (!info || !['jpg', 'png', 'webp'].includes(info.type)) throw new Error('The photo has to be a JPG, PNG or WebP.')
    if (info.width < 200 || info.height < 200) throw new Error('The photo is too small, at least 200 px a side please.')
    if (info.width > 12000 || info.height > 12000 || info.width * info.height > 60e6) throw new Error('The photo is huge. A smaller one, please.')
    fs.mkdirSync(tmpDir, { recursive: true })
    const id = crypto.randomBytes(8).toString('hex')
    const src = path.join(tmpDir, `${id}.${info.type}`)
    const out = path.join(tmpDir, `${id}.out.webp`)
    fs.writeFileSync(src, buf)
    const resize = Math.max(info.width, info.height) > 1600 ? (info.width >= info.height ? ['-resize', '1600', '0'] : ['-resize', '0', '1600']) : []
    try {
      for (const q of ['80', '66', '50']) {
        await new Promise((resolve, reject) => execFile(cwebp, ['-quiet', '-metadata', 'none', '-q', q, ...resize, src, '-o', out], { timeout: 30000 }, e => (e ? reject(new Error('Could not read that photo.')) : resolve())))
        const res = fs.readFileSync(out)
        const oi = imageInfo(res)
        if (!oi || oi.type !== 'webp') throw new Error('Could not read that photo.')
        if (res.length <= LIMITS.coverBytes) return { buf: res, width: oi.width, height: oi.height }
      }
      throw new Error('That photo would not get small enough. Try a simpler one.')
    } finally {
      fs.rmSync(src, { force: true })
      fs.rmSync(out, { force: true })
    }
  }
}

/* ------------------------------- Telegram ------------------------------- */

const tgEsc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
const clock = s => (s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s}s`)
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** The moderation message: everything needed to decide, in Telegram HTML, under 4096 characters. */
export function moderationText(sub, { label = '', cat } = {}) {
  const r = sub.routine
  const head = `${label ? `<b>[${tgEsc(label)}]</b> ` : ''}New routine for opengym.ch/routines`
  const lines = [
    head, '',
    `<b>${tgEsc(r.title)}</b>`,
    `by ${tgEsc(r.author.name)}${r.author.url ? ` (${tgEsc(r.author.url)})` : ''}`,
    `${r.days} days · ${r.duration} min · ${r.level} · ${r.goal} · ${r.split} · ${r.language}`,
    r.tags?.length ? `Tags: ${tgEsc(r.tags.join(', '))}` : '',
    '', tgEsc(r.description),
    r.about ? `\n<i>${tgEsc(r.about.slice(0, 700))}${r.about.length > 700 ? '…' : ''}</i>` : '',
    ''
  ]
  r.sessions.forEach((s, i) => {
    const when = (r.schedule || []).filter(p => p[1] === i).map(p => DAY[p[0]]).join(' ')
    lines.push(`<b>${tgEsc(s.name)}</b>${when ? ` (${when})` : ''}`)
    s.exercises.forEach(x => {
      const n = cat?.get(x.id)?.n || x.id
      const amount = x.sec ? clock(x.sec) : x.repsMin ? `${x.repsMin}-${x.reps}` : x.reps
      lines.push(`• ${tgEsc(n)} ${x.sets}×${amount}${x.rest ? `, rest ${clock(x.rest)}` : ''}${x.note ? ` <i>${tgEsc(x.note)}</i>` : ''}`)
    })
  })
  lines.push('', `Page will be /routines/${tgEsc(sub.slug)}/ · cover: ${r.cover ? 'yes' : 'none'}${r.coverAlt ? ` (${tgEsc(r.coverAlt)})` : ''}`, `id ${sub.sid}`)
  let text = lines.filter(l => l !== null).join('\n').replace(/\n{3,}/g, '\n\n')
  if (text.length > 4000) text = text.slice(0, 3990) + '…'
  return text
}

export const keyboard = (sid, tag) => ({ inline_keyboard: [[{ text: '✅ Approve', callback_data: `rt:${tag}:ok:${sid}` }, { text: '❌ Reject', callback_data: `rt:${tag}:no:${sid}` }]] })
export const envTag = label => (label ? label.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) : 'prod') || 'prod'

export function telegramClient(token, fetchImpl = fetch) {
  const url = m => `https://api.telegram.org/bot${token}/${m}`
  return async (method, payload, file) => {
    let body, headers
    if (file) {
      body = new FormData()
      for (const [k, v] of Object.entries(payload)) body.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v))
      body.append(file.field, new Blob([file.buf], { type: file.type }), file.name)
    } else {
      body = JSON.stringify(payload)
      headers = { 'content-type': 'application/json' }
    }
    const r = await fetchImpl(url(method), { method: 'POST', body, headers, signal: AbortSignal.timeout(method === 'getUpdates' ? 70000 : 20000) })
    const j = await r.json().catch(() => ({}))
    if (!j.ok) throw new Error(`telegram ${method}: ${j.description || r.status}`)
    return j.result
  }
}

/* ------------------------------- GitHub ------------------------------- */

export function githubClient({ token, repo, branch, base }, fetchImpl = fetch) {
  const api = p => `https://api.github.com/repos/${repo}${p}`
  const call = async (method, p, body) => {
    const r = await fetchImpl(api(p), { method, headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'opengym-routines', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) })
    const j = r.status === 204 ? {} : await r.json().catch(() => ({}))
    return { status: r.status, j }
  }
  async function ensureBranch() {
    const b = await call('GET', `/git/ref/heads/${branch}`)
    if (b.status === 200) return
    const m = await call('GET', `/git/ref/heads/${base}`)
    if (m.status !== 200) throw new Error(`GitHub: can't read ${base} (${m.status} ${m.j.message || ''})`)
    const c = await call('POST', '/git/refs', { ref: `refs/heads/${branch}`, sha: m.j.object.sha })
    if (c.status !== 201) throw new Error(`GitHub: can't create ${branch} (${c.status} ${c.j.message || ''})`)
  }
  const exists = async p => (await call('GET', `/contents/${p}?ref=${encodeURIComponent(branch)}`)).status === 200
  async function put(p, buf, message) {
    const r = await call('PUT', `/contents/${p}`, { message, content: buf.toString('base64'), branch, committer: { name: 'openGym routines', email: 'contact@duarte-santos.ch' } })
    if (r.status !== 201 && r.status !== 200) throw new Error(`GitHub: can't write ${p} (${r.status} ${r.j.message || ''})`)
    return r.j.commit?.html_url
  }
  /** Commits the routine (and cover) to the inbox branch under a free name. Returns { slug, url }. */
  return async function commit(slug, routineJSON, cover) {
    await ensureBranch()
    let name = slug
    for (let i = 2; await exists(`routines/community/${name}.json`); i++) name = `${slug}-${i}`
    const json = { ...routineJSON, ...(cover ? { cover: `${name}.webp` } : {}) }
    if (cover) await put(`routines/community/${name}.webp`, cover, `routines: cover for ${name}`)
    const url = await put(`routines/community/${name}.json`, Buffer.from(JSON.stringify(json, null, 2) + '\n'), `routines: add ${name} by ${json.author.name}`)
    return { slug: name, url }
  }
}

/* ------------------------------- turning a request into a routine ------------------------------- */

const s = (v, max) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').trim().slice(0, max + 50) : '')

/** The plan in a request ({ link } or { plan }), as sessions + schedule. Throws with a sentence. */
export function planFromRequest(body, cat) {
  let data
  if (typeof body.link === 'string' && body.link.trim()) {
    const p = payloadFromLink(body.link)
    if (!p) throw new Error('That is not an openGym routine link. It starts with https://opengym.ch/r#')
    data = decodePayload(p)
  } else if (body.plan && typeof body.plan === 'object') data = body.plan
  else throw new Error('Paste a routine link or pick a plan file first.')
  return { ...sessionsFromPlan(data, cat), name: typeof data.name === 'string' ? data.name.trim().slice(0, 80) : '' }
}

/** The routine file a submission becomes (before its checks), from the form and the plan. */
export function routineFromRequest(body, plan, today) {
  const authorUrl = s(body.authorUrl, 200)
  return {
    title: s(body.title, LIMITS.title),
    author: { name: s(body.author, LIMITS.author), ...(authorUrl ? { url: cleanHttpsUrl(authorUrl) || authorUrl } : {}) },
    license: 'CC-BY-4.0',
    added: today,
    language: s(body.language, 10) || 'en',
    goal: s(body.goal, 20), level: s(body.level, 20), split: s(body.split, 20),
    duration: Number.isInteger(body.duration) ? body.duration : Number.parseInt(body.duration, 10),
    description: s(body.description, LIMITS.description),
    ...(s(body.about, LIMITS.about) ? { about: s(body.about, LIMITS.about) } : {}),
    tags: (Array.isArray(body.tags) ? body.tags : []).slice(0, 12).map(t => s(t, 30).toLowerCase()).filter(Boolean),
    sessions: plan.sessions,
    ...(plan.schedule.length ? { schedule: plan.schedule } : {})
  }
}

const line = x => (x.sec ? `${x.sets} × ${clock(x.sec)} hold` : `${x.sets} × ${x.repsMin ? x.repsMin + '-' : ''}${x.reps} reps`) + (x.rest ? `, rest ${clock(x.rest)}` : '')

/* ------------------------------- the server ------------------------------- */

export function createApp(cfg, deps = {}) {
  const now = deps.now || Date.now
  const today = () => new Date(now()).toISOString().slice(0, 10)
  const cat = deps.cat || catalogueFrom(JSON.parse(fs.readFileSync(cfg.catalogue, 'utf8')))
  const tg = deps.telegram || (cfg.tgToken && cfg.tgChat ? telegramClient(cfg.tgToken) : null)
  const gh = deps.github !== undefined ? deps.github : (cfg.ghToken ? githubClient({ token: cfg.ghToken, repo: cfg.ghRepo, branch: cfg.ghBranch, base: cfg.ghBase }) : null)
  const reencode = deps.reencode || reencodeWith(cfg.cwebp)
  const tag = envTag(cfg.label)
  const visitor = visitorHasher(now)
  const dirs = { pending: path.join(cfg.dataDir, 'pending'), approved: path.join(cfg.dataDir, 'approved'), tmp: path.join(cfg.dataDir, 'tmp') }
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true })

  // What exists already: published routines (the site's routines.json) and submissions waiting.
  const known = { ids: new Set(), slugs: new Set() }
  function loadKnown() {
    known.ids.clear(); known.slugs.clear()
    const file = deps.routinesFile || (cfg.siteDir ? path.join(cfg.siteDir, 'routines.json') : '')
    try { for (const r of JSON.parse(fs.readFileSync(file, 'utf8'))) { known.ids.add(r.id); known.slugs.add(r.slug) } } catch { /* no site yet */ }
  }
  loadKnown()

  // Copy counts: { id: n }, the only thing the counter keeps.
  const countsFile = path.join(cfg.dataDir, 'counts.json')
  let counts = {}
  try { counts = JSON.parse(fs.readFileSync(countsFile, 'utf8')) || {} } catch { counts = {} }
  let saveTimer = null
  const saveCounts = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => writeAtomic(countsFile, JSON.stringify(counts)), deps.saveDelay ?? 3000) }
  let counted = { day: '', set: new Set() }

  const limits = {
    copy: new Limiter(120, 3600e3, now),
    preview: new Limiter(40, 600e3, now),
    submit: new Limiter(4, 3600e3, now),
    submitAll: new Limiter(60, 86400e3, now)
  }

  const pendingSlugs = () => fs.readdirSync(dirs.pending).filter(f => f.endsWith('.json')).map(f => { try { return JSON.parse(fs.readFileSync(path.join(dirs.pending, f), 'utf8')).slug } catch { return null } }).filter(Boolean)
  function freeSlug(title) {
    const base = slugify(title)
    const taken = new Set([...known.slugs, ...pendingSlugs(), ...fs.readdirSync(dirs.approved).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5))])
    let slug = base
    for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`
    return slug
  }

  async function handleCopy(req, res) {
    const body = await readJSON(req, LIMITS_HTTP.copy)
    const id = typeof body.id === 'string' && ROUTINE_ID.test(body.id) ? body.id : null
    if (!id || !known.ids.has(id)) return send(res, 400, { ok: false, error: 'Unknown routine.' })
    const v = visitor(req)
    if (!limits.copy.take(v)) return send(res, 204, '')
    // One count per routine per visitor per day: a copy, not a click.
    const d = today()
    if (counted.day !== d) counted = { day: d, set: new Set() }
    const key = v + id
    if (!counted.set.has(key)) {
      counted.set.add(key)
      counts[id] = (counts[id] || 0) + 1
      saveCounts()
    }
    send(res, 204, '')
  }

  function previewOf(plan) {
    return {
      name: plan.name, from: plan.from,
      sessions: plan.sessions.map(se => ({ name: se.name, exercises: se.exercises.map(x => ({ id: x.id, name: (cat.get(x.id)?.n || x.id).replace(/^./, c => c.toUpperCase()), line: line(x) })) })),
      schedule: plan.schedule,
      exerciseCount: plan.sessions.reduce((n, se) => n + se.exercises.length, 0),
      days: plan.schedule.length || plan.sessions.length
    }
  }
  // The checks that are about the plan itself, run with stand-in words for the form fields.
  function planProblems(plan) {
    const stand = { title: 'Preview', author: { name: 'Preview' }, license: 'CC-BY-4.0', added: today(), language: 'en', goal: 'general', level: 'beginner', split: 'other', duration: 45, description: 'A stand-in description for the preview.', sessions: plan.sessions, ...(plan.schedule.length ? { schedule: plan.schedule } : {}) }
    return checkRoutine(stand, { slug: 'preview', source: 'community', cat }).problems
  }

  async function handlePreview(req, res) {
    if (!limits.preview.take(visitor(req))) return send(res, 429, { ok: false, error: 'That was a lot of tries. Give it a few minutes.' })
    const body = await readJSON(req, LIMITS_HTTP.preview)
    let plan
    try { plan = planFromRequest(body, cat) } catch (e) { return send(res, 422, { ok: false, error: e.message }) }
    const problems = planProblems(plan)
    if (problems.length) return send(res, 422, { ok: false, error: 'The plan needs a fix first:', problems })
    send(res, 200, { ok: true, preview: previewOf(plan) })
  }

  async function handleSubmit(req, res) {
    const v = visitor(req)
    const body = await readJSON(req, LIMITS_HTTP.submit)
    // Bots fill the hidden field or send in a blink; they get a cheerful answer and nothing else.
    if ((typeof body.website === 'string' && body.website.trim()) || !(Number(body.ms) >= 4000)) return send(res, 200, { ok: true })
    if (!limits.submit.take(v) || !limits.submitAll.take('all')) return send(res, 429, { ok: false, error: 'That was a lot of routines in a short time. Give it an hour.' })
    if (body.consent !== true) return send(res, 422, { ok: false, error: 'Tick the box to say it is yours to share.' })
    let plan
    try { plan = planFromRequest(body, cat) } catch (e) { return send(res, 422, { ok: false, error: e.message }) }
    const raw = routineFromRequest(body, plan, today())
    const slug = freeSlug(raw.title)
    let coverBuf = null, coverInfo
    if (body.cover && typeof body.cover.data === 'string') {
      const buf = Buffer.from(body.cover.data, 'base64')
      if (buf.length > MAX_PHOTO) return send(res, 413, { ok: false, error: 'That photo is over 8 MB.' })
      try {
        const out = await reencode(buf, dirs.tmp)
        coverBuf = out.buf
        coverInfo = { bytes: out.buf.length, width: out.width, height: out.height }
        raw.cover = `${slug}.webp`
        raw.coverAlt = s(body.coverAlt, 160)
      } catch (e) { return send(res, 422, { ok: false, error: e.message }) }
    }
    const { problems, routine } = checkRoutine(raw, { slug, source: 'community', cat, coverInfo })
    if (problems.length) return send(res, 422, { ok: false, error: 'Almost. A few things to fix:', problems })
    const sid = crypto.randomBytes(6).toString('hex')
    const sub = { sid, slug, at: new Date(now()).toISOString(), raw, routine }
    writeAtomic(path.join(dirs.pending, sid + '.json'), JSON.stringify(sub, null, 2))
    if (coverBuf) writeAtomic(path.join(dirs.pending, sid + '.webp'), coverBuf)
    send(res, 200, { ok: true })
    notify(sub, coverBuf).catch(e => console.error('telegram notify failed:', e.message))
  }

  async function notify(sub, coverBuf) {
    if (!tg) { console.log(`routine ${sub.sid} (${sub.slug}) waiting, Telegram not configured`); return }
    const text = moderationText(sub, { label: cfg.label, cat })
    if (coverBuf) {
      await tg('sendPhoto', { chat_id: cfg.tgChat, caption: `${cfg.label ? `[${cfg.label}] ` : ''}Cover for "${sub.routine.title}"`.slice(0, 1000) }, { field: 'photo', buf: coverBuf, type: 'image/webp', name: 'cover.webp' })
    }
    await tg('sendMessage', { chat_id: cfg.tgChat, text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: keyboard(sub.sid, tag) })
  }

  /** A press on ✅ or ❌. Returns the sentence the message is edited to end with. */
  async function moderate(sid, ok) {
    if (!/^[0-9a-f]{12}$/.test(sid)) return 'Unknown submission.'
    const file = path.join(dirs.pending, sid + '.json')
    if (!fs.existsSync(file)) return 'Already handled.'
    const sub = JSON.parse(fs.readFileSync(file, 'utf8'))
    const coverFile = path.join(dirs.pending, sid + '.webp')
    const cover = fs.existsSync(coverFile) ? fs.readFileSync(coverFile) : null
    if (!ok) {
      fs.rmSync(file, { force: true }); fs.rmSync(coverFile, { force: true })
      return '❌ Rejected and deleted.'
    }
    if (gh) {
      try {
        const r = await gh(sub.slug, sub.raw, cover)
        fs.rmSync(file, { force: true }); fs.rmSync(coverFile, { force: true })
        return `✅ Approved. Committed to ${cfg.ghBranch} as routines/community/${r.slug}.json\n${r.url || ''}\nOpen a pull request from ${cfg.ghBranch} to publish it.`
      } catch (e) {
        console.error('github commit failed:', e.message)
        // Kept as approved on disk so nothing is lost; the owner sees why.
      }
    }
    const json = { ...sub.raw }
    writeAtomic(path.join(dirs.approved, sub.slug + '.json'), JSON.stringify(json, null, 2) + '\n')
    if (cover) writeAtomic(path.join(dirs.approved, sub.slug + '.webp'), cover)
    fs.rmSync(file, { force: true }); fs.rmSync(coverFile, { force: true })
    return `✅ Approved. ${gh ? 'GitHub did not take it, so it' : 'No GitHub token yet, so it'} is saved on the server in ${path.join(cfg.dataDir, 'approved', sub.slug + '.json')}. Copy it into routines/community/ by hand.`
  }

  async function onCallback(cb) {
    const m = /^rt:([a-z0-9]+):(ok|no):([0-9a-f]{12})$/.exec(cb.data || '')
    if (!m || m[1] !== tag) return
    if (String(cb.from?.id) !== cfg.tgChat && String(cb.message?.chat?.id) !== cfg.tgChat) {
      await tg('answerCallbackQuery', { callback_query_id: cb.id, text: 'Not yours to decide, sorry.' }).catch(() => {})
      return
    }
    await tg('answerCallbackQuery', { callback_query_id: cb.id, text: m[2] === 'ok' ? 'Approving…' : 'Rejecting…' }).catch(() => {})
    const result = await moderate(m[3], m[2] === 'ok')
    if (cb.message) {
      const old = (cb.message.text || '').slice(0, 3600)
      await tg('editMessageText', { chat_id: cb.message.chat.id, message_id: cb.message.message_id, text: `${tgEsc(old)}\n\n<b>${tgEsc(result)}</b>`, parse_mode: 'HTML', disable_web_page_preview: true }).catch(e => console.error('edit failed:', e.message))
    }
  }

  let polling = false
  async function poll() {
    if (!tg || polling) return
    polling = true
    let offset = 0
    while (polling) {
      try {
        const ups = await tg('getUpdates', { offset, timeout: 50, allowed_updates: ['callback_query'] })
        for (const u of ups) {
          offset = u.update_id + 1
          if (u.callback_query) await onCallback(u.callback_query).catch(e => console.error('callback failed:', e.message))
        }
      } catch (e) {
        console.error('telegram poll:', e.message)
        await new Promise(r => setTimeout(r, 10000))
      }
    }
  }

  /* ------------------------------- static files (staging, local runs) ------------------------------- */

  const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.xml': 'application/xml; charset=utf-8', '.md': 'text/plain; charset=utf-8' }
  function serveStatic(req, res, urlPath) {
    if (!cfg.siteDir) return send(res, 404, 'Not found', { 'content-type': 'text/plain' })
    let rel
    try { rel = decodeURIComponent(urlPath.slice(cfg.base.length)) } catch { return send(res, 400, 'Bad path', { 'content-type': 'text/plain' }) }
    if (rel.includes('\0') || rel.split('/').some(p => p === '..' || p.startsWith('.'))) return send(res, 404, 'Not found', { 'content-type': 'text/plain' })
    let file = path.join(cfg.siteDir, rel)
    if (!file.startsWith(path.resolve(cfg.siteDir))) return send(res, 404, 'Not found', { 'content-type': 'text/plain' })
    let st
    try { st = fs.statSync(file) } catch { return send(res, 404, 'Not found', { 'content-type': 'text/plain' }) }
    if (st.isDirectory()) {
      if (!urlPath.endsWith('/')) return send(res, 301, '', { location: urlPath + '/' })
      file = path.join(file, 'index.html')
      try { st = fs.statSync(file) } catch { return send(res, 404, 'Not found', { 'content-type': 'text/plain' }) }   // never a listing
    }
    const ext = path.extname(file)
    const headers = { 'content-type': TYPES[ext] || 'application/octet-stream', 'content-length': st.size }
    if (cfg.label) headers['x-robots-tag'] = 'noindex, nofollow'
    if (rel.startsWith('media/')) {
      // The licensed stills: our pages only. No hotlinking, no image search.
      const ref = String(req.headers.referer || '')
      if (ref && !ref.startsWith(cfg.origin + '/') && !ref.startsWith(`http://${req.headers.host}/`) && !ref.startsWith(`https://${req.headers.host}/`)) return send(res, 403, 'Forbidden', { 'content-type': 'text/plain' })
      headers['x-robots-tag'] = 'noindex, noimageindex'
      headers['cross-origin-resource-policy'] = 'same-origin'
      headers['cache-control'] = 'public, max-age=604800'
    } else if (ext === '.html') headers['cache-control'] = 'no-cache'
    else if (rel === 'index.json') { headers['access-control-allow-origin'] = '*'; headers['cache-control'] = 'public, max-age=3600' }
    else headers['cache-control'] = 'public, max-age=86400'
    if (ext === '.json' && rel.startsWith('plans/')) headers['content-disposition'] = `attachment; filename="${path.basename(file)}"`
    res.writeHead(200, { ...SECURITY, ...headers })
    if (req.method === 'HEAD') return res.end()
    fs.createReadStream(file).pipe(res)
  }

  const server = http.createServer(async (req, res) => {
    const urlPath = (req.url || '/').split('?')[0]
    try {
      if (urlPath.startsWith(cfg.api)) {
        const route = urlPath.slice(cfg.api.length)
        if (route === 'health' && req.method === 'GET') return send(res, 200, { ok: true })
        if (route === 'stats' && req.method === 'GET') return send(res, 200, { ok: true, copies: counts }, { 'cache-control': 'public, max-age=300' })
        if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method not allowed.' }, { allow: 'POST' })
        if (route === 'copy') return await handleCopy(req, res)
        if (route === 'preview') return await handlePreview(req, res)
        if (route === 'submit') return await handleSubmit(req, res)
        return send(res, 404, { ok: false, error: 'No such thing.' })
      }
      if ((req.method === 'GET' || req.method === 'HEAD') && (urlPath + '/').startsWith(cfg.base)) return serveStatic(req, res, urlPath === cfg.base.slice(0, -1) ? cfg.base : urlPath)
      send(res, 404, 'Not found', { 'content-type': 'text/plain' })
    } catch (e) {
      if (!res.headersSent) send(res, e.status || 500, { ok: false, error: e.status ? e.message : 'Something broke on our side.' })
      if (!e.status) console.error(e)
    }
  })

  return {
    server, moderate, onCallback, poll, stop: () => { polling = false; clearTimeout(saveTimer) },
    counts: () => counts, flush: () => writeAtomic(countsFile, JSON.stringify(counts)), reloadKnown: loadKnown
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const cfg = configFromEnv()
  const app = createApp(cfg)
  app.server.listen(cfg.port, () => console.log(`routines service on :${cfg.port}${cfg.label ? ` [${cfg.label}]` : ''}, api ${cfg.api}, telegram ${cfg.tgToken ? 'on' : 'off'}, github ${cfg.ghToken ? 'on' : 'off'}`))
  if (cfg.poll) app.poll()
  // Re-read the published list when the site is redeployed (cheap, once a minute).
  setInterval(app.reloadKnown, 60000).unref()
  const bye = () => { app.flush(); process.exit(0) }
  process.on('SIGTERM', bye)
  process.on('SIGINT', bye)
}
