// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The gym search's places (1.4.4): the Photon type-ahead and the Nominatim fallback with their
// manners (a gap between requests, cached, no repeats in flight, an honest User-Agent), the
// ranking that puts gyms first, the address lookup, the maps links, and the iPhone's MapKit calls
// (complete / resolve / reverse) with the fallback for builds that do not have them.
const cap = vi.hoisted(() => ({ platform: 'ios', available: true, calls: [], complete: null, resolve: null, reverse: null }))
vi.mock('./mobile.js', () => ({ MOBILE: true }))
vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => cap.platform, isPluginAvailable: () => cap.available, isNativePlatform: () => false },
  registerPlugin: () => ({
    complete: o => { cap.calls.push(['complete', o]); return cap.complete(o) },
    resolve: o => { cap.calls.push(['resolve', o]); return cap.resolve(o) },
    reverse: o => { cap.calls.push(['reverse', o]); return cap.reverse(o) },
  }),
}))

import {
  createPlaceSearch, createTypeahead, createReverse, placeOf, photonPlaceOf, rankPlaces, isFitness, kindOf,
  googleMapsUrl, appleMapsUrl, findPlaces, placeOfPick, addressAt, searchSource, nativeComplete, fmtDistance,
  MIN_GAP_MS, PHOTON_GAP_MS, _resetGymPlaces,
} from './gym-places.js'

const row = (o = {}) => ({ place_id: 1, lat: '47.1', lon: '8.2', name: 'Iron Temple', display_name: 'Iron Temple, Gym St 1, Zürich, Switzerland', category: 'leisure', type: 'fitness_centre', address: { road: 'Gym St', house_number: '1', postcode: '8000', city: 'Zürich' }, ...o })
const okJson = rows => ({ ok: true, json: async () => rows })

describe('a Nominatim row', () => {
  it('becomes a name, a short address and the place', () => {
    expect(placeOf(row())).toEqual({ id: '1', name: 'Iron Temple', address: 'Gym St 1, 8000 Zürich', lat: 47.1, lng: 8.2, fitness: true, kind: 'gym' })
  })
  it('without a name or an address breakdown: read from the display name', () => {
    const p = placeOf(row({ name: '', address: undefined, category: 'place', type: 'house', display_name: 'Bahnhofstrasse 5, Zürich, Switzerland' }))
    expect(p).toMatchObject({ name: 'Bahnhofstrasse 5', address: 'Zürich, Switzerland', fitness: false })
  })
  it('no usable place: dropped', () => {
    expect(placeOf(row({ lat: 'x' }))).toBe(null)
  })
  it('what counts as a gym', () => {
    expect(isFitness({ category: 'leisure', type: 'fitness_centre' })).toBe(true)
    expect(isFitness({ category: 'leisure', type: 'sports_centre' })).toBe(true)
    expect(isFitness({ category: 'highway', type: 'residential' })).toBe(false)
  })
  it('gyms first, then the nearest', () => {
    const near = { lat: 47, lng: 8 }
    const far = { id: 'far', lat: 48, lng: 8, fitness: false }
    const close = { id: 'close', lat: 47.01, lng: 8, fitness: false }
    const gym = { id: 'gym', lat: 47.5, lng: 8, fitness: true }
    expect(rankPlaces([far, close, gym], near).map(p => p.id)).toEqual(['gym', 'close', 'far'])
    // no centre yet: Nominatim's own order after the gyms
    expect(rankPlaces([far, close, gym], null).map(p => p.id)).toEqual(['gym', 'far', 'close'])
  })
})

