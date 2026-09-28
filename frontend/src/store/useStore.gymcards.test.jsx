// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn(), setRemoteAuth: vi.fn() }))

import { DEF, useStore } from './useStore.js'

const clone = value => JSON.parse(JSON.stringify(value))

beforeEach(() => {
  localStorage.clear()
  useStore.setState({ S: clone(DEF), user: null, ready: false })
})

afterEach(() => {
  localStorage.clear()
  useStore.setState({ S: clone(DEF), user: null, ready: false })
})

// gymCards is plain profile data — it rides the same update()/persist() path as everything else,
// with no backend or schema change. These pin the contract the check-in view relies on: a fresh
// profile starts empty, and adding/removing a card mutates and persists like any other field.

describe('gymCards state', () => {
  it('defaults to an empty array on a fresh profile', () => {
    expect(useStore.getState().S.gymCards).toEqual([])
  })

  it('adds a card via update and persists it to localStorage', () => {
    useStore.getState().update(s => {
      s.gymCards.push({ id: 'c1', label: 'FitZone', value: 'ABC123', fmt: 'qrcode' })
    }, false)

    const cards = useStore.getState().S.gymCards
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({ id: 'c1', label: 'FitZone', value: 'ABC123', fmt: 'qrcode' })

    // persist() writes the whole state under the app's storage key — the card must be in it.
    const saved = JSON.parse(localStorage.getItem('gym_state_v1'))
    expect(saved.gymCards).toHaveLength(1)
    expect(saved.gymCards[0].value).toBe('ABC123')
  })

  it('removes a card by id, leaving the others', () => {
    useStore.getState().update(s => {
      s.gymCards.push({ id: 'a', label: 'A', value: '1', fmt: 'qrcode' })
      s.gymCards.push({ id: 'b', label: 'B', value: '2', fmt: 'qrcode' })
    }, false)

    useStore.getState().update(s => {
      s.gymCards = s.gymCards.filter(c => c.id !== 'a')
    }, false)

    const cards = useStore.getState().S.gymCards
    expect(cards).toHaveLength(1)
    expect(cards[0].id).toBe('b')
  })

  it('keeps multiple cards in insertion order', () => {
    useStore.getState().update(s => {
      s.gymCards.push({ id: '1', label: 'One', value: 'x', fmt: 'qrcode' })
      s.gymCards.push({ id: '2', label: 'Two', value: 'y', fmt: 'qrcode' })
      s.gymCards.push({ id: '3', label: 'Three', value: 'z', fmt: 'qrcode' })
    }, false)

    expect(useStore.getState().S.gymCards.map(c => c.id)).toEqual(['1', '2', '3'])
  })
})

// lastGymCardId remembers which card the check-in screen last settled on, so it reopens there.
// It is plain profile data on the same update()/persist() path; these pin the contracts the view
// relies on — a fresh default, add points it at the new card, edit-in-place touches only that
// card, and removing the remembered card falls back to the first survivor (or null when none).
describe('lastGymCardId', () => {
  it('defaults to null on a fresh profile', () => {
    expect(useStore.getState().S.lastGymCardId).toBeNull()
  })

  it('persists to localStorage like any other field', () => {
    useStore.getState().update(s => { s.lastGymCardId = 'c9' }, false)
    const saved = JSON.parse(localStorage.getItem('gym_state_v1'))
    expect(saved.lastGymCardId).toBe('c9')
  })

  it('adding a card points lastGymCardId at the new card (view contract)', () => {
    // Mirrors CardSheet's add branch: push a card and remember its id in one update.
    useStore.getState().update(s => {
      const id = 'new1'
      s.gymCards.push({ id, label: 'FitZone', value: 'ABC', fmt: 'qrcode' })
      s.lastGymCardId = id
    }, false)
    expect(useStore.getState().S.lastGymCardId).toBe('new1')
  })

  it('removing the remembered card falls back to the first survivor', () => {
    useStore.getState().update(s => {
      s.gymCards.push({ id: 'a', label: 'A', value: '1', fmt: 'qrcode' })
      s.gymCards.push({ id: 'b', label: 'B', value: '2', fmt: 'qrcode' })
      s.lastGymCardId = 'a'
    }, false)
    // Mirrors CardFace's remove: drop the card, then repoint a now-stale lastGymCardId.
    useStore.getState().update(s => {
      s.gymCards = s.gymCards.filter(c => c.id !== 'a')
      if (s.lastGymCardId === 'a') s.lastGymCardId = s.gymCards[0]?.id || null
    }, false)
    expect(useStore.getState().S.lastGymCardId).toBe('b')
  })

  it('removing the last remaining remembered card resets to null', () => {
    useStore.getState().update(s => {
      s.gymCards.push({ id: 'only', label: 'Only', value: 'x', fmt: 'qrcode' })
      s.lastGymCardId = 'only'
    }, false)
    useStore.getState().update(s => {
      s.gymCards = s.gymCards.filter(c => c.id !== 'only')
      if (s.lastGymCardId === 'only') s.lastGymCardId = s.gymCards[0]?.id || null
    }, false)
    expect(useStore.getState().S.gymCards).toEqual([])
    expect(useStore.getState().S.lastGymCardId).toBeNull()
  })
})

// Editing a card (rename / re-scan) updates that entry in place — same id, same slot, other cards
// untouched. Mirrors CardSheet's edit branch, which finds the card by id and overwrites its label
// and value only.
describe('editing a card in place', () => {
  it('updates label and value of the matching card, leaving order and siblings intact', () => {
    useStore.getState().update(s => {
      s.gymCards.push({ id: 'a', label: 'A', value: '1', fmt: 'qrcode' })
      s.gymCards.push({ id: 'b', label: 'B', value: '2', fmt: 'qrcode' })
    }, false)

    useStore.getState().update(s => {
      const c = s.gymCards.find(x => x.id === 'b')
      c.label = 'B renamed'
      c.value = 'rescanned'
    }, false)

    const cards = useStore.getState().S.gymCards
    expect(cards.map(c => c.id)).toEqual(['a', 'b'])          // order + count unchanged
    expect(cards[0]).toMatchObject({ label: 'A', value: '1' }) // sibling untouched
    expect(cards[1]).toMatchObject({ id: 'b', label: 'B renamed', value: 'rescanned', fmt: 'qrcode' })
  })
})

// The Settings switch. On by default; an older profile that predates the key must read as on
// too, and off only hides the feature — the cards themselves survive the round trip.
describe('checkIn switch', () => {
  it('is on for a fresh profile', () => {
    expect(useStore.getState().S.checkIn).toBe(true)
  })

  it('turning it off keeps the saved cards', () => {
    useStore.getState().update(s => {
      s.gymCards.push({ id: 'c1', label: 'FitZone', value: 'ABC123', fmt: 'qrcode' })
      s.checkIn = false
    }, false)
    const S = useStore.getState().S
    expect(S.checkIn).toBe(false)
    expect(S.gymCards).toHaveLength(1)
  })
})
