// The community routines library (opengym.ch/routines): one place that knows what a routine file
// is. The validator (validate.mjs), the site build (build.mjs) and the submit service
// (service/server.mjs) all call checkRoutine() here, so a routine the service accepts is exactly a
// routine CI accepts. No dependencies beyond Node itself.
//
// A routine file is routines/<source>/<slug>.json (docs/ROUTINES_LIBRARY.md has the format). The
// app reads the published index.json; this module also turns a routine into the app's own share
// formats: a plan file (lib/plan-share.js) and a routine link (lib/routine-link.js).
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

export const SOURCES = ['starter', 'opengym', 'community']
export const GOALS = ['strength', 'muscle', 'general', 'fatloss', 'endurance']
export const LEVELS = ['beginner', 'intermediate', 'advanced']
export const SPLITS = ['full-body', 'upper-lower', 'ppl', 'push-pull', 'bro-split', 'other']
export const LICENSES = ['CC-BY-4.0', 'CC-BY-SA-4.0', 'CC0-1.0']
export const LANGS = ['en', 'ar', 'bn', 'cs', 'de', 'es', 'fa', 'fr', 'hi', 'hu', 'it', 'ko', 'pl', 'pt', 'pt-BR', 'ru', 'sv', 'th', 'tr', 'uk', 'zh', 'zh-TW']
export const LANG_NAMES = { en: 'English', ar: 'العربية', bn: 'বাংলা', cs: 'Čeština', de: 'Deutsch', es: 'Español', fa: 'فارسی', fr: 'Français', hi: 'हिन्दी', hu: 'Magyar', it: 'Italiano', ko: '한국어', pl: 'Polski', pt: 'Português', 'pt-BR': 'Português (Brasil)', ru: 'Русский', sv: 'Svenska', th: 'ไทย', tr: 'Türkçe', uk: 'Українська', zh: '中文', 'zh-TW': '中文（台灣）' }
export const LIMITS = {
  title: 80, author: 60, description: 400, about: 1500, sessionName: 40, sessionNote: 200, exNote: 160,
  tags: 8, tag: 24, sessions: 7, exercises: 20, setsPerSession: 40,
  sets: [1, 10], reps: [1, 100], sec: [5, 3600], rest: [0, 600], duration: [10, 180],
  coverBytes: 600 * 1024, coverSide: 2400
}
export const SLUG = /^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/
export const ROUTINE_ID = /^[a-z0-9][a-z0-9/_.-]{1,79}$/
export const SPLIT_NAMES = { 'full-body': 'Full body', 'upper-lower': 'Upper / lower', ppl: 'Push, pull, legs', 'push-pull': 'Push / pull', 'bro-split': 'Body-part split', other: 'Something else' }
export const GOAL_NAMES = { strength: 'Strength', muscle: 'Muscle', general: 'General fitness', fatloss: 'Fat loss', endurance: 'Endurance' }
export const LEVEL_NAMES = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' }

/* ------------------------------- the catalogue ------------------------------- */

// The few fields a routine needs of an exercise, keyed by id: name, equipment, body part, target,
// secondaries, hold, needs, machine kind, and the exercise a female drawing belongs to.
export function loadCatalogue(dir) {
  const ex = {}
  for (const f of fs.readdirSync(path.join(dir, 'exercises'))) {
    if (!f.endsWith('.json')) continue
    const e = JSON.parse(fs.readFileSync(path.join(dir, 'exercises', f), 'utf8'))
    ex[e.id] = liteOf(e)
  }
  return catalogueFrom({ ex })
}
const liteOf = e => {
  const o = { n: e.name || '' }
  if (e.equipment) o.eq = e.equipment
  if (e.bodyPart) o.bp = e.bodyPart
  if (e.target) o.t = e.target
  if (e.secondaryMuscles?.length) o.sm = e.secondaryMuscles
  if (e.hold) o.hold = 1
  if (e.needs?.length) o.needs = e.needs
  if (e.machineKind) o.mk = e.machineKind
  if (e.variantOf) o.v = e.variantOf
  return o
}
/** The catalogue as the service ships it (catalogue-lite.json), the same object loadCatalogue makes. */
export function catalogueFrom(lite) {
  const ex = lite.ex || {}
  const base = id => (ex[id]?.v && ex[ex[id].v] ? ex[ex[id].v] : ex[id])
  return {
    ex,
    has: id => typeof id === 'string' && Object.prototype.hasOwnProperty.call(ex, id),
    // A drawing of another exercise (variantOf) borrows that exercise's words.
    get: id => {
      const e = ex[id]
      if (!e) return null
      const b = base(id)
      return { ...b, ...(e.v ? {} : e), n: e.n || b.n, hold: e.hold || b.hold }
    }
  }
}
export const liteJSON = cat => JSON.stringify({ v: 1, ex: cat.ex })

