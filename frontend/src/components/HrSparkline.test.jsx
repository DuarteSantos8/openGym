// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import HrSparkline from './HrSparkline.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let container
let root
beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const points = () => container.querySelector('polyline').getAttribute('points').trim().split(/\s+/).map(p => p.split(',').map(Number))

describe('HrSparkline', () => {
  it('draws one point per sample, the peak at the top and the low at the bottom', () => {
    const hr = { avg: 130, max: 170, min: 90, n: 4, s: [[0, 90], [60, 130], [120, 170], [180, 130]] }
    act(() => root.render(<HrSparkline hr={hr} />))
    const svg = container.querySelector('svg')
    expect(svg.getAttribute('role')).toBe('img')
    expect(svg.getAttribute('aria-label')).toBe('130 avg · 170 max')
    expect(svg.getAttribute('height')).toBe('40')
    const pts = points()
    expect(pts).toHaveLength(4)
    expect(pts[0][0]).toBe(0)
    expect(pts[3][0]).toBe(300)
    expect(pts[0][1]).toBe(36)
    expect(pts[2][1]).toBe(4)
  })

  it('draws a flat line for a single reading, and nothing without a summary', () => {
    act(() => root.render(<HrSparkline hr={{ avg: 100, max: 100, min: 100, n: 1, s: [[30, 100]] }} />))
    expect(points()).toHaveLength(2)
    expect(new Set(points().map(p => p[1])).size).toBe(1)
    act(() => root.render(<HrSparkline hr={null} />))
    expect(container.querySelector('svg')).toBeNull()
  })
})
