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
  assert.deepEqual(focusOf(v), ['core'])   // a plank twice a week is a quarter of this little week
  assert.deepEqual(focusOf({ quads: 6, hamstrings: 4, chest: 4, lats: 6, 'front delts': 5.5, biceps: 4, triceps: 3.5, glutes: 4, abs: 3.5 }), [], 'a balanced week leans on nothing')
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
  assert.equal(p.from, 'Ana')
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
  { s: 'c', id: 'x/c', t: 'Ganzkörper', d: 'Zuhause', a: 'Cy', g: 'general', l: 'beginner', sp: 'full-body', n: 3, m: 30, k: [], f: ['legs'], lang: 'de', tags: ['zuhause'], at: '2026-11-03', ex: ['0662'], sn: ['Tag A'] },
  { s: 'd', id: 'x/d', t: 'Machine circuit', d: 'Every station once', a: 'Di', g: 'muscle', l: 'intermediate', sp: 'full-body', n: 3, m: 50, k: ['barbell', 'cable', 'machine'], f: [], lang: 'en', tags: [], at: '2026-11-06', ex: ['0001'], sn: ['Circuit'] }
]
const pick = (st, names) => R.filter(r => F.matches(r, st, F.haystack(r, names))).map(r => r.s)
const st = over => ({ ...F.emptyState(), ...over })

test('filters: each group narrows, OR inside a group, AND across groups', () => {
  assert.deepEqual(pick(st({ goal: ['general'] })), ['a', 'c'])
  assert.deepEqual(pick(st({ goal: ['general', 'strength'] })), ['a', 'b', 'c'])
  assert.deepEqual(pick(st({ days: ['4'] })), ['b'])
  assert.deepEqual(pick(st({ days: ['3', '4'] })), ['a', 'b', 'c', 'd'])
  assert.deepEqual(pick(st({ len: '30' })), ['c'])
  assert.deepEqual(pick(st({ len: '45' })), ['a', 'c'])
  assert.deepEqual(pick(st({ len: '61' })), ['b'])
  assert.deepEqual(pick(st({ level: ['beginner'], lang: ['de'] })), ['c'])
  assert.deepEqual(pick(st({ goal: ['general'], days: ['4'] })), [])
  assert.deepEqual(pick(st({ focus: ['chest', 'core'] })), ['a', 'b'])
  assert.deepEqual(pick(st({ focus: ['balanced'] })), ['d'])
  assert.deepEqual(pick(st({ split: ['upper-lower'] })), ['b'])
})

test('filters: equipment means "uses it", unless "only what I picked" is on', () => {
  assert.deepEqual(pick(st({ kit: ['bodyweight'] })), ['c'])
  assert.deepEqual(pick(st({ kit: ['pull-up bar'] })), ['a'])
  assert.deepEqual(pick(st({ kit: ['barbell'] })), ['b', 'd'], 'barbell lists the barbell routines, never body weight')
  assert.deepEqual(pick(st({ kit: ['barbell', 'pull-up bar'] })), ['a', 'b', 'd'])
  assert.deepEqual(pick(st({ kit: ['bodyweight', 'pull-up bar'] })), ['a', 'c'])
  // "What I have": nothing needed beyond the picks, body weight always fits.
  assert.deepEqual(pick(st({ kit: ['pull-up bar'], kitonly: true })), ['a', 'c'])
  assert.deepEqual(pick(st({ kit: ['barbell'], kitonly: true })), ['c'])
  assert.deepEqual(pick(st({ kit: ['barbell', 'bench', 'pull-up bar'], kitonly: true })), ['a', 'b', 'c'])
  assert.deepEqual(pick(st({ home: true })), ['a', 'c'])
})

test('search: titles, authors, accents and exercise names in any language', () => {
  assert.deepEqual(pick(st({ q: 'barbell' })), ['b'])
  assert.deepEqual(pick(st({ q: 'ganzkorper' })), ['c'])
  assert.deepEqual(pick(st({ q: 'ana doorway' })), ['a'])
  const names = { '0025': 'barbell bench press | bankdrücken mit der langhantel', '0662': 'push-up | liegestütz' }
  assert.deepEqual(pick(st({ q: 'bankdrucken' }), names), ['b'])
  assert.deepEqual(pick(st({ q: 'liegestütz' }), names), ['c'])
  assert.deepEqual(pick(st({ q: 'liegestutz', goal: ['strength'] }), names), [], 'search and filters together')
  assert.deepEqual(pick(st({ q: 'bar', level: ['beginner'] })), ['a'])
})