/** Names in the other languages, for search and for a routine written in that language. */
export function loadNames(dir, ids) {
  const want = new Set(ids)
  const out = {}
  for (const lang of LANGS.filter(l => l !== 'en')) {
    let data
    try { data = JSON.parse(fs.readFileSync(path.join(dir, 'i18n', lang + '.json'), 'utf8')) } catch { continue }
    for (const id of want) if (data[id]?.name) (out[id] ||= {})[lang] = data[id].name
  }
  return out
}

/* ------------------------------- kit and muscles ------------------------------- */

// The site's equipment chips, from the catalogue's equipment words.
const KIT_OF = {
  barbell: 'barbell', 'ez barbell': 'barbell', 'olympic barbell': 'barbell', 'trap bar': 'barbell', landmine: 'barbell',
  dumbbell: 'dumbbell', kettlebell: 'kettlebell', cable: 'cable',
  'leverage machine': 'machine', 'smith machine': 'machine', 'sled machine': 'machine', 'stationary bike': 'machine', 'elliptical machine': 'machine', 'stepmill machine': 'machine', 'skierg machine': 'machine', 'upper body ergometer': 'machine',
  band: 'band', 'resistance band': 'band',
  'suspension trainer': 'suspension'
}
export const KIT = ['bodyweight', 'pull-up bar', 'bench', 'dumbbell', 'kettlebell', 'barbell', 'band', 'cable', 'machine', 'suspension', 'other']
export const KIT_NAMES = { bodyweight: 'Nothing, just me', 'pull-up bar': 'Pull-up bar', bench: 'Bench', dumbbell: 'Dumbbells', kettlebell: 'Kettlebell', barbell: 'Barbell', band: 'Bands', cable: 'Cable', machine: 'Machines', suspension: 'Suspension trainer', other: 'Other small kit' }
const NAME_BAR = /pull-?up|chin-?up|hanging|muscle-?up|\bbar hang/
const NAME_BENCH = /bench|incline|decline/

/** What an exercise needs, as site chips (empty for body weight with nothing else). */
export function kitOf(e) {
  if (!e) return []
  const out = new Set()
  if (e.eq && e.eq !== 'body weight') {
    if (e.eq === 'assisted') { if (e.mk && e.mk !== 'none') out.add('machine') }
    else out.add(KIT_OF[e.eq] || 'other')
  }
  const needs = new Set(e.needs || [])
  if (needs.has('pull-up bar') || NAME_BAR.test(e.n)) out.add('pull-up bar')
  if (needs.has('bench') || NAME_BENCH.test(e.n)) out.add('bench')
  return [...out]
}

// Fine muscles for the volume bars, and the six groups the focus filter uses.
const MUSCLE_OF = {
  pectorals: 'chest', chest: 'chest', 'upper chest': 'chest', 'serratus anterior': 'chest',
  lats: 'lats', 'latissimus dorsi': 'lats',
  'upper back': 'upper back', rhomboids: 'upper back', back: 'upper back',
  traps: 'traps', trapezius: 'traps', 'levator scapulae': 'traps',
  'lower back': 'lower back', spine: 'lower back',
  'front delts': 'front delts', delts: 'front delts', shoulders: 'side delts', deltoids: 'side delts',
  'side delts': 'side delts', 'rear delts': 'rear delts', 'rear deltoids': 'rear delts', 'rotator cuff': 'rear delts',
  biceps: 'biceps', brachialis: 'biceps', triceps: 'triceps',
  forearms: 'forearms', wrists: 'forearms', 'wrist flexors': 'forearms', 'wrist extensors': 'forearms', 'grip muscles': 'forearms', hands: 'forearms',
  quads: 'quads', quadriceps: 'quads', 'hip flexors': 'quads',
  hamstrings: 'hamstrings', glutes: 'glutes', abductors: 'glutes',
  adductors: 'adductors', 'inner thighs': 'adductors', groin: 'adductors',
  calves: 'calves', soleus: 'calves', shins: 'calves', ankles: 'calves', 'ankle stabilizers': 'calves', feet: 'calves',
  abs: 'abs', abdominals: 'abs', 'lower abs': 'abs', core: 'abs', obliques: 'obliques',
  'cardiovascular system': 'conditioning'
}
export const MUSCLE_ORDER = ['chest', 'lats', 'upper back', 'traps', 'lower back', 'front delts', 'side delts', 'rear delts', 'biceps', 'triceps', 'forearms', 'quads', 'hamstrings', 'glutes', 'adductors', 'calves', 'abs', 'obliques', 'conditioning']
export const GROUP_OF = {
  chest: 'chest', lats: 'back', 'upper back': 'back', traps: 'back', 'lower back': 'back',
  'front delts': 'shoulders', 'side delts': 'shoulders', 'rear delts': 'shoulders',
  biceps: 'arms', triceps: 'arms', forearms: 'arms',
  quads: 'legs', hamstrings: 'legs', adductors: 'legs', calves: 'legs', glutes: 'glutes',
  abs: 'core', obliques: 'core', conditioning: 'conditioning'
}
export const GROUPS = ['chest', 'back', 'shoulders', 'arms', 'legs', 'glutes', 'core', 'conditioning']
export const GROUP_NAMES = { chest: 'Chest', back: 'Back', shoulders: 'Shoulders', arms: 'Arms', legs: 'Legs', glutes: 'Glutes', core: 'Core', conditioning: 'Conditioning' }

