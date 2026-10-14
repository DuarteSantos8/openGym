// Apple Health's own export (Health → profile → Export All Health Data): the way into the health
// area without the iPhone app, from the web app or the PWA, where no website may read HealthKit.
//
// The export is `export.zip` holding `apple_health_export/export.xml` — often hundreds of MB, nearly
// all of it heart rate and step samples. Nothing here holds the file whole: the zip entry is
// inflated as a stream (the browser's own DecompressionStream, no library), the XML is scanned one
// chunk at a time for <Record> and <Workout> tags, and every sample goes straight into the folding of
// api/health/fold.js — the same folding the server gives an iPhone Shortcut's samples — so what
// stays in memory is one number per metric and day, not the samples, and a reading has the same id
// whichever way it came in.
import { createFolder } from '../../../../api/health/fold.js'
import { BY_HK, TYPES, canonical } from '../../../../api/health/catalogue.js'

// In bed and awake are not sleep; every "asleep" value is (unspecified, core, deep, REM, and the
// plain "asleep" of older phones).
const ASLEEP = /^HKCategoryValueSleepAnalysisAsleep/

// One compiled pattern per attribute: an export has millions of records.
const ATTR = {}
const attr = (tag, name) => {
  const re = ATTR[name] || (ATTR[name] = new RegExp(`\\s${name}="([^"]*)"`))
  const m = re.exec(tag)
  if (!m) return null
  // An attribute holds XML's escapes: a glucose unit is "mmol&lt;180.1558800000541&gt;/L".
  return m[1].includes('&') ? m[1].replace(/&(lt|gt|amp|quot|apos);/g, (_, e) => ENTITY[e]) : m[1]
}
const ENTITY = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }

/**
 * The tags of an export into a folder: every <Record> of a type the catalogue knows (others are
 * skipped), and every <Workout> with its <WorkoutStatistics> — which newer phones write for the
 * energy and distance that older ones put on the workout itself. A workout is handed over when the
 * next one starts, or at finish().
 */
function exportReader(folder) {
  let w = null
  const flush = () => { if (w) folder.addWorkout(w); w = null }
  return {
    tag(tag) {
      if (tag.startsWith('<Record ')) {
        const type = BY_HK[attr(tag, 'type')]
        if (!type) return
        const kind = TYPES[type].kind
        const start = attr(tag, 'startDate'), end = attr(tag, 'endDate'), source = attr(tag, 'sourceName') || ''
        if (kind === 'sleep') folder.add({ type, start, end, asleep: ASLEEP.test(attr(tag, 'value') || '') })
        else if (kind === 'min' || kind === 'ev' || kind === 'lvl' || kind === 'val') folder.add({ type, start, end, source, raw: attr(tag, 'value') })
        else folder.add({ type, v: Number(attr(tag, 'value')), unit: attr(tag, 'unit') || '', start, source })
      } else if (tag.startsWith('<WorkoutStatistics ')) {
        if (!w) return
        const type = BY_HK[attr(tag, 'type')], sum = Number(attr(tag, 'sum'))
        if (!(sum > 0)) return
        if (type === 'activeEnergy' && w.kcal == null) w.kcal = canonical('activeEnergy', sum, attr(tag, 'unit'))
        else if (TYPES[type]?.dim === 'distance' && w.km == null) w.km = canonical('distance', sum, attr(tag, 'unit'))
      } else if (tag.startsWith('<Workout ')) {
        flush()
        const dur = Number(attr(tag, 'duration')), dist = Number(attr(tag, 'totalDistance')), e = Number(attr(tag, 'totalEnergyBurned'))
        w = {
          activity: attr(tag, 'workoutActivityType'), start: attr(tag, 'startDate'), end: attr(tag, 'endDate'),
          minutes: dur > 0 ? canonical('workout', dur, attr(tag, 'durationUnit') || 'min') : null,
          km: dist > 0 ? canonical('distance', dist, attr(tag, 'totalDistanceUnit')) : null,
          kcal: e > 0 ? canonical('activeEnergy', e, attr(tag, 'totalEnergyBurnedUnit')) : null,
        }
      }
    },
    finish: flush,
  }
}

const TAGS = ['<Record ', '<Workout']

/**
 * Scans text that arrives in pieces for <Record …> and <Workout…> tags, handing each opening tag
 * to `onTag`. A tag cut between two pieces is carried over to the next one.
 */
