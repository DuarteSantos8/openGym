// Resistance bands (Reddit, v1.4.5): "set the actual band colour for a given set, '15 reps with
// red'". The lifter's own bands live in S.bands, lightest first: [{ id, name, color, kg? }], where
// `kg` is the band's resistance when known (always kilograms, like every stored weight's unit is
// the profile's; see bandKg for lb profiles). A set names the bands it was done with by id,
// `bands: ['b-red', 'b-yellow']`, an optional field: a set without it is what it always was, and
// an app from before this ignores it.
//
// Which exercises get the band chips: S.bandEx[exId] when the lifter said (true or false), else
// any exercise whose equipment is a band. A plan slot can name the bands each set starts with
// (`cfg.bands`), and a new session otherwise starts with last time's bands per set.
import { t } from './i18n-core.js'
import { EXIDX } from './exercises.js'

export const MAX_BANDS = 12
export const MAX_SET_BANDS = 4
export const BAND_NAME_MAX = 24
// A band's level or strength as its maker prints it ("Level 3", "Heavy", "X-Heavy"), optional,
// beside or instead of a colour (TestFlight 11-08: "choose band colour, or level"). A band can be
// called by its level alone: name it "Level 3" and leave the colour grey.
export const BAND_LEVEL_MAX = 16

// The swatches the band editor offers, roughly how band makers colour them light to heavy.
export const BAND_COLORS = ['#f2c94c', '#f2994a', '#eb5757', '#27ae60', '#2f80ed', '#9b51e0', '#333333', '#8d8d8d']

/** The usual set of five, light to heavy, with typical resistances; names in the app's language. */
export function starterBands() {
  return [
    { id: 'b-yellow', name: t('Yellow'), color: '#f2c94c', kg: 5 },
    { id: 'b-red', name: t('Red'), color: '#eb5757', kg: 10 },
    { id: 'b-green', name: t('Green'), color: '#27ae60', kg: 15 },
    { id: 'b-blue', name: t('Blue'), color: '#2f80ed', kg: 20 },
    { id: 'b-black', name: t('Black'), color: '#333333', kg: 30 },
  ]
}

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v)
const okId = v => typeof v === 'string' && /^[\w.-]{1,40}$/.test(v) && !(v in Object.prototype)
const okColor = v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)

/** One band as stored, or null for something that is not one (a synced or imported list is data). */
export function cleanBand(b) {
  if (!isMap(b) || !okId(b.id)) return null
  const name = typeof b.name === 'string' ? b.name.trim().slice(0, BAND_NAME_MAX) : ''
  if (!name) return null
  const out = { id: b.id, name, color: okColor(b.color) ? b.color.toLowerCase() : BAND_COLORS[0] }
  const kg = Number(b.kg)
  if (Number.isFinite(kg) && kg > 0 && kg <= 500) out.kg = Math.round(kg * 100) / 100
  const level = typeof b.level === 'string' ? b.level.trim().slice(0, BAND_LEVEL_MAX) : ''
  if (level && level.toLocaleLowerCase() !== name.toLocaleLowerCase()) out.level = level
  return out
}

/** What a chip says for a band: "Red · Heavy", or just the name. */
export const bandLabel = b => (b?.level ? `${b.name} · ${b.level}` : b?.name || '')

/** A list of bands, each id once, at most MAX_BANDS. */
export function cleanBands(list) {
  const seen = new Set()
  const out = []
  for (const b of Array.isArray(list) ? list : []) {
    const c = cleanBand(b)
    if (!c || seen.has(c.id)) continue
    seen.add(c.id)
    out.push(c)
    if (out.length >= MAX_BANDS) break
  }
  return out
}

/** The profile's bands, lightest first. */
export const bandsOf = S => cleanBands(S?.bands)

/** A fresh id for a new band that none of `list` has. */
export function newBandId(list, now = Date.now()) {
  const have = new Set((list || []).map(b => b.id))
  let n = now
  while (have.has('b-' + n.toString(36))) n++
  return 'b-' + n.toString(36)
}

/** The bands a set was done with, by id, in the order they were picked. Empty for a plain set. */
export function setBandsOf(set) {
  const v = isMap(set) ? set.bands : null
  if (!Array.isArray(v)) return []
  return [...new Set(v.filter(okId))].slice(0, MAX_SET_BANDS)
}

/** The set with `id` picked or unpicked; no bands left takes the field away. Never mutates. */
export function toggleSetBand(set, id) {
  if (!okId(id)) return set
  const cur = setBandsOf(set)
  const next = cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id].slice(0, MAX_SET_BANDS)
  const out = { ...(isMap(set) ? set : {}) }
  if (next.length) out.bands = next
  else delete out.bands
  return out
}

