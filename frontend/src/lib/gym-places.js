// Finding a gym (#614, the 1.4.4 search-first picker): the search as you type, the address of a
// spot, the map tiles and the "Open in Apple Maps / Google Maps" links.
//
// Where a search goes: on the iPhone to Apple (MapKit's MKLocalSearchCompleter for the type-ahead
// and MKLocalSearch for the one you pick, ios/App/App/GymMapPickerPlugin.swift); in the Android
// app, and on an iPhone build without those calls, to OpenStreetMap data. Only the text typed and
// a rough "near here" go out, never the gyms.
//
// OpenStreetMap side. The type-ahead asks Photon (photon.komoot.io, komoot's public OSM geocoder,
// built for search-as-you-type; its rule is "be fair, heavy use gets throttled"): the page waits
// until you stop typing, asks for at least two letters, never more than one request every
// PHOTON_GAP_MS, the same question twice comes from memory (this session only, nothing stored) and
// a question already on its way is not asked again. If Photon does not answer, Nominatim does,
// with its own stricter manners (operations.osmfoundation.org/policies/nominatim): at most one
// request a second, an identifying User-Agent, results cached. Both name the app the same way.
//
// Tiles: OpenStreetMap's standard tiles (tile usage policy: attribution shown, no bulk download,
// the app's own requests only). Dark mode darkens them on the phone (a CSS filter, index.css
// .gym-map), so no second tile provider and no API key: CARTO's dark basemaps now need a key.
import { MOBILE } from './mobile.js'
import { getLang } from './i18n.js'
import { nativeFetch } from './capacitor-fetch.js'

