// The core's state kept in the watch's files (@system.file, passed in as `file`). The API reads at
// most 4 KB of text per call and writes about 4 KB per call, so the state is JSON escaped to ASCII
// and cut into numbered parts. A save never touches what the last complete save wrote:
//   1. the parts of the new generation g          (g<g>p<i>)
//   2. a small head file naming g, the part count and the length   (head<g % 2>)
//   3. the parts of the generation before are deleted (one that will not delete is tried again after the next save)
// Two head files take turns, so a save cut off while writing a head leaves the other head, and the
// parts it names, whole. After a load fell back to the older generation, the next save does not reuse the
// number of the damaged one (its head still names those parts): it takes the number after, whose head slot
// is the damaged head's, so the good head stays until the new one is whole. A load takes the newest head whose parts all read back to the length the
// head names and parse. Only one save runs at a time: a save asked for meanwhile waits, and only the
// newest of those is written. A read that fails is not "nothing stored": load says which of fresh,
// damaged and unreadable it found (see load), and a store whose last load was unreadable writes nothing.
import { escape } from './frames.js'

const DIR = 'internal://app/'
const CHUNK = 3000
const TRIES = 3 // reads of one file before it counts as unreadable
const NOT_FOUND = 301 // @system.file's code for a file that does not exist
const partUri = (g, i) => DIR + 'g' + g + 'p' + i
const headUri = g => DIR + 'head' + (g % 2)

const isCount = v => typeof v === 'number' && v >= 0 && Math.floor(v) === v

function parseHead (text) {
  let h = null
  try { h = JSON.parse(text) } catch (e) { return null }
  return h && isCount(h.g) && isCount(h.n) && h.n >= 1 && isCount(h.len) ? h : null
}

