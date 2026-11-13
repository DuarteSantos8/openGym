// A Life Fitness workout summary → an openGym cardio set.
//
// The console sends the same JSON two ways: inside the end-of-workout QR code (`r`) and, over
// Bluetooth, as the WORKOUT_SUMMARY characteristic (docs/LIFE_FITNESS_CARDIO_CONNECT.md). The keys:
//   bs serial · id GUID · t model id · et seconds · c kcal · d {v, u} distance · dc {v, u} climbed
//   as {v, u} average speed · ap {v: "mm:ss"} pace · ai incline % · al level · ahr heart rate
//   am METs × 10 · aw watts · ar rpm · asl stride length · dt date (Java Date.toString or ISO)
// A unit `u` of 1 is metric (km, km/h, m); anything else imperial (mi, mph, ft). On a stair climber `dc` is steps (u 1)
// or floors (17 steps each).
//
// What openGym's cardio set holds is minutes, speed in km/h (lib/speed.js) and incline; the
// rest of the summary goes into the set's note, and the GUID rides along as `lf` so the same
// code scanned twice is recognised.
import { clampIncline, inclineFrom } from '../incline.js'
import { NOTE_MAX } from '../history.js'
import { isStepsModel, kindOfModel } from './devices.js'

const MI = 1.609344
const FT = 0.3048
const num = v => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
const valOf = o => (o != null && typeof o === 'object' ? num(o.v) : num(o))
const unitOf = (o, fallback) => (o != null && typeof o === 'object' && o.u != null ? Number(o.u) : fallback)
const round = (v, step) => Math.round(v / step) * step
const r1 = v => Math.round(v * 10) / 10
const r2 = v => Math.round(v * 100) / 100

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }
const pad = n => String(n).padStart(2, '0')

/**
 * The day and clock time a summary's `dt` names, as the console's own wall clock printed them
 * ({ d: 'YYYY-MM-DD', time: 'HH:MM' }), or null. Java's Date.toString ("Fri Oct 17 18:05:12 CEST
 * 2026") is read field by field — its zone abbreviation is ambiguous, and the clock on the
 * console is the one the person saw — and an ISO stamp through Date in local time.
 */
export function parseLfDate(dt) {
  const s = String(dt ?? '').trim()
  if (!s) return null
  const j = /^[A-Za-z]{3}\s+([A-Za-z]{3})\s+(\d{1,2})\s+(\d{1,2}):(\d{2})(?::\d{2})?\s+(?:[A-Za-z][\w+:\- ]*?\s+)?(\d{4})$/.exec(s)
  if (j && MONTHS[j[1].toLowerCase()]) return { d: `${j[5]}-${pad(MONTHS[j[1].toLowerCase()])}-${pad(+j[2])}`, time: `${pad(+j[3])}:${j[4]}` }
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(s)
  if (!iso) return null
  // With an offset it is an instant: shown on this device's clock. Without one, as written.
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) {
    const at = new Date(s.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'))
    if (!Number.isNaN(at.getTime())) return { d: `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`, time: `${pad(at.getHours())}:${pad(at.getMinutes())}` }
  }
  return { d: `${iso[1]}-${iso[2]}-${iso[3]}`, time: iso[4] ? `${iso[4]}:${iso[5]}` : null }
}

/**
 * The summary in openGym's units: { guid, serial, model, kind, sec, km, kcal, climbM, steps,
 * floors, speedKmh, pace, incline, level, hr, mets, watts, rpm, stride, date }. Values the
 * console did not send (or sent as nonsense) are null. Returns null for something that is not a
 * summary at all — no duration and no distance.
 */
