// @vitest-environment happy-dom
// Settings > Workout > Live widget (lib/live-notes.js): what a switch that is on but shows nowhere
// says about itself, and the moment the preview goes to when a switch is flipped. Every note comes
// from the real view of the sample moments on the surfaces of the phone in hand.
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./mobile.js', () => ({ MOBILE: true, nativePlatform: async () => 'ios' }))
vi.mock('@capacitor/core', () => ({ registerPlugin: () => ({}) }))

const N = await import('./live-notes.js')
const G = await import('./live-glance.js')
const LA = await import('./live-activity.js')

const S = (over = {}) => ({ unit: 'kg', restSec: 90, effort: 'rir', lang: 'en', workouts: [], routines: [], exWeights: {}, ...over })
const glance = fn => { const g = G.normalizeGlance(null); fn?.(g); return g }
const said = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v))
const iphone = { os: 'ios', island: true }
const plain = { os: 'ios', island: false }
const android = { os: 'android' }
const HIDDEN = 'Hidden while the picture or the − and + buttons are showing.'

afterEach(() => { LA._resetLiveActivity(); localStorage.clear() })

describe('which surfaces a note answers for', () => {
  it('a phone: its own, the island only when it has one', () => {
    expect(N.noteSurfaces(android)).toEqual(['android'])
    expect(N.noteSurfaces(plain)).toEqual(['lock'])
    expect(N.noteSurfaces(iphone)).toEqual(['lock', 'island'])
  })
  it('the web: the tab in view, with the Lock Screen beside the island', () => {
    expect(N.noteSurfaces({ os: null, surface: 'lock' })).toEqual(['lock'])
    expect(N.noteSurfaces({ os: null, surface: 'island' })).toEqual(['lock', 'island'])
    expect(N.noteSurfaces({ os: null, surface: 'android' })).toEqual(['android'])
    expect(N.rowPlatform(null, 'android')).toBe('android')
    expect(N.rowPlatform(null, 'island')).toBe('ios')
    expect(N.rowPlatform('android', 'lock')).toBe('android')
  })
})

describe('optionNotes', () => {
  it('says nothing while everything that is on shows', () => {
    for (const ctx of [iphone, plain, android, { os: null, surface: 'lock' }]) expect(said(N.optionNotes(S(), glance(), ctx)), JSON.stringify(ctx)).toEqual({})
  })
  it('names every switch of the page, so a row never reads undefined', () => {
    expect(Object.keys(N.optionNotes(S(), glance(), iphone)).sort()).toEqual(['addRest', 'adjust', 'calories', 'effort', 'elapsed', 'heart', 'next', 'nextEx', 'pause', 'picture', 'record'])
  })

  describe('record hints', () => {
    it('clean look: only in the detailed look', () => {
      expect(N.optionNotes(S(), glance(g => { g.look = 'clean' }), plain).record).toBe('Only in the detailed look.')
    })
    it('the picture or the − and + buttons take its line', () => {
      expect(N.optionNotes(S(), glance(g => { g.show.picture = true }), plain).record).toBe(HIDDEN)
      expect(N.optionNotes(S(), glance(g => { g.buttons.adjust = true }), plain).record).toBe(HIDDEN)
    })
    it('on the Dynamic Island tab: Lock Screen only; on the Lock Screen tab of the same phone: nothing', () => {
      expect(N.optionNotes(S(), glance(), { ...iphone, surface: 'island' }).record).toBe('Lock Screen only.')
      expect(N.optionNotes(S(), glance(), { ...iphone, surface: 'lock' }).record).toBeNull()
      expect(N.optionNotes(S(), glance(), { os: null, surface: 'island' }).record).toBe('Lock Screen only.')
    })
    it('no note where the row is not there or says it itself: switched off, hints off in the profile, Android', () => {
      expect(N.optionNotes(S(), glance(g => { g.look = 'clean'; g.show.record = false }), plain).record).toBeNull()
      expect(N.optionNotes(S({ recordHints: false }), glance(g => { g.look = 'clean' }), plain).record).toBeNull()
      expect(N.optionNotes(S(), glance(g => { g.look = 'clean'; g.show.picture = true }), android).record).toBeNull()
    })
  })

  describe('buttons', () => {
    it('fits the Lock Screen but not the island: Lock Screen only', () => {
      const g = glance(x => { x.buttons.adjust = true; x.buttons.pause = true })
      expect(N.optionNotes(S(), g, iphone).pause).toBe('Lock Screen only.')
      // The same switches on an iPhone without an island: it shows, so nothing to say.
      expect(N.optionNotes(S(), g, plain).pause).toBeNull()
    })
    it('Android: Less weight and More weight take both free places, and the others say so', () => {
      const n = N.optionNotes(S(), glance(x => { x.buttons.adjust = true; x.buttons.pause = true }), android)
      expect(n.nextEx).toBe('No room on the notification.')
      expect(n.pause).toBe('No room on the notification.')
      expect(n.adjust).toBeNull()
    })
    it('a switch that is off has no note', () => {
      const n = N.optionNotes(S(), glance(x => { x.buttons.adjust = true; x.buttons.nextEx = false }), android)
      expect(n.nextEx).toBeNull()
      expect(n.pause).toBeNull()
    })
    it('+15 s is never noted on Android, where the rest card always has it', () => {
      expect(N.optionNotes(S(), glance(), android).addRest).toBeNull()
    })
  })

  describe('chips', () => {
    const three = glance(x => { x.look = 'clean'; x.show.calories = true })
    it('cut for room in the clean look (two extras): no room right now', () => {
      expect(N.optionNotes(S(), three, plain).calories).toBe('No room right now.')
      expect(N.optionNotes(S(), three, android).calories).toBe('No room right now.')
      expect(N.optionNotes(S(), glance(x => { x.show.calories = true }), plain).calories).toBeNull()
    })
    it('kept off the island by a third button, though the Lock Screen has it: Lock Screen only', () => {
      expect(N.optionNotes(S(), glance(x => { x.buttons.pause = true }), iphone).heart).toBe('Lock Screen only.')
      expect(N.optionNotes(S(), glance(x => { x.buttons.pause = true }), plain).heart).toBeNull()
    })
  })

  it('strength with its own setup: the set’s switches leave it alone, so they carry no note', () => {
    const g = glance(x => { x.look = 'clean'; x.buttons.adjust = true; x.buttons.pause = true; x.kinds.lift = { d: [], b: ['next'] } })
    const n = N.optionNotes(S(), g, android)
    expect([n.adjust, n.nextEx, n.pause, n.effort, n.record]).toEqual([null, null, null, null, null])
  })
})

