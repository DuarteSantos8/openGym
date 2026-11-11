// The Garmin watch's sync as JavaScript, for the end-to-end tests of the wire protocol
// (src/lib/garmin-link.e2e.test.js): nobody here has a Garmin, and the simulator cannot talk to a
// phone app, so both ends are driven in code. This is a line-by-line port of the parts of
// source/Core.mc (the state, the outbox, applySnapshot, tick, start, finish) and of source/App.mc's
// Link (send, hello, flush, retry, sent, failed) that decide what goes over the link and when.
// It is a model, not the watch: source/CoreTest.mc tests the real Monkey C in the simulator, and
// src/lib/garmin-contract.test.js fails when the constants and field names below stop matching
// the Monkey C sources. Change one, change the other.
//
// Left out (they do not touch the link): per-side sets, holds, the rest timer, the Instinct's
// 6-set outbox, drawing.

export const EV_KEYS = ['id', 'type', 'at', 'wid', 'exId', 'entryIdx', 'setIdx', 'w', 'r', 'sec', 'side', 'hr', 'rir', 'rpe', 'routineIds']
export const BATCH = 4            // Link.flush: events per message
export const MAX = 60             // Link.MAX
export const HARD = 90            // Link.HARD
export const RETRY_UNSENT_MS = 30000
export const RETRY_UNACKED_MS = 60000
export const GIVE_UP_MS = 45000   // a transmit that never called back
export const HELLO_EVERY_MS = 60000
export const HEARD_RESEND_MS = 10000  // Link.heard: sent longer ago than this and not named → again
export const QUIET_MAX = 4            // the waits double up to 60 s << 4

const isNum = v => typeof v === 'number' && Number.isFinite(v)
const dictOf = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null)
const arrOf = v => (Array.isArray(v) ? v : [])
const same = (a, b) => typeof a === 'string' && a === b
const isTrue = v => v === true || v === 1
const toI = (v, d) => (isNum(v) ? Math.trunc(v) : d)
const strOf = v => (typeof v === 'string' ? v : v == null ? '' : String(v))

export const emptyState = () => ({
  w: null, rd: null, set: {}, u: 'kg', rs: 90, stk: null, sy: false,
  sh: null, fh: [], p: {}, pos: 0, sk: [], rest: null, ob: [], obn: 0, rec: null, pre: null,
})

/** Core.normalize: a state read back from storage, with anything missing filled in. */
export function normalize (s) {
  const base = emptyState()
  if (!dictOf(s)) return base
  for (const k of Object.keys(base)) if (!(k in s) || (s[k] == null && base[k] != null)) s[k] = base[k]
  if (toI(s.obn, 0) > s.ob.length) s.obn = s.ob.length
  return s
}

/** Core.pack / unpack: an event waits as an array of its values in EV_KEYS' order. */
export function pack (ev) {
  const out = []
  let last = 0
  EV_KEYS.forEach((k, i) => {
    let v = ev[k]
    if (dictOf(v)) v = [v.avg, v.max]
    out.push(v ?? null)
    if (v != null) last = i + 1
  })
  return out.slice(0, last)
}
export function unpack (ev) {
  if (dictOf(ev)) return ev
  const out = {}
  ev.forEach((v, i) => {
    if (v == null || i >= EV_KEYS.length) return
    out[EV_KEYS[i]] = i === 11 ? { avg: v[0], max: v[1] } : v
  })
  return out
}
const evField = (ev, k) => (dictOf(ev) ? ev[EV_KEYS[k]] : Array.isArray(ev) && ev.length > k ? ev[k] : null)

/**
 * The watch. `radio.transmit(message, { onComplete, onError })` is Communications.transmit;
 * `now()` is the clock (ms); `stored` is what Application.Storage gave back at the start.
 */
export class GarminWatch {
  constructor ({ radio, now = () => Date.now(), stored = null }) {
    this.radio = radio
    this.now = now
    this.disk = stored ? JSON.parse(JSON.stringify(stored)) : { s: null, ob: null }
    // G.load + Core.normalize
    const s = this.disk.s ? { ...this.disk.s, ob: this.disk.ob ?? this.disk.s.ob } : null
    this.s = normalize(s)
    // Link
    this.busy = false
    this.lastTry = 0
    this.began = 0
    this.gen = 0
    this.ask = true
    this.quiet = 0
    this.ended = null
    this.sentMessages = 0
    this.n = 0
  }

