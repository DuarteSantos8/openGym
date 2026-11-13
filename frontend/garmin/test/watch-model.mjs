// The Garmin watch's sync as JavaScript, for the end-to-end tests of the wire protocol
// (src/lib/garmin-link.e2e.test.js): nobody here has a Garmin, and the simulator cannot talk to a
// phone app, so both ends are driven in code. This is a line-by-line port of the parts of
// source/Core.mc (the state, the outbox, applySnapshot, tick, start, finish) and of source/App.mc's
// Link (send, hello, flush, retry, sent, failed) that decide what goes over the link and when.
// It is a model, not the watch: source/CoreTest.mc tests the real Monkey C in the simulator, and
// src/lib/garmin-contract.test.js fails when the constants and field names below stop matching
// the Monkey C sources. Change one, change the other.
//
// Left out (they do not touch the link): per-side sets, holds, the rest's buzzes and ring, the
// Instinct's 6-set outbox, drawing. The rest itself is in (protocol 2, docs/WATCH_SYNC.md "One
// rest"): Core.tickRest, restEvent and followRest, Rest.add / skip and the rest running out.

export const EV_KEYS = ['id', 'type', 'at', 'wid', 'exId', 'entryIdx', 'setIdx', 'w', 'r', 'sec', 'side', 'hr', 'rir', 'rpe', 'routineIds', 'sid', 'restEnd', 'endsAt', 'off']
export const BATCH = 4            // Link.flush: events per message
export const MAX = 60             // Link.MAX
export const HARD = 90            // Link.HARD
export const RETRY_UNSENT_MS = 30000
export const RETRY_UNACKED_MS = 60000
export const GIVE_UP_MS = 45000   // a transmit that never called back
export const HELLO_EVERY_MS = 60000
export const HEARD_RESEND_MS = 10000  // Link.heard: sent longer ago than this and not named → again
export const QUIET_MAX = 4            // the waits double up to 60 s << 4
export const CLOCK_SAMPLES = 8        // Core.noteClock
export const CLOCK_WINDOW_MS = 300000 // Core.off: the last five minutes' samples
export const REST_SLACK_MS = 250      // Core.followRest: a phone end this close is the watch's own

const isNum = v => typeof v === 'number' && Number.isFinite(v)
const dictOf = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null)
const arrOf = v => (Array.isArray(v) ? v : [])
const same = (a, b) => typeof a === 'string' && a === b
const isTrue = v => v === true || v === 1
const toI = (v, d) => (isNum(v) ? Math.trunc(v) : d)
const strOf = v => (typeof v === 'string' ? v : v == null ? '' : String(v))

export const emptyState = () => ({
  w: null, rd: null, set: {}, u: 'kg', rs: 90, stk: null, sy: false,
  sh: null, fh: [], p: {}, pos: 0, sk: [], rest: null, ob: [], obn: 0, rec: null,
  ra: 0, rh: null, ck: [],
})
const placeKey = (e, pos, si) => 'e' + toI(e.i, pos) + ':' + strOf(e.id) + '#' + si
/** Core.pkey: a pending tick by the set's id, else by its place (entry, exercise, set). */
const pkey = (e, pos, si) => { const sid = dictOf(arrOf(e.sets)[si])?.sid; return typeof sid === 'string' ? 's:' + sid : placeKey(e, pos, si) }
const onKey = (e, pos) => '@' + toI(e.i, pos) + ':' + strOf(e.id)
const posIn = (es, id) => { const k = es.findIndex(e => dictOf(e) && same(e.id, id)); return k < 0 ? null : k }

/** Core.normalize: a state read back from storage, with anything missing filled in. */
export function normalize (s) {
  const base = emptyState()
  if (!dictOf(s)) return base
  for (const k of Object.keys(base)) if (!(k in s) || (s[k] == null && base[k] != null)) s[k] = base[k]
  if (toI(s.obn, 0) > s.ob.length) s.obn = s.ob.length
  return s
}