export function normalizeResult(data) {
  if (!data || typeof data !== 'object') return null
  const model = num(data.t)
  const distUnit = unitOf(data.d, 1)
  const metric = distUnit === 1
  const dist = valOf(data.d)
  const km = dist != null && dist > 0 ? (metric ? dist : dist * MI) : null
  const sec = num(data.et)
  let climbM = null, steps = null, floors = null
  const dc = valOf(data.dc)
  if (dc != null && dc > 0) {
    if (isStepsModel(model)) {
      if (unitOf(data.dc, 1) === 1) { steps = Math.round(dc); floors = r1(dc / 17) }
      else { floors = dc; steps = Math.round(dc) * 17 }
    } else climbM = unitOf(data.dc, distUnit) === 1 ? dc : dc * FT
  }
  const as = valOf(data.as)
  const speedKmh = as != null && as > 0 && !isStepsModel(model) ? (unitOf(data.as, distUnit) === 1 ? as : as * MI) : null
  const out = {
    guid: data.id != null && String(data.id).trim() ? String(data.id).trim() : null,
    serial: data.bs != null ? String(data.bs) : null,
    model,
    kind: kindOfModel(model),
    sec: sec != null && sec > 0 ? sec : null,
    km,
    kcal: num(data.c) != null && num(data.c) > 0 ? Math.round(num(data.c)) : null,
    climbM, steps, floors,
    speedKmh,
    pace: data.ap != null ? String(typeof data.ap === 'object' ? data.ap.v ?? '' : data.ap) || null : null,
    incline: num(data.ai) != null && num(data.ai) > 0 ? num(data.ai) : null,
    level: num(data.al) != null && num(data.al) > 0 ? num(data.al) : null,
    hr: num(data.ahr) != null && num(data.ahr) > 0 ? Math.round(num(data.ahr)) : null,
    mets: num(data.am) != null && num(data.am) > 0 ? num(data.am) / 10 : null,
    watts: num(data.aw) != null && num(data.aw) > 0 ? Math.round(num(data.aw)) : null,
    rpm: num(data.ar) != null && num(data.ar) > 0 ? num(data.ar) : null,
    stride: num(data.asl) != null && num(data.asl) > 0 ? num(data.asl) : null,
    date: parseLfDate(data.dt),
  }
  if (out.sec == null && out.km == null) return null
  return out
}

/**
 * What identifies a summary for the duplicate check: its GUID, or — a console that sends none —
 * serial, date and duration together.
 */
export function resultKey(res) {
  if (!res) return null
  if (res.guid) return res.guid
  return ['lf', res.serial || '', res.date?.d || '', res.date?.time || '', res.sec ?? '', res.km ?? ''].join('|')
}

/** The rest of the summary, one line, for the set's note ("Life Fitness · 5.2 km · 312 kcal …"). */
export function resultNote(res, { level = n => 'Level ' + n } = {}) {
  const parts = ['Life Fitness']
  if (res.km != null) parts.push(r2(res.km) + ' km')
  if (res.kcal != null) parts.push(res.kcal + ' kcal')
  if (res.hr != null) parts.push('Ø ' + res.hr + ' bpm')
  if (res.watts != null) parts.push('Ø ' + res.watts + ' W')
  if (res.rpm != null) parts.push('Ø ' + r1(res.rpm) + ' rpm')
  if (res.level != null) parts.push(level(r1(res.level)))
  if (res.climbM != null) parts.push(Math.round(res.climbM) + ' m ↑')
  if (res.floors != null) parts.push(r1(res.floors) + ' fl')
  if (res.mets != null) parts.push(r1(res.mets) + ' METs')
  return parts.join(' · ').slice(0, NOTE_MAX)
}

/**
 * The cardio set a summary becomes: minutes, average speed in km/h (from distance and time when
 * both are there, else the console's own average), the average incline on a treadmill, done.
 * `lf` is the duplicate key, `note` the rest.
 */
export function cardioSetFromResult(res, opts) {
  const min = res.sec != null ? r1(res.sec / 60) : 0
  const speed = res.km != null && res.sec ? r1(res.km / (res.sec / 3600)) : res.speedKmh != null ? r1(res.speedKmh) : 0
  const incline = res.kind === 'treadmill' && res.incline != null ? clampIncline(round(res.incline, 0.5)) : null
  return { min, speed, ...inclineFrom({ incline }), done: true, lf: resultKey(res), note: resultNote(res, opts) }
}

/**
 * Where a summary was already saved: { where: 'active', idx } for the running workout,
 * { where: 'history', d } for a logged one, or null.
 */
export function findResult(S, key) {
  if (!key) return null
  const has = e => (e?.sets || []).some(s => s && s.lf === key)
  const idx = (S?.active?.entries || []).findIndex(has)
  if (idx >= 0) return { where: 'active', idx }
  const w = (S?.workouts || []).find(x => (x?.entries || []).some(has))
  return w ? { where: 'history', d: w.d } : null
}
