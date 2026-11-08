// node --test scripts/routines/   (CI: the routines job in .github/workflows/test.yml)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { validateRepo, ROOT } from './validate.mjs'
import { build, navFrom, parseArgs } from './build.mjs'
import {
  checkRoutine, catalogueFrom, factsOf, indexEntry, planFile, linkBundle, encodePayload, decodePayload, payloadFromLink,
  sessionsFromPlan, slugify, imageInfo, kitOf, weeklyVolume, focusOf, dayLink
} from './lib.mjs'
import { normalizeIndex } from '../../api/coach/core/routine-library.js'
import * as F from '../../website/routines/filter.mjs'
import { createApp, moderationText, keyboard, envTag, Limiter, routineFromRequest, planFromRequest } from './service/server.mjs'

const repo = validateRepo()
const cat = repo.cat
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'routines-test-'))

const good = () => ({
  title: 'Pull-up bar basics', author: { name: 'Ana', url: 'https://example.org/ana' }, license: 'CC-BY-4.0', added: '2026-11-08',
  language: 'en', goal: 'general', level: 'beginner', split: 'full-body', duration: 40,
  description: 'Three short sessions for a doorway bar and the floor.', tags: ['home'],
  sessions: [
    { name: 'Bar A', exercises: [{ id: '0652', sets: 3, reps: 6, rest: 120 }, { id: '0463', sets: 3, sec: 40 }] },
    { name: 'Bar B', exercises: [{ id: '0662', sets: 3, reps: 10, repsMin: 8 }] }
  ],
  schedule: [[1, 0], [3, 1], [5, 0]]
})
const check = (raw, more = {}) => checkRoutine(raw, { slug: 'pullup-test', source: 'community', cat, ...more })

/* ------------------------------- the repository ------------------------------- */

test('every routine in routines/ passes the validator', () => {
  assert.deepEqual(repo.problems, [])
  assert.ok(repo.routines.length >= 20)
  assert.ok(repo.routines.some(r => r.source === 'starter' && r.builtin === 'ppl' && r.sessions.length === 3))
})

test('a starter routine takes its days from the app', () => {
  const r = repo.routines.find(x => x.id === 'starter/5x5')
  assert.equal(r.sessions[0].exercises[0].id, '0043')
  assert.deepEqual(r.schedule, [[1, 0], [3, 1], [5, 2]])
})

/* ------------------------------- the validator ------------------------------- */

test('a good routine passes and comes back normalised', () => {
  const { problems, routine } = check(good())
  assert.deepEqual(problems, [])
  assert.equal(routine.id, 'community/pullup-test')
  assert.equal(routine.days, 3)
})

test('an exercise the catalogue does not hold is refused', () => {
  const r = good(); r.sessions[0].exercises[0].id = '99999'
  assert.match(check(r).problems.join('\n'), /not in the openGym catalogue/)
})

test('silly numbers are refused', () => {
  const cases = [
    [x => { x.sessions[0].exercises[0].sets = 0 }, /"sets"/],
    [x => { x.sessions[0].exercises[0].sets = 11 }, /"sets"/],
    [x => { x.sessions[0].exercises[0].reps = 500 }, /"reps"/],
    [x => { x.sessions[0].exercises[1].sec = 2 }, /"sec"/],
    [x => { x.sessions[0].exercises[0].rest = 9999 }, /"rest"/],
    [x => { x.sessions[0].exercises[0].sec = 30 }, /one of the two/],
    [x => { x.sessions[1].exercises[0].repsMin = 12 }, /repsMin/],
    [x => { x.sessions[0].exercises[1] = { id: '0463', sets: 3, reps: 10 } }, /a hold/],
    [x => { x.duration = 2 }, /duration/],
    [x => { x.sessions[0].exercises = Array.from({ length: 5 }, () => ({ id: '0652', sets: 10, reps: 5 })) }, /a lot for one session/],
    [x => { x.schedule = [[1, 0], [1, 1]] }, /twice/],
    [x => { x.schedule = [[1, 0]] }, /never on the week/],
    [x => { x.schedule = [[9, 0]] }, /schedule entry/]
  ]
  for (const [edit, re] of cases) { const r = good(); edit(r); assert.match(check(r).problems.join('\n'), re, String(edit)) }
})

