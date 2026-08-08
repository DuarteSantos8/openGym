import React from 'react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import Heatmap from './Heatmap.jsx'

const NOW = Date.UTC(2026, 7, 8, 12)
const DAY = 86400000

function day(offset) {
  return new Date(NOW - offset * DAY).toISOString().slice(0, 10)
}

function workout(offset, minutes, weight) {
  const start = NOW - offset * DAY
  return {
    d: day(offset), start, end: start + minutes * 60000, unit: 'kg',
    entries: [{ id: '0025', sets: [{ done: true, w: weight, r: 10, unit: 'kg' }] }]
  }
}

function cell(html, key) {
  return html.match(new RegExp(`<div class="hm-c [^"]+" title="${key}[^\"]*"`))?.[0] || ''
}

describe('Heatmap metric derivation', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => vi.useRealTimers())

  it('uses the selected metric for samples, levels, legend, and tooltip text', () => {
    const S = { unit: 'kg', workouts: [workout(1, 10, 100), workout(2, 60, 10)] }
    const time = renderToStaticMarkup(React.createElement(Heatmap, { S, metric: 'time', onDay: () => {} }))
    expect(time).toContain('Less time')
    expect(time).toContain('More time')
    expect(cell(time, day(1))).toContain('l2')
    expect(cell(time, day(2))).toContain('l4')
    expect(cell(time, day(1))).toContain('10 min')
    expect(cell(time, day(1))).not.toContain('1,000 kg')

    const volume = renderToStaticMarkup(React.createElement(Heatmap, { S, metric: 'vol', onDay: () => {} }))
    expect(volume).toContain('Less volume')
    expect(volume).toContain('More volume')
    expect(cell(volume, day(1))).toContain('l4')
    expect(cell(volume, day(2))).toContain('l2')
    expect(cell(volume, day(1))).toContain('1,000 kg')
    expect(cell(volume, day(1))).not.toContain('10 min')
  })
})
