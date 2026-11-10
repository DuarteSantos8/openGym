// Cycle tracking (our own, outside upstream's code): what a day holds, the averages worked out
// from the logged periods, the estimate for the next one, and the phase a day falls in.
// Pure and shared: the Worker (contrib/cloudflare/cycle.js) imports it too, to validate a day and
// to work out what an account chooses to share.
//
// Everything here is an ESTIMATE from the person's own logs. It is not contraception and not
// medical advice; the screens say so.
export const DAY = 86400e3
const ms = iso => Date.parse(iso + 'T00:00:00Z')
export const addDays = (iso, n) => new Date(ms(iso) + n * DAY).toISOString().slice(0, 10)
export const diffDays = (a, b) => Math.round((ms(a) - ms(b)) / DAY)
const ISO = /^\d{4}-\d{2}-\d{2}$/
export const isDate = s => typeof s === 'string' && ISO.test(s) && !Number.isNaN(ms(s))

// The usual figures, used until the logs say otherwise.
const CYCLE = 28, PERIOD = 5, LUTEAL = 14

export const FLOW = ['None', 'Light', 'Medium', 'Heavy']

/* Symptoms: id -> label, and `q`, the question the phase screen asks. */
export const SYMPTOMS = {
  cramps: { label: 'Cramps', q: 'Any cramps?' },
  backache: { label: 'Back pain', q: 'Back pain?' },
  headache: { label: 'Headache', q: 'A headache?' },
  tender: { label: 'Tender breasts', q: 'Tender breasts?' },
  bloating: { label: 'Bloating', q: 'Bloated?' },
  nausea: { label: 'Nausea', q: 'Feeling sick?' },
  fatigue: { label: 'Tired', q: 'More tired than usual?' },
  acne: { label: 'Breakouts', q: 'Breakouts?' },
  spotting: { label: 'Spotting', q: 'Any spotting?' },
  clear: { label: 'Egg-white discharge', q: 'Clear, stretchy discharge?' },
  creamy: { label: 'Creamy discharge', q: 'Creamy discharge?' },
  twinge: { label: 'One-sided twinge', q: 'A twinge low on one side?' },
  cravings: { label: 'Cravings', q: 'Food cravings?' },
  appetite: { label: 'Big appetite', q: 'Hungrier than usual?' },
  insomnia: { label: 'Poor sleep', q: 'Trouble sleeping?' },
  digest: { label: 'Gut changes', q: 'Gut or bowel changes?' },
  libido: { label: 'Higher libido', q: 'Higher sex drive?' },
  libidoLow: { label: 'Lower libido', q: 'Lower sex drive?' },
  sore: { label: 'Sore muscles', q: 'Muscles sore for longer?' },
  strong: { label: 'Felt strong', q: 'Felt strong in training?' },
  weak: { label: 'Heavy legs', q: 'Training felt heavy?' },
}
export const MOODS = {
  happy: 'Happy', calm: 'Calm', energetic: 'Energetic', low: 'Low', anxious: 'Anxious',
  irritable: 'Irritable', sensitive: 'Sensitive', foggy: 'Foggy',
}

export const PHASES = {
  menstrual: { label: 'Period', tip: 'Train by feel. Many people lift as usual; ease off if cramps are heavy.' },
  follicular: { label: 'Follicular phase', tip: 'Energy often builds from here. A good stretch to push, if you feel like it.' },
  ovulation: { label: 'Ovulation window', tip: 'Some people feel their strongest now. Warm up well.' },
  luteal: { label: 'Luteal phase', tip: 'Recovery can feel slower and sleep lighter. An easier week is fine.' },
}

/* The questions each phase asks first (ids in SYMPTOMS), the rest sit under "More". */
export const PHASE_ASKS = {
  menstrual: ['cramps', 'backache', 'headache', 'fatigue', 'nausea', 'digest'],
  follicular: ['strong', 'acne', 'libido', 'creamy', 'sore'],
  ovulation: ['clear', 'twinge', 'libido', 'tender', 'strong'],
  luteal: ['tender', 'bloating', 'cravings', 'insomnia', 'acne', 'fatigue', 'weak'],
}

/** A day from the wire, cleaned; null when nothing is left (the day is then deleted). */
export function cleanDay(d) {
  if (!d || typeof d !== 'object') return null
  const out = {}
  const flow = Math.round(Number(d.flow))
  if (flow >= 1 && flow <= 3) out.flow = flow
  const sym = [...new Set([].concat(d.sym || []).filter(x => typeof x === 'string' && SYMPTOMS[x]))]
  if (sym.length) out.sym = sym
  const mood = [...new Set([].concat(d.mood || []).filter(x => typeof x === 'string' && MOODS[x]))].slice(0, 4)
  if (mood.length) out.mood = mood
  const note = typeof d.note === 'string' ? d.note.trim().slice(0, 1000) : ''
  if (note) out.note = note
  return Object.keys(out).length ? out : null
}

const dates = days => Object.keys(days || {}).filter(isDate).sort()