test('search highlights land on the right letters, accents and case ignored', () => {
  assert.deepEqual(F.highlightRanges('Ganzkörper zu Hause', 'korper'), [[4, 10]])
  assert.deepEqual(F.highlightRanges('Pull-up bar basics', 'BAR pull'), [[0, 4], [8, 11]])
  assert.deepEqual(F.highlightRanges('barbell', 'bar barb'), [[0, 4]])
  assert.deepEqual(F.highlightRanges('anything', ''), [])
})

test('facet counts, quick picks, sorting, clearing and the address round-trip', () => {
  const options = { goal: ['general', 'strength', 'muscle'], days: ['3', '4'], len: ['30', '45', '60', '61'], kit: ['bodyweight', 'barbell'], level: [], focus: [], split: [], lang: ['en', 'de'] }
  const c = F.facetCounts(R, st({ lang: ['en'] }), options)
  assert.equal(c.goal.general, 1)
  assert.equal(c.goal.muscle, 1)
  assert.equal(c.lang.de, 1)               // a group's own options count as if picked instead
  assert.equal(c.kit.barbell, 2)
  assert.equal(c.kit.bodyweight, 0)
  const k = F.facetCounts(R, st({ kit: ['pull-up bar'], kitonly: true }), options)
  assert.equal(k.kit.barbell, 2, 'with "only what I picked", an option adds to the kit')
  assert.deepEqual(F.sortRoutines(R, 'new').map(r => r.s), ['d', 'b', 'c', 'a'])
  assert.deepEqual(F.sortRoutines(R, 'name').map(r => r.s), ['b', 'c', 'd', 'a'])
  assert.deepEqual(F.sortRoutines(R, 'short').map(r => r.s), ['c', 'a', 'd', 'b'])
  assert.deepEqual(F.sortRoutines(R, 'popular', { 'x/a': 9, 'x/c': 2 }).map(r => r.s), ['a', 'c', 'd', 'b'])
  const s = st({ q: 'bar', goal: ['general', 'strength'], len: '45', kit: ['pull-up bar'], kitonly: true, home: true, sort: 'popular' })
  const q = F.queryFromState(s)
  assert.equal(q, '?q=bar&goal=general,strength&len=45&kit=pull-up+bar&have=only&home=1&sort=popular')
  assert.deepEqual(F.stateFromQuery(q), s)
  assert.equal(F.activeCount(s), 5)
  assert.deepEqual(F.stateFromQuery('?len=999&sort=evil&have=only'), F.emptyState())
  assert.equal(F.queryFromState(F.emptyState()), '', 'cleared state is a clean address')
  for (const [name, qp] of Object.entries(F.QUICK)) {
    const on = qp.set(F.emptyState(), true)
    assert.ok(qp.on(on), name + ' turns on')
    assert.ok(!qp.on(qp.set(on, false)), name + ' turns off')
    assert.deepEqual(F.stateFromQuery(F.queryFromState(on)), on, name + ' survives the address')
  }
  assert.deepEqual(pick(F.QUICK.short.set(st(), true)), ['c'])
  assert.deepEqual(pick(F.QUICK.nokit.set(st(), true)), ['c'])
  assert.deepEqual(pick(F.QUICK.beginner.set(st(), true)), ['a', 'c'])
})

/* --------------- the filters against the real library, as the list page carries it --------------- */

const built = (() => {
  const out = path.join(tmp, 'list-site')
  build(parseArgs(['--out', out]))
  const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8')
  const data = JSON.parse(/<script type="application\/json" id="rt-data">([\s\S]*?)<\/script>/.exec(html)[1].replace(/\\u003c/g, '<'))
  const index = JSON.parse(fs.readFileSync(path.join(out, 'index.json'), 'utf8'))
  return { out, html, list: data.routines, index }
})()
const real = (over, names) => built.list.filter(r => F.matches(r, st(over), F.haystack(r, names))).map(r => r.s).sort()
const expect = fn => built.list.filter(fn).map(r => r.s).sort()

