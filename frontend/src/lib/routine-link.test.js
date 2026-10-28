import { describe, it, expect, afterEach } from 'vitest'
import {
  routineLinkBundle, encodePayload, decodePayload, routineLink, routinePayloadFromUrl, readRoutineBundle,
  importRoutineLink, importedRoutineName, linkFor, toBase64Url, fromBase64Url, cleanFrom, LINK_FMT, MAX_LINK,
} from './routine-link.js'
import { EXIDX, registerCustom } from './exercises.js'
import { youtubeSearchUrl } from './youtube.js'

const BENCH = '0025', CURL = '0463', PLANK = '8221', RAISE = '0334'
const custom = { id: 'cx1', n: 'Zercher carry ü 💪', bp: 'upper legs', eq: 'barbell', custom: true }

const state = (over = {}) => ({
  unit: 'kg', week: {}, customEx: [custom], routines: [], ...over,
})
const push = {
  id: 'r1', name: 'Push Day 💪 Ärger', emoji: 'dumbbell',
  ex: [
    { id: BENCH, sets: 3, reps: 8, weight: 80, restSec: 120, note: 'Pausé au torse, 2 s ⏸' },
    { id: CURL, sets: 3, reps: 12, weight: 14, side: true, sg: 'sgA', sgName: 'Arms', sgRest: 90 },
    { id: RAISE, sets: 3, reps: 15, weight: 8, sg: 'sgA', sgName: 'Arms', sgRest: 90 },
    { id: PLANK, sets: 2, mode: 'time', sec: 45 },
    { id: 'cx1', sets: 2, reps: 20, weight: 40 },
  ],
}

afterEach(() => registerCustom([]))

const roundTrip = async (bundle, opts) => decodePayload(await encodePayload(bundle, opts))

describe('routine links: encode and decode', () => {
  it('round-trips a routine with unicode, supersets, per-side, timed and custom exercises (compressed)', async () => {
    registerCustom([custom])
    const S = state({ routines: [push] })
    const bundle = routineLinkBundle(S, push, { weights: true, from: 'Alex' })
    const payload = await encodePayload(bundle)
    expect(payload.startsWith(LINK_FMT + '.d.')).toBe(true)
    const back = await decodePayload(payload)
    expect(back).toEqual(bundle)
    expect(back.opengym_plan).toBe(1)
    expect(back.from).toBe('Alex')
    expect(back.names[BENCH]).toBe(EXIDX[BENCH].n)
    expect(back.names.cx1).toBeUndefined()
    const [b, c, r, p, x] = back.routines[0].ex
    expect(b).toMatchObject({ id: BENCH, sets: 3, reps: 8, weight: 80, restSec: 120, note: 'Pausé au torse, 2 s ⏸' })
    expect(c).toMatchObject({ side: true, sg: 'sgA', sgName: 'Arms', sgRest: 90 })
    expect(r.sg).toBe('sgA')
    expect(p).toMatchObject({ mode: 'time', sec: 45 })
    expect(x.id).toBe('cx1')
    expect(back.customEx[0]).toMatchObject({ id: 'cx1', n: 'Zercher carry ü 💪', bp: 'upper legs' })
    expect(back.routines[0].name).toBe('Push Day 💪 Ärger')
  })

  it('reads the plain form too (a browser without CompressionStream)', async () => {
    const bundle = routineLinkBundle(state(), push, { weights: true })
    const payload = await encodePayload(bundle, { compress: false })
    expect(payload.startsWith('1.j.')).toBe(true)
    expect(await decodePayload(payload)).toEqual(bundle)
  })

  it('leaves the weights out unless asked, and the name unless given', async () => {
    const bundle = routineLinkBundle(state(), push)
    expect(bundle.routines[0].ex.every(e => e.weight == null)).toBe(true)
    expect(bundle.routines[0].ex[0].reps).toBe(8)
    expect(bundle.from).toBeUndefined()
    expect(routineLinkBundle(state(), push, { from: '  \u0007  ' }).from).toBeUndefined()
    expect(cleanFrom('x'.repeat(80))).toHaveLength(40)
  })

  it('never carries the rest of the plan: other routines, the week, programmes', () => {
    const other = { id: 'r2', name: 'Legs', ex: [{ id: BENCH, sets: 1, reps: 1 }] }
    const S = state({ routines: [push, other], week: { 1: ['r1'], 3: ['r2'] }, programmes: { p: { id: 'p', name: 'Block' } } })
    const b = routineLinkBundle(S, push)
    expect(b.routines).toHaveLength(1)
    expect(b.week).toBeUndefined()
    expect(b.programmes).toBeUndefined()
    expect(b.exported).toBeUndefined()
  })

  it('base64url has no +, / or = and comes back byte for byte', () => {
    const bytes = new Uint8Array(300).map((_, i) => (i * 37) & 255)
    const s = toBase64Url(bytes)
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/)
    expect([...fromBase64Url(s)]).toEqual([...bytes])
  })

  it('refuses broken, cut off, oversized and newer links with a code', async () => {
    const good = await encodePayload(routineLinkBundle(state(), push))
    const code = async p => { try { await decodePayload(p); return 'ok' } catch (e) { return e.code } }
    expect(await code(good)).toBe('ok')
    expect(await code(good.slice(0, good.length - 12))).toBe('bad-link')
    expect(await code('hello')).toBe('bad-link')
    expect(await code('1.j.' + toBase64Url(new TextEncoder().encode('{"not":"a plan"}')))).toBe('bad-link')
    expect(await code('1.j.' + toBase64Url(new TextEncoder().encode('[1,2]')))).toBe('bad-link')
    expect(await code('1.j.@@@')).toBe('bad-link')
    expect(await code('0.j.abc')).toBe('bad-link')
    expect(await code('2.d.abc')).toBe('too-new')
    expect(await code('1.x.abc')).toBe('too-new')
    expect(await code('1.j.' + 'A'.repeat(20000))).toBe('too-big')
    expect(await code(null)).toBe('bad-link')
  })

  it('stops a tiny link that inflates to something huge', async () => {
    const huge = new TextEncoder().encode('{"opengym_plan":1,"routines":[],"x":"' + ' '.repeat(400000) + '"}')
    const cs = new CompressionStream('deflate-raw')
    const w = cs.writable.getWriter(); w.write(huge); w.close()
    const zipped = new Uint8Array(await new Response(cs.readable).arrayBuffer())
    const payload = '1.d.' + toBase64Url(zipped)
    expect(payload.length).toBeLessThan(16000)
    await expect(decodePayload(payload)).rejects.toMatchObject({ code: 'too-big' })
  })
})