/** How often each session is trained in a week: the schedule, or once each without one. */
export function weeklyCounts(r) {
  const n = r.sessions.map(() => 0)
  if (r.schedule?.length) r.schedule.forEach(([, i]) => { n[i]++ })
  else n.fill(1)
  return n
}

/** Weekly working sets per muscle: the target counts a whole set, each secondary half of one. */
export function weeklyVolume(r, cat) {
  const times = weeklyCounts(r)
  const out = {}
  r.sessions.forEach((s, i) => s.exercises.forEach(x => {
    const e = cat.get(x.id)
    if (!e) return
    const sets = x.sets * times[i]
    const prim = MUSCLE_OF[e.t]
    if (prim) out[prim] = (out[prim] || 0) + sets
    const seen = new Set([prim])
    for (const m of e.sm || []) {
      const k = MUSCLE_OF[m]
      if (k && !seen.has(k)) { seen.add(k); out[k] = (out[k] || 0) + sets / 2 }
    }
  }))
  return Object.fromEntries(MUSCLE_ORDER.filter(m => out[m]).map(m => [m, Math.round(out[m] * 2) / 2]))
}

/**
 * What a routine leans on, for the "muscle focus" filter: the groups (at most three) that get at
 * least 1.3 times the share of the week a balanced plan gives them, and at least a tenth of it.
 * Legs are a quarter of any sensible full-body week, so "a big share" alone would tag nearly
 * every routine as a leg routine; measured against a balanced week, only the ones that really
 * lean on legs are. Empty means balanced.
 */
export const BALANCED_SHARE = { chest: 0.09, back: 0.15, shoulders: 0.14, arms: 0.19, legs: 0.25, glutes: 0.1, core: 0.09, conditioning: 0.03 }
export function focusOf(volume) {
  const g = {}
  for (const [m, v] of Object.entries(volume)) g[GROUP_OF[m]] = (g[GROUP_OF[m]] || 0) + v
  const total = Object.values(g).reduce((a, b) => a + b, 0) || 1
  const lean = k => (g[k] || 0) / total / BALANCED_SHARE[k]
  return GROUPS
    .filter(k => (g[k] || 0) / total >= 0.1 && lean(k) >= 1.3)
    .sort((a, b) => lean(b) - lean(a)).slice(0, 3)
    .sort((a, b) => GROUPS.indexOf(a) - GROUPS.indexOf(b))
}

/* ------------------------------- validation ------------------------------- */

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v)
const intIn = (v, [lo, hi]) => Number.isInteger(v) && v >= lo && v <= hi
const CTRL = /[\u0000-\u0008\u000b-\u001f\u007f‪-‮⁦-⁩]/
const LINKISH = /https?:\/\/|www\.|\.(com|net|org|ru|xyz|io|ly)\b\//i
const DATE = /^\d{4}-\d{2}-\d{2}$/
const TOP_KEYS = ['title', 'author', 'license', 'added', 'language', 'goal', 'level', 'split', 'duration', 'description', 'about', 'tags', 'cover', 'coverAlt', 'sessions', 'schedule', 'builtin']
const SESSION_KEYS = ['name', 'note', 'exercises']
const EX_KEYS = ['id', 'sets', 'reps', 'repsMin', 'sec', 'rest', 'note']

/**
 * Checks one routine and returns { problems, routine }: `problems` are sentences a contributor can
 * act on ("Day 2, exercise 3: ..."), `routine` the normalised routine (null when it can't be one).
 *  opts.slug, opts.source: from the file's place (routines/<source>/<slug>.json)
 *  opts.cat: the catalogue (loadCatalogue / catalogueFrom)
 *  opts.starters: STARTER_PLANS, for a `builtin` routine
 *  opts.coverInfo: { bytes, width, height } of the cover file when there is one, or null if missing
 */