test('library: every record the list filters on is complete and normalised', () => {
  for (const r of built.list) {
    assert.ok(['strength', 'muscle', 'general', 'fatloss', 'endurance'].includes(r.g), r.s + ' goal')
    assert.ok(['beginner', 'intermediate', 'advanced'].includes(r.l), r.s + ' level')
    assert.ok(Number.isInteger(r.n) && r.n >= 1 && r.n <= 7, r.s + ' days')
    assert.ok(Number.isInteger(r.m) && r.m > 0, r.s + ' minutes')
    assert.ok(Array.isArray(r.k) && Array.isArray(r.f) && typeof r.lang === 'string', r.s + ' kit, focus, language')
    assert.ok(!r.k.includes('bodyweight'), 'body weight is an empty kit, never a word in it')
    assert.ok(r.f.length <= 3, r.s + ' leans on at most three groups')
  }
  // The app's index agrees with the list on the facts both carry.
  for (const e of built.index.routines) {
    const r = built.list.find(x => x.id === e.id)
    assert.ok(r, e.id)
    assert.deepEqual([e.goal, e.level, e.days, e.duration, e.language, e.split], [r.g, r.l, r.n, r.m, r.lang, r.sp])
  }
})

test('library: each option, alone, lists exactly the routines that have it', () => {
  for (const g of ['strength', 'muscle', 'general', 'fatloss', 'endurance']) assert.deepEqual(real({ goal: [g] }), expect(r => r.g === g), g)
  for (const d of [1, 2, 3, 4, 5, 6, 7]) assert.deepEqual(real({ days: [String(d)] }), expect(r => r.n === d), 'days ' + d)
  for (const l of ['beginner', 'intermediate', 'advanced']) assert.deepEqual(real({ level: [l] }), expect(r => r.l === l), l)
  for (const k of ['pull-up bar', 'bench', 'dumbbell', 'kettlebell', 'barbell', 'band', 'cable', 'machine']) {
    const got = real({ kit: [k] })
    assert.deepEqual(got, expect(r => r.k.includes(k)), k)
    assert.ok(got.every(s => built.list.find(r => r.s === s).k.includes(k)), k + ': every result uses it')
  }
  assert.deepEqual(real({ kit: ['bodyweight'] }), expect(r => !r.k.length))
  assert.deepEqual(real({ len: '30' }), expect(r => r.m <= 30))
  assert.deepEqual(real({ len: '61' }), expect(r => r.m > 60))
  assert.deepEqual(real({ lang: ['de'] }), ['ganzkoerper-zuhause'])
  assert.deepEqual(real({ home: true }), expect(r => !r.k.some(k => ['barbell', 'cable', 'machine'].includes(k))))
  // Spot checks a person can verify by reading the routines.
  assert.ok(real({ kit: ['kettlebell'] }).includes('one-kettlebell'))
  assert.ok(!real({ kit: ['barbell'] }).includes('home-bw'), 'a body-weight routine is not a barbell routine')
  assert.ok(real({ kit: ['bodyweight'] }).includes('hotel'))
  assert.deepEqual(real({ kit: ['band'] }), ['bands'])
})

test('library: muscle focus picks the routines that lean, not every routine with legs in it', () => {
  const legs = real({ focus: ['legs'] })
  assert.ok(legs.length > 0 && legs.length <= built.list.length / 2, `legs is ${legs.length} of ${built.list.length}`)
  for (const g of ['chest', 'back', 'shoulders', 'arms', 'glutes', 'core', 'conditioning']) {
    assert.ok(real({ focus: [g] }).length < built.list.length, g + ' narrows')
  }
  assert.ok(real({ focus: ['core'] }).includes('desk-reset'))
  assert.ok(real({ focus: ['conditioning'] }).includes('circuit-25'))
  assert.ok(real({ focus: ['glutes'] }).includes('glutes-first'))
})

test('library: combinations, search with filters, and clearing', () => {
  assert.deepEqual(real({ goal: ['general'], kit: ['bodyweight'] }), expect(r => r.g === 'general' && !r.k.length))
  assert.deepEqual(real({ level: ['beginner'], days: ['2', '3'] }), expect(r => r.l === 'beginner' && [2, 3].includes(r.n)))
  assert.deepEqual(real({ kit: ['dumbbell'], kitonly: true }), expect(r => r.k.every(k => k === 'dumbbell')))
  assert.deepEqual(real({ q: 'kettlebell' }), ['one-kettlebell'])
  assert.deepEqual(real({ q: 'kettlebell', level: ['beginner'] }), [])
  assert.deepEqual(real({}), built.list.map(r => r.s).sort(), 'nothing picked lists everything')
  const s = F.stateFromQuery('?goal=muscle&days=4&kit=barbell')
  assert.deepEqual(real(s), expect(r => r.g === 'muscle' && r.n === 4 && r.k.includes('barbell')))
  assert.deepEqual(real({ ...F.emptyState(), sort: s.sort }), built.list.map(r => r.s).sort())
})