  /** OpenGymApp.onStart: "send me the latest". */
  launch () { this.hello(); return this }

  // Time.now() has whole seconds
  nowMs () { return Math.floor(this.now() / 1000) * 1000 }
  newId () { this.n += 1; return 'g' + this.nowMs() + '-' + this.n + '-' + Math.floor(Math.random() * 1e6) }

  /* ---------- storage (App.mc G.save / G.saveOb) ---------- */
  save () { const { ob, ...rest } = this.s; this.disk = JSON.parse(JSON.stringify({ s: { ...rest, w: this.s.w, rd: this.s.rd }, ob })) }
  saveOb () { this.disk.ob = JSON.parse(JSON.stringify(this.s.ob)) }
  /** What a restart finds in storage. */
  stored () { return JSON.parse(JSON.stringify(this.disk)) }

  /* ---------- Core: the outbox ---------- */
  ackOutbox (acked) {
    if (!acked.length) return
    const sent = toI(this.s.obn, 0)
    const kept = []
    let n = 0
    this.s.ob.forEach((ev, i) => {
      if (acked.some(a => same(a, evField(ev, 0)))) return
      kept.push(ev)
      if (i < sent) n += 1
    })
    this.s.ob = kept
    this.s.obn = n
  }

  room (max, hard) {
    const ob = this.s.ob
    const sent = toI(this.s.obn, 0)
    if (ob.length < max || (sent === 0 && ob.length < hard)) return
    let k = 0
    if (sent === 0) { while (k < ob.length - 1 && same(evField(ob[k], 1), 'start')) k += 1 } else this.s.obn = sent - 1
    this.s.ob = ob.filter((_, i) => i !== k)
  }

  unsent () { return this.s.ob.length - toI(this.s.obn, 0) }
  /** Core.waiting: sets on their way, a set fixed or rated after its tick counted once (Core.again). */
  waiting () {
    const ob = this.s.ob
    const set = ev => same(evField(ev, 1), 'setDone')
    const again = i => ob.slice(Math.max(0, i - 8), i).some(b => set(b) && same(evField(b, 4), evField(ob[i], 4)) && evField(b, 6) === evField(ob[i], 6) &&
      same(evField(b, 3), evField(ob[i], 3)) && (evField(b, 10) ?? null) === (evField(ob[i], 10) ?? null))
    return ob.filter((ev, i) => set(ev) && !again(i)).length
  }

  /* ---------- Core: the phone's snapshot ---------- */
  entries () { const w = dictOf(this.s.w); return w ? arrOf(w.entries) : [] }
  entryAt (pos) { const es = this.entries(); return pos >= 0 && pos < es.length ? dictOf(es[pos]) : null }
  entryIdx (pos) { const e = this.entryAt(pos); return e ? toI(e.i, pos) : pos }
  hasMore () {
    const w = dictOf(this.s.w)
    if (!w) return false
    const es = this.entries()
    if (!es.length) return toI(w.count, 0) > 0
    const last = dictOf(es[es.length - 1])
    return toI(w.count, es.length) > (last ? toI(last.i, es.length - 1) : es.length - 1) + 1
  }

  setIndex (pos) {
    const e = this.entryAt(pos)
    if (!e) return null
    const sets = arrOf(e.sets)
    for (let si = 0; si < sets.length; si++) {
      const row = dictOf(sets[si])
      if (row && !isTrue(row.done) && !this.s.sk.includes(e.id + '#' + si)) return si
    }
    return null
  }