export function createStore (file) {
  let gen = 0 // newest complete generation
  let base = 0 // the number a save adds one to: gen, or past a damaged generation a load fell back from
  let stale = [] // part files that would not delete, and the parts of a damaged generation
  let count = 0 // its parts
  let busy = false
  let want = null // the newest state asked for while a save runs
  let ready = false // a load told "nothing stored" or gave the state: only then may a save write
  let last = null // the text of the last save that made it, so an unchanged state is not written again

  // cb(kind, text): 'ok', 'missing' (documented code 301: no such file) or 'error' (anything else, tried
  // TRIES times: a read that fails once is not "nothing stored").
  function read (uri, cb, tried) {
    const n = tried === undefined ? 1 : tried
    const again = () => { if (n < TRIES) read(uri, cb, n + 1); else cb('error', null) }
    const req = {
      uri: uri,
      success: d => { if (d && typeof d.text === 'string') cb('ok', d.text); else again() },
      fail: (data, code) => { if (code === NOT_FOUND) cb('missing', null); else again() }
    }
    try { file.readText(req) } catch (e) { again() }
  }
  // cb(kind, head|null). A head that reads back but does not parse may be a torn read: read again first.
  function readHead (uri, cb, tried) {
    const n = tried === undefined ? 1 : tried
    read(uri, (kind, text) => {
      const h = kind === 'ok' ? parseHead(text) : null
      if (kind === 'ok' && !h && n < TRIES) readHead(uri, cb, n + 1)
      else cb(kind, h)
    })
  }
  function write (uri, text, cb) {
    const req = { uri: uri, text: text, success: () => cb(true), fail: () => cb(false) }
    try { file.writeText(req) } catch (e) { cb(false) }
  }
  // cb(deleted)
  function remove (uri, cb) {
    const req = { uri: uri, success: () => cb(true), fail: () => cb(false) }
    try { file.delete(req) } catch (e) { cb(false) }
  }
  // Deletes the files one by one. A failure is no failed save: the file is kept in `stale` and tried again
  // after the next save (lean: not after a restart; a leftover part is never read, only a few KB).
  function sweep (uris, cb) {
    if (uris.length === 0) { cb(); return }
    remove(uris[0], ok => {
      if (!ok && stale.indexOf(uris[0]) < 0) stale.push(uris[0])
      sweep(uris.slice(1), cb)
    })
  }
  function partUris (g, n) {
    const out = []
    for (let i = 0; i < n; i++) out.push(partUri(g, i))
    return out
  }
  // cb('ok', text) | 'error' (a part would not read) | 'bad' (a part is missing or the length is not the head's)
  function readParts (h, i, text, cb) {
    if (i >= h.n) { cb(text.length === h.len ? 'ok' : 'bad', text); return }
    read(partUri(h.g, i), (kind, t) => {
      if (kind === 'ok') readParts(h, i + 1, text + t, cb)
      else cb(kind === 'missing' ? 'bad' : 'error', null)
    })
  }
  // A wrong length may be a torn read, so it is read again before it counts as damage.
  function readCandidate (h, tried, cb) {
    readParts(h, 0, '', (kind, text) => {
      if (kind === 'bad' && tried < TRIES) readCandidate(h, tried + 1, cb)
      else cb(kind, text)
    })
  }
  function tryHeads (heads, k, cb) {
    if (k >= heads.length) { cb(null, 'damaged'); return }
    readCandidate(heads[k], 1, (kind, text) => {
      if (kind === 'error') { cb(null, 'unreadable'); return } // never fall back past a head that may still be good
      let s = null
      try { s = kind === 'ok' ? JSON.parse(text) : null } catch (e) { s = null }
      if (!s || typeof s !== 'object' || Array.isArray(s)) { tryHeads(heads, k + 1, cb); return }
      gen = heads[k].g
      count = heads[k].n
      last = text
      if (k === 0) base = gen
      else {
        // fell back: the damaged generation is not written over (its head still names it); its parts go after the next save
        base = heads[0].g + 1
        stale = stale.concat(partUris(heads[0].g, heads[0].n))
      }
      const other = heads[1 - k]
      if (k === 0 && other) sweep(partUris(other.g, other.n), () => cb(s, 'ok')) // the older generation is not needed any more
      else cb(s, 'ok')
    })
  }

  function writeParts (g, text, i, n, cb) {
    if (i >= n) { cb(true); return }
    write(partUri(g, i), text.substring(i * CHUNK, (i + 1) * CHUNK), ok => { if (ok) writeParts(g, text, i + 1, n, cb); else cb(false) })
  }
  function run () {
    busy = true
    const text = escape(JSON.stringify(want))
    want = null
    const finish = ok => {
      busy = false
      store.failed = !ok
      if (want !== null) run()
    }
    if (text === last) { finish(true); return }
    const g = base + 1
    const n = Math.max(1, Math.ceil(text.length / CHUNK))
    writeParts(g, text, 0, n, ok => {
      if (!ok) { finish(false); return }
      write(headUri(g), JSON.stringify({ g: g, n: n, len: text.length }), ok2 => {
        if (!ok2) { finish(false); return }
        const was = gen
        const wasN = count
        gen = base = g
        count = n
        last = text
        const old = stale.concat(partUris(was, wasN))
        stale = []
        sweep(old, () => finish(true))
      })
    })
  }

  const store = {
    // true after a save that did not make it and nothing newer was asked for: call save again
    failed: false,
    // cb(state, status). status 'ok': the newest complete state. 'fresh': nothing was ever saved (state null).
    // 'damaged': heads were there but no generation is whole (state null; it cannot be read again, so a new
    // state may be started). 'unreadable': a read kept failing (state null; NOTHING may be saved, the
    // files may be fine: ask again later).
    load: function (cb) {
      ready = false
      const done = (s, status) => { ready = status !== 'unreadable'; cb(s, status) }
      readHead(headUri(0), (k0, h0) => readHead(headUri(1), (k1, h1) => {
        if (k0 === 'error' || k1 === 'error') { done(null, 'unreadable'); return }
        const heads = [h0, h1].filter(h => h).sort((a, b) => b.g - a.g)
        gen = heads.length ? heads[0].g : 0
        count = 0
        last = null
        base = gen
        // fresh only when both heads are missing: a head that is there but does not parse is damage, not an empty folder
        if (!heads.length) { done(null, k0 === 'missing' && k1 === 'missing' ? 'fresh' : 'damaged'); return }
        tryHeads(heads, 0, done)
      }))
    },
    // Writes nothing until a load has said the files are not unreadable.
    save: function (state) {
      if (!ready) return
      want = state
      if (!busy) run()
    }
  }
  return store
}
