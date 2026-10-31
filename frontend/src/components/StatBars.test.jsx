// @vitest-environment happy-dom
// The one bar system of Stats: a BarRow (fill, target band, plan tick, value), a StackBar (one
// 100% bar, its key carrying every figure) and the legend whose swatches are the marks.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BarRow, StackBar, ChartLegend } from './StatBars.jsx'

let host, root
beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })
const render = el => act(() => root.render(el))

describe('BarRow', () => {
  it('places the fill, the band and the tick on the row scale, from the inline start', () => {
    render(<BarRow label="Chest" value="8 / 10–20" fill={0.4} band={[0.5, 1]} tick={0.6} tone="below" ariaLabel="Chest: 8 sets" />)
    const row = host.querySelector('.sbar-row')
    expect(row.className).toBe('sbar-row below')
    expect(row.getAttribute('role')).toBe('group')
    expect(row.getAttribute('aria-label')).toBe('Chest: 8 sets')
    expect(row.querySelector('.sbar-f').style.width).toBe('40%')
    expect(row.querySelector('.sbar-band').style.insetInlineStart).toBe('50%')
    expect(row.querySelector('.sbar-band').style.width).toBe('50%')
    expect(row.querySelector('.sbar-tick').style.insetInlineStart).toBe('calc(60% - 1px)')
    expect(row.querySelector('.sbar-t').getAttribute('aria-hidden')).toBe('true')
    expect(row.querySelector('.sbar-v').textContent).toBe('8 / 10–20')
  })
  it('clamps the fill, draws no band or tick unless asked', () => {
    render(<BarRow label="Forearms" value="2" fill={1.7} />)
    expect(host.querySelector('.sbar-f').style.width).toBe('100%')
    expect(host.querySelector('.sbar-band')).toBeNull()
    expect(host.querySelector('.sbar-tick')).toBeNull()
  })
  it('is a button, by keyboard too, when it opens something', () => {
    const open = vi.fn()
    render(<BarRow label="Bench" value="8 min" fill={1} onClick={open} />)
    const row = host.querySelector('.sbar-row')
    expect(row.getAttribute('role')).toBe('button')
    expect(row.tabIndex).toBe(0)
    expect(row.classList.contains('tap')).toBe(true)
    act(() => row.click())
    act(() => row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(open).toHaveBeenCalledTimes(2)
  })
})

describe('StackBar', () => {
  const parts = [
    { key: 0, label: 'RIR 0', n: 3, share: 0.75, color: 'var(--gold-ink)', opacity: 1 },
    { key: 1, label: 'RIR 1', n: 1, share: 0.25, color: 'var(--gold-ink)', opacity: 0.72 },
    { key: 4, label: 'RIR 4+', n: 0, share: 0, color: 'var(--label-3)' },
  ]
  it('draws only the parts with a share, sized by it, and says every part in words', () => {
    render(<StackBar parts={parts} ariaLabel="Where the sets land" fmtValue={p => (p.n ? p.n + ' · ' + Math.round(p.share * 100) + '%' : '–')} />)
    const segs = host.querySelectorAll('.sstack-bar > span')
    expect(segs).toHaveLength(2)
    expect(segs[0].style.flexGrow).toBe('0.75')
    expect(segs[1].style.opacity).toBe('0.72')
    expect(host.querySelector('.sstack-bar').getAttribute('aria-label')).toBe('Where the sets land: RIR 0 3 · 75%, RIR 1 1 · 25%, RIR 4+ –')
    const key = [...host.querySelectorAll('.sstack-legend li')]
    expect(key.map(li => li.textContent)).toEqual(['RIR 03 · 75%', 'RIR 11 · 25%', 'RIR 4+–'])
    expect(key[2].classList.contains('muted')).toBe(true)
    expect(key[1].querySelector('.slegend-m').style.opacity).toBe('0.72')
  })
})

describe('ChartLegend', () => {
  it('draws each swatch as its mark', () => {
    render(<ChartLegend items={[{ key: 'r', mark: 'band', label: 'Target range' }, { key: 'p', mark: 'tick', label: 'Planned' }, { key: 1, mark: 'dot', color: 'var(--blue)', label: 'Set 1' }]} />)
    const marks = [...host.querySelectorAll('.slegend-m')]
    expect(marks.map(m => m.className)).toEqual(['slegend-m band', 'slegend-m tick', 'slegend-m dot'])
    expect(marks.every(m => m.getAttribute('aria-hidden') === 'true')).toBe(true)
    expect(marks[2].style.getPropertyValue('--m')).toBe('var(--blue)')
  })
})
