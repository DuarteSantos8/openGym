// The readiness rules, shared by the screens (lib/garmin.js re-exports them) and the server's
// morning push (contrib/cloudflare/garmin-push.js). No imports: the Worker bundles this file too.

const avg = v => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null)

/** The day `iso` of a loaded record, or null. */
export const dayOf = (g, iso) => g?.days?.find(d => d.date === iso) || null

/** The mean of `field` over the `n` days before `iso` that have it, or null. */
export function meanBefore(g, field, iso, n = 7) {
  const vals = (g?.days || []).filter(d => d.date < iso && d[field] != null).slice(-n).map(d => d[field])
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
}

/**
 * How ready the body looks today, from what the watch measured overnight: sleep score, the
 * morning's body battery (the day's highest), HRV status against its own baseline, and the
 * resting heart rate against the week before. Two bad signs make it an easy day, none bad and
 * two good a day to push. ponytail: fixed thresholds, Garmin's own "training readiness" is not
 * in the Personal API; tune them here if they feel off.
 * Returns { level: 'push' | 'normal' | 'easy', good: [..], bad: [..] } or null without data.
 */
export function readiness(g, iso) {
  const d = dayOf(g, iso)
  if (!d) return null
  const good = [], bad = []
  if (d.sleepScore != null) (d.sleepScore >= 80 ? good : d.sleepScore < 60 ? bad : []).push(`Sleep score ${d.sleepScore}`)
  else if (d.sleepSec != null) (d.sleepSec >= 7.5 * 3600 ? good : d.sleepSec < 6 * 3600 ? bad : []).push(`Slept ${fmtDuration(d.sleepSec)}`)
  if (d.bbMax != null) (d.bbMax >= 75 ? good : d.bbMax < 40 ? bad : []).push(`Body battery up to ${d.bbMax}`)
  if (d.hrvStatus) {
    const s = d.hrvStatus.toUpperCase()
    if (s === 'BALANCED') good.push('HRV balanced')
    else if (s === 'UNBALANCED' || s === 'LOW' || s === 'POOR') bad.push(`HRV ${s.toLowerCase()}`)
  }
  const usual = meanBefore(g, 'restHr', iso)
  if (d.restHr != null && usual != null) {
    if (d.restHr >= usual + 5) bad.push(`Resting heart rate ${d.restHr}, usually ${Math.round(usual)}`)
    else if (d.restHr <= usual - 2) good.push(`Resting heart rate ${d.restHr}, below usual`)
  }
  if (!good.length && !bad.length) return null
  // The getting-sick signs overrule the rest: train light or not at all (sickSigns below).
  const sick = sickSigns(g, iso).sick
  const level = sick || bad.length >= 2 ? 'easy' : !bad.length && good.length >= 2 ? 'push' : 'normal'
  return { level, good, bad, sick }
}

export const READY_TITLE = { push: 'Ready to push', normal: 'Train as planned', easy: 'Take it easy today' }

/** 27000 -> "7 h 30 min", 300 -> "5 min". */
export function fmtDuration(sec) {
  const m = Math.round((Number(sec) || 0) / 60)
  const h = Math.floor(m / 60)
  return h ? `${h} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`
}

/**
 * Early signs the body is fighting something, on morning `iso` against the 14 days before: resting
 * heart rate 5+ above its mean, HRV under its baseline band (else 15% under its mean), breathing
 * in sleep 1+ breaths a minute above its mean. Two or more together is the flag.
 * ponytail: fixed thresholds from the usual wearable research rules of thumb; tune here.
 */
export function sickSigns(g, iso) {
  const d = dayOf(g, iso)
  if (!d) return { sick: false, signs: [] }
  const past = (g.days || []).filter(x => x.date < iso).slice(-14)
  const mean = f => avg(past.map(x => x[f]).filter(v => v != null))
  const signs = []
  const rhr = mean('restHr'), hrv = mean('hrv'), resp = mean('sleepResp')
  if (d.restHr != null && rhr != null && d.restHr >= rhr + 5) signs.push(`Resting heart rate ${d.restHr}, usually ${Math.round(rhr)}`)
  if (d.hrv != null && (d.hrvLow != null ? d.hrv < d.hrvLow : hrv != null && d.hrv < hrv * 0.85)) signs.push(`HRV ${d.hrv} ms, under your usual range`)
  if (d.sleepResp != null && resp != null && d.sleepResp >= resp + 1) signs.push(`Breathing ${d.sleepResp.toFixed(1)} a minute asleep, usually ${resp.toFixed(1)}`)
  return { sick: signs.length >= 2, signs }
}