describe('routine links: size fallback', () => {
  it('a normal routine fits in a link', async () => {
    const link = await routineLink(state(), push, { weights: true })
    expect(link.tooLong).toBeUndefined()
    expect(link.url.startsWith('https://opengym.ch/r#1.')).toBe(true)
    expect(link.length).toBeLessThanOrEqual(MAX_LINK)
  })

  it('one too big for a link says so, so the caller can send a plan file', async () => {
    const many = { id: 'big', name: 'Everything', ex: Object.keys(EXIDX).slice(0, 120).map((id, i) => ({ id, sets: 3, reps: 8 + (i % 5), note: 'note ' + i + ' ' + id.repeat(3) })) }
    const link = await routineLink(state(), many)
    expect(link.tooLong).toBe(true)
    expect(link.length).toBeGreaterThan(MAX_LINK)
    expect(link.bundle.routines[0].ex).toHaveLength(120)
  })

  it('an empty routine has nothing to share', () => {
    expect(() => routineLinkBundle(state(), { id: 'e', name: 'Empty', ex: [] })).toThrow()
  })
})

describe('routine links: reading a link', () => {
  const P = '1.d.q1YqzkxRslIqS8wpTVWqBQA'
  it('finds the payload in every form the link travels in', () => {
    for (const url of [
      'https://opengym.ch/r#' + P, 'https://opengym.ch/r/#' + P, 'https://www.opengym.ch/r#' + P,
      'https://opengym.ch/r/index.html#' + P, 'opengym://r#' + P, 'opengym://r/#' + P, 'OPENGYM://r#' + P,
      'https://gym.example.org/#/r/' + P, 'http://192.168.1.10:8080/#/r/' + P, 'https://opengym.ch/demo/#/r/' + P,
      linkFor(P),
    ]) expect(routinePayloadFromUrl(url), url).toBe(P)
  })

  it('ignores everything else, without throwing', () => {
    for (const url of [
      'https://opengym.ch/r', 'https://opengym.ch/r#', 'https://opengym.ch/nfc?do=start', 'https://evil.test/r#' + P,
      'https://opengym.ch/rest#' + P, 'opengym://nfc?do=start', 'opengym://r/extra#' + P, 'opengym://x#' + P,
      'https://opengym.ch/r#hello', 'https://opengym.ch/r#1.d.<script>', 'javascript:alert(1)', '', null, 42,
      'https://opengym.ch/r#1.d.' + 'A'.repeat(17000),
    ]) expect(routinePayloadFromUrl(url), String(url).slice(0, 60)).toBeNull()
  })
})