export const NOMINATIM = 'https://nominatim.openstreetmap.org/search'
export const PHOTON = 'https://photon.komoot.io'
export const USER_AGENT = 'openGym/' + (typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev') + ' (gym reminder; +https://opengym.ch)'
export const TILES = Object.freeze({
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  maxZoom: 19,
  attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
})
export const MIN_GAP_MS = 1000
export const PHOTON_GAP_MS = 500

// In the phone app the request goes out natively (CapacitorHttp), with the User-Agent above. A
// plain browser may not set one: there it would only cost a CORS preflight Nominatim refuses, and
// the page's Referer names the app instead, which is what the policy asks of browser apps.
async function placeFetch(url, init) {
  let native = false
  try { native = (await import('@capacitor/core')).Capacitor.isNativePlatform() } catch { /* no Capacitor */ }
  if (native) return nativeFetch(url, init)
  const { 'User-Agent': _ua, ...headers } = init.headers || {}
  return fetch(url, { ...init, headers, referrerPolicy: 'strict-origin-when-cross-origin' })
}
const CACHE_MAX = 40

// What Nominatim calls a gym. These come first in the results, the rest after them by distance.
const FITNESS = new Set(['fitness_centre', 'sports_centre', 'fitness_station', 'gym', 'sports_hall', 'climbing', 'swimming_pool', 'dojo'])
export const isFitness = r => FITNESS.has(String(r?.type || '')) && /^(leisure|amenity|sport|building)$/.test(String(r?.category || r?.class || ''))

// The small grey hint on a result: a gym, some other sports place, a street address or a whole
// area (a town, a district). Null when OpenStreetMap's tags say nothing a person would care about.
const SPORT = new Set(['sports_centre', 'sports_hall', 'stadium', 'pitch', 'swimming_pool', 'climbing', 'dojo', 'fitness_station', 'track'])
const AREA = new Set(['city', 'town', 'village', 'hamlet', 'suburb', 'quarter', 'neighbourhood', 'borough', 'district', 'county', 'state', 'country', 'municipality', 'locality'])
export function kindOf(key, value, fitness = false) {
  if (fitness && (value === 'fitness_centre' || value === 'gym')) return 'gym'
  if (fitness || SPORT.has(value)) return 'sport'
  if (key === 'place' || key === 'boundary') return AREA.has(value) || key === 'boundary' ? 'area' : 'address'
  if (key === 'building' || key === 'highway' || value === 'house' || value === 'street') return 'address'
  return null
}

const km = (a, b) => {
  const rad = x => x * Math.PI / 180
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** One Nominatim row as the picker shows it: a name, a short address, the place. Null if unusable. */
export function placeOf(r) {
  const lat = Number(r?.lat), lng = Number(r?.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  const a = r.address || {}
  const full = String(r.display_name || '')
  const street = [a.road || a.pedestrian || a.footway, a.house_number].filter(Boolean).join(' ')
  const town = [a.postcode, a.city || a.town || a.village || a.suburb || a.municipality].filter(Boolean).join(' ')
  const name = String(r.name || '').trim() || full.split(',')[0].trim()
  let address = [street, town].filter(Boolean).join(', ')
  if (!address) address = full.split(',').slice(name ? 1 : 0, 4).map(s => s.trim()).filter(Boolean).join(', ')
  const fitness = isFitness(r)
  return { id: String(r.place_id ?? lat + ',' + lng), name, address, lat, lng, fitness, kind: kindOf(String(r.category || r.class || ''), String(r.type || ''), fitness) }
}

/** Gyms first, then the nearest (when the map has a centre), else in Nominatim's own order. */
export function rankPlaces(places, near) {
  const d = p => (near ? km(near, p) : 0)
  return places.map((p, i) => ({ p, i, d: d(p) }))
    .sort((x, y) => (y.p.fitness - x.p.fitness) || (x.d - y.d) || (x.i - y.i))
    .map(x => x.p)
}

/**
 * A place search with Nominatim's manners built in. `fetcher`, `now` and `sleep` are for tests.
 * search(q, { near }) resolves to ranked places ([] for an empty question).
 */
export function createPlaceSearch({ fetcher = placeFetch, now = () => Date.now(), sleep = ms => new Promise(r => setTimeout(r, ms)), lang = () => getLang() || 'en' } = {}) {
  const cache = new Map()
  const flying = new Map()
  let nextAt = 0
  const ask = async (query, near, key) => {
    // One a second, in the order asked: a second question waits for the slot after the first.
    const at = Math.max(now(), nextAt)
    nextAt = at + MIN_GAP_MS
    if (at > now()) await sleep(at - now())
    let url = NOMINATIM + '?format=jsonv2&addressdetails=1&limit=8&q=' + encodeURIComponent(query) + '&accept-language=' + encodeURIComponent(lang())
    // Biased to what is on the map, not bounded to it: a gym in the next town still shows.
    if (near) url += '&viewbox=' + [near.lng - 0.2, near.lat + 0.2, near.lng + 0.2, near.lat - 0.2].map(n => n.toFixed(4)).join(',')
    const res = await fetcher(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } })
    if (!res.ok) throw new Error('search failed: ' + res.status)
    const rows = await res.json()
    const out = rankPlaces((Array.isArray(rows) ? rows : []).map(placeOf).filter(Boolean), near)
    cache.set(key, out)
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value)
    return out
  }
  return function search(q, { near = null } = {}) {
    const query = String(q || '').trim().replace(/\s+/g, ' ')
    if (!query) return Promise.resolve([])
    // About 10 km of map is "the same place" for a repeated question.
    const area = near ? near.lat.toFixed(1) + ',' + near.lng.toFixed(1) : ''
    const key = query.toLowerCase() + '|' + lang() + '|' + area
    if (cache.has(key)) return Promise.resolve(cache.get(key))
    if (flying.has(key)) return flying.get(key)
    const p = ask(query, near, key).finally(() => flying.delete(key))
    flying.set(key, p)
    return p
  }
}

export const searchPlaces = createPlaceSearch()

/** A link that shows the spot in Google Maps: the app on a phone that has it, the website otherwise. */
export const googleMapsUrl = ({ lat, lng }) =>
  'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(lat.toFixed(6) + ',' + lng.toFixed(6))


/** The same spot in Apple Maps (the iPhone opens the Maps app), named after the gym. */
export const appleMapsUrl = ({ lat, lng }, name = '') =>
  'https://maps.apple.com/?ll=' + encodeURIComponent(lat.toFixed(6) + ',' + lng.toFixed(6)) + (name ? '&q=' + encodeURIComponent(name) : '')

/* ---------------- OpenStreetMap: the type-ahead (Photon) ---------------- */

// Photon answers in these languages only (anything else is refused with a 400); other languages
// get the names as they are written on the spot, which is what a sign on the street says too.
const PHOTON_LANGS = new Set(['en', 'de', 'fr'])
const SHORT = 2

/** One Photon feature as a result row: a name, a short address, the place. Null if unusable. */
export function photonPlaceOf(f) {
  const [lng, lat] = Array.isArray(f?.geometry?.coordinates) ? f.geometry.coordinates.map(Number) : []
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  const p = f.properties || {}
  const street = [p.street, p.housenumber].filter(Boolean).join(' ')
  const town = [p.postcode, p.city || p.town || p.village || p.district || p.locality].filter(Boolean).join(' ')
  let name = String(p.name || '').trim()
  let address = [street, town].filter(Boolean).join(', ')
  if (!name) { name = street || town || String(p.state || p.country || '').trim(); address = street ? town : [p.state, p.country].filter(Boolean).join(', ') }
  if (!name) return null
  if (address === name) address = [p.state, p.country].filter(Boolean).join(', ')
  const key = String(p.osm_key || ''), value = String(p.osm_value || '')
  const fitness = isFitness({ category: key, type: value })
  return { id: String((p.osm_type || '') + (p.osm_id ?? lat + ',' + lng)), name, address, lat, lng, fitness, kind: kindOf(key, value, fitness) }
}

/**
 * A search as you type over OpenStreetMap data. `fetcher`, `now`, `sleep`, `lang` and `fallback`
 * are for tests. suggest(q, { near }) resolves to ranked places ([] for a question too short).
 */
export function createTypeahead({ fetcher = placeFetch, now = () => Date.now(), sleep = ms => new Promise(r => setTimeout(r, ms)), lang = () => getLang() || 'en', fallback = (q, o) => searchPlaces(q, o) } = {}) {
  const cache = new Map()
  const flying = new Map()
  let nextAt = 0
  const ask = async (query, near, key) => {
    const at = Math.max(now(), nextAt)
    nextAt = at + PHOTON_GAP_MS
    if (at > now()) await sleep(at - now())
    const l = String(lang()).slice(0, 2).toLowerCase()
    let url = PHOTON + '/api/?q=' + encodeURIComponent(query) + '&limit=10'
    if (PHOTON_LANGS.has(l)) url += '&lang=' + l
    if (near) url += '&lat=' + near.lat.toFixed(3) + '&lon=' + near.lng.toFixed(3)
    let out
    try {
      const res = await fetcher(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } })
      if (!res.ok) throw new Error('search failed: ' + res.status)
      const body = await res.json()
      out = rankPlaces((Array.isArray(body?.features) ? body.features : []).map(photonPlaceOf).filter(Boolean), near)
    } catch (e) {
      // Photon is down or throttling: Nominatim, with its own one-a-second rule.
      if (!fallback) throw e
      out = await fallback(query, { near })
    }
    cache.set(key, out)
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value)
    return out
  }
  return function suggest(q, { near = null } = {}) {
    const query = String(q || '').trim().replace(/\s+/g, ' ')
    if (query.length < SHORT) return Promise.resolve([])
    const area = near ? near.lat.toFixed(1) + ',' + near.lng.toFixed(1) : ''
    const key = query.toLowerCase() + '|' + lang() + '|' + area
    if (cache.has(key)) return Promise.resolve(cache.get(key))
    if (flying.has(key)) return flying.get(key)
    const p = ask(query, near, key).finally(() => flying.delete(key))
    flying.set(key, p)
    return p
  }
}

