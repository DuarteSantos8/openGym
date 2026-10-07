/* Property test of the sync model: N devices and a server, each device modelled on the store
 * (useStore update / persist / doPush / pullState / mergeInto) and the server on PUT /api/data,
 * driven by random edits, deletes, offline spells, lost responses and pushes still in flight.
 * After everything settles, every device must hold the server's copy, and every entry must be
 * what the last change to it said: present with its last edit, or gone after its last delete.
 * Found by a scratch fuzzer (QA 2026-10-06): an unrelated edit re-stamped entries a device merely
 * still held as added back, and a star set on a device that never saw an earlier unstar was lost.
 */
import { describe, expect, it } from 'vitest'
import * as M from './sync-merge.js'
import * as U from './units.js'
import { stampPut } from '../../../api/sync-stamps.js'

const { mergeStates, stampWorkout, keepReset } = M
const unitOps = []
const clone = o => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)))
// What server.js sends a client: the stored document without the server's own notes.
const forClient = S => { const x = clone(S); if (x) { delete x._unstamped; delete x._prior } return x }
const DEL = '__DELETED__'

function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296 } }

const DEF = () => ({ unit: 'kg', workouts: [], routines: [], customEx: [], bodyweight: [], week: {}, dayPlan: {}, queue: null, restSec: 90, exNotes: {}, favEx: [], gymCards: [], equipProfiles: [], exWeights: {}, barWeights: {} })
const EXS = ['bench', 'squat', 'dead', 'row', 'ohp']
const DAYS = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']