  applySnapshot (snap) {
    const s = this.s
    this.ackOutbox(arrOf(snap.acked))
    s.rd = dictOf(snap.ready)
    s.sy = true
    if (typeof snap.unit === 'string') s.u = snap.unit
    if (isNum(snap.restSec) && snap.restSec > 0) s.rs = snap.restSec
    if (dictOf(snap.settings)) s.set = snap.settings
    if (dictOf(snap.streak)) s.stk = snap.streak

    const cur = dictOf(s.w)
    const wid = cur ? cur.id : null
    const discarded = arrOf(snap.discarded)
    const droppedThere = wid != null && discarded.includes(wid)
    if (droppedThere && same(wid, s.sh)) s.sh = null
    const unconfirmed = wid != null && same(wid, s.sh)
    const nx = dictOf(snap.active)
    const nid = nx ? nx.id : null

    if (!nx || (nid != null && s.fh.includes(nid))) {
      if (unconfirmed || !cur) return null
      const ended = droppedThere ? null : { name: strOf(cur.name), ended: true }
      s.w = null; s.p = {}; s.sk = []; s.rest = null
      return ended
    }
    const sameOne = nid != null && same(nid, wid)
    if (nid != null && same(nid, s.sh)) s.sh = null
    if (!sameOne && unconfirmed) return null

    const onScreen = this.entryAt(s.pos)
    const onId = onScreen ? onScreen.id : null
    const atEnd = cur != null && this.entries().length > 0 && s.pos >= this.entries().length
    if (!sameOne) { s.p = {}; s.sk = []; s.rest = null }

    const p = s.p
    const es = arrOf(nx.entries)
    for (const e of es) {
      if (!dictOf(e)) continue
      arrOf(e.sets).forEach((row, si) => {
        if (!dictOf(row)) return
        const k = e.id + '#' + si
        const t = p[k]
        if (!t) return
        const rowAt = isNum(row.at) ? row.at : null
        if (isTrue(row.done) && (rowAt == null || rowAt >= t[2])) delete p[k]
        else {
          row.done = true
          if (t[0] != null) row.w = t[0]
          if (t[1] != null) row.r = t[1]
          if (t[3] != null) row.sec = t[3]
          row.at = t[2]
        }
      })
    }
    s.w = nx
    const inWindow = new Set(es.filter(dictOf).map(e => strOf(e.id)))
    for (const k of Object.keys(p)) {
      const cut = k.indexOf('#')
      if (cut < 0 || !inWindow.has(k.slice(0, cut))) delete p[k]
    }
    let pos = 0
    if (!sameOne) {
      const curIdx = toI(nx.cur, 0)
      const k2 = es.findIndex((e, k) => dictOf(e) && toI(e.i, k) === curIdx)
      if (k2 >= 0) pos = k2
    } else if (atEnd && es.length > 0 && !this.hasMore()) {
      pos = es.length
    } else if (onId != null) {
      const k3 = es.findIndex(e => dictOf(e) && same(e.id, onId))
      if (k3 >= 0) pos = k3
    }
    s.pos = pos
    return null
  }

  /* ---------- Core: what the lifter does ---------- */

  /** Core.tickAt + Actions.tick: the set done here, its event stored and sent. */
  tick (pos, si, w, r, { hr = null, at = this.nowMs(), eff = null } = {}) {
    const s = this.s
    const wk = dictOf(s.w)
    const e = this.entryAt(pos)
    if (!wk || !e) return null
    const row = dictOf(arrOf(e.sets)[si])
    if (!row) return null
    row.done = true
    if (w != null) row.w = w
    if (r != null) row.r = r
    row.at = at
    s.p[e.id + '#' + si] = [w, r, at, null]
    const ev = { id: this.newId(), type: 'setDone', wid: strOf(wk.id), exId: strOf(e.id), entryIdx: this.entryIdx(pos), setIdx: si, at }
    if (w != null) ev.w = w
    if (r != null) ev.r = r
    if (hr != null) ev.hr = { avg: hr[0], max: hr[1] }
    if (eff != null) ev[eff[0]] = eff[1]
    s.eo = ev.id
    this.send(ev)
    this.save()
    return ev
  }

  /** The next set to do, ticked with the numbers the phone planned (what START on the set page does). */
  tickNext (over = {}) {
    for (let pos = 0; pos < this.entries().length; pos++) {
      const si = this.setIndex(pos)
      if (si == null) continue
      const row = this.entryAt(pos).sets[si]
      return this.tick(pos, si, over.w ?? row.w ?? null, over.r ?? row.r ?? null, over)
    }
    return null
  }

  /** Core.fix: a done set with new numbers, a moment later than its own tick, without hr. */
  fix (pos, si, w, r) {
    const row = this.entryAt(pos)?.sets?.[si]
    if (!row || !isTrue(row.done)) return null
    let at = this.nowMs()
    if (isNum(row.at) && row.at + 1 > at) at = row.at + 1
    return this.tick(pos, si, w, r, { at })
  }

