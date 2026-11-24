import { describe, expect, it } from 'vitest'
import { PAGES, arrange, cardState, groupHidden, isCustom, layoutOf, moveCard, orderedCards, placeCard, resetLayout, setCardState, dismissedNote } from './page-layout.js'

const ids = page => PAGES[page].map(c => c.id)

describe('page layout (Home and Stats, #1119)', () => {
  it('nothing stored is the page as it always was', () => {
    expect(arrange({}, 'home', ids('home'))).toEqual(ids('home'))
    expect(arrange({ layout: 'junk' }, 'stats', ids('stats'))).toEqual(ids('stats'))
    expect(isCustom({}, 'home')).toBe(false)
  })

  it('hides and folds a card, and a hidden card is not also folded', () => {
    const s = {}
    setCardState(s, 'home', 'deload', 'hidden')
    setCardState(s, 'home', 'streak', 'folded')
    expect(cardState(s, 'home', 'deload')).toBe('hidden')
    expect(cardState(s, 'home', 'streak')).toBe('folded')
    expect(arrange(s, 'home', ids('home'))).not.toContain('deload')
    setCardState(s, 'home', 'streak', 'hidden')
    expect(layoutOf(s, 'home').folded).toEqual([])
    setCardState(s, 'home', 'streak', 'shown')
    expect(cardState(s, 'home', 'streak')).toBe('shown')
  })

  it('only draws the cards the view can draw right now', () => {
    expect(arrange({}, 'home', ['streak', 'recap'])).toEqual(['recap', 'streak'])
  })

  it('moves a card among its neighbours and stops at the edge', () => {
    const s = {}
    expect(moveCard(s, 'home', 'streak', -1)).toBe(true)
    expect(arrange(s, 'home', ids('home')).slice(-2)).toEqual(['streak', 'bodyweight'])
    expect(moveCard(s, 'home', 'recap', -1)).toBe(false)
  })

  it('on Stats a card stays inside its own part', () => {
    const s = {}
    expect(moveCard(s, 'stats', 'recent', 1)).toBe(false) // last of Overview
    expect(moveCard(s, 'stats', 'bodyweight', -1)).toBe(false) // alone in Body
    expect(moveCard(s, 'stats', 'muscles', -1)).toBe(true)
    const lifts = orderedCards(s, 'stats').filter(c => c.group === 'lifts').map(c => c.id)
    expect(lifts).toEqual(['muscles', 'progress', 'strength'])
    const groups = orderedCards(s, 'stats').map(c => c.group)
    expect(groups).toEqual([...groups].sort((a, b) => ['overview', 'body', 'lifts', 'effort'].indexOf(a) - ['overview', 'body', 'lifts', 'effort'].indexOf(b)))
  })

  it('a card that is new in a later version keeps its built-in place in a stored order', () => {
    const s = { layout: { home: { order: ['streak', 'recap', 'deload'] } } }
    const got = orderedCards(s, 'home').map(c => c.id)
    expect(got.slice(0, 2)).toEqual(['streak', 'recap'])
    expect(got).toHaveLength(ids('home').length)
    expect(got.indexOf('recovery')).toBe(got.indexOf('recap') + 1)
  })

  it('ignores ids it does not know', () => {
    const s = { layout: { home: { order: ['nope', 'streak'], hidden: ['ghost'], folded: [7] } } }
    expect(layoutOf(s, 'home')).toEqual({ order: ['streak'], hidden: [], folded: [] })
  })

  it('the old body weight switch and the layout are one setting', () => {
    const s = { showWeightCard: false }
    expect(cardState(s, 'home', 'bodyweight')).toBe('hidden')
    setCardState(s, 'home', 'bodyweight', 'shown')
    expect(s.showWeightCard).toBe(true)
    setCardState(s, 'home', 'bodyweight', 'hidden')
    expect(s.showWeightCard).toBe(false)
    expect(layoutOf(s, 'home').hidden).toEqual(['bodyweight'])
  })

  it('a part of Stats with every card hidden is gone, and reset brings everything back', () => {
    const s = {}
    setCardState(s, 'stats', 'effort', 'hidden')
    expect(groupHidden(s, 'stats', 'effort')).toBe(false)
    setCardState(s, 'stats', 'time', 'hidden')
    expect(groupHidden(s, 'stats', 'effort')).toBe(true)
    setCardState(s, 'home', 'bodyweight', 'hidden')
    resetLayout(s, 'stats'); resetLayout(s, 'home')
    expect(isCustom(s, 'stats')).toBe(false)
    expect(s.showWeightCard).toBe(true)
    expect(arrange(s, 'stats', ids('stats'))).toEqual(ids('stats'))
  })
})

describe('placeCard (a drag in the Customize sheet)', () => {
  it('puts a card after the one it was dropped on going down, before it going up', () => {
    const s = {}
    expect(placeCard(s, 'home', 'recap', 'challenges')).toBe(true)
    expect(orderedCards(s, 'home').map(c => c.id).slice(0, 4)).toEqual(['recovery', 'deload', 'challenges', 'recap'])
    expect(placeCard(s, 'home', 'streak', 'recovery')).toBe(true)
    expect(orderedCards(s, 'home').map(c => c.id)[0]).toBe('streak')
    expect(placeCard(s, 'home', 'streak', 'streak')).toBe(false)
    expect(placeCard(s, 'home', 'nope', 'streak')).toBe(false)
  })
})

describe('cards put away with their own × (Discord 2026-11-20)', () => {
  const now = new Date(2026, 10, 24, 12)
  it('says until when, and Show brings the challenges and the recovery tip back', () => {
    const s = { challengesHidden: '2026-11', recoveryHintDay: '2026-11-24' }
    expect(dismissedNote(s, 'home', 'challenges', now)).toBe('Hidden until next month.')
    expect(dismissedNote(s, 'home', 'recovery', now)).toBe('Hidden for today. Back tomorrow.')
    setCardState(s, 'home', 'challenges', 'shown')
    expect(dismissedNote(s, 'home', 'challenges', now)).toBe(null)
    expect(s.recoveryHintDay).toBe('2026-11-24')
    setCardState(s, 'home', 'recovery', 'folded')
    expect(dismissedNote(s, 'home', 'recovery', now)).toBe(null)
  })
  it('an old dismissal is no note, Hide keeps it, and Reset clears it', () => {
    expect(dismissedNote({ challengesHidden: '2026-10' }, 'home', 'challenges', now)).toBe(null)
    const s = { challengesHidden: '2026-11' }
    setCardState(s, 'home', 'challenges', 'hidden')
    expect(s.challengesHidden).toBe('2026-11')
    resetLayout(s, 'home')
    expect(s.challengesHidden).toBe(null)
    expect(dismissedNote({ challengesHidden: '2026-11' }, 'stats', 'challenges', now)).toBe(null)
  })
})