export function checkRoutine(raw, { slug, source, cat, starters = {}, coverInfo } = {}) {
  const problems = []
  const say = m => problems.push(m)
  if (!isMap(raw)) return { problems: ['not a JSON object'], routine: null }
  if (!SLUG.test(slug || '')) say(`the file name "${slug}" must be lowercase letters, digits and dashes, 3 to 60 long`)
  if (!SOURCES.includes(source)) say(`"${source}" is not a routines folder (${SOURCES.join(', ')})`)
  for (const k of Object.keys(raw)) if (!TOP_KEYS.includes(k)) say(`unknown field "${k}"`)
  const ours = source !== 'community'

  const text = (v, field, max, { required = true, min = 1, links = false } = {}) => {
    if (v == null || v === '') { if (required) say(`"${field}" is required`); return null }
    if (typeof v !== 'string') { say(`"${field}" must be text`); return null }
    const s = v.trim()
    if (s.length < min) say(`"${field}" is too short (at least ${min} characters)`)
    if (s.length > max) say(`"${field}" is too long (${s.length} of ${max} characters)`)
    if (CTRL.test(s)) say(`"${field}" has control characters in it`)
    if (!links && LINKISH.test(s)) say(`"${field}" can't hold links (put yours in author.url)`)
    if (ours && s.includes('—')) say(`"${field}": no em dashes in openGym's own copy`)
    return s
  }

  // A built-in starter plan takes its days from the app's own data, so the two never drift.
  let sessionsRaw = raw.sessions
  let scheduleRaw = raw.schedule
  if (raw.builtin != null) {
    if (source !== 'starter') say('"builtin" is only for routines/starter/')
    const plan = starters[raw.builtin]
    if (!plan) say(`"builtin": no starter plan "${raw.builtin}" in api/coach/core/starter-plans.js`)
    else {
      if (raw.sessions || raw.schedule) say('a "builtin" routine takes its sessions and schedule from the app; leave them out')
      const keys = plan.routines.map(r => r[0])
      sessionsRaw = plan.routines.map(([, name, , list]) => ({
        name, exercises: list.map(([id, sets, amount, mode]) => (mode === 'time' ? { id, sets, sec: amount } : { id, sets, reps: amount }))
      }))
      scheduleRaw = plan.schedule.map(([d, k]) => [d, keys.indexOf(k)])
    }
  } else if (source === 'starter') say('a routine in routines/starter/ names its plan in "builtin"')

  const title = text(raw.title, 'title', LIMITS.title, { min: 3 })
  const description = text(raw.description, 'description', LIMITS.description, { min: 20 })
  const about = text(raw.about, 'about', LIMITS.about, { required: false })
  const coverAlt = text(raw.coverAlt, 'coverAlt', 160, { required: false })

  let author = null
  if (!isMap(raw.author)) say('"author" must be { "name": "...", "url": "https://..." } (url optional)')
  else {
    for (const k of Object.keys(raw.author)) if (!['name', 'url'].includes(k)) say(`unknown field "author.${k}"`)
    const name = text(raw.author.name, 'author.name', LIMITS.author, { min: 2 })
    let url = null
    if (raw.author.url != null && raw.author.url !== '') {
      url = cleanHttpsUrl(raw.author.url)
      if (!url) say('"author.url" must be a plain https:// address')
    }
    if (name) author = { name, ...(url ? { url } : {}) }
  }
  if (!LICENSES.includes(raw.license)) say(`"license" must be one of: ${LICENSES.join(', ')}`)
  if (typeof raw.added !== 'string' || !DATE.test(raw.added) || Number.isNaN(Date.parse(raw.added))) say('"added" must be a date, YYYY-MM-DD')
  if (!LANGS.includes(raw.language)) say(`"language" must be one of: ${LANGS.join(', ')}`)
  if (!GOALS.includes(raw.goal)) say(`"goal" must be one of: ${GOALS.join(', ')}`)
  if (!LEVELS.includes(raw.level)) say(`"level" must be one of: ${LEVELS.join(', ')}`)
  if (!SPLITS.includes(raw.split)) say(`"split" must be one of: ${SPLITS.join(', ')}`)
  if (!intIn(raw.duration, LIMITS.duration)) say(`"duration" is minutes per session, ${LIMITS.duration[0]} to ${LIMITS.duration[1]}`)

  let tags = []
  if (raw.tags != null) {
    if (!Array.isArray(raw.tags)) say('"tags" must be a list of words')
    else {
      tags = [...new Set(raw.tags.map(t => (typeof t === 'string' ? t.trim().toLowerCase() : '')))]
      if (tags.length > LIMITS.tags) say(`at most ${LIMITS.tags} tags`)
      if (tags.some(t => !/^[\p{L}\p{N}][\p{L}\p{N} -]{0,23}$/u.test(t))) say(`a tag is a word or two, up to ${LIMITS.tag} letters`)
    }
  }

  const sessions = []
  if (!Array.isArray(sessionsRaw) || !sessionsRaw.length) say('"sessions" needs at least one day')
  else {
    if (sessionsRaw.length > LIMITS.sessions) say(`at most ${LIMITS.sessions} sessions`)
    sessionsRaw.slice(0, LIMITS.sessions).forEach((s, si) => {
      const where = `day ${si + 1}`
      if (!isMap(s)) { say(`${where}: must be { "name", "exercises" }`); return }
      for (const k of Object.keys(s)) if (!SESSION_KEYS.includes(k)) say(`${where}: unknown field "${k}"`)
      const name = text(s.name, `${where} name`, LIMITS.sessionName)
      const note = text(s.note, `${where} note`, LIMITS.sessionNote, { required: false })
      const list = Array.isArray(s.exercises) ? s.exercises : []
      if (!list.length) say(`${where}: needs at least one exercise`)
      if (list.length > LIMITS.exercises) say(`${where}: at most ${LIMITS.exercises} exercises`)
      const exercises = []
      list.slice(0, LIMITS.exercises).forEach((x, xi) => {
        const at = `${where}, exercise ${xi + 1}`
        if (!isMap(x)) { say(`${at}: must be { "id", "sets", "reps" }`); return }
        for (const k of Object.keys(x)) if (!EX_KEYS.includes(k)) say(`${at}: unknown field "${k}"`)
        const e = cat?.has(x.id) ? cat.get(x.id) : null
        if (!e) { say(`${at}: "${x.id}" is not in the openGym catalogue (catalogue/exercises/)`); return }
        const label = `${at} (${e.n})`
        if (!intIn(x.sets, LIMITS.sets)) say(`${label}: "sets" is ${LIMITS.sets[0]} to ${LIMITS.sets[1]}`)
        const hasReps = x.reps != null, hasSec = x.sec != null
        if (hasReps === hasSec) say(`${label}: give "reps" or "sec" (a hold), one of the two`)
        if (hasReps && !intIn(x.reps, LIMITS.reps)) say(`${label}: "reps" is ${LIMITS.reps[0]} to ${LIMITS.reps[1]}`)
        if (hasSec && !intIn(x.sec, LIMITS.sec)) say(`${label}: "sec" is ${LIMITS.sec[0]} to ${LIMITS.sec[1]} seconds`)
        if (x.repsMin != null && (!hasReps || !intIn(x.repsMin, [1, 99]) || !(x.repsMin < x.reps))) say(`${label}: "repsMin" is the low end of a range, below "reps"`)
        if (e.hold && hasReps) say(`${label}: this one is a hold, plan it in "sec"`)
        if (x.rest != null && !intIn(x.rest, LIMITS.rest)) say(`${label}: "rest" is ${LIMITS.rest[0]} to ${LIMITS.rest[1]} seconds`)
        const xnote = text(x.note, `${label} note`, LIMITS.exNote, { required: false })
        exercises.push({ id: x.id, sets: x.sets, ...(hasSec ? { sec: x.sec } : { reps: x.reps }), ...(x.repsMin != null ? { repsMin: x.repsMin } : {}), ...(x.rest != null ? { rest: x.rest } : {}), ...(xnote ? { note: xnote } : {}) })
      })
      const total = exercises.reduce((n, x) => n + (x.sets || 0), 0)
      if (total > LIMITS.setsPerSession) say(`${where}: ${total} sets is a lot for one session (at most ${LIMITS.setsPerSession})`)
      sessions.push({ name: name || `Day ${si + 1}`, ...(note ? { note } : {}), exercises })
    })
  }

  let schedule = []
  if (scheduleRaw != null) {
    if (!Array.isArray(scheduleRaw)) say('"schedule" is a list of [weekday, session] pairs')
    else {
      const days = new Set()
      scheduleRaw.forEach((p, i) => {
        if (!Array.isArray(p) || p.length !== 2 || !intIn(p[0], [0, 6]) || !intIn(p[1], [0, Math.max(0, sessions.length - 1)])) {
          say(`schedule entry ${i + 1}: [weekday 0 (Sunday) to 6, session 0 to ${Math.max(0, sessions.length - 1)}]`); return
        }
        if (days.has(p[0])) say(`schedule: weekday ${p[0]} is there twice`)
        days.add(p[0])
        schedule.push([p[0], p[1]])
      })
      sessions.forEach((s, i) => { if (schedule.length && !schedule.some(p => p[1] === i)) say(`schedule: "${s.name}" is never on the week`) })
      schedule.sort((a, b) => ((a[0] + 6) % 7) - ((b[0] + 6) % 7))
    }
  }

  let cover = null
  if (raw.cover != null) {
    const ok = typeof raw.cover === 'string' && new RegExp(`^${escapeRe(slug || '')}\\.(webp|jpg|jpeg|png)$`).test(raw.cover)
    if (!ok) say(`"cover" is the picture's file name next to the routine, "${slug}.webp" (or .jpg / .png)`)
    else if (coverInfo === null) say(`"cover": ${raw.cover} is missing`)
    else if (coverInfo) {
      if (coverInfo.bytes > LIMITS.coverBytes) say(`"cover": ${Math.round(coverInfo.bytes / 1024)} KB, keep it under ${LIMITS.coverBytes / 1024} KB`)
      if (!coverInfo.width || coverInfo.width > LIMITS.coverSide || coverInfo.height > LIMITS.coverSide) say(`"cover": at most ${LIMITS.coverSide} px a side, and a real jpg/png/webp`)
    }
    if (ok) cover = raw.cover
    if (ok && !coverAlt) say('"coverAlt" says in a sentence what the cover shows')
  }

  if (problems.length) return { problems, routine: null }
  const id = `${source}/${slug}`
  return {
    problems,
    routine: {
      id, slug, source, title, author, license: raw.license, added: raw.added, language: raw.language,
      goal: raw.goal, level: raw.level, split: raw.split, duration: raw.duration, description,
      ...(about ? { about } : {}), tags, ...(cover ? { cover, coverAlt } : {}),
      ...(raw.builtin ? { builtin: raw.builtin } : {}),
      sessions, ...(schedule.length ? { schedule } : {}),
      days: schedule.length || sessions.length
    }
  }
}
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function cleanHttpsUrl(v) {
  if (typeof v !== 'string' || v.length > 200 || /\s/.test(v)) return null
  let u
  try { u = new URL(v) } catch { return null }
  if (u.protocol !== 'https:' || u.username || u.password || !u.hostname.includes('.')) return null
  return u.href
}