  /** Core.start + Actions.startNow. */
  start (session) {
    const s = this.s
    const at = this.nowMs()
    const wid = 'watch-' + at
    const es = arrOf(session.entries)
    s.w = { id: wid, name: strOf(session.name), unit: s.u, cur: 0, restSec: s.rs, entries: es, start: at, count: toI(session.count, es.length) }
    s.sh = wid
    const rd = dictOf(s.rd)
    if (rd && rd.today === session) rd.today = { name: strOf(session.name), routineIds: arrOf(session.routineIds), entries: [] }
    s.p = {}; s.sk = []; s.pos = 0; s.rest = null
    const ev = { id: this.newId(), type: 'start', routineIds: arrOf(session.routineIds), wid, at }
    this.ended = null
    this.send(ev)
    this.save()
    return ev
  }

  /** Core.finish + Actions.finish. */
  finish (discard = false) {
    const s = this.s
    const w = dictOf(s.w)
    if (!w) return null
    const at = this.nowMs()
    const wid = strOf(w.id)
    s.w = null; s.p = {}; s.sk = []; s.sh = null; s.rest = null; s.pos = 0
    s.fh.push(wid)
    if (s.fh.length > 5) s.fh = s.fh.slice(-5)
    const ev = { id: this.newId(), type: discard ? 'discard' : 'finish', wid, at }
    this.send(ev)
    this.ended = discard ? null : { ended: false }
    this.save()
    return ev
  }

  /* ---------- App.mc: Link ---------- */

  send (ev) {
    if (!ev) return
    this.room(MAX, HARD)
    this.s.ob.push(pack(ev))
    this.saveOb()
    this.flush()
  }

  listener (n) {
    const gen = this.gen
    return { onComplete: () => this.sent(n, gen), onError: () => this.failed(gen) }
  }

  hello () {
    if (this.busy) return false
    this.began = this.now()
    this.gen += 1
    this.busy = true
    this.sentMessages += 1
    this.radio.transmit({ events: [{ id: this.newId(), type: 'hello', at: this.nowMs() }] }, this.listener(0))
    return true
  }

  flush () {
    const ob = this.s.ob
    const from = toI(this.s.obn, 0)
    if (this.busy || from >= ob.length) return
    this.busy = true
    this.lastTry = this.now()
    this.began = this.lastTry
    this.gen += 1
    const n = Math.min(BATCH, ob.length - from)
    this.sentMessages += 1
    this.radio.transmit({ events: ob.slice(from, from + n).map(unpack) }, this.listener(n))
  }

  /** Once a second (OpenGymApp.onTick). */
  second () {
    const now = this.now()
    if (this.busy && now - this.began > GIVE_UP_MS) { this.busy = false; this.gen += 1 }
    if (this.busy) return
    const wait = RETRY_UNACKED_MS << Math.min(QUIET_MAX, this.quiet)
    if (this.ask && now - this.began > wait && this.hello()) { this.quiet += 1; return }
    if (!this.s.ob.length) return
    const since = now - this.lastTry
    if (this.unsent() > 0 && since > RETRY_UNSENT_MS) this.flush()
    else if (this.unsent() === 0 && since > wait) { this.s.obn = 0; this.quiet += 1; this.flush() }
  }

  /** Link.heard: the phone just spoke. */
  heard () {
    this.ask = false
    this.quiet = 0
    if (!this.busy && this.s.ob.length > 0 && this.unsent() === 0 && this.now() - this.lastTry > HEARD_RESEND_MS) this.s.obn = 0
    this.flush()
  }

  sent (n, g) {
    if (g !== this.gen) return
    this.busy = false
    if (n > 0) {
      this.s.obn = Math.min(this.s.ob.length, toI(this.s.obn, 0) + n)
      this.saveOb()
    }
    this.flush()
  }

  failed (g) {
    if (g !== this.gen) return
    this.busy = false
  }

  /** OpenGymApp.onPhone: a message from the phone. */
  onPhone (data) {
    if (!dictOf(data)) return
    const ended = this.applySnapshot(data)
    if (ended) this.ended = ended
    this.save()
    this.heard()
  }
}
