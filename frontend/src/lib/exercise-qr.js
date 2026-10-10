// QR codes stuck on the machines at the gym, and what scanning one in a running workout does.
//
// S.exQr maps an exercise id to the codes that stand for it: { [exId]: [code, …] }. A code is the
// raw text the scanner read, trimmed — whatever the gym (or our own printout) put in it. One code
// may stand for several exercises (one cable tower, many movements) and one exercise may have
// several codes (two identical racks); scanning asks which one only when it has to.
//
// The codes openGym prints itself are `opengym:ex:` + a random id. They name neither the exercise
// nor the person, so a sticker can be moved to another exercise later without reprinting it.
//
// Everything that decides where a scan leads lives here, pure and tested (exercise-qr.test.js);
// the views only open the sheets.
import { canonicalExId } from './exercises.js'
import { uid } from './format.js'
import { t, getLang, RTL_LANGS } from './i18n-core.js'

export const QR_PREFIX = 'opengym:ex:'

/** A scanned value as we store and compare it: trimmed text, '' for nothing. */
export const normalizeQr = v => (v == null ? '' : String(v).trim())

/** A fresh code for a printout of our own. */
export const newExerciseQr = () => QR_PREFIX + uid()

/** Whether a code is one openGym printed. */
export const isOpenGymQr = code => normalizeQr(code).startsWith(QR_PREFIX)

/** How a code reads in a list: our own as "openGym code · 4F7K", anyone else's shortened. */
export function shortQrLabel(code) {
  const c = normalizeQr(code)
  if (isOpenGymQr(c)) return t('openGym code') + ' · ' + c.slice(-4).toUpperCase()
  return c.length > 32 ? c.slice(0, 30) + '…' : c
}

const isMap = m => m != null && typeof m === 'object' && !Array.isArray(m)

/** An exercise's codes, cleaned. */
export function qrCodesFor(map, exId) {
  const xs = isMap(map) && Array.isArray(map[exId]) ? map[exId] : []
  return [...new Set(xs.map(normalizeQr).filter(Boolean))]
}

/** `map` with `code` added to the exercise (once). Returns a new map; `map` is left alone. */
export function withExQr(map, exId, code) {
  const c = normalizeQr(code)
  const out = isMap(map) ? { ...map } : {}
  if (!c || exId == null) return out
  const have = qrCodesFor(out, exId)
  if (!have.includes(c)) out[exId] = [...have, c]
  return out
}

/**
 * `map` with `code` taken off this one exercise. Every other exercise keeps it, so a code shared
 * with them still finds them; once no exercise has it any more, the code is gone and a scan of it
 * reads as unknown. An exercise left without codes loses its key.
 */
export function withoutExQr(map, exId, code) {
  const c = normalizeQr(code)
  const out = isMap(map) ? { ...map } : {}
  if (exId == null || !(exId in out)) return out
  const rest = qrCodesFor(out, exId).filter(x => x !== c)
  if (rest.length) out[exId] = rest
  else delete out[exId]
  return out
}

/** `map` with `code` taken off every other exercise and given to this one alone. */
export function moveExQr(map, exId, code) {
  const c = normalizeQr(code)
  let out = isMap(map) ? { ...map } : {}
  if (!c || exId == null) return out
  for (const k of Object.keys(out)) if (k !== String(exId) && qrCodesFor(out, k).includes(c)) out = withoutExQr(out, k, c)
  return withExQr(out, exId, c)
}

/** `map` without anything on this exercise (a custom exercise deleted). */
export function withoutExercise(map, exId) {
  const out = isMap(map) ? { ...map } : {}
  delete out[exId]
  return out
}

/** The exercises a code stands for, in the order they were given it, each once. */
export function exercisesForCode(map, code) {
  const c = normalizeQr(code)
  if (!c || !isMap(map)) return []
  const out = []
  for (const exId of Object.keys(map)) {
    if (!qrCodesFor(map, exId).includes(c)) continue
    const id = canonicalExId(exId)
    if (!out.includes(id)) out.push(id)
  }
  return out
}

/** The other exercises that would still hold a code once it is taken off `exId`. */
export const othersWithCode = (map, exId, code) =>
  exercisesForCode(map, code).filter(id => id !== canonicalExId(exId))

const unfinished = e => Array.isArray(e?.sets) && e.sets.some(s => s && !s.done)

/**
 * Where a scanned code leads in the running session `active`:
 *   { kind: 'unknown' }                  no exercise has this code
 *   { kind: 'inWorkout', idx, exId }     an exercise of the session has it: go there. Of several,
 *                                        the first one with sets left to do, looking from the
 *                                        current exercise onwards (then from the top); the first
 *                                        one that way when they are all done
 *   { kind: 'notInWorkout', exIds }      only exercises the session does not hold have it
 */