/** The set with exactly these bands (a plan's or last time's). */
export function withSetBands(set, ids) {
  const out = { ...(isMap(set) ? set : {}) }
  const list = [...new Set((Array.isArray(ids) ? ids : []).filter(okId))].slice(0, MAX_SET_BANDS)
  if (list.length) out.bands = list
  else delete out.bands
  return out
}

// The bands the app knows of right now, for the readers that get a set but no state (the set
// line in history.js, the text export). App.jsx keeps it up to date (setKnownBands).
let known = []
let knownFrom = null
export function setKnownBands(list) {
  if (list === knownFrom) return
  knownFrom = list
  known = cleanBands(list)
}
export const knownBands = () => known

const byId = list => new Map((list || []).map(b => [b.id, b]))

/** "Red + Yellow": the set's bands by name, a band since deleted as "band". */
export function bandText(ids, list = known) {
  const m = byId(list)
  return (ids || []).map(id => m.get(id)?.name || t('band')).join(' + ')
}

/** The bands' resistance together, in kg, or null when any of them has none set. */
export function bandResistanceKg(ids, list = known) {
  if (!ids || !ids.length) return null
  const m = byId(list)
  let sum = 0
  for (const id of ids) {
    const b = m.get(id)
    if (!b || !(b.kg > 0)) return null
    sum += b.kg
  }
  return Math.round(sum * 100) / 100
}

/**
 * How hard a combination of bands is, for comparing sets (records, progression): their summed
 * resistance when every band has one, else their places in the list (lightest first, 1-based),
 * summed, so red + yellow ranks above red alone. A band that is gone counts as the lightest.
 */
export function bandRank(ids, list = known) {
  if (!ids || !ids.length) return 0
  const kg = bandResistanceKg(ids, list)
  if (kg != null) return kg
  const pos = new Map((list || []).map((b, i) => [b.id, i + 1]))
  return ids.reduce((n, id) => n + (pos.get(id) || 1), 0)
}

/**
 * One step up from these bands: the lightest single band or pair of bands that ranks above them.
 * Null at the top. What progression offers a band exercise instead of more weight.
 */
export function nextBandsUp(ids, list = known) {
  const bands = cleanBands(list)
  if (!bands.length) return null
  const cur = bandRank(ids || [], bands)
  const combos = []
  bands.forEach((a, i) => {
    combos.push([a.id])
    for (const b of bands.slice(i + 1)) combos.push([b.id, a.id])
  })
  let best = null, bestRank = Infinity
  for (const c of combos) {
    const r = bandRank(c, bands)
    // A single band beats a pair of the same rank: fewer bands to clip on.
    if (r > cur && (r < bestRank || (r === bestRank && c.length < best.length))) { best = c; bestRank = r }
  }
  return best
}

/** Whether an exercise is logged with bands: the lifter's own say first, else its equipment. */
export function usesBands(S, exId, cfg = null) {
  const own = isMap(S?.bandEx) ? S.bandEx[exId] : undefined
  if (typeof own === 'boolean') return own
  if (cfg && Array.isArray(cfg.bands) && cfg.bands.length) return true
  const eq = String(EXIDX[exId]?.eq || '').toLowerCase()
  return eq === 'band' || eq === 'resistance band'
}

/** S.bandEx with the lifter's choice for `exId`; the equipment's own default takes the key away. */
export function withBandEx(map, exId, on, byDefault = false) {
  const out = { ...(isMap(map) ? map : {}) }
  if (!!on === !!byDefault) delete out[exId]
  else out[exId] = !!on
  return out
}

/** The CSV cell for a set's bands: names joined by " + ", empty without any. */
export function bandsCell(set, list = known) {
  const ids = setBandsOf(set)
  return ids.length ? bandText(ids, list) : ''
}

/**
 * A CSV cell back into band ids, matching names to `list` (case and spaces aside). A name that is
 * not there yet becomes a new band, returned in `added` for the importer to keep.
 */
export function bandsFromCell(text, list, now = Date.now()) {
  const bands = cleanBands(list)
  const names = String(text || '').split('+').map(s => s.trim()).filter(Boolean).slice(0, MAX_SET_BANDS)
  const ids = [], added = []
  const key = s => s.toLocaleLowerCase().replace(/\s+/g, ' ')
  for (const name of names) {
    let b = [...bands, ...added].find(x => key(x.name) === key(name))
    if (!b && bands.length + added.length < MAX_BANDS) {
      b = cleanBand({ id: newBandId([...bands, ...added], now + added.length), name, color: BAND_COLORS[(bands.length + added.length) % BAND_COLORS.length] })
      if (b) added.push(b)
    }
    if (b && !ids.includes(b.id)) ids.push(b.id)
  }
  return { ids, added }
}