describe('where the preview goes when a switch is flipped', () => {
  it('a set’s switches go to the strength set', () => {
    for (const k of ['adjust', 'nextEx', 'pause', 'effort', 'record', 'picture']) {
      expect(N.jumpFor(k, 'rest'), k).toBe('strength')
      expect(N.jumpFor(k, 'done'), k).toBe('strength')
      expect(N.jumpFor(k, 'strength'), k).toBeNull()
    }
  })
  it('a rest’s switches go to the rest', () => {
    for (const k of ['next', 'addRest']) {
      expect(N.jumpFor(k, 'strength'), k).toBe('rest')
      expect(N.jumpFor(k, 'done'), k).toBe('rest')
      expect(N.jumpFor(k, 'rest'), k).toBeNull()
    }
  })
  it('heart rate, calories and the look only leave All done', () => {
    for (const k of ['heart', 'calories', 'look']) {
      expect(N.jumpFor(k, 'done'), k).toBe('strength')
      expect(N.jumpFor(k, 'rest'), k).toBeNull()
      expect(N.jumpFor(k, 'strength'), k).toBeNull()
    }
  })
  it('time since start and the strip stay, and nothing leaves “Your workout”', () => {
    for (const m of ['strength', 'rest', 'done']) { expect(N.jumpFor('elapsed', m)).toBeNull(); expect(N.jumpFor('card', m)).toBeNull() }
    for (const k of ['adjust', 'next', 'heart', 'look', 'elapsed']) expect(N.jumpFor(k, 'live'), k).toBeNull()
  })
})

describe('Per exercise type: where a picked button fits', () => {
  const full = glance(x => { x.kinds.lift = { d: ['effort', 'record', 'partner', 'equip', 'notes'], b: [...G.KIND_BUTTONS.lift] } })
  it('comes from the real view: what is drawn has no note, what is cut says where it would fit', () => {
    const n = N.kindButtonNotes(S(), full, 'lift', iphone)
    // − and + sit beside the numbers on an iPhone and take no place in the row.
    expect([n.wDown, n.wUp, n.rDown, n.rUp, n.effort, n.next]).toEqual([null, null, null, null, null, null])
    expect(n.pause).toBe('Lock Screen only.')
    expect(n.warm).toBe('No room on the Lock Screen.')
    expect(n.addSet).toBe('No room on the Lock Screen.')
    expect(N.kindButtonNotes(S(), full, 'lift', plain).pause).toBeNull()
  })
  it('a button the profile cannot draw (no effort scale) frees its place for the next one', () => {
    const n = N.kindButtonNotes(S({ effort: 'none' }), full, 'lift', plain)
    expect(n.effort).toBeNull()
    // Warm-up is drawn now: it must not claim "No room" under a preview that shows it.
    expect(n.warm).toBeNull()
  })
  it('Android has three places, Log set included', () => {
    const n = N.kindButtonNotes(S(), full, 'lift', android)
    expect([n.wDown, n.wUp]).toEqual([null, null])
    for (const k of ['rDown', 'rUp', 'effort', 'next', 'pause', 'warm', 'addSet']) expect(n[k], k).toBe('No room on the notification.')
  })
  it('never lists Log set, which is always there', () => {
    expect('log' in N.kindButtonNotes(S(), full, 'lift', iphone)).toBe(false)
  })
})