/** Periods from the days with flow: [{ start, end, len }], oldest first. Flow days up to 3 days apart are one period. */
export function periods(days) {
  const out = []
  for (const date of dates(days)) {
    if (!days[date]?.flow) continue
    const last = out[out.length - 1]
    if (last && diffDays(date, last.end) <= 3) { last.end = date; last.len = diffDays(date, last.start) + 1 }
    else out.push({ start: date, end: date, len: 1 })
  }
  return out
}

const mean = a => a.reduce((n, x) => n + x, 0) / a.length

/** Averages over the last six cycles: { cycle, period, count, min, max, spread, lengths }. */
export function stats(days) {
  const ps = periods(days)
  const lengths = ps.slice(1).map((p, i) => diffDays(p.start, ps[i].start)).filter(n => n >= 15 && n <= 60)
  const recent = lengths.slice(-6)
  const cycle = recent.length ? Math.round(mean(recent)) : CYCLE
  const sd = recent.length > 1 ? Math.sqrt(mean(recent.map(n => (n - mean(recent)) ** 2))) : 0
  const plen = ps.slice(-6).map(p => p.len).filter(n => n <= 10)
  return {
    cycle, period: plen.length ? Math.round(mean(plen)) : PERIOD, count: ps.length,
    min: lengths.length ? Math.min(...lengths) : null, max: lengths.length ? Math.max(...lengths) : null,
    spread: Math.min(7, Math.round(sd)), lengths, known: recent.length > 0,
  }
}

/**
 * The next three periods after the last logged one, each with its fertile window and ovulation
 * day: [{ start, from, to, ovulation, fertile: { from, to } }]. [] before any period is logged.
 */
export function forecast(days) {
  const ps = periods(days)
  if (!ps.length) return []
  const st = stats(days), last = ps[ps.length - 1]
  return [1, 2, 3].map(k => {
    const start = addDays(last.start, k * st.cycle), ov = addDays(start, -LUTEAL)
    return { start, from: start, to: addDays(start, st.period - 1), ovulation: ov, fertile: { from: addDays(ov, -5), to: addDays(ov, 1) } }
  })
}

/**
 * Where `date` falls: { phase, day, fertile, late } or null with no period logged yet before it.
 * `day` counts from the first day of that period. `late` is how many days past the expected start.
 */
export function phaseOn(days, date, ps = periods(days), st = stats(days)) {
  let last = null
  for (const p of ps) if (p.start <= date) last = p
  if (!last) return null
  const day = diffDays(date, last.start) + 1
  if (date <= last.end) return { phase: 'menstrual', day, fertile: false, late: 0 }
  const ov = addDays(last.start, st.cycle - LUTEAL)
  const late = Math.max(0, diffDays(date, addDays(last.start, st.cycle)) + 1)
  if (date < addDays(ov, -1)) return { phase: 'follicular', day, fertile: date >= addDays(ov, -5), late }
  if (date <= addDays(ov, 1)) return { phase: 'ovulation', day, fertile: true, late }
  return { phase: 'luteal', day, fertile: false, late }
}

/** How a calendar cell is coloured: logged flow, expected period, fertile window or ovulation day. */
export function kindOn(days, date, fc = forecast(days)) {
  if (days?.[date]?.flow) return 'period'
  for (const f of fc) {
    if (date >= f.from && date <= f.to) return 'predicted'
    if (date === f.ovulation) return 'ovulation'
    if (date >= f.fertile.from && date <= f.fertile.to) return 'fertile'
  }
  return null
}

/** The weeks of a month as ISO dates, each week `weekStart` (0 Sunday, 1 Monday) first; days outside the month are null. */
export function monthGrid(year, month, weekStart = 1) {
  const first = new Date(Date.UTC(year, month, 1)), n = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const lead = (first.getUTCDay() - weekStart + 7) % 7
  const cells = [...Array(lead).fill(null), ...Array.from({ length: n }, (_, i) => new Date(Date.UTC(year, month, i + 1)).toISOString().slice(0, 10))]
  while (cells.length % 7) cells.push(null)
  return Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7))
}

/** Per phase, the symptoms logged most often: { luteal: [['tender', 4], ...], ... } (top 3). */
export function symptomsByPhase(days) {
  const ps = periods(days), st = stats(days), count = {}
  for (const date of dates(days)) {
    const sym = days[date]?.sym
    const ph = sym?.length && phaseOn(days, date, ps, st)
    if (!ph) continue
    const c = (count[ph.phase] ||= {})
    for (const s of sym) c[s] = (c[s] || 0) + 1
  }
  return Object.fromEntries(Object.entries(count).map(([p, c]) => [p, Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 3)]))
}

/** The sharing levels an account can give another account. Fertile days and logs are never shared. */
export const LEVELS = ['phase', 'period']

/** What an account shows an account it shares with: the phase only, or also when the next period is expected. */
export function sharedView(days, today, level) {
  const ph = phaseOn(days, today)
  if (!ph || !LEVELS.includes(level)) return {}
  const out = { phase: ph.phase, day: ph.day }
  if (level === 'period') {
    const next = forecast(days)[0]
    if (next && next.start >= today) out.next = { from: addDays(next.start, -stats(days).spread), to: addDays(next.start, stats(days).spread) }
  }
  return out
}