/** Core.pack / unpack: an event waits as an array of its values in EV_KEYS' order. */
/** Core.pack / unpack: the first 9 values by place, then [-place, value] pairs (Core.PLACES). */
export const PLACES = 9
export function pack (ev) {
  const out = []
  let last = 0
  EV_KEYS.forEach((k, i) => {
    let v = ev[k]
    if (dictOf(v)) v = [v.avg, v.max]
    if (i === 16 && v != null && v !== 0) v = v - ev.at   // restEnd waits as ms after at
    if (i < PLACES) { out.push(v ?? null); if (v != null) last = i + 1; return }
    if (v == null) return
    if (last < PLACES) last = PLACES
    out.length = last
    out.push(-i, v)
    last = out.length
  })
  return out.slice(0, last).map(v => v ?? null)
}
const byPairs = ev => ev.length > PLACES && typeof ev[PLACES] === 'number' && ev[PLACES] < 0
export function unpack (ev) {
  if (dictOf(ev)) return ev
  const out = {}
  const pairs = byPairs(ev)
  for (let i = 0; i < ev.length;) {
    let k = i, v = ev[i]
    if (pairs && i >= PLACES) { k = -ev[i]; v = ev[i + 1] ?? null; i += 2 } else i += 1
    if (v == null || k >= EV_KEYS.length) continue
    out[EV_KEYS[k]] = k === 11 ? { avg: v[0], max: v[1] } : k === 16 && v !== 0 ? ev[2] + v : v
  }
  return out
}
const evField = (ev, k) => {
  if (dictOf(ev)) return ev[EV_KEYS[k]]
  if (!Array.isArray(ev)) return null
  if (k < PLACES || !byPairs(ev)) return ev.length > k ? ev[k] : null
  for (let i = PLACES; i + 1 < ev.length; i += 2) if (ev[i] === -k) return ev[i + 1]
  return null
}

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

  // Core.nowMs: milliseconds (Time.now()'s seconds refined by System.getTimer())
  nowMs () { return this.now() }
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

  /* ---------- Core: the clocks ---------- */
  noteClock (phoneNow) {
    if (!isNum(phoneNow) || phoneNow <= 0) return
    const now = this.nowMs()
    this.s.ck = [...arrOf(this.s.ck), [now, now - phoneNow]].slice(-CLOCK_SAMPLES)
  }
  off () {
    const ck = arrOf(this.s.ck)
    if (!ck.length) return 0
    const now = this.nowMs()
    const recent = ck.filter(c => now - c[0] <= CLOCK_WINDOW_MS).map(c => c[1])
    return recent.length ? Math.min(...recent) : ck[ck.length - 1][1]
  }

  doneKeys () {
    const out = new Set()
    this.entries().forEach((e, ei) => {
      if (!dictOf(e)) return
      out.add(onKey(e, ei))
      arrOf(e.sets).forEach((row, si) => { if (dictOf(row) && isTrue(row.done)) out.add(pkey(e, ei, si)) })
    })
    return out
  }

  applySnapshot (snap) {
    const s = this.s
    this.rx = false
    this.ptick = null
    this.ackOutbox(arrOf(snap.acked))
    this.noteClock(snap.now)
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
      s.w = null; s.p = {}; s.sk = []; s.rest = null; s.rh = null; s.ra = 0
      return ended
    }
    const sameOne = nid != null && same(nid, wid)
    if (nid != null && same(nid, s.sh)) s.sh = null
    if (!sameOne && unconfirmed) return null

    const onScreen = this.entryAt(s.pos)
    const onId = onScreen ? onScreen.id : null
    const atEnd = cur != null && this.entries().length > 0 && s.pos >= this.entries().length
    if (!sameOne) { s.p = {}; s.sk = []; s.rest = null; s.rh = null; s.ra = 0 }

    let es = arrOf(nx.entries)
    // the phone behind a drain: the watch keeps its own exercises
    const held = sameOne && onId != null && this.waiting() > 0 && posIn(es, onId) == null
    if (held) { es = this.entries(); nx.entries = es }
    const old = sameOne && !held ? this.doneKeys() : null

    const p = s.p
    const seen = new Set()
    es.forEach((e, ei) => {
      if (!dictOf(e)) return
      arrOf(e.sets).forEach((row, si) => {
        if (!dictOf(row)) return
        const k = pkey(e, ei, si)
        const kp = placeKey(e, ei, si)
        if (p[k] == null && kp !== k && p[kp] != null) { p[k] = p[kp]; delete p[kp] }
        const t = p[k]
        if (t) {
          seen.add(k)
          const rowAt = isNum(row.at) ? row.at : null
          if (isTrue(row.done) && (rowAt == null || rowAt >= t[2])) delete p[k]
          else {
            row.done = true
            if (t[0] != null) row.w = t[0]
            if (t[1] != null) row.r = t[1]
            if (t[3] != null) row.sec = t[3]
            row.at = t[2]
          }
        } else if (old && isTrue(row.done) && old.has(onKey(e, ei)) && !old.has(k)) {
          const at = isNum(row.at) ? row.at : 0
          if (!this.ptick || at >= this.ptick[2]) this.ptick = [ei, si, at]
        }
      })
    })
    s.w = nx
    for (const k of Object.keys(p)) if (!seen.has(k)) delete p[k]

    let pos = 0
    const curIdx = toI(nx.cur, 0)
    const moved = sameOne && !held && toI(cur.cur, curIdx) !== curIdx && this.waiting() === 0
    let at2 = null
    if (!sameOne || moved) {
      const k2 = es.findIndex((e, k) => dictOf(e) && toI(e.i, k) === curIdx)
      if (k2 >= 0) at2 = k2
    }
    if (at2 != null) pos = at2
    else if (sameOne && atEnd && es.length > 0 && !this.hasMore()) pos = es.length
    else if (sameOne && onId != null) { const k3 = posIn(es, onId); if (k3 != null) pos = k3 }
    s.pos = pos
    this.followRest(nx)
    return null
  }

  /** Core.followRest: the phone's rest by its stamp (protocol 2), else the first rules. */
  followRest (nx) {
    const s = this.s
    const rest = dictOf(nx.rest)
    const endsAt = rest && isNum(rest.endsAt) ? rest.endsAt : null
    if (isNum(nx.restAt)) {
      if (nx.restAt <= toI(s.ra, 0)) return
      s.ra = nx.restAt
      const now = this.nowMs()
      const mine = isNum(s.rest) ? s.rest : null
      const was = (mine != null && mine > now) || s.rh != null
      s.rh = null
      if (endsAt != null) {
        const end = endsAt + this.off()
        if (end <= now) s.rest = null
        else if (mine == null || Math.abs(end - mine) > REST_SLACK_MS) s.rest = end
      } else if (isTrue(nx.restPaused)) {
        s.rest = null
        s.rh = isNum(nx.restLeft) && nx.restLeft > 0 ? Math.trunc(nx.restLeft) : 0
      } else {
        s.rest = null
        this.rx = was
      }
    }
    // no stamp: no rest changed in this workout yet (every phone with a Garmin link has protocol 2)
  }

  /** Core.next, the plain case (no supersets, no sides): this exercise while it has sets, then the next. */
  next (pos) {
    const n = this.entries().length
    if (this.setIndex(pos) != null) return pos
    for (let k = pos + 1; k < n; k++) if (this.setIndex(k) != null) return k
    for (let k = 0; k < pos; k++) if (this.setIndex(k) != null) return k
    return n
  }

  /* ---------- Core: what the lifter does ---------- */

  /** Core.tickAt + Actions.tick: the set done here, its event stored and sent. */
  /** `rest`: the rest it starts in seconds (Actions.tick, Core.tickRest), 0 for none; null for a fix (no restEnd). */
  tick (pos, si, w, r, { hr = null, at = this.nowMs(), eff = null, rest = null } = {}) {
    const s = this.s
    const wk = dictOf(s.w)
    const e = this.entryAt(pos)
    if (!wk || !e) return null
    const row = dictOf(arrOf(e.sets)[si])
    if (!row) return null
    const o = this.off()
    const pat = at - o
    row.done = true
    if (w != null) row.w = w
    if (r != null) row.r = r
    row.at = pat
    s.p[pkey(e, pos, si)] = [w, r, pat, null]
    const ev = { id: this.newId(), type: 'setDone', wid: strOf(wk.id), exId: strOf(e.id), entryIdx: this.entryIdx(pos), setIdx: si, at }
    if (typeof row.sid === 'string') ev.sid = row.sid
    if (o !== 0) ev.off = o
    if (w != null) ev.w = w
    if (r != null) ev.r = r
    if (hr != null) ev.hr = { avg: hr[0], max: hr[1] }
    if (eff != null) ev[eff[0]] = eff[1]
    if (rest != null) {
      // Actions.tick: on to the next set, the rest from the tick's own time (Core.tickRest)
      s.pos = this.next(pos)
      const end = rest > 0 ? at + rest * 1000 : 0
      ev.restEnd = end
      s.ra = at - o
      s.rh = null
      s.rest = end > 0 ? end : null
    }
    this.send(ev)
    this.save()
    return ev
  }

  /** Core.restEvent + Rest.add / skip: +15, -15 or Skip pressed here. */
  restEvent (endsAt) {
    const s = this.s
    const w = dictOf(s.w)
    if (!w) return null
    const o = this.off()
    let at = this.nowMs()
    if (toI(s.ra, 0) + o + 1 > at) at = toI(s.ra, 0) + o + 1
    s.ra = at - o
    const ev = { id: this.newId(), type: 'rest', wid: strOf(w.id), at, endsAt }
    if (o !== 0) ev.off = o
    return ev
  }
  addRest (sec) {
    const s = this.s
    if (!isNum(s.rest)) return null
    const now = this.nowMs()
    const to = sec > 0 ? s.rest + sec * 1000 : (s.rest - -sec * 1000 - now >= 1000 ? s.rest + sec * 1000 : null)
    if (to == null) return this.skipRest()
    s.rest = to
    const ev = this.restEvent(to)
    this.send(ev)
    this.save()
    return ev
  }
  skipRest () {
    const s = this.s
    const had = s.rest != null || s.rh != null
    s.rest = null; s.rh = null
    if (!had) return null
    const ev = this.restEvent(null)
    this.send(ev)
    this.save()
    return ev
  }
  /** Seconds left on the rest here (Rest.left), or null. */
  restLeft () {
    const s = this.s
    if (s.rest == null) return s.rh == null ? null : s.rh
    const ms = s.rest - this.nowMs()
    return ms <= 0 ? 0 : Math.ceil(ms / 1000)
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
    const o = this.off()
    if (isNum(row.at) && row.at + o + 1 > at) at = row.at + o + 1
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
    s.p = {}; s.sk = []; s.pos = 0; s.rest = null; s.rh = null; s.ra = 0
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
    s.w = null; s.p = {}; s.sk = []; s.sh = null; s.rest = null; s.rh = null; s.ra = 0; s.pos = 0
    s.fh.push(wid)
    if (s.fh.length > 5) s.fh = s.fh.slice(-5)
    const ev = { id: this.newId(), type: discard ? 'discard' : 'finish', wid, at }
    this.send(ev)
    this.ended = discard ? null : { ended: false }
    this.save()
    return ev
  }

  /* ---------- App.mc: Link ---------- */

  /** Core.supersede: only the newest change of the rest waits to be sent. */
  supersede (ev) {
    if (ev.type !== 'rest' && ev.restEnd == null) return
    const sent = toI(this.s.obn, 0)
    this.s.ob = this.s.ob.filter((e, i) => i < sent || !same(evField(e, 1), 'rest'))
  }

  send (ev) {
    if (!ev) return
    this.supersede(ev)
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
    // Rest.tick: the rest runs out by itself (nothing is sent)
    if (isNum(this.s.rest) && this.s.rest <= this.nowMs()) this.s.rest = null
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
    // Actions.followTick: the phone ticked a set, the watch moves on as its own Done would
    else if (this.ptick && dictOf(this.s.w)) {
      const to = this.next(this.ptick[0])
      if (!(to >= this.entries().length && this.hasMore()) && to !== this.s.pos) this.s.pos = to
    }
    this.save()
    this.heard()
  }
}
