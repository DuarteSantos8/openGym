// @vitest-environment happy-dom
// The line under a review change: the app's own numbers (as stored) and the studies behind the tag.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import EvidenceLine from './EvidenceLine.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function render(change) {
  const host = document.createElement('div')
  const root = createRoot(host)
  act(() => root.render(<EvidenceLine change={change} />))
  return host
}

describe('EvidenceLine', () => {
  it('volume: stored numbers, the study and a link to the tag', () => {
    const h = render({ ref: 'volume', refCheck: { id: 'volume-low:lats', muscle: 'lats', sets: 6, low: 10, high: 20 } })
    expect(h.textContent).toContain('Lats: 6 sets a week, your range 10 to 20')
    expect(h.textContent).toContain('Schoenfeld 2017')
    expect(h.querySelector('a').getAttribute('href')).toMatch(/docs\/COACH_EVIDENCE\.md#volume$/)
  })
  it('volume-cap shows the stored numbers too', () => {
    expect(render({ ref: 'volume-cap', refCheck: { id: 'volume-high:chest', muscle: 'chest', sets: 24, low: 10, high: 20 } }).textContent).toContain('Chest: 24 sets a week, your range 10 to 20')
  })
  it('sets-per-exercise names our rule', () => {
    expect(render({ ref: 'sets-per-exercise' }).textContent).toContain('Krieger 2010, our rule')
  })
  it('frequency and sets-per-exercise', () => {
    expect(render({ ref: 'frequency', refCheck: { muscle: 'chest', sessions: 1 } }).textContent).toContain('Chest: trained in one session a week')
    expect(render({ ref: 'sets-per-exercise', refCheck: { routine: 'A', exercise: 'x', sets: 5, cap: 4 } }).textContent).toContain('5 sets on this exercise')
  })
  it('no refCheck: only the sources', () => {
    const h = render({ ref: 'progression' })
    expect(h.textContent).toContain('Based on Plotkin 2022, Chaves 2024')
    expect(h.textContent).not.toContain('sets a week')
  })
  it('our rule shows as the words, not an author', () => {
    expect(render({ ref: 'volume-cap' }).textContent).toContain('Baz-Valle 2022, our rule')
  })
  it('an unknown or missing ref renders nothing', () => {
    expect(render({ ref: 'nope' }).innerHTML).toBe('')
    expect(render({}).innerHTML).toBe('')
  })
})
