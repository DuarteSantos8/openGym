// openGym Offline (lib/build-caps.js): the build without the INTERNET permission hides everything
// that needs a network, and the modules that are nothing but network are off whatever S says.
import { afterEach, describe, expect, it } from 'vitest'
import { setOfflineBuild, offlineBuild, networkBuilt, subscribeBuildCaps, OFFLINE_OFF_CARDS } from './build-caps.js'
import { isOn, moduleBuilt, presetOf, applyPreset } from './modules.js'
import { youtubeId, youtubeSearchUrl, youtubeLinks } from './youtube.js'
import { directory } from './integrations.js'
import { coachAvailable } from './coach.js'
import { findPlaces, addressAt } from './gym-places.js'

afterEach(() => setOfflineBuild(false))

describe('openGym Offline', () => {
  it('is off by default and says so to listeners once', () => {
    expect(offlineBuild()).toBe(false)
    expect(networkBuilt()).toBe(true)
    let n = 0
    const off = subscribeBuildCaps(() => n++)
    setOfflineBuild(true); setOfflineBuild(true)
    expect(n).toBe(1)
    expect(offlineBuild()).toBe(true)
    off()
  })

  it('switches the network modules off without touching the saved choice', () => {
    const S = { modules: { coach: true } }
    expect(isOn(S, 'coach')).toBe(true)
    setOfflineBuild(true)
    for (const id of ['coach', 'integrations', 'community']) { expect(isOn(S, id)).toBe(false); expect(moduleBuilt(id)).toBe(false) }
    expect(isOn(S, 'body')).toBe(true)
    expect(S.modules.coach).toBe(true)
    // "Everything" still reads as everything here
    const all = {}; applyPreset(all, 'all')
    expect(presetOf(all)).toBe('all')
    setOfflineBuild(false)
    expect(isOn(S, 'coach')).toBe(true)
  })

  it('has no YouTube, no Coach, no gym search', async () => {
    const ex = { n: 'Bench Press' }
    expect(youtubeSearchUrl(ex)).toMatch(/youtube\.com/)
    expect(youtubeId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    setOfflineBuild(true)
    expect(youtubeSearchUrl(ex)).toBe(null)
    expect(youtubeId('https://youtu.be/dQw4w9WgXcQ')).toBe(null)
    expect(youtubeLinks('see https://youtu.be/dQw4w9WgXcQ')).toEqual([])
    expect(coachAvailable({ coach: { enabled: true } }, { id: 'u' }, { mobile: true, coachMode: 'byok' })).toBe(false)
    expect(await findPlaces('gym zurich', { suggest: () => { throw new Error('asked the network') } })).toEqual([])
    expect(await addressAt({ lat: 47, lng: 8 })).toBe(null)
  })

  it('leaves only the cards that work without a network on Integrations', () => {
    const ctx = { mobile: true, platform: 'android', mod: () => true, offline: true }
    const ids = directory(ctx).flatMap(c => c.cards.map(x => x.id))
    for (const id of OFFLINE_OFF_CARDS) expect(ids).not.toContain(id)
    expect(ids).toEqual(expect.arrayContaining(['files', 'csv']))
    const normal = directory({ ...ctx, offline: false }).flatMap(c => c.cards.map(x => x.id))
    expect(normal.length).toBeGreaterThan(ids.length)
  })
})