export const suggestPlaces = createTypeahead()

/**
 * The street address of a spot ("Gym St 1, 8000 Zürich"), for a pin placed by hand or "Current
 * location": Photon's reverse lookup, once per spot (about 10 m), '' when it does not know.
 */
export function createReverse({ fetcher = placeFetch } = {}) {
  const cache = new Map()
  return async function reverse({ lat, lng }) {
    const key = lat.toFixed(4) + ',' + lng.toFixed(4)
    if (cache.has(key)) return cache.get(key)
    let out = ''
    try {
      const res = await fetcher(PHOTON + '/reverse?lat=' + lat.toFixed(5) + '&lon=' + lng.toFixed(5) + '&limit=1', { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } })
      if (res.ok) {
        const p = (await res.json())?.features?.[0]?.properties || {}
        const street = [p.street, p.housenumber].filter(Boolean).join(' ')
        const town = [p.postcode, p.city || p.town || p.village || p.district].filter(Boolean).join(' ')
        out = [street, town].filter(Boolean).join(', ')
      }
    } catch { /* offline: no address, the pin is what counts */ }
    cache.set(key, out)
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value)
    return out
  }
}
const reverseOSM = createReverse()

/* ---------------- the iPhone: Apple's own search ---------------- */

// Registered once and handed out inside an object: a Capacitor plugin proxy answers `then` with a
// native call that never settles, so a promise resolved with the bare proxy hangs (#42).
let nativeP = null
const nativePlaces = () => nativeP || (nativeP = (async () => {
  if (!MOBILE) return null
  const { registerPlugin, Capacitor } = await import('@capacitor/core')
  if (Capacitor.getPlatform() !== 'ios') return null
  if (typeof Capacitor.isPluginAvailable === 'function' && !Capacitor.isPluginAvailable('GymMapPicker')) return null
  return { GymMapPicker: registerPlugin('GymMapPicker') }
})().catch(() => null))