test('required fields, licence, credit and words', () => {
  const r = good()
  delete r.title; r.license = 'all rights reserved'; r.author = { name: '' }; r.goal = 'huge'
  r.description = 'Buy now at https://spam.example/ cheap cheap cheap'
  const p = check(r).problems.join('\n')
  for (const re of [/"title" is required/, /"license"/, /author.name/, /"goal"/, /can't hold links/]) assert.match(p, re)
  assert.match(check({ ...good(), author: { name: 'Ana', url: 'javascript:alert(1)' } }).problems.join(), /author.url/)
  assert.match(check({ ...good(), extra: 1 }).problems.join(), /unknown field "extra"/)
})

test('em dashes are only refused in our own copy', () => {
  const r = { ...good(), description: 'Short sessions — for a doorway bar and the floor.' }
  assert.deepEqual(check(r).problems, [])
  assert.match(check(r, { source: 'opengym' }).problems.join(), /em dash/)
})

test('file names and covers', () => {
  assert.match(check(good(), { slug: 'Bad Name' }).problems.join(), /file name/)
  assert.match(check({ ...good(), cover: 'other.webp', coverAlt: 'x' }).problems.join(), /"cover"/)
  assert.match(check({ ...good(), cover: 'pullup-test.webp', coverAlt: 'A bar' }, { coverInfo: null }).problems.join(), /missing/)
  assert.match(check({ ...good(), cover: 'pullup-test.webp', coverAlt: 'A bar' }, { coverInfo: { bytes: 2e6, width: 800, height: 600 } }).problems.join(), /KB/)
  assert.match(check({ ...good(), cover: 'pullup-test.webp' }, { coverInfo: { bytes: 1000, width: 800, height: 600 } }).problems.join(), /coverAlt/)
})

test('imageInfo reads jpg, png and webp sizes and nothing else', () => {
  const png = Buffer.alloc(40); Buffer.from([0x89, 0x50, 0x4e, 0x47]).copy(png); png.writeUInt32BE(640, 16); png.writeUInt32BE(480, 20)
  assert.deepEqual(imageInfo(png), { type: 'png', width: 640, height: 480 })
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, 0x01, 0xe0, 0x02, 0x80, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
  assert.deepEqual(imageInfo(jpg), { type: 'jpg', width: 640, height: 480 })
  const still = fs.readFileSync(path.join(ROOT, 'catalogue/media/still/0025.webp'))   // bytes only, never decoded
  assert.equal(imageInfo(still).type, 'webp')
  assert.equal(imageInfo(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>                ')), null)
})

/* ------------------------------- facts, index, share formats ------------------------------- */

test('kit, volume and focus are read off the exercises', () => {
  assert.deepEqual(kitOf(cat.get('0652')), ['pull-up bar'])
  assert.deepEqual(kitOf(cat.get('0662')), [])
  assert.deepEqual(kitOf(cat.get('0025')).sort(), ['barbell', 'bench'])
  const r = check(good()).routine
  const v = weeklyVolume(r, cat)
  assert.equal(v.lats, 3 * 2)               // 3 sets of pull-ups, Bar A twice a week
  assert.ok(focusOf(v).includes('back'))
  assert.deepEqual(factsOf(r, cat).kit, ['pull-up bar'])
})

test('the index entry is one the app reads', () => {
  const r = check(good()).routine
  const idx = { format: 'opengym-routines', version: 1, routines: [indexEntry(r, cat, 'https://opengym.ch/routines/pullup-test/')] }
  const { entries } = normalizeIndex(idx)
  assert.equal(entries.length, 1)
  assert.deepEqual(entries[0].equipment, ['pull-up bar'])
  assert.deepEqual(entries[0].schedule, [[1, 0], [3, 1], [5, 0]])
  assert.equal(entries[0].sessions[0].exercises[1].sec, 40)
})

test('the plan file is the app\'s format, with the week', () => {
  const p = planFile(check(good()).routine, cat)
  assert.equal(p.opengym_plan, 1)
  assert.deepEqual(p.week, { 1: ['r0'], 3: ['r1'], 5: ['r0'] })
  assert.deepEqual(p.routines[0].ex[0], { id: '0652', sets: 3, reps: 6, restSec: 120 })
  assert.deepEqual(p.routines[0].ex[1], { id: '0463', sets: 3, mode: 'time', sec: 40 })
  assert.equal(p.routines[1].ex[0].repsMin, 8)
})

test('a day link round-trips through the app\'s link format', async () => {
  const r = check(good()).routine
  const url = dayLink(r, 0, cat)
  assert.ok(url.startsWith('https://opengym.ch/r#1.d.'))
  const payload = payloadFromLink(url)
  const bundle = decodePayload(payload)
  assert.deepEqual(bundle, linkBundle(r, 0, cat))
  assert.equal(bundle.from, 'Ana')
  assert.equal(bundle.names['0652'], 'pull-up')
  // Inflated the way the app and the /r page do it, with DecompressionStream.
  const b64 = payload.split('.')[2].replace(/-/g, '+').replace(/_/g, '/')
  const ds = new DecompressionStream('deflate-raw')
  const text = await new Response(new Blob([Buffer.from(b64, 'base64')]).stream().pipeThrough(ds)).text()
  assert.deepEqual(JSON.parse(text), bundle)
})

test('reading a plan file or link people submit', () => {
  const plan = planFile(check(good()).routine, cat)
  const got = sessionsFromPlan(plan, cat)
  assert.equal(got.sessions.length, 2)
  assert.deepEqual(got.schedule, [[1, 0], [3, 1], [5, 0]])
  assert.deepEqual(got.sessions[0].exercises[0], { id: '0652', sets: 3, reps: 6, rest: 120 })
  assert.throws(() => sessionsFromPlan({ ...plan, customEx: [{ id: 'c1', n: 'My thing' }], routines: [{ id: 'r0', name: 'X', ex: [{ id: 'c1', sets: 3, reps: 5 }] }] }, cat), /custom exercise/)
  assert.throws(() => sessionsFromPlan({ hello: 1 }, cat), /not an openGym plan/)
  assert.equal(payloadFromLink('https://evil.example/r#1.d.abc'), null)
  assert.equal(payloadFromLink('opengym://r#1.j.e30'), '1.j.e30')
  assert.throws(() => decodePayload('1.d.' + Buffer.from(zlib.deflateRawSync(Buffer.alloc(400000, 32))).toString('base64url')), /cut off|garbled/)
  assert.equal(slugify('Pull-up bar basics!'), 'pull-up-bar-basics')
  assert.equal(slugify('Ganzkörper zu Hause'), 'ganzkorper-zu-hause')
  assert.equal(slugify('!!'), 'routine')
})

/* ------------------------------- the site build ------------------------------- */

test('the build writes pages, the app index, plan files and only the stills it shows', () => {
  const out = path.join(tmp, 'site')
  const lite = path.join(tmp, 'lite.json')
  const r = build(parseArgs(['--out', out, '--lite', lite]))
  const index = JSON.parse(fs.readFileSync(path.join(out, 'index.json'), 'utf8'))
  assert.equal(normalizeIndex(index).entries.length, index.routines.length)
  assert.ok(!index.routines.some(x => x.id.startsWith('starter/')), 'built-in plans stay out of the index')
  assert.ok(index.routines.every(x => x.url.startsWith('https://opengym.ch/routines/')))
  for (const x of r.routines) {
    assert.ok(fs.existsSync(path.join(out, x.slug, 'index.html')))
    assert.ok(fs.existsSync(path.join(out, 'plans', x.slug + '.opengym-plan.json')))
  }
  const media = fs.readdirSync(path.join(out, 'media')).filter(f => f.endsWith('.webp'))
  assert.equal(media.length, r.media)
  assert.ok(media.length < 400, 'never the whole catalogue')
  assert.ok(fs.existsSync(path.join(out, 'media/NOTICE.md')))
  const page = fs.readFileSync(path.join(out, 'pullup-bar-basics/index.html'), 'utf8')
  assert.match(page, /"@type":"ExercisePlan"/)
  assert.match(page, /<link rel="canonical" href="https:\/\/opengym.ch\/routines\/pullup-bar-basics\/">/)
  assert.match(page, /href="https:\/\/opengym.ch\/r#1\.d\./)
  assert.match(page, /gymvisual\.com/)
  assert.doesNotMatch(page, /noindex/)
  assert.match(fs.readFileSync(path.join(out, 'sitemap.xml'), 'utf8'), /routines\/ten-sets-of-ten\//)
  assert.match(fs.readFileSync(path.join(out, 'assets/list.js'), 'utf8'), /filter\.mjs\?v=/)
  // German routine: German exercise names where the catalogue has them.
  assert.match(fs.readFileSync(path.join(out, 'ganzkoerper-zuhause/index.html'), 'utf8'), /<html lang="en">[\s\S]*<h1 lang="de">/)
  assert.ok(JSON.parse(fs.readFileSync(lite, 'utf8')).ex['0025'])
})

test('staging builds are noindex and carry their own base', () => {
  const out = path.join(tmp, 'stage')
  build(parseArgs(['--out', out, '--base', '/routines-staging-x/', '--staging']))
  const page = fs.readFileSync(path.join(out, 'index.html'), 'utf8')
  assert.match(page, /noindex,nofollow/)
  assert.match(page, /href="\/routines-staging-x\/assets\/routines\.css/)
  assert.match(page, /"api":"\/routines-staging-x\/api\/"/)
  assert.match(page, /<a class="ql site" href="\/routines-staging-x\/" aria-current="page">Routines<\/a>/)
  assert.equal(page.match(/>Routines<\/a>/g).length, 2, 'one link in the bar, one in the sheet')
})

test('the header is the site\'s own, with Routines added', () => {
  const html = fs.readFileSync(path.join(ROOT, 'website/index.html'), 'utf8')
  const nav = navFrom(html, '/routines/')('routines')
  assert.match(nav, /<a class="ql site" href="\/routines\/" aria-current="page">Routines<\/a>/)
  assert.match(nav, /<a class="nl" href="\/routines\/" aria-current="page">Routines<\/a>/)
  assert.match(nav, /class="brand-mark"|src="\/icon-180.png"/)
})

/* ------------------------------- the list's filters ------------------------------- */

const R = [
  { s: 'a', id: 'x/a', t: 'Pull-up bar basics', d: 'Doorway bar', a: 'Ana', g: 'general', l: 'beginner', sp: 'full-body', n: 3, m: 40, k: ['pull-up bar'], f: ['back', 'core'], lang: 'en', tags: ['home'], at: '2026-11-01', ex: ['0652'], sn: ['Bar A'] },
  { s: 'b', id: 'x/b', t: 'Barbell strength', d: 'Heavy', a: 'Bo', g: 'strength', l: 'intermediate', sp: 'upper-lower', n: 4, m: 75, k: ['barbell', 'bench'], f: ['legs', 'chest'], lang: 'en', tags: [], at: '2026-11-05', ex: ['0025'], sn: ['Upper'] },
  { s: 'c', id: 'x/c', t: 'Ganzkörper', d: 'Zuhause', a: 'Cy', g: 'general', l: 'beginner', sp: 'full-body', n: 3, m: 30, k: [], f: ['legs'], lang: 'de', tags: ['zuhause'], at: '2026-11-03', ex: ['0662'], sn: ['Tag A'] }
]
const pick = (st, names) => R.filter(r => F.matches(r, st, F.haystack(r, names))).map(r => r.s)
const st = over => ({ ...F.emptyState(), ...over })

test('filters: each group narrows, groups combine', () => {
  assert.deepEqual(pick(st({ goal: ['general'] })), ['a', 'c'])
  assert.deepEqual(pick(st({ days: ['4'] })), ['b'])
  assert.deepEqual(pick(st({ len: '30' })), ['c'])
  assert.deepEqual(pick(st({ len: '61' })), ['b'])
  assert.deepEqual(pick(st({ level: ['beginner'], lang: ['de'] })), ['c'])
  assert.deepEqual(pick(st({ focus: ['chest', 'core'] })), ['a', 'b'])
  assert.deepEqual(pick(st({ split: ['upper-lower'] })), ['b'])
})

test('filters: "what you have" keeps routines that need nothing more', () => {
  assert.deepEqual(pick(st({ kit: ['bodyweight'] })), ['c'])
  assert.deepEqual(pick(st({ kit: ['pull-up bar'] })), ['a', 'c'])
  assert.deepEqual(pick(st({ kit: ['barbell'] })), ['c'])
  assert.deepEqual(pick(st({ kit: ['barbell', 'bench', 'pull-up bar'] })), ['a', 'b', 'c'])
})

test('search: titles, authors, accents and exercise names in any language', () => {
  assert.deepEqual(pick(st({ q: 'barbell' })), ['b'])
  assert.deepEqual(pick(st({ q: 'ganzkorper' })), ['c'])
  assert.deepEqual(pick(st({ q: 'ana doorway' })), ['a'])
  const names = { '0025': 'barbell bench press | bankdrücken mit der langhantel', '0662': 'push-up | liegestütz' }
  assert.deepEqual(pick(st({ q: 'bankdrucken' }), names), ['b'])
  assert.deepEqual(pick(st({ q: 'liegestütz' }), names), ['c'])
})

test('facet counts, sorting and the address round-trip', () => {
  const options = { goal: ['general', 'strength', 'muscle'], days: ['3', '4'], len: ['30', '45', '60', '61'], kit: ['bodyweight', 'barbell'], level: [], focus: [], split: [], lang: ['en', 'de'] }
  const c = F.facetCounts(R, st({ lang: ['en'] }), options)
  assert.equal(c.goal.general, 1)
  assert.equal(c.goal.muscle, 0)
  assert.equal(c.lang.de, 1)               // a group's own options count as if picked instead
  assert.deepEqual(F.sortRoutines(R, 'new').map(r => r.s), ['b', 'c', 'a'])
  assert.deepEqual(F.sortRoutines(R, 'name').map(r => r.s), ['b', 'c', 'a'])
  assert.deepEqual(F.sortRoutines(R, 'short').map(r => r.s), ['c', 'a', 'b'])
  assert.deepEqual(F.sortRoutines(R, 'popular', { 'x/a': 9, 'x/c': 2 }).map(r => r.s), ['a', 'c', 'b'])
  const s = st({ q: 'bar', goal: ['general', 'strength'], len: '45', kit: ['pull-up bar'], sort: 'popular' })
  const q = F.queryFromState(s)
  assert.equal(q, '?q=bar&goal=general,strength&len=45&kit=pull-up+bar&sort=popular')
  assert.deepEqual(F.stateFromQuery(q), s)
  assert.equal(F.activeCount(s), 4)
  assert.deepEqual(F.stateFromQuery('?len=999&sort=evil'), F.emptyState())
})

/* ------------------------------- the service ------------------------------- */

function startApp(over = {}) {
  const dataDir = fs.mkdtempSync(path.join(tmp, 'svc-'))
  const routinesFile = path.join(dataDir, 'routines.json')
  fs.writeFileSync(routinesFile, JSON.stringify([{ id: 'opengym/pullup-bar-basics', slug: 'pullup-bar-basics' }]))
  const sent = []
  const committed = []
  let t = Date.parse('2026-11-08T12:00:00Z')
  const app = createApp({ base: '/routines/', api: '/routines/api/', siteDir: '', dataDir, label: 'STAGING', origin: 'https://opengym.ch', tgChat: '42', ghBranch: 'routines-inbox', ...over.cfg }, {
    cat, routinesFile, saveDelay: 0, now: () => t,
    telegram: async (method, payload, file) => { sent.push({ method, payload, file }); return {} },
    github: over.github === null ? null : async (slug, json, cover) => { committed.push({ slug, json, cover }); return { slug, url: 'https://github.com/x/commit/1' } },
    reencode: async buf => ({ buf: Buffer.from('RIFF\0\0\0\0WEBPVP8 fake'), width: 1600, height: 900, got: buf.length }),
    ...over.deps
  })
  return new Promise(res => app.server.listen(0, '127.0.0.1', () => {
    const base = `http://127.0.0.1:${app.server.address().port}/routines/api/`
    const post = (p, body, headers = {}) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) })
    res({ app, base, post, sent, committed, dataDir, tick: ms => { t += ms } })
  }))
}
const close = s => new Promise(r => { s.app.stop(); s.app.server.close(r) })
const link = () => dayLink(check(good()).routine, 0, cat)
const form = over => ({
  link: link(), title: 'Doorway strength', description: 'Pull-ups and push-ups for a doorway bar, three days a week.', goal: 'general', level: 'beginner',
  split: 'full-body', duration: 30, language: 'en', tags: ['home'], author: 'Ana', authorUrl: 'https://example.org', consent: true, website: '', ms: 9000, ...over
})

test('service: preview reads a link and names the exercises', async () => {
  const s = await startApp()
  try {
    const r = await s.post('preview', { link: link() })
    const j = await r.json()
    assert.equal(r.status, 200)
    assert.equal(j.preview.sessions[0].exercises[0].name, 'Pull-up')
    assert.equal(j.preview.from, 'Ana')
    const bad = await s.post('preview', { link: 'https://example.com/' })
    assert.equal(bad.status, 422)
    const notJson = await s.post('preview', 'nope')
    assert.equal(notJson.status, 400)
  } finally { await close(s) }
})

test('service: a submission is checked, stored and sent to Telegram with the buttons', async () => {
  const s = await startApp()
  try {
    const r = await s.post('submit', form({ cover: { type: 'image/jpeg', data: Buffer.alloc(5000).toString('base64') }, coverAlt: 'A bar in a doorway' }))
    assert.equal(r.status, 200, await r.clone().text())
    await new Promise(res => setTimeout(res, 30))
    const pending = fs.readdirSync(path.join(s.dataDir, 'pending'))
    assert.equal(pending.filter(f => f.endsWith('.json')).length, 1)
    assert.equal(pending.filter(f => f.endsWith('.webp')).length, 1)
    const photo = s.sent.find(x => x.method === 'sendPhoto')
    assert.match(photo.payload.caption, /\[STAGING\]/)
    const msg = s.sent.find(x => x.method === 'sendMessage')
    assert.match(msg.payload.text, /\[STAGING\]/)
    assert.match(msg.payload.text, /Doorway strength/)
    assert.equal(msg.payload.reply_markup.inline_keyboard[0][0].callback_data.split(':')[1], 'staging')
    const sub = JSON.parse(fs.readFileSync(path.join(s.dataDir, 'pending', pending.find(f => f.endsWith('.json'))), 'utf8'))
    assert.equal(sub.slug, 'doorway-strength')
    assert.equal(sub.raw.license, 'CC-BY-4.0')
    assert.equal(sub.raw.cover, 'doorway-strength.webp')
  } finally { await close(s) }
})

test('service: honeypot, speed, consent, limits and validation', async () => {
  const s = await startApp()
  try {
    assert.equal((await s.post('submit', form({ website: 'http://spam' }))).status, 200)
    assert.equal((await s.post('submit', form({ ms: 500 }))).status, 200)
    assert.equal(fs.readdirSync(path.join(s.dataDir, 'pending')).length, 0, 'bots get a smile, nothing is stored')
    assert.equal(s.sent.length, 0)
    assert.equal((await s.post('submit', form({ consent: false }))).status, 422)
    const bad = await s.post('submit', form({ title: 'x', description: 'short', duration: 999 }))
    const j = await bad.json()
    assert.equal(bad.status, 422)
    assert.ok(j.problems.some(p => /title/.test(p)) && j.problems.some(p => /duration/.test(p)))
    const big = await s.post('submit', '{"x":"' + 'a'.repeat(13 * 1024 * 1024) + '"}')
    assert.equal(big.status, 413)
    const s2 = await startApp()
    try {
      for (let i = 0; i < 4; i++) assert.equal((await s2.post('submit', form({ title: `Doorway strength ${i + 1}` }))).status, 200)
      assert.equal((await s2.post('submit', form({ title: 'One too many' }))).status, 429)
      assert.equal((await s2.post('submit', form({ title: 'Someone else' }, ), { 'cf-connecting-ip': '198.51.100.1' })).status, 200)
    } finally { await close(s2) }
  } finally { await close(s) }
})

test('service: ✅ commits to GitHub, ❌ deletes, strangers are ignored', async () => {
  const s = await startApp()
  try {
    await s.post('submit', form())
    await s.post('submit', form({ title: 'Another one', ms: 9000 }, ), { 'cf-connecting-ip': '198.51.100.2' })
    await new Promise(res => setTimeout(res, 30))
    const msgs = s.sent.filter(x => x.method === 'sendMessage')
    const [ok, no] = msgs.map(m => m.payload.reply_markup.inline_keyboard[0])
    const cb = (data, from = 42) => ({ id: 'q', data, from: { id: from }, message: { chat: { id: from }, message_id: 7, text: 'msg' } })
    await s.app.onCallback(cb(ok[0].callback_data, 999))
    assert.equal(s.committed.length, 0, 'only the owner decides')
    await s.app.onCallback(cb(ok[0].callback_data))
    assert.equal(s.committed.length, 1)
    assert.equal(s.committed[0].json.author.name, 'Ana')
    assert.match(s.sent.at(-1).payload.text, /Committed to routines-inbox/)
    await s.app.onCallback(cb(no[1].callback_data))
    assert.equal(fs.readdirSync(path.join(s.dataDir, 'pending')).length, 0)
    assert.match(s.sent.at(-1).payload.text, /Rejected/)
    await s.app.onCallback(cb(ok[0].callback_data))
    assert.match(s.sent.at(-1).payload.text, /Already handled/)
    await s.app.onCallback(cb(ok[0].callback_data.replace(':staging:', ':prod:')))
    assert.equal(s.committed.length, 1, 'another environment\'s buttons are not ours')
  } finally { await close(s) }
})

test('service: without a GitHub token ✅ keeps the routine on disk and says so', async () => {
  const s = await startApp({ github: null })
  try {
    await s.post('submit', form())
    await new Promise(res => setTimeout(res, 30))
    const data = s.sent.find(x => x.method === 'sendMessage').payload.reply_markup.inline_keyboard[0][0].callback_data
    await s.app.onCallback({ id: 'q', data, from: { id: 42 }, message: { chat: { id: 42 }, message_id: 1, text: 'm' } })
    assert.ok(fs.existsSync(path.join(s.dataDir, 'approved', 'doorway-strength.json')))
    assert.match(s.sent.at(-1).payload.text, /No GitHub token yet/)
    // The approved file is a routine CI accepts as it is.
    const raw = JSON.parse(fs.readFileSync(path.join(s.dataDir, 'approved', 'doorway-strength.json'), 'utf8'))
    assert.deepEqual(checkRoutine(raw, { slug: 'doorway-strength', source: 'community', cat }).problems, [])
  } finally { await close(s) }
})

test('service: copies count once per visitor a day, stats, unknown ids', async () => {
  const s = await startApp()
  try {
    const one = { id: 'opengym/pullup-bar-basics', kind: 'day' }
    assert.equal((await s.post('copy', one)).status, 204)
    assert.equal((await s.post('copy', one)).status, 204)
    assert.equal((await s.post('copy', one, { 'cf-connecting-ip': '198.51.100.7' })).status, 204)
    assert.equal((await s.post('copy', { id: 'opengym/nope' })).status, 400)
    const stats = await (await fetch(s.base + 'stats')).json()
    assert.equal(stats.copies['opengym/pullup-bar-basics'], 2)
    s.tick(86400e3)
    await s.post('copy', one)
    assert.equal(s.app.counts()['opengym/pullup-bar-basics'], 3)
    s.app.flush()
    const disk = fs.readFileSync(path.join(s.dataDir, 'counts.json'), 'utf8')
    assert.doesNotMatch(disk, /203\.0\.113|198\.51/, 'no addresses on disk')
    assert.equal((await fetch(s.base + 'copy')).status, 405)
  } finally { await close(s) }
})

test('moderation message and helpers', () => {
  const routine = check(good()).routine
  const text = moderationText({ sid: 'abcdefabcdef', slug: 'pullup-test', routine: { ...routine, title: '<b>x</b>' } }, { label: 'STAGING', cat })
  assert.match(text, /^<b>\[STAGING\]<\/b>/)
  assert.match(text, /&lt;b&gt;x&lt;\/b&gt;/)
  assert.match(text, /pull-up 3×6, rest 2:00/)
  assert.match(text, /\(Mon Fri\)/)
  assert.ok(text.length < 4096)
  assert.deepEqual(keyboard('abcdefabcdef', 'prod').inline_keyboard[0].map(b => b.callback_data), ['rt:prod:ok:abcdefabcdef', 'rt:prod:no:abcdefabcdef'])
  assert.equal(envTag(''), 'prod')
  assert.equal(envTag('STAGING'), 'staging')
  const l = new Limiter(2, 1000, () => 0)
  assert.ok(l.take('a') && l.take('a') && !l.take('a') && l.take('b'))
  const plan = planFromRequest({ link: link() }, cat)
  const raw = routineFromRequest({ title: ' T ', author: 'A', authorUrl: 'https://x.org', duration: '30', tags: [' Home '] }, plan, '2026-11-08')
  assert.equal(raw.title, 'T')
  assert.equal(raw.duration, 30)
  assert.deepEqual(raw.tags, ['home'])
})

test('service: static files, no listings, media only for our pages, CORS on the index', async () => {
  const out = path.join(tmp, 'site-static')
  build(parseArgs(['--out', out]))
  const s = await startApp({ cfg: { siteDir: out } })
  try {
    const root = s.base.replace(/api\/$/, '')
    const idx = await fetch(root + 'index.json')
    assert.equal(idx.headers.get('access-control-allow-origin'), '*')
    assert.equal((await fetch(root + 'media/')).status, 404)
    assert.equal((await fetch(root + 'media/0652.webp', { headers: { referer: 'https://elsewhere.example/' } })).status, 403)
    const ok = await fetch(root + 'media/0652.webp', { headers: { referer: 'https://opengym.ch/routines/x/' } })
    assert.equal(ok.status, 200)
    assert.match(ok.headers.get('x-robots-tag'), /noimageindex/)
    await ok.arrayBuffer()
    assert.equal((await fetch(root + '../package.json')).status, 404)
    assert.equal((await fetch(root + 'pullup-bar-basics', { redirect: 'manual' })).status, 301)
    const page = await fetch(root + 'pullup-bar-basics/')
    assert.equal(page.status, 200)
    assert.match(page.headers.get('x-robots-tag'), /noindex/)
    await page.text()
  } finally { await close(s) }
})