function run(seed, opts = {}) {
  const R = rng(seed)
  const ri = n => Math.floor(R() * n)
  const pick = a => a[ri(a.length)]
  const NREP = opts.replicas || 2 + ri(2)
  const NOPS = opts.ops || 10 + ri(40)
  let T = 1_700_000_000_000
  let idc = 0
  const uid = p => `${p}${++idc}`
  const trace = []
  const truth = new Map()   // key -> { t, val, by }
  const everDeleted = new Set()
  const created = new Map()
  const note = (key, val, by) => { if (!created.has(key)) created.set(key, T); if (val === DEL) everDeleted.add(key); truth.set(key, { t: T, val: clone(val), by }) }

  const server = { doc: null, rev: 0 }
  const reps = []
  for (let i = 0; i < NREP; i++) {
    reps.push({ i, S: Object.assign(DEF(), { _ts: 0 }), base: null, owed: false, online: true, skew: opts.skew ? Math.round((R() - 0.5) * 2 * (opts.skew)) : 0, inflight: null, pushPending: false })
  }
  const nowOf = r => T + r.skew
  server.doc = Object.assign(DEF(), { _ts: T, _rev: 1 }); server.rev = 1
  for (const r of reps) { r.S = clone(server.doc); delete r.S._rev; r.base = { rev: 1, ts: T } }

  // ---- store model -----------------------------------------------------------------------
  function persist(r, S, stamp = true) {
    if (stamp) S._ts = Math.max(nowOf(r), (r.base?.ts || 0) + 1, Number(S._ts) || 0)
    r.S = S
  }
  function update(r, mut) {
    const prev = r.S
    const S = clone(prev)
    const ok = mut(S, nowOf(r))
    if (ok === false) return false
    S._ts = M.stampChange(prev, S, nowOf(r))
    persist(r, S)
    r.pushTm = true
    return true
  }
  const localChanged = r => !!r.base && (r.S._ts || 0) > (r.base.ts || 0)
  function mergeInto(r, remote, rev) {
    const ts = r.base?.ts || 0
    const merged = Object.assign(DEF(), mergeStates(r.S, remote))
    persist(r, merged)
    r.base = { rev, ts }
  }
  function serverPut(body) {
    const cur = server.doc
    const curRev = server.rev
    if (body.baseRev != null && body.baseRev !== curRev) return { status: 409, state: forClient(cur), rev: curRev }
    const st = clone(body.state)
    delete st.active
    const storedReset = Number(cur?.resetAt) || 0
    if (storedReset > (Number(st.resetAt) || 0)) { st.resetAt = cur.resetAt; if (cur.resetIds) st.resetIds = cur.resetIds; else delete st.resetIds }
    stampPut(cur, st, { overRead: body.baseRev != null && body.baseRev === curRev, stamped: true, now: T })
    st._rev = curRev + 1
    server.doc = st; server.rev = st._rev
    return { status: 200, rev: st._rev }
  }
  // push in two phases: send (server applies) and receive (client learns), so local edits can
  // land in between; `lose` drops the response.
  function pushSend(r, force0 = false, attempt = 0) {
    const force = force0 || r.forceNext; r.forceNext = false
    if (!r.online) { r.owed = true; return }
    const snap = clone(r.S)
    const body = { state: snap }
    if (!force && r.base) body.baseRev = r.base.rev
    const res = serverPut(body)
    r.inflight = { res, snapTs: snap._ts, attempt }
  }
  function pushRecv(r, lose = false) {
    const f = r.inflight; if (!f) return
    r.inflight = null
    if (lose) { r.owed = true; return }
    if (f.res.status === 200) { r.base = { rev: f.res.rev, ts: f.snapTs }; r.owed = false; return }
    if (f.attempt < 2) {
      mergeInto(r, f.res.state, f.res.rev || 0)
      pushSend(r, false, f.attempt + 1)
      pushRecv(r)
      return
    }
    r.owed = true
  }
  function push(r) { r.pushTm = false; pushSend(r); pushRecv(r) }
  function pull(r) {
    if (!r.online) return
    if (r.inflight) pushRecv(r)
    if (r.pushTm) push(r)
    const state = forClient(server.doc), rev = server.rev
    const S = r.S
    const dirty = r.owed
    if (!r.base) {
      if (dirty && state) { mergeInto(r, state, rev); push(r); return }
      const hasData = st => !!((st.workouts || []).length || (st.routines || []).length || (st.bodyweight || []).length || (st.customEx || []).length)
      const restored = (!state || (hasData(S) && ((state._ts || 0) < (S._ts || 0)))) ? null : Object.assign(DEF(), state)
      if (restored) { persist(r, restored, false); r.base = { rev, ts: restored._ts }; r.owed = false }
      else if (hasData(S)) { r.base = { rev, ts: 0 }; push(r) }
      else { r.base = { rev, ts: state?._ts || 0 } }
      return
    }
    const serverMoved = rev !== r.base.rev
    const changed = dirty || localChanged(r)
    if (!serverMoved) { if (changed) push(r); return }
    if (!state) { r.base = { rev, ts: 0 }; push(r); return }
    if (!changed) { const next = Object.assign(DEF(), state); persist(r, next, false); r.base = { rev, ts: next._ts }; r.owed = false; return }
    mergeInto(r, state, rev)
    push(r)
  }

  // ---- user operations ---------------------------------------------------------------------
  const canonW = (w, unit = 'kg') => { const x = clone(w); delete x._ts; delete x._f; delete x.media; delete x.note; for (const e of x.entries || []) for (const st of e.sets || []) st.w = unit === 'lb' ? st.w / 2.2046226218 : st.w; return x }
  const sameW = (a, b) => { const ws = [], wt = []; const sa = JSON.stringify(a, (k, v) => (k === 'w' && typeof v === 'number' ? (ws.push(v), 0) : v)); const sb = JSON.stringify(b, (k, v) => (k === 'w' && typeof v === 'number' ? (wt.push(v), 0) : v)); return sa === sb && ws.every((x, i) => Math.abs(x - wt[i]) < 0.4) }
  const canonR = x => { const y = clone(x); delete y._ts; delete y._f; return y }
  const ops = {
    addWorkout(r) {
      const id = uid('w')
      const w = { id, d: pick(DAYS), start: nowOf(r) - 3600000, end: nowOf(r), entries: [{ id: pick(EXS), sets: [{ w: 20 + ri(100), r: 5 }] }] }
      update(r, S => { S.workouts.push(w) })
      note('w:' + id, canonW(w, r.S.unit), r.i)
      return `addWorkout ${id}`
    },
    editWorkout(r) {
      const W = r.S.workouts; if (!W.length) return null
      const id = pick(W).id
      let rec
      update(r, (S, now) => { const i = S.workouts.findIndex(x => x.id === id); rec = S.workouts[i]; rec.entries[0].sets.push({ w: 20 + ri(100), r: 1 + ri(10) }); stampWorkout(rec, now) })
      if (truth.get('w:' + id)?.val === DEL) note('wn:' + id, rec.note ?? DEL, r.i)
      note('w:' + id, canonW(rec, r.S.unit), r.i)
      return `editWorkout ${id}`
    },
    addMedia(r) {
      const W = r.S.workouts; if (!W.length) return null
      const id = pick(W).id; const h = uid('h')
      let rec
      update(r, (S, now) => { rec = S.workouts.find(x => x.id === id); rec.media = [...(rec.media || []), { hash: h, kind: 'img' }]; stampWorkout(rec, now) })
      note('m:' + id + ':' + h, true, r.i)
      // an edit keeps the workout (also after a delete elsewhere); its sets are whatever was set last
      { const was = truth.get('w:' + id); if (was?.val === DEL) note('wn:' + id, rec.note ?? DEL, r.i); note('w:' + id, was && was.val !== DEL ? was.val : canonW(rec, r.S.unit), r.i) }
      return `addMedia ${id} ${h}`
    },
    deleteWorkout(r) {
      const W = r.S.workouts; if (!W.length) return null
      const id = pick(W).id
      update(r, S => { S.workouts = S.workouts.filter(x => x.id !== id) })
      note('w:' + id, DEL, r.i); note('wn:' + id, DEL, r.i)
      return `deleteWorkout ${id}`
    },
    addRoutine(r) {
      const id = uid('r'); const x = { id, name: 'R' + id, ex: [{ id: pick(EXS), sets: 3 }] }
      update(r, S => { S.routines.push(x) }); note('r:' + id, clone(x.ex), r.i); note('rn:' + id, x.name, r.i); return `addRoutine ${id}`
    },
    editRoutine(r) {
      if (!r.S.routines.length) return null
      const id = pick(r.S.routines).id; let rec
      update(r, S => { rec = S.routines.find(x => x.id === id); rec.ex.push({ id: pick(EXS), sets: 1 + ri(5) }) })
      note('r:' + id, clone(rec.ex), r.i)
      if (truth.get('rn:' + id)?.val === DEL) note('rn:' + id, rec.name, r.i)
      return `editRoutine ${id}`
    },
    deleteRoutine(r) {
      if (!r.S.routines.length) return null
      const id = pick(r.S.routines).id
      update(r, S => { S.routines = S.routines.filter(x => x.id !== id) }); note('r:' + id, DEL, r.i); note('rn:' + id, DEL, r.i); return `deleteRoutine ${id}`
    },
    reorderRoutines(r) {
      if (r.S.routines.length < 2) return null
      update(r, S => { S.routines.reverse() }); return `reorderRoutines`
    },
    addCustom(r) {
      const id = uid('c'); const x = { id, name: 'C' + id, custom: true, eq: '' }
      update(r, S => { S.customEx.push(x) }); note('c:' + id, x.name, r.i); return `addCustom ${id}`
    },
    editCustom(r) {
      if (!r.S.customEx.length) return null
      const id = pick(r.S.customEx).id; let rec
      update(r, S => { rec = S.customEx.find(x => x.id === id); rec.name = 'C' + id + '-' + ri(1000) })
      note('c:' + id, rec.name, r.i)
      if (truth.get('cm:' + id)?.val === DEL && rec.media) note('cm:' + id, rec.media.hash, r.i)
      return `editCustom ${id}`
    },
    deleteCustom(r) {
      if (!r.S.customEx.length) return null
      const id = pick(r.S.customEx).id
      update(r, S => { S.customEx = S.customEx.filter(x => x.id !== id) }); note('c:' + id, DEL, r.i); note('cm:' + id, DEL, r.i); return `deleteCustom ${id}`
    },
    weighIn(r) {
      const d = pick(DAYS); const w = 60 + ri(40)
      update(r, (S, now) => { S.bodyweight = S.bodyweight.filter(e => e.d !== d); S.bodyweight.push({ d, w, t: now }); S.bodyweight.sort((a, b) => (a.d < b.d ? -1 : 1)) })
      note('bw:' + d, { w: r.S.unit === 'lb' ? w / 2.2046226218 : w }, r.i); return `weighIn ${d} ${w}`
    },
    deleteWeighIn(r) {
      if (!r.S.bodyweight.length) return null
      const d = pick(r.S.bodyweight).d
      update(r, S => { S.bodyweight = S.bodyweight.filter(e => e.d !== d) }); note('bw:' + d, DEL, r.i); return `deleteWeighIn ${d}`
    },
    toggleFav(r) {
      const ex = pick(EXS); const has = r.S.favEx.includes(ex)
      update(r, S => { S.favEx = has ? S.favEx.filter(x => x !== ex) : [...S.favEx, ex] })
      note('fav:' + ex, has ? DEL : true, r.i); return `${has ? 'unfav' : 'fav'} ${ex}`
    },
    setRest(r) {
      const v = 30 * (1 + ri(10)); if (r.S.restSec === v) return null
      update(r, S => { S.restSec = v }); note('set:restSec', v, r.i); return `restSec ${v}`
    },
    setWeek(r) {
      const d = String(ri(7)); const v = R() < 0.3 ? null : pick(r.S.routines)?.id || 'rest'
      const cur = r.S.week[d]
      if ((v == null && !(d in r.S.week)) || cur === v) return null
      update(r, S => { if (v == null) delete S.week[d]; else S.week[d] = v })
      note('week:' + d, v == null ? DEL : v, r.i); return `week ${d}=${v}`
    },
    setQueue(r) {
      const v = R() < 0.2 ? null : { items: [pick(EXS), pick(EXS)], n: ri(100) }
      if (JSON.stringify(v) === JSON.stringify(r.S.queue)) return null
      update(r, S => { S.queue = v }); note('set:queue', v, r.i); return `queue ${JSON.stringify(v)}`
    },
    setNote(r) {
      const ex = pick(EXS); const v = R() < 0.3 ? null : 'n' + ri(1000)
      if (v == null && !(ex in r.S.exNotes)) return null
      update(r, S => { if (v == null) delete S.exNotes[ex]; else S.exNotes[ex] = v })
      note('note:' + ex, v == null ? DEL : v, r.i); return `note ${ex}=${v}`
    },
    addCard(r) {
      const id = uid('g'); update(r, S => { S.gymCards.push({ id, name: id }) }); note('g:' + id, true, r.i); return `addCard ${id}`
    },
    deleteCard(r) {
      if (!r.S.gymCards.length) return null
      const id = pick(r.S.gymCards).id
      update(r, S => { S.gymCards = S.gymCards.filter(x => x.id !== id) }); note('g:' + id, DEL, r.i); note('gl:' + id, DEL, r.i); return `deleteCard ${id}`
    },
    // Second fields of the same entries: edited on one device while another edits the first
    // field, both edits must survive (field-level merge).
    noteWorkout(r) {
      const W = r.S.workouts; if (!W.length) return null
      const id = pick(W).id; const v = 'n' + ri(1000)
      let rec
      update(r, (S, now) => { rec = S.workouts.find(x => x.id === id); rec.note = v; stampWorkout(rec, now) })
      note('wn:' + id, v, r.i)
      { const was = truth.get('w:' + id); note('w:' + id, was && was.val !== DEL ? was.val : canonW(rec, r.S.unit), r.i) }
      return `noteWorkout ${id}`
    },
    renameRoutine(r) {
      if (!r.S.routines.length) return null
      const id = pick(r.S.routines).id; const v = 'R' + id + '-' + ri(1000); let rec
      update(r, S => { rec = S.routines.find(x => x.id === id); rec.name = v })
      note('rn:' + id, v, r.i)
      { const was = truth.get('r:' + id); note('r:' + id, was && was.val !== DEL ? was.val : clone(rec.ex), r.i) }
      return `renameRoutine ${id}`
    },
    customMedia(r) {
      if (!r.S.customEx.length) return null
      const id = pick(r.S.customEx).id; const h = uid('ch'); let rec
      update(r, S => { rec = S.customEx.find(x => x.id === id); rec.media = { hash: h } })
      note('cm:' + id, h, r.i)
      { const was = truth.get('c:' + id); note('c:' + id, was && was.val !== DEL ? was.val : rec.name, r.i) }
      return `customMedia ${id}`
    },
    editCard(r) {
      if (!r.S.gymCards.length) return null
      const id = pick(r.S.gymCards).id; const v = 'L' + ri(1000)
      update(r, S => { S.gymCards.find(x => x.id === id).label = v })
      note('gl:' + id, v, r.i); note('g:' + id, true, r.i)
      return `editCard ${id}`
    },
  }
  const resets = []
  if (opts.units) ops.setUnit = r => {
    const to = r.S.unit === 'lb' ? 'kg' : 'lb'
    const conv = opts.units === 'mix' ? R() < 0.5 : true
    const S0 = r.S
    const S = clone(conv ? U.convertStateUnit(S0, to) : { ...S0, unit: to })
    S.unitSet = { at: nowOf(r), convert: conv }
    persist(r, S); r.pushTm = true
    unitOps.push({ t: T, conv })
    return `setUnit ${to} convert=${conv}`
  }
  if (opts.reset) ops.reset = r => {
    const cur = r.S
    const S = DEF()
    S.resetAt = Math.max(nowOf(r), (Number(cur.resetAt) || 0) + 1)
    S.resetIds = M.mergeResetIds(cur.resetIds, M.resetIdsOf(cur))
    keepReset(cur, S); persist(r, S); r.forceNext = true; r.pushTm = true
    if (r.online && server.doc) {
      const ids = M.mergeResetIds(r.S.resetIds, M.mergeResetIds(server.doc.resetIds, M.resetIdsOf(server.doc)))
      if (JSON.stringify(ids) !== JSON.stringify(r.S.resetIds)) { const S2 = clone(r.S); S2.resetIds = ids; persist(r, S2) }
    }
    resets.push(T)
    if (r.inflight) pushRecv(r)
    push(r)   // the 1.5 s debounce: forced if it lands, an ordinary push once it failed
    return 'RESET'
  }
  const only = opts.only ? new Set(opts.only.split(',')) : null
  const opNames = Object.keys(ops).filter(k => !only || only.has(k))
  const syncOps = ['push', 'pull', 'pushSendOnly', 'recv', 'recvLost', 'offline', 'online']

  for (let step = 0; step < NOPS; step++) {
    T += 1 + ri(opts.gap || 5000)
    const r = pick(reps)
    let desc = null
    if (R() < 0.55) {
      const name = pick(opNames)
      desc = ops[name](r)
    } else {
      const s = pick(syncOps)
      if (s === 'push') { if (!r.inflight && r.pushTm) { push(r); desc = 'push(timer)' } }
      else if (s === 'pull') { pull(r); desc = 'pull' }
      else if (s === 'pushSendOnly') { if (!r.inflight && r.online && r.pushTm) { r.pushTm = false; pushSend(r); desc = 'pushSend' } }
      else if (s === 'recv') { if (r.inflight) { pushRecv(r); desc = 'pushRecv' } }
      else if (s === 'recvLost') { if (r.inflight) { pushRecv(r, true); desc = 'pushRecv(lost)' } }
      else if (s === 'offline') { if (r.online) { r.online = false; desc = 'offline' } }
      else if (s === 'online') { if (!r.online) { r.online = true; desc = 'online' } }
    }
    if (desc) trace.push(`T+${T - 1_700_000_000_000} r${r.i}: ${desc}`)
  }
  // ---- settle -----------------------------------------------------------------------------
  for (const r of reps) { r.online = true; if (r.inflight) pushRecv(r) }
  for (let round = 0; round < 6; round++) for (const r of reps) { T += 1000; pull(r) }
  const strip = S => { const x = clone(S); for (const k of ['_ts', '_rev', 'active']) delete x[k]; return JSON.stringify(sortKeys(x)) }
  const problems = []
  const sv = strip(forClient(server.doc) || DEF())
  for (const r of reps) if (strip(r.S) !== sv) problems.push(`no-converge r${r.i}`)
  // ---- oracle -----------------------------------------------------------------------------
  const D = server.doc || DEF()
  const lastReset = resets.length ? Math.max(...resets) : 0
  for (const [key, { val, by, t }] of truth) {
    const [kind, a, b] = key.split(':')
    if (resets.length) {
      if (!['w', 'r', 'c', 'g', 'bw', 'm'].includes(kind)) continue   // settings: the reset copy decides
      if (t < lastReset) {
        // made before the last reset: gone if the reset named it, else ambiguous
        const f = { w: 'workouts', r: 'routines', c: 'customEx', g: 'gymCards' }[kind]
        const named = f && (D.resetIds?.[f] || []).includes(a)
        if (named) { const L = D[f] || []; if (L.some(x => x.id === a)) problems.push(`${key}: reset named it but it is back`) }
        continue
      }
      if (created.get(key) < lastReset && kind !== 'bw') continue   // an older entry edited after the reset: ambiguous
    }
    let got
    if (kind === 'w') { const w = (D.workouts || []).find(x => x.id === a); got = w ? canonW(w, D.unit) : DEL; if (got !== DEL && val !== DEL && sameW(got, val)) continue }
    else if (kind === 'm') { const w = (D.workouts || []).find(x => x.id === a); const wTruth = truth.get('w:' + a); if (!w || wTruth?.val === DEL || everDeleted.has('w:' + a)) continue; got = (w.media || []).some(m => m.hash === b) ? true : DEL }
    else if (kind === 'r') { const x = (D.routines || []).find(x => x.id === a); got = x ? x.ex : DEL }
    else if (kind === 'rn') { const x = (D.routines || []).find(x => x.id === a); if (!x && truth.get('r:' + a)?.val !== DEL) continue; got = x ? x.name : DEL }
    else if (kind === 'c') { const x = (D.customEx || []).find(x => x.id === a); got = x ? x.name : DEL }
    else if (kind === 'cm') { const x = (D.customEx || []).find(x => x.id === a); if (!x || truth.get('c:' + a)?.val === DEL) continue; got = x.media?.hash ?? DEL }
    else if (kind === 'wn') { const x = (D.workouts || []).find(x => x.id === a); if (!x || truth.get('w:' + a)?.val === DEL) continue; got = x.note ?? DEL }
    else if (kind === 'gl') { const x = (D.gymCards || []).find(x => x.id === a); if (!x || truth.get('g:' + a)?.val === DEL) continue; got = x.label ?? DEL }
    else if (kind === 'bw') { const x = (D.bodyweight || []).find(x => x.d === a); got = x ? { w: D.unit === 'lb' ? x.w / 2.2046226218 : x.w } : DEL; if (got !== DEL && val !== DEL && Math.abs(got.w - val.w) < 0.2) continue }
    else if (kind === 'fav') got = (D.favEx || []).includes(a) ? true : DEL
    else if (kind === 'set') got = a in D ? D[a] : DEL
    else if (kind === 'week') got = D.week && a in D.week ? D.week[a] : DEL
    else if (kind === 'note') got = D.exNotes && a in D.exNotes ? D.exNotes[a] : DEL
    else if (kind === 'g') got = (D.gymCards || []).some(x => x.id === a) ? true : DEL
    // An entry deleted on one device and edited on another that had not seen the delete comes
    // back with the editing device's version; which fields of the deleted versions survive in it
    // is not a last-change question, so only its presence is checked then.
    const baseKey = { w: 'w:', wn: 'w:', r: 'r:', rn: 'r:', c: 'c:', cm: 'c:', g: 'g:', gl: 'g:' }[kind]
    if (baseKey && everDeleted.has(baseKey + a) && (['wn', 'rn', 'cm', 'gl'].includes(kind) || (val !== DEL && got !== DEL))) continue
    if (JSON.stringify(got) !== JSON.stringify(val)) problems.push(`${key}: want ${JSON.stringify(val)} (r${by} @T+${t - 1_700_000_000_000}) got ${JSON.stringify(got)}`)
  }
  // ids unique
  for (const f of ['workouts', 'routines', 'customEx', 'gymCards']) {
    const ids = (D[f] || []).map(x => x.id); if (new Set(ids).size !== ids.length) problems.push(`dup ids in ${f}`)
  }
  { const ds = (D.bodyweight || []).map(x => x.d); if (new Set(ds).size !== ds.length) problems.push('dup bodyweight day') }
  return { problems, trace, reps, server }
}
function sortKeys(x) { if (Array.isArray(x)) return x.map(sortKeys); if (x && typeof x === 'object') return Object.fromEntries(Object.keys(x).sort().map(k => [k, sortKeys(x[k])])); return x }