/** Width and height of a jpg, png or webp from its first bytes, or null for anything else. */
export function imageInfo(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 30) return null
  if (buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return { type: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    const kind = buf.toString('latin1', 12, 16)
    if (kind === 'VP8X') return { type: 'webp', width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) }
    if (kind === 'VP8L') { const b = buf.readUInt32LE(21); return { type: 'webp', width: 1 + (b & 0x3fff), height: 1 + ((b >> 14) & 0x3fff) } }
    if (kind === 'VP8 ') return { type: 'webp', width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff }
    return null
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue }
      const m = buf[i + 1]
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7) || m === 0xff) { i += m === 0xff ? 1 : 2; continue }
      const len = buf.readUInt16BE(i + 2)
      if ((m >= 0xc0 && m <= 0xc3) || (m >= 0xc5 && m <= 0xc7) || (m >= 0xc9 && m <= 0xcb) || (m >= 0xcd && m <= 0xcf)) return { type: 'jpg', width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) }
      i += 2 + len
    }
  }
  return null
}

/* ------------------------------- derived facts ------------------------------- */

/** Everything the site shows or filters on that is read off the routine rather than written. */
export function factsOf(r, cat) {
  const kit = new Set()
  let exerciseCount = 0
  const ids = new Set()
  r.sessions.forEach(s => s.exercises.forEach(x => { exerciseCount++; ids.add(x.id); kitOf(cat.get(x.id)).forEach(k => kit.add(k)) }))
  const volume = weeklyVolume(r, cat)
  const weekSets = weeklyCounts(r).reduce((n, t, i) => n + t * r.sessions[i].exercises.reduce((a, x) => a + x.sets, 0), 0)
  return { kit: KIT.filter(k => kit.has(k)), volume, focus: focusOf(volume), weekSets, exerciseCount, ids: [...ids] }
}