describe('routine links: importing', () => {
  const decoded = async (S, routine, opts) => decodePayload(await encodePayload(routineLinkBundle(S, routine, opts)))

  it('maps catalogue ids as they are and creates the custom exercise on import', async () => {
    registerCustom([custom])
    const data = await decoded(state({ routines: [push] }), push, { weights: true })
    registerCustom([])
    const friend = { unit: 'kg', routines: [], week: {}, customEx: [] }
    const parsed = readRoutineBundle(data, 'kg')
    expect(parsed.routines).toHaveLength(1)
    const id = importRoutineLink(friend, parsed)
    const r = friend.routines.find(x => x.id === id)
    expect(r.ex.map(e => e.id).slice(0, 4)).toEqual([BENCH, CURL, RAISE, PLANK])
    expect(friend.customEx).toHaveLength(1)
    expect(friend.customEx[0]).toMatchObject({ n: 'Zercher carry ü 💪', bp: 'upper legs', custom: true })
    expect(r.ex[4].id).toBe(friend.customEx[0].id)
    expect(r.ex[1]).toMatchObject({ side: true, sg: 'sgA', sgName: 'Arms' })
    expect(r.ex[3]).toMatchObject({ mode: 'time', sec: 45 })
    expect(friend.week).toEqual({})
  })

  it('reuses a custom exercise the friend already has with that name and body part', async () => {
    const data = await decoded(state(), push)
    const friend = { unit: 'kg', routines: [], week: {}, customEx: [{ id: 'mine', n: 'zercher carry ü 💪', bp: 'upper legs', custom: true }] }
    registerCustom(friend.customEx)
    const id = importRoutineLink(friend, readRoutineBundle(data, 'kg'))
    expect(friend.customEx).toHaveLength(1)
    expect(friend.routines.find(x => x.id === id).ex[4].id).toBe('mine')
  })

  it('converts the weights to the friend’s unit', async () => {
    const data = await decoded(state(), push, { weights: true })
    const parsed = readRoutineBundle(data, 'lb')
    expect(parsed.routines[0].ex[0].weight).toBeGreaterThan(170)
  })

  it('never overwrites: a new routine with a fresh id, "(from Alex)" when named, a number when taken', async () => {
    const mine = { id: 'r1', name: 'Push Day 💪 Ärger', ex: [{ id: BENCH, sets: 5, reps: 5 }] }
    const friend = { unit: 'kg', routines: [mine], week: { 1: ['r1'] }, customEx: [] }
    const plain = readRoutineBundle(await decoded(state(), push), 'kg')
    const a = importRoutineLink(friend, plain)
    expect(a).not.toBe('r1')
    expect(friend.routines[0]).toBe(mine)
    expect(mine.ex).toEqual([{ id: BENCH, sets: 5, reps: 5 }])
    expect(friend.routines[1].name).toBe('Push Day 💪 Ärger 2')
    const named = readRoutineBundle(await decoded(state(), push, { from: 'Alex' }), 'kg')
    importRoutineLink(friend, named)
    importRoutineLink(friend, named)
    expect(friend.routines.map(r => r.name)).toEqual(['Push Day 💪 Ärger', 'Push Day 💪 Ärger 2', 'Push Day 💪 Ärger (from Alex)', 'Push Day 💪 Ärger (from Alex) 2'])
    expect(friend.week).toEqual({ 1: ['r1'] })
    expect(importedRoutineName('', '', [])).toBe('Shared routine')
  })

  it('reads an older plain plan bundle (no names, no from) and drops exercises it does not know', () => {
    const old = { opengym_plan: 1, name: 'Old', routines: [{ id: 'o', name: 'Old one', ex: [{ id: BENCH, sets: 3, reps: 5 }, { id: 'nope-123', sets: 1 }] }] }
    const parsed = readRoutineBundle(old, 'kg')
    expect(parsed.dropped).toBe(1)
    expect(parsed.from).toBe('')
    expect(parsed.routines[0].ex).toHaveLength(1)
  })

  it('a link whose exercises are all unknown here is refused, not imported empty', () => {
    const data = { opengym_plan: 1, routines: [{ id: 'o', name: 'X', ex: [{ id: 'nope-1', sets: 1 }] }] }
    expect(() => readRoutineBundle(data, 'kg')).toThrow(expect.objectContaining({ code: 'empty' }))
    expect(() => readRoutineBundle({ nope: 1 }, 'kg')).toThrow(expect.objectContaining({ code: 'bad-link' }))
  })

  it('only the first routine of a hand-made link with several', () => {
    const data = { opengym_plan: 1, week: { 1: ['a'] }, routines: [{ id: 'a', name: 'A', ex: [{ id: BENCH, sets: 1, reps: 1 }] }, { id: 'b', name: 'B', ex: [{ id: BENCH, sets: 1, reps: 1 }] }] }
    const friend = { unit: 'kg', routines: [], week: {}, customEx: [] }
    importRoutineLink(friend, readRoutineBundle(data, 'kg'))
    expect(friend.routines.map(r => r.name)).toEqual(['A'])
    expect(friend.week).toEqual({})
  })
})

describe('Watch on YouTube', () => {
  it('searches the English catalogue name plus "form", spaces as +', () => {
    expect(youtubeSearchUrl(EXIDX[BENCH])).toBe('https://www.youtube.com/results?search_query=barbell+bench+press+form')
  })
  it('encodes what needs encoding, and a custom exercise searches its own name', () => {
    expect(youtubeSearchUrl({ id: 'c', n: 'Zercher  carry & 3/4 #1 ü', custom: true }))
      .toBe('https://www.youtube.com/results?search_query=Zercher+carry+%26+3%2F4+%231+%C3%BC+form')
  })
  it('nothing for an exercise without a name or one that is missing', () => {
    expect(youtubeSearchUrl({ id: 'x', n: '  ' })).toBeNull()
    expect(youtubeSearchUrl(null)).toBeNull()
    expect(youtubeSearchUrl({ id: 'x', n: 'Unknown exercise', missing: true })).toBeNull()
  })
})
