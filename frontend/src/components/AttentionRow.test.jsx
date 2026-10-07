// @vitest-environment happy-dom
// AttentionRow is shared by Home's Strength card and Stats' weekly review so the two
// screens never word the same signal differently.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import AttentionRow from './AttentionRow.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host, root
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const render = (a, altNames) => act(() => root.render(<AttentionRow a={a} altNames={altNames} />))

describe('AttentionRow', () => {
  it('words a stalling run with its evidence and alternative', () => {
    render({ id: 'x', name: 'Bench', kind: 'stalling', stalls: 2 }, ['Incline press'])
    const text = host.textContent
    expect(text).toContain('Bench')
    expect(text).toContain('Missed the target 2 sessions running.')
    expect(text).toContain('Try: Incline press.')
    expect(text).toContain('Stalled')
  })

  it('words a skipped movement with its window', () => {
    render({ id: 'x', name: 'Curl', kind: 'skipped', days: 30, workouts: 5 }, [])
    expect(host.textContent).toContain('No completed sets in the last 30 days, across 5 workouts.')
    expect(host.textContent).toContain('Skipped')
    expect(host.textContent).not.toContain('Try:')
  })

  it('words an equipment mismatch', () => {
    render({ id: 'x', name: 'Lat pulldown', kind: 'equipment', eq: 'cable' }, [])
    expect(host.textContent).toContain('Needs cable')
    expect(host.textContent).toContain('Equipment')
  })
})