/** The catalogue equipment words a routine needs (the index's `equipment`; empty is body weight). */
export function equipmentWords(r, cat) {
  const eq = new Set()
  r.sessions.forEach(s => s.exercises.forEach(x => {
    const e = cat.get(x.id)
    if (e?.eq && e.eq !== 'body weight') eq.add(e.eq)
    kitOf(e).forEach(k => { if (k === 'pull-up bar' || k === 'bench') eq.add(k) })
  }))
  return [...eq].sort()
}

/** One routine as an entry of the app's index (docs/ROUTINES_LIBRARY.md, format 1). */
export function indexEntry(r, cat, pageUrl) {
  return {
    id: r.id, title: r.title, author: r.author.name, goal: r.goal, level: r.level, split: r.split,
    days: r.days, duration: r.duration, equipment: equipmentWords(r, cat), language: r.language,
    description: r.description, url: pageUrl,
    sessions: r.sessions.map(s => ({ name: s.name, exercises: s.exercises.map(x => ({ id: x.id, sets: x.sets, ...(x.sec ? { sec: x.sec } : { reps: x.reps }), ...(x.rest != null ? { rest: x.rest } : {}) })) })),
    ...(r.schedule ? { schedule: r.schedule } : {})
  }
}

/* ------------------------------- the app's share formats ------------------------------- */

const GLYPH = { barbell: 'barbell', dumbbell: 'dumbbell', 'pull-up bar': 'pullup' }
const exToPlan = x => ({
  id: x.id, sets: x.sets,
  ...(x.sec ? { mode: 'time', sec: x.sec } : { reps: x.reps, ...(x.repsMin ? { repsMin: x.repsMin } : {}) }),
  ...(x.rest ? { restSec: x.rest } : {}),
  ...(x.note ? { note: x.note } : {})
})
const routineOf = (s, i, cat) => {
  const kit = new Set(s.exercises.flatMap(x => kitOf(cat.get(x.id))))
  const glyph = ['barbell', 'dumbbell', 'pull-up bar'].find(k => kit.has(k))
  return { id: 'r' + i, name: s.name, emoji: GLYPH[glyph] || 'figureStrength', ex: s.exercises.map(exToPlan) }
}

