// What the workout's medal shows, as plain data (Wear OS Medal.kt and SummaryMedal.kt's word rules; the Apple
// Watch's Medal.swift is the twin; MedalTest.kt is ported in test/medal.test.js). No drawing and no Huawei API:
// the page draws what medalOf() returns (a disc, diamonds, plates). Pure, ES5 subset.
//
//   medalOf(summary, { comma, repsWord, maxPlates }) -> {
//       gold,        true on a records day (gold), else steel; never the accent
//       time,        the big number ('52', or '1:05' over an hour), or the set count when there is no duration
//       timeLabel,   'min_minutes' | 'hours' | 'sets': the text key under it (upper-case it)
//       gems,        { angles: [degrees], radius }: a diamond per record, 7 at most, under the time
//       legend,      { key: 'n_sets' | 'new_record' | 'records', count } the text key under the rim and its number
//       plates,      [{ name, old, now, unit, kind }] the first `maxPlates` (4) record lines, texts ready
//       more,        how many records did not fit the plates ("+2 more")
//       volume (whole number text), unit }
//   summary = what finishWorkout / onPhone return: { name, unit, dur, sets, vol, ended, hr, recs }; any part may be
//   missing. `comma`: write 62,5 (usesComma(lang)). `repsWord`: the app's word for reps (a reps record has no unit).
// Left out on purpose: the rim lettering (arcable), the crown's stops, the back face, calories, the animation and its
// haptic beats, the rim of notches, the medal's size per watch: none has a Huawei lite-wearable equivalent here (no
// arc text, no canvas).
// lean: no notches (one per set, first at -90, 48 at most); add them if the medal ever gets a canvas.

const isNum = v => typeof v === 'number' && isFinite(v)
const two = n => (n < 10 ? '0' : '') + n

export const MAX_GEMS = 7

// One diamond per record, 7 at most, centred under the time; past 5 they are smaller and closer.
export function gems (records) {
  const shown = isNum(records) ? Math.min(Math.max(Math.floor(records), 0), MAX_GEMS) : 0
  const step = shown <= 5 ? 27 : 21
  const angles = []
  for (let i = 0; i < shown; i++) angles.push(90 + (i - (shown - 1) / 2) * step)
  return { angles: angles, radius: shown <= 5 ? 8.6 : 7 }
}

const rounded = v => (isNum(v) ? Math.round(v) : 0)

// The time stamped in the middle: minutes under an hour ("52"), else hours and minutes ("1:05").
export function time (seconds) {
  const m = rounded(seconds / 60)
  if (m < 60) return [String(Math.max(m, 0)), false]
  return [Math.floor(m / 60) + ':' + two(m % 60), true]
}

// A hold's seconds as "1:15".
export function clock (seconds) {
  const s = Math.max(rounded(seconds), 0)
  return Math.floor(s / 60) + ':' + two(s % 60)
}

// "62.5", or "62,5" for the languages that write a comma: at most two decimals.
export function number (v, comma) {
  const t = String(isNum(v) ? Math.round(v * 100) / 100 : 0)
  return comma ? t.replace('.', ',') : t
}

const COMMA = ['de', 'fr', 'es', 'it', 'pt', 'pt-BR', 'pl', 'hu', 'tr', 'ru', 'uk', 'cs', 'id', 'lt', 'da', 'sv', 'vi', 'nl', 'fi', 'nb', 'ro', 'bg', 'el', 'hr', 'sk', 'sl']
export function usesComma (lang) { return typeof lang === 'string' && COMMA.indexOf(lang) >= 0 }

// A record line [name, kind, old, new, unit]'s two bests as the plate shows them.
export function recordTexts (rec, comma) {
  return rec[1] === 'h' ? [clock(rec[2]), clock(rec[3])] : [number(rec[2], comma), number(rec[3], comma)]
}
export function plate (rec, comma, repsWord) {
  const t = recordTexts(rec, comma)
  return { name: String(rec[0]), old: t[0], now: t[1], unit: rec[1] === 'h' ? '' : rec[1] === 'r' ? repsWord : rec[4], kind: rec[1] }
}

// The text under the rim: the set count with no record, "New record", "k Records".
export function legend (k, sets) { return k <= 0 ? { key: 'n_sets', count: isNum(sets) ? sets : 0 } : k === 1 ? { key: 'new_record', count: 1 } : { key: 'records', count: k } }
// The label under the big number.
export function timeLabel (seconds) { return !isNum(seconds) ? 'sets' : time(seconds)[1] ? 'hours' : 'min_minutes' }

export function medalOf (sum, opts) {
  const o = opts || {}
  const recs = Array.isArray(sum.recs) ? sum.recs : []
  const k = recs.length
  const max = isNum(o.maxPlates) ? o.maxPlates : 4
  const sets = isNum(sum.sets) ? sum.sets : 0
  const hasTime = isNum(sum.dur)
  const t = hasTime ? time(sum.dur) : [String(sets), false]
  const plates = recs.slice(0, max).map(r => plate(r, !!o.comma, o.repsWord || 'reps'))
  return {
    gold: k > 0,
    time: t[0],
    timeLabel: timeLabel(hasTime ? sum.dur : null),
    gems: gems(k),
    legend: legend(k, sets),
    plates: plates,
    more: Math.max(0, k - plates.length),
    volume: String(Math.round(isNum(sum.vol) ? sum.vol : 0)),
    unit: typeof sum.unit === 'string' ? sum.unit : 'kg'
  }
}