test('library: the counts next to each option are what picking it would show', () => {
  const options = {}
  for (const g of F.GROUPS) options[g] = [...built.html.matchAll(new RegExp(`name="${g}" value="([^"]+)"`, 'g'))].map(m => m[1].replace(/&#39;/g, "'").replace(/&amp;/g, '&'))
  assert.ok(options.kit.includes('barbell') && options.kit.includes('bodyweight'))
  assert.ok(!options.kit.includes('suspension'), 'options nobody has are not offered')
  assert.ok(!options.days.includes('1') && !options.days.includes('7'))
  for (const base of [st(), st({ goal: ['muscle'] }), st({ level: ['beginner'], q: 'bar' })]) {
    const counts = F.facetCounts(built.list, base, options)
    for (const g of F.GROUPS) {
      for (const v of options[g]) {
        const t = { ...base, [g]: g === 'len' ? v : [v] }
        assert.equal(counts[g][v], real(t).length, `${g}=${v}`)
      }
    }
  }
})

/* ------------------------------- the pages ------------------------------- */

test('pages: stills sit in tiles, the QR code waits to be asked for, related routines are linked', () => {
  const list = built.html
  const one = fs.readFileSync(path.join(built.out, 'ppl-six-days/index.html'), 'utf8')
  assert.doesNotMatch(list + one, /<img src="[^"]*\/media\/[^"]+"(?![^>]*>[\s]*<\/span>)/, 'no bare still outside a tile')
  assert.ok((list.match(/class="still"/g) || []).length > 20)
  assert.match(one, /<div class="way rt-qr" id="qr" hidden>/)
  assert.match(one, /<div class="rt-qrbox" id="qrbox" hidden>/)
  assert.match(one, /role="tablist" aria-label="Sessions" hidden/)
  assert.match(one, /<section class="rt-sec rt-related"[\s\S]*?href="\/routines\/[a-z0-9-]+\/"/)
  assert.doesNotMatch(one, /href="\/routines\/ppl-six-days\/"><span class="t"/, 'a routine is not related to itself')
  assert.match(one, /<dl class="rt-facts">/)
  assert.match(list, /data-quick="nokit"[\s\S]*data-quick="home"[\s\S]*data-quick="beginner"[\s\S]*data-quick="short"/)
  assert.match(list, /id="active"/)
  assert.match(list, /name="kitonly"/)
  const css = fs.readFileSync(path.join(ROOT, 'website/routines/routines.css'), 'utf8')
  assert.match(css, /\.still img \{[^}]*mix-blend-mode: multiply/)
  assert.doesNotMatch(css, /(^|[\s,}])\.tile\b/, 'the site already owns .tile')
  const sub = fs.readFileSync(path.join(built.out, 'submit/index.html'), 'utf8')
  assert.equal((sub.match(/class="rt-step"/g) || []).length, 4)
  assert.match(sub, /id="final"/)
  for (const f of ['title', 'description', 'author', 'authorUrl', 'duration']) assert.match(sub, new RegExp(`id="e-${f}"`))
  for (const page of [list, one, sub]) {
    assert.doesNotMatch(page.slice(page.indexOf('<main')), /—/, 'no em dashes in our copy')
    assert.doesNotMatch(page, /<nav class="wrap rt-top"/, 'the breadcrumb is not a second sticky header')
  }
})

test('header: one line at every width, and the panels hang from the bar', () => {
  const css = fs.readFileSync(path.join(ROOT, 'website/styles.css'), 'utf8')
  const js = fs.readFileSync(path.join(ROOT, 'website/site.js'), 'utf8')
  assert.match(css, /\.nav-quick > a \{ white-space: nowrap; flex: none; \}/)
  assert.match(css, /\.navsheet \{[^}]*top: var\(--nav-b, 54px\)/)
  assert.match(css, /\.side \{[^}]*top: var\(--nav-b, 54px\)/)
  assert.match(css, /body::after \{[^}]*inset: var\(--nav-b, 54px\) 0 0/)
  assert.match(js, /setProperty\('--nav-b'/)
  assert.match(js, /document\.documentElement\.style\.overflow = open \? 'hidden' : ''/)
  // One green: the brand's.
  assert.match(css, /--acc: #a3e635;/)
  assert.doesNotMatch(css + fs.readFileSync(path.join(ROOT, 'website/routines/routines.css'), 'utf8'), /#32d74b|#30d158|50, 215, 75/i)
  const compact = new Function(`${/const compact = [^\n]+/.exec(js)[0]}; return compact`)()
  assert.deepEqual([20358, 2141, 950, 1000].map(compact), ['20.4k', '2.1k', '950', '1k'])
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