/** The whole routine as a plan file, the file Plan > Import reads (frontend/src/lib/plan-share.js). */
export function planFile(r, cat) {
  const week = {}
  ;(r.schedule || []).forEach(([d, i]) => { (week[d] ||= []).push('r' + i) })
  // `from`: the author, which the app shows on the import sheet when the page's link opens it
  // (frontend/src/lib/library-link.js); an app that does not know it simply ignores it.
  return { opengym_plan: 1, exported: r.added, name: r.title.slice(0, 60), unit: 'kg', week, routines: r.sessions.map((s, i) => routineOf(s, i, cat)), customEx: [], from: r.author.name.slice(0, 40) }
}

/** One day as a routine link bundle (frontend/src/lib/routine-link.js routineLinkBundle). */
export function linkBundle(r, i, cat) {
  const s = r.sessions[i]
  const names = {}
  s.exercises.forEach(x => { const e = cat.get(x.id); if (e?.n) names[x.id] = e.n })
  return { opengym_plan: 1, name: s.name, unit: 'kg', routines: [routineOf(s, i, cat)], names, from: r.author.name.slice(0, 40) }
}

export const toBase64Url = buf => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
/** A bundle as a link payload, `1.d.<deflate-raw, base64url>`, what CompressionStream makes in the app. */
export const encodePayload = bundle => '1.d.' + toBase64Url(zlib.deflateRawSync(Buffer.from(JSON.stringify(bundle)), { level: 9 }))
export const LINK_BASE = 'https://opengym.ch/r'
export const MAX_LINK = 2000

/** The day's https link, or null when it would be too long for a link (the plan file still works). */
export function dayLink(r, i, cat) {
  const url = `${LINK_BASE}#${encodePayload(linkBundle(r, i, cat))}`
  return url.length > MAX_LINK ? null : url
}

/* ------------------------------- reading what people submit ------------------------------- */

const MAX_PAYLOAD = 16000
const MAX_JSON = 256 * 1024

/** A routine link's payload back to its bundle (Node side of routine-link.js decodePayload). */
export function decodePayload(p) {
  const m = /^(\d{1,4})\.([a-z])\.([A-Za-z0-9_-]+)$/.exec(String(p || '').trim())
  if (!m || p.length > MAX_PAYLOAD || m[1] !== '1') throw new Error('That link is not an openGym routine link, or it is cut off.')
  let bytes = Buffer.from(m[3].replace(/-/g, '+').replace(/_/g, '/'), 'base64')
  if (m[2] === 'd') {
    try { bytes = zlib.inflateRawSync(bytes, { maxOutputLength: MAX_JSON }) } catch { throw new Error('That link is cut off or garbled.') }
  } else if (m[2] !== 'j') throw new Error('That link is from a newer openGym than this page knows.')
  try { return JSON.parse(bytes.toString('utf8')) } catch { throw new Error('That link is cut off or garbled.') }
}

/** The payload of an https://opengym.ch/r#… or opengym://r#… link, or null. */
export function payloadFromLink(s) {
  const t = String(s || '').trim()
  const m = /^(?:https:\/\/(?:www\.)?opengym\.ch\/r\/?|opengym:\/\/r\/?)#(\d{1,4}\.[a-z]\.[A-Za-z0-9_-]+)$/.exec(t) || /#\/r\/(\d{1,4}\.[a-z]\.[A-Za-z0-9_-]+)$/.exec(t)
  return m ? m[1] : null
}

/**
 * An app plan file or routine link bundle as routine sessions + schedule, for the submit form.
 * Throws an Error with a sentence for people when it can't be one (custom exercises, not a plan).
 */