describe('the search', () => {
  let clock, sleeps, fetcher, search
  beforeEach(() => {
    clock = 1_000_000
    sleeps = []
    fetcher = vi.fn(async () => okJson([row()]))
    search = createPlaceSearch({ fetcher, now: () => clock, sleep: async ms => { sleeps.push(ms); clock += ms }, lang: () => 'de' })
  })

  it('names the app in the User-Agent, asks in the app\'s language, biased to the map', async () => {
    const r = await search('  Iron   Temple ', { near: { lat: 47.37, lng: 8.54 } })
    expect(r[0].name).toBe('Iron Temple')
    const [url, init] = fetcher.mock.calls[0]
    expect(url).toMatch(/^https:\/\/nominatim\.openstreetmap\.org\/search\?format=jsonv2&addressdetails=1&limit=8&q=Iron%20Temple&accept-language=de/)
    expect(url).toContain('&viewbox=8.3400,47.5700,8.7400,47.1700')
    expect(url).not.toContain('bounded=1')
    expect(init.headers['User-Agent']).toMatch(/^openGym\/.+opengym\.ch/)
  })
  it('an empty question asks nobody', async () => {
    expect(await search('   ')).toEqual([])
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('at most one request a second: the second question waits its turn', async () => {
    await search('one')
    clock += 200
    await search('two')
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(sleeps).toEqual([MIN_GAP_MS - 200])
    // a while later: no wait
    clock += 5000
    await search('three')
    expect(sleeps).toHaveLength(1)
  })
  it('the same question again is answered from memory (case and spaces aside)', async () => {
    await search('Iron Temple')
    await search('iron  temple')
    expect(fetcher).toHaveBeenCalledTimes(1)
    // somewhere else on the map is a new question
    await search('iron temple', { near: { lat: 40, lng: -3 } })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('a double tap on Search sends one request', async () => {
    const [a, b] = await Promise.all([search('gym'), search('gym')])
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(a).toBe(b)
  })
  it('a failed answer throws and is not cached', async () => {
    fetcher.mockResolvedValueOnce({ ok: false, status: 429 })
    await expect(search('gym')).rejects.toThrow('429')
    await search('gym')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})

describe('the maps links and the distance', () => {
  it('a plain Google Maps link, no key', () => {
    expect(googleMapsUrl({ lat: 47.3769, lng: 8.5417 })).toBe('https://www.google.com/maps/search/?api=1&query=47.376900%2C8.541700')
  })
  it('Apple Maps at the spot, named after the gym', () => {
    expect(appleMapsUrl({ lat: 47.3769, lng: 8.5417 }, 'Iron & Co')).toBe('https://maps.apple.com/?ll=47.376900%2C8.541700&q=Iron%20%26%20Co')
    expect(appleMapsUrl({ lat: 47.3769, lng: 8.5417 })).toBe('https://maps.apple.com/?ll=47.376900%2C8.541700')
  })
  it('metres up close, kilometres further off, in the app\'s number format', () => {
    expect(fmtDistance(343, 'en')).toBe('340 m')
    expect(fmtDistance(2, 'en')).toBe('10 m')
    expect(fmtDistance(2450, 'de')).toBe('2,5 km')
    expect(fmtDistance(21400, 'en')).toBe('21 km')
    expect(fmtDistance(null)).toBe('')
  })
  it('the little kind hint', () => {
    expect(kindOf('leisure', 'fitness_centre', true)).toBe('gym')
    expect(kindOf('leisure', 'sports_centre', true)).toBe('sport')
    expect(kindOf('leisure', 'swimming_pool')).toBe('sport')
    expect(kindOf('place', 'city')).toBe('area')
    expect(kindOf('place', 'house')).toBe('address')
    expect(kindOf('highway', 'residential')).toBe('address')
    expect(kindOf('amenity', 'cafe')).toBe(null)
  })
})

const feature = (o = {}, at = [8.5416, 47.3807]) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: at }, properties: { osm_type: 'N', osm_id: 683372588, osm_key: 'leisure', osm_value: 'fitness_centre', name: 'Iron Temple', street: 'Gym St', housenumber: '1', postcode: '8000', city: 'Zürich', country: 'Switzerland', ...o } })
const fc = features => ({ ok: true, json: async () => ({ type: 'FeatureCollection', features }) })

describe('a Photon feature', () => {
  it('becomes a name, a short address and the place', () => {
    expect(photonPlaceOf(feature())).toEqual({ id: 'N683372588', name: 'Iron Temple', address: 'Gym St 1, 8000 Zürich', lat: 47.3807, lng: 8.5416, fitness: true, kind: 'gym' })
  })
  it('a street without a name: the street is the name, the town the address', () => {
    expect(photonPlaceOf(feature({ name: undefined, osm_key: 'highway', osm_value: 'residential', housenumber: undefined }))).toMatchObject({ name: 'Gym St', address: '8000 Zürich', kind: 'address', fitness: false })
  })
  it('no usable place: dropped', () => {
    expect(photonPlaceOf({ properties: { name: 'x' }, geometry: { coordinates: ['a', 'b'] } })).toBe(null)
  })
})

describe('the type-ahead', () => {
  let clock, sleeps, fetcher, suggest, fallback
  beforeEach(() => {
    clock = 1_000_000
    sleeps = []
    fetcher = vi.fn(async () => fc([feature({ name: 'Far Gym' }, [8.9, 47.9]), feature()]))
    fallback = vi.fn(async () => [{ id: 'n', name: 'From Nominatim', lat: 1, lng: 1 }])
    suggest = createTypeahead({ fetcher, now: () => clock, sleep: async ms => { sleeps.push(ms); clock += ms }, lang: () => 'de', fallback })
  })
  it('asks Photon with the app named, in a language it has, near you, nearest gym first', async () => {
    const r = await suggest('  Iron   Temple ', { near: { lat: 47.37, lng: 8.54 } })
    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe('https://photon.komoot.io/api/?q=Iron%20Temple&limit=10&lang=de&lat=47.370&lon=8.540')
    expect(init.headers['User-Agent']).toMatch(/^openGym\/.+opengym\.ch/)
    expect(r.map(p => p.name)).toEqual(['Iron Temple', 'Far Gym'])
  })
  it('a language Photon refuses is left out (the names on the spot then)', async () => {
    const s = createTypeahead({ fetcher, lang: () => 'pt-BR', now: () => clock, sleep: async () => {} })
    await s('ginásio')
    expect(fetcher.mock.calls[0][0]).not.toContain('lang=')
  })
  it('fewer than two letters asks nobody', async () => {
    expect(await suggest('I')).toEqual([])
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('keeps a gap between requests, answers repeats from memory, sends one for a double ask', async () => {
    await suggest('ir')
    clock += 100
    await suggest('iro')
    expect(sleeps).toEqual([PHOTON_GAP_MS - 100])
    await suggest('IRO ')
    expect(fetcher).toHaveBeenCalledTimes(2)
    const [a, b] = await Promise.all([suggest('iron'), suggest('iron')])
    expect(a).toBe(b)
    expect(fetcher).toHaveBeenCalledTimes(3)
  })
  it('Photon down: Nominatim answers instead', async () => {
    fetcher.mockResolvedValueOnce({ ok: false, status: 503 })
    const r = await suggest('iron', { near: { lat: 47, lng: 8 } })
    expect(fallback).toHaveBeenCalledWith('iron', { near: { lat: 47, lng: 8 } })
    expect(r[0].name).toBe('From Nominatim')
  })
})

describe('the address of a spot', () => {
  it('asks Photon once per spot, \'\' when it does not know', async () => {
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ features: [{ properties: { street: 'Side St', housenumber: '9', postcode: '8000', city: 'Zürich' } }] }) }))
    const reverse = createReverse({ fetcher })
    expect(await reverse({ lat: 47.38101, lng: 8.54102 })).toBe('Side St 9, 8000 Zürich')
    expect(fetcher.mock.calls[0][0]).toBe('https://photon.komoot.io/reverse?lat=47.38101&lon=8.54102&limit=1')
    await reverse({ lat: 47.38102, lng: 8.54101 })
    expect(fetcher).toHaveBeenCalledTimes(1)
    const offline = createReverse({ fetcher: async () => { throw new Error('offline') } })
    expect(await offline({ lat: 1, lng: 1 })).toBe('')
  })
})