export function createScanner(onTag) {
  let rest = ''
  return {
    push(text) {
      const s = rest + text
      // The next of each tag, found once and kept until passed: workouts are rare among millions
      // of records, so looking for one again after every record would read the text over and over.
      const next = TAGS.map(() => -2)
      let i = 0
      for (;;) {
        for (let k = 0; k < TAGS.length; k++) if (next[k] !== -1 && next[k] < i) next[k] = s.indexOf(TAGS[k], i)
        const found = next.filter(x => x >= 0)
        if (!found.length) { rest = s.slice(Math.max(i, s.length - 20)); return }
        const start = Math.min(...found)
        const end = s.indexOf('>', start)
        if (end < 0) { rest = s.slice(start); return }
        onTag(s.slice(start, end + 1))
        i = end + 1
      }
    },
  }
}

/** The readings of an export, from text in one piece (tests) or any iterable of pieces. */
export function readingsFromExportText(pieces, opts) {
  const folder = createFolder(opts)
  const reader = exportReader(folder)
  const scan = createScanner(reader.tag)
  for (const p of typeof pieces === 'string' ? [pieces] : pieces) scan.push(p)
  reader.finish()
  return folder.readings()
}

/* ---------- the file ---------- */

const u16 = (b, o) => b[o] | (b[o + 1] << 8)
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0
const bytes = async (blob, a, b) => new Uint8Array(await blob.slice(a, b).arrayBuffer())

/**
 * The export.xml inside an Apple Health export.zip, as a stream of bytes: the zip's own directory
 * is read to find it, and a deflated entry is inflated as it is read. Throws Error('no-export')
 * when the zip holds no export.xml, Error('zip64') for one too large for this reader (unzip it and
 * pick the export.xml inside), Error('unsupported') where the browser cannot inflate a stream.
 */
async function exportXmlStream(file, onBytes) {
  const size = file.size
  const tail = await bytes(file, Math.max(0, size - 66000), size)
  let eocd = -1
  for (let i = tail.length - 22; i >= 0; i--) if (u32(tail, i) === 0x06054b50) { eocd = i; break }
  if (eocd < 0) throw new Error('no-export')
  const count = u16(tail, eocd + 10), cdSize = u32(tail, eocd + 12), cdOffset = u32(tail, eocd + 16)
  if (count === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) throw new Error('zip64')
  const cd = await bytes(file, cdOffset, cdOffset + cdSize)
  const dec = new TextDecoder()
  for (let p = 0, n = 0; n < count && p + 46 <= cd.length; n++) {
    if (u32(cd, p) !== 0x02014b50) break
    const method = u16(cd, p + 10), csize = u32(cd, p + 20)
    const nameLen = u16(cd, p + 28), extraLen = u16(cd, p + 30), commentLen = u16(cd, p + 32)
    const local = u32(cd, p + 42)
    const name = dec.decode(cd.subarray(p + 46, p + 46 + nameLen))
    p += 46 + nameLen + extraLen + commentLen
    if (!/(^|\/)export\.xml$/.test(name)) continue
    if (csize === 0xffffffff || local === 0xffffffff) throw new Error('zip64')
    const lh = await bytes(file, local, local + 30)
    const start = local + 30 + u16(lh, 26) + u16(lh, 28)
    let body = file.slice(start, start + csize).stream()
    if (onBytes) {
      let read = 0
      body = body.pipeThrough(new TransformStream({ transform(chunk, c) { read += chunk.byteLength; onBytes(read / csize); c.enqueue(chunk) } }))
    }
    if (method === 0) return body
    if (method !== 8 || typeof DecompressionStream === 'undefined') throw new Error('unsupported')
    return body.pipeThrough(new DecompressionStream('deflate-raw'))
  }
  throw new Error('no-export')
}

/**
 * The readings of an Apple Health export, picked as export.zip or as the export.xml inside it.
 * `since` (YYYY-MM-DD) skips what is older. `onProgress(fraction)` follows the bytes read.
 * Resolves { readings, records } — `records` the samples it could use.
 */
export async function readAppleHealthExport(file, { since = '', onProgress } = {}) {
  const head = await bytes(file, 0, 4)
  const zipped = u32(head, 0) === 0x04034b50
  const progress = f => onProgress && onProgress(Math.min(0.99, f))
  let stream = zipped ? await exportXmlStream(file, progress) : file.stream()
  if (onProgress && !zipped) {
    let read = 0
    stream = stream.pipeThrough(new TransformStream({ transform(chunk, c) { read += chunk.byteLength; progress(read / file.size); c.enqueue(chunk) } }))
  }
  const folder = createFolder({ since })
  const tags = exportReader(folder)
  const scan = createScanner(tags.tag)
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader()
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    scan.push(value)
  }
  tags.finish()
  if (onProgress) onProgress(1)
  return { readings: folder.readings(), records: folder.count() }
}