const UNIMPLEMENTED = e => e?.code === 'UNIMPLEMENTED' || /not implemented/i.test(String(e?.message || e))
// A build from before the search calls (1.4.4 build 45 had only the full-screen picker): answers
// UNIMPLEMENTED, and the OpenStreetMap side takes over for the rest of the session.
const retire = () => { nativeP = Promise.resolve(null) }

/** 'apple' when this phone searches with Apple Maps, 'osm' otherwise. */
export async function searchSource() { return (await nativePlaces()) ? 'apple' : 'osm' }

/**
 * Type-ahead on Apple Maps. Resolves to result rows, or to undefined when this phone has no such
 * search (then the OpenStreetMap one is asked). A row from Apple has no place yet: placeOfPick
 * fetches it when it is picked, as Apple asks (one MKLocalSearch per pick, not per keystroke).
 */
export async function nativeComplete(q, near) {
  const p = await nativePlaces()
  if (!p) return undefined
  try {
    const r = await p.GymMapPicker.complete({ query: q, ...(near ? { lat: near.lat, lng: near.lng } : {}) })
    if (r?.stale) return null
    return (Array.isArray(r?.results) ? r.results : []).map(x => ({
      id: 'a:' + String(x.id), ref: String(x.id), name: String(x.title || ''), address: String(x.subtitle || ''),
      lat: null, lng: null, fitness: !!x.fitness, kind: x.fitness ? 'gym' : null, apple: true,
    })).filter(x => x.name)
  } catch (e) {
    if (UNIMPLEMENTED(e)) { retire(); return undefined }
    throw e
  }
}

async function nativeResolve(ref) {
  const p = await nativePlaces()
  if (!p) return null
  try {
    const r = await p.GymMapPicker.resolve({ id: ref })
    const lat = Number(r?.lat), lng = Number(r?.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
    return { name: String(r.name || ''), address: String(r.address || ''), lat, lng, fitness: !!r.fitness }
  } catch { return null }
}

async function nativeReverse(pos) {
  const p = await nativePlaces()
  if (!p) return undefined
  try { return String((await p.GymMapPicker.reverse({ lat: pos.lat, lng: pos.lng }))?.address || '') } catch (e) {
    if (UNIMPLEMENTED(e)) { retire(); return undefined }
    return ''
  }
}

/* ---------------- what the page calls ---------------- */

/**
 * The search as you type: Apple's on the iPhone, OpenStreetMap's elsewhere. Resolves to rows with
 * the distance from `near` where both are known, or to null for an answer overtaken by a newer
 * question (the page drops it).
 */
export async function findPlaces(q, { near = null, suggest = suggestPlaces } = {}) {
  const query = String(q || '').trim().replace(/\s+/g, ' ')
  if (query.length < SHORT) return []
  const apple = await nativeComplete(query, near)
  const rows = apple === undefined ? await suggest(query, { near }) : apple
  if (rows === null) return null
  return rows.map(r => ({ ...r, distance: near && Number.isFinite(r.lat) && Number.isFinite(r.lng) ? km(near, r) * 1000 : null }))
}

/** A picked row with its place: Apple's rows ask Apple once for it. Null if it has none. */
export async function placeOfPick(row) {
  if (Number.isFinite(row?.lat) && Number.isFinite(row?.lng)) return row
  if (!row?.apple) return null
  const r = await nativeResolve(row.ref)
  return r && { ...row, ...r, name: row.name || r.name, address: r.address || row.address }
}

/** The address at a spot, from Apple on the iPhone, else OpenStreetMap; '' when unknown. */
export async function addressAt(pos) {
  const a = await nativeReverse(pos)
  return a === undefined ? reverseOSM(pos) : a
}

/** "350 m" up close, "2.4 km" further off, in the app's number format. */
export function fmtDistance(m, lang = getLang() || 'en') {
  if (!Number.isFinite(m)) return ''
  if (m < 1000) return Math.max(10, Math.round(m / 10) * 10) + ' m'
  const km = m / 1000
  let n
  try { n = new Intl.NumberFormat(lang, { maximumFractionDigits: km < 10 ? 1 : 0 }).format(km) } catch { n = km.toFixed(km < 10 ? 1 : 0) }
  return n + ' km'
}

export function _resetGymPlaces() { nativeP = null }