export function sessionsFromPlan(data, cat) {
  if (!isMap(data) || !data.opengym_plan || !Array.isArray(data.routines)) throw new Error('That is not an openGym plan file or routine link.')
  const customs = new Map((Array.isArray(data.customEx) ? data.customEx : []).filter(isMap).map(c => [c.id, c.n || 'a custom exercise']))
  const routines = data.routines.filter(r => isMap(r) && Array.isArray(r.ex) && r.ex.length).slice(0, LIMITS.sessions)
  if (!routines.length) throw new Error('That plan has no routines with exercises in it.')
  const index = new Map(routines.map((r, i) => [r.id, i]))
  const sessions = routines.map((r, i) => ({
    name: (typeof r.name === 'string' && r.name.trim() ? r.name.trim() : `Day ${i + 1}`).slice(0, LIMITS.sessionName),
    exercises: r.ex.slice(0, LIMITS.exercises).map(e => {
      if (!isMap(e)) throw new Error('One of the exercises in that plan is broken.')
      if (customs.has(e.id) || !cat.has(e.id)) throw new Error(`"${customs.get(e.id) || e.id}" is a custom exercise. Swap it for one from the openGym list, then share again.`)
      const sets = Math.min(10, Math.max(1, Number.isInteger(e.sets) ? e.sets : 3))
      const rest = Number.isInteger(e.restSec) && e.restSec > 0 ? Math.min(600, e.restSec) : null
      const note = typeof e.note === 'string' && e.note.trim() ? e.note.trim().slice(0, LIMITS.exNote) : null
      let amount
      if (e.mode === 'time') amount = { sec: Math.min(3600, Math.max(5, Number(e.sec) || 30)) }
      else if (e.mode === 'cardio') amount = { sec: Math.min(3600, Math.max(5, Math.round((Number(e.min) || 20) * 60))) }
      else {
        const pyr = Array.isArray(e.pyramid) ? e.pyramid.filter(n => Number.isInteger(n) && n > 0) : []
        const reps = Math.min(100, Math.max(1, Number.isInteger(e.reps) ? e.reps : pyr[0] || 10))
        amount = { reps, ...(Number.isInteger(e.repsMin) && e.repsMin >= 1 && e.repsMin < reps ? { repsMin: e.repsMin } : {}) }
      }
      if (cat.get(e.id)?.hold && amount.reps) amount = { sec: Math.min(3600, Math.max(5, amount.reps)) }
      return { id: e.id, sets, ...amount, ...(rest ? { rest } : {}), ...(note ? { note } : {}) }
    })
  }))
  const schedule = []
  if (isMap(data.week)) {
    for (const [d, v] of Object.entries(data.week)) {
      const day = Number(d)
      const first = [].concat(v).map(id => index.get(id)).find(i => i != null)
      if (Number.isInteger(day) && day >= 0 && day <= 6 && first != null) schedule.push([day, first])
    }
  }
  // A week that leaves a routine out is dropped rather than half kept: the routine stands as a list.
  const complete = schedule.length && sessions.every((_, i) => schedule.some(p => p[1] === i))
  return { sessions, schedule: complete ? schedule.sort((a, b) => ((a[0] + 6) % 7) - ((b[0] + 6) % 7)) : [], from: typeof data.from === 'string' ? data.from.slice(0, 40) : '' }
}

/** A title as a file name: "Pull-up bar basics!" → "pull-up-bar-basics". */
export function slugify(s) {
  const base = String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50).replace(/-+$/g, '')
  return base.length >= 3 ? base : ('routine-' + base).replace(/-+$/, '') || 'routine'
}

/* ------------------------------- the repository ------------------------------- */

/** Reads and checks every routine under `dir` (routines/). { routines, problems: ["file: ..."] } */
export function loadAll(dir, { cat, starters }) {
  const routines = []
  const problems = []
  const slugs = new Map()
  for (const source of SOURCES) {
    const folder = path.join(dir, source)
    let files = []
    try { files = fs.readdirSync(folder).sort() } catch { continue }
    for (const f of files) {
      const rel = `routines/${source}/${f}`
      if (/\.(webp|jpg|jpeg|png)$/.test(f) || f === 'README.md' || f === '.gitkeep') continue
      if (!f.endsWith('.json')) { problems.push(`${rel}: only routine .json files and their cover pictures go here`); continue }
      const slug = f.slice(0, -5)
      let raw
      try { raw = JSON.parse(fs.readFileSync(path.join(folder, f), 'utf8')) } catch (e) { problems.push(`${rel}: not valid JSON (${e.message})`); continue }
      let coverInfo
      if (typeof raw?.cover === 'string' && !raw.cover.includes('/')) {
        try {
          const buf = fs.readFileSync(path.join(folder, raw.cover))
          const info = imageInfo(buf)
          coverInfo = { bytes: buf.length, width: info?.width || 0, height: info?.height || 0 }
        } catch { coverInfo = null }
      }
      const { problems: p, routine } = checkRoutine(raw, { slug, source, cat, starters, coverInfo })
      p.forEach(m => problems.push(`${rel}: ${m}`))
      if (!routine) continue
      if (slugs.has(slug)) { problems.push(`${rel}: the name "${slug}" is taken by ${slugs.get(slug)} (pages live at /routines/<name>/)`); continue }
      slugs.set(slug, rel)
      routine.file = rel
      routines.push(routine)
    }
  }
  // Cover pictures with no routine are someone's leftover upload.
  for (const source of SOURCES) {
    let files = []
    try { files = fs.readdirSync(path.join(dir, source)) } catch { continue }
    for (const f of files) if (/\.(webp|jpg|jpeg|png)$/.test(f) && !routines.some(r => r.source === source && r.cover === f)) problems.push(`routines/${source}/${f}: no routine uses this picture`)
  }
  return { routines, problems }
}