export function resolveScan(active, map, code) {
  const exIds = exercisesForCode(map, code)
  if (!exIds.length) return { kind: 'unknown' }
  const entries = Array.isArray(active?.entries) ? active.entries : []
  const n = entries.length
  const cur = Number.isInteger(active?.cur) && active.cur >= 0 && active.cur < n ? active.cur : 0
  const order = Array.from({ length: n }, (_, i) => (cur + i) % n)
  const want = new Set(exIds)
  const hits = order.filter(i => entries[i] && want.has(canonicalExId(entries[i].id)))
  if (!hits.length) return { kind: 'notInWorkout', exIds }
  const idx = hits.find(i => unfinished(entries[i])) ?? hits[0]
  return { kind: 'inWorkout', idx, exId: canonicalExId(entries[idx].id) }
}

/**
 * The routine an exercise found by a scan would join: the current exercise's routine, otherwise
 * the first of the session's routines that still exists, otherwise none (a freestyle session).
 */
export function scanTargetRoutineId(active, routines) {
  const have = new Set((Array.isArray(routines) ? routines : []).map(r => r?.id).filter(id => id != null))
  const entries = Array.isArray(active?.entries) ? active.entries : []
  const rid = entries[active?.cur]?.rid
  if (rid != null && have.has(rid)) return rid
  for (const id of Array.isArray(active?.routineIds) ? active.routineIds : []) if (have.has(id)) return id
  return null
}

/* ------------------------------- the printout ------------------------------- */

const esc = str => String(str == null ? '' : str)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
// What may go into an <img>: a data: URL of an image (the QR code, a picture read into the page),
// and for the exercise's picture also a plain web address, when it could not be read in (a CDN
// that does not allow it); nothing else, a javascript: URL least of all.
const dataImg = u => (typeof u === 'string' && /^data:image\/[a-z0-9.+-]+[;,]/i.test(u) ? u : '')
const picUrl = u => dataImg(u) || (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : '')

/** The QR code's printed size: 3 × 3 cm, big enough for any phone at arm's length. */
export const QR_PRINT_MM = 30

/**
 * One A4 page for one exercise: its name, picture, tags, description and steps, and its QR code
 * at 3 × 3 cm to cut out and stick on the machine. Pictures come in as data: URLs so the page
 * prints the same from a browser's iframe and from the app's native print plugin (the exercise's
 * picture may fall back to its web address).
 */
export function exerciseQrPrintHTML({ name, qrDataUrl, imageUrl, description, tags, steps } = {}) {
  const lang = getLang()
  const qr = dataImg(qrDataUrl)
  const img = picUrl(imageUrl)
  const tagList = (Array.isArray(tags) ? tags : []).map(x => String(x || '').trim()).filter(Boolean)
  const stepList = (Array.isArray(steps) ? steps : []).map(x => String(x || '').trim()).filter(Boolean)
  const desc = String(description || '').trim()
  return `<!doctype html><html lang="${esc(lang)}" dir="${RTL_LANGS.has(lang) ? 'rtl' : 'ltr'}"><head><meta charset="utf-8">
<title>${esc(name)}</title>
<style>
  @page { size: A4; margin: 15mm; }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; color: #16181d; background: #fff; font: 14px/1.5 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  .doc { max-width: 180mm; margin: 0 auto; }
  header { display: flex; gap: 8mm; align-items: flex-start; justify-content: space-between; border-bottom: 2px solid #16181d; padding-bottom: 4mm; margin-bottom: 6mm; }
  .kicker { font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: #6a7a3a; font-weight: 700; }
  h1 { font-size: 26px; letter-spacing: -.02em; margin: 2px 0 0; }
  .tags { color: #6b7180; font-size: 13px; margin-top: 4px; text-transform: capitalize; }
  .qr { flex: none; text-align: center; }
  .qr img { display: block; width: ${QR_PRINT_MM}mm; height: ${QR_PRINT_MM}mm; image-rendering: pixelated; border: 1px dashed #b8bcc6; }
  .qr .cap { width: ${QR_PRINT_MM}mm; font-size: 8px; line-height: 1.25; color: #6b7180; margin-top: 1.5mm; }
  .pic { text-align: center; margin: 0 0 6mm; }
  .pic img { width: 90mm; max-width: 100%; max-height: 95mm; object-fit: contain; }
  .desc { margin: 0 0 5mm; }
  h2 { font-size: 12px; letter-spacing: .1em; text-transform: uppercase; color: #8a90a0; margin: 0 0 2mm; font-weight: 700; }
  ol { margin: 0; padding-inline-start: 6mm; }
  li { margin-bottom: 1.5mm; break-inside: avoid; }
</style></head><body><div class="doc">
<header>
  <div>
    <div class="kicker">openGym</div>
    <h1>${esc(name)}</h1>
    ${tagList.length ? `<div class="tags">${tagList.map(esc).join(' · ')}</div>` : ''}
  </div>
  ${qr ? `<div class="qr"><img src="${esc(qr)}" alt="QR"><div class="cap">${esc(t('Scan in a running workout to jump to this exercise'))}</div></div>` : ''}
</header>
${img ? `<div class="pic"><img src="${esc(img)}" alt="${esc(name)}"></div>` : ''}
${desc ? `<p class="desc">${esc(desc)}</p>` : ''}
${stepList.length ? `<h2>${esc(t('How to'))}</h2><ol>${stepList.map(s => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}
</div></body></html>`
}