const CASES = [
  { name: 'two or three devices, short gaps', seeds: 300, opts: {} },
  { name: 'three devices, long offline gaps', seeds: 300, opts: { ops: 150, replicas: 3, gap: 300000 } },
  { name: 'with resets', seeds: 150, opts: { reset: true, ops: 80 } },
  { name: 'with unit switches', seeds: 150, opts: { units: true, ops: 80 } },
]

describe('sync fuzz: clocks up to a day apart still converge, with nothing duplicated', () => {
  it('three devices, skewed clocks', () => {
    const bad = []
    for (let s = 1; s <= 200; s++) {
      const { problems } = run(s, { skew: 86400000, ops: 80, replicas: 3 })
      // which of two changes neither device had seen comes last is the clocks' call; only
      // convergence and duplicates are checked here (the ordering is checked without skew)
      const hard = problems.filter(p => p.startsWith('no-converge') || p.startsWith('dup'))
      if (hard.length) bad.push(`seed ${s}: ${hard.join('; ')}`)
    }
    expect(bad.slice(0, 5)).toEqual([])
  }, 120000)
})

describe('sync fuzz: every device converges on every last change', () => {
  for (const c of CASES) {
    it(c.name, () => {
      const bad = []
      for (let s = 1; s <= c.seeds; s++) {
        const { problems } = run(s, c.opts)
        if (problems.length) bad.push(`seed ${s}: ${problems.slice(0, 3).join('; ')}`)
      }
      expect(bad.slice(0, 5)).toEqual([])
    }, 120000)
  }
})