describe('the iPhone: Apple\'s search', () => {
  beforeEach(() => { _resetGymPlaces(); cap.platform = 'ios'; cap.available = true; cap.calls = [] })

  it('type-ahead rows from MapKit, gyms marked; the place comes with the pick', async () => {
    cap.complete = async () => ({ results: [{ id: '4', title: 'Iron Temple', subtitle: 'Zürich', fitness: true }, { id: '5', title: 'Iron Street', subtitle: 'Bern', fitness: false }] })
    cap.resolve = async () => ({ name: 'Iron Temple', address: 'Gym St 1, 8000 Zürich', lat: 47.1, lng: 8.2, fitness: true })
    expect(await searchSource()).toBe('apple')
    const rows = await findPlaces(' iron ', { near: { lat: 47, lng: 8 } })
    expect(cap.calls[0]).toEqual(['complete', { query: 'iron', lat: 47, lng: 8 }])
    expect(rows.map(r => [r.name, r.address, r.kind, r.distance])).toEqual([['Iron Temple', 'Zürich', 'gym', null], ['Iron Street', 'Bern', null, null]])
    const picked = await placeOfPick(rows[0])
    expect(cap.calls.at(-1)).toEqual(['resolve', { id: '4' }])
    expect(picked).toMatchObject({ name: 'Iron Temple', address: 'Gym St 1, 8000 Zürich', lat: 47.1, lng: 8.2 })
  })
  it('an answer overtaken by a newer question: null (the page drops it)', async () => {
    cap.complete = async () => ({ stale: true, results: [] })
    expect(await findPlaces('iron')).toBe(null)
  })
  it('Apple has no place for a row: null', async () => {
    cap.resolve = async () => ({})
    expect(await placeOfPick({ id: 'a:1', ref: '1', name: 'X', apple: true, lat: null, lng: null })).toBe(null)
  })
  it('the address of a spot from Apple', async () => {
    cap.reverse = async () => ({ address: 'Side St 9, 8000 Zürich' })
    expect(await addressAt({ lat: 47, lng: 8 })).toBe('Side St 9, 8000 Zürich')
  })
  it('build 45 (only the old picker, UNIMPLEMENTED): OpenStreetMap from then on', async () => {
    cap.complete = async () => { const e = new Error('"GymMapPicker.complete()" is not implemented on ios'); e.code = 'UNIMPLEMENTED'; throw e }
    const suggest = vi.fn(async () => [{ id: 'o', name: 'OSM Gym', lat: 47.01, lng: 8, fitness: true }])
    const rows = await findPlaces('iron', { near: { lat: 47, lng: 8 }, suggest })
    expect(suggest).toHaveBeenCalledWith('iron', { near: { lat: 47, lng: 8 } })
    expect(rows[0].distance).toBeGreaterThan(1000)
    expect(rows[0].distance).toBeLessThan(1200)
    expect(await searchSource()).toBe('osm')
    expect(await nativeComplete('iron')).toBe(undefined)
  })
  it('Android, or no plugin: OpenStreetMap', async () => {
    cap.platform = 'android'
    expect(await searchSource()).toBe('osm')
    _resetGymPlaces(); cap.platform = 'ios'; cap.available = false
    expect(await searchSource()).toBe('osm')
    const suggest = vi.fn(async () => [])
    await findPlaces('iron', { suggest })
    expect(suggest).toHaveBeenCalled()
    expect(cap.calls).toEqual([])
  })
})
