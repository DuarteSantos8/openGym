import { describe, it, expect } from 'vitest'
import RAW from './body-paths.js'
import GEO, { BODY_SPLIT, regionLevel } from './body-geometry.js'
import { MUSCLES } from './muscles.js'

// The vertical extent of an SVG path, read off its coordinates (enough to tell a lat from a
// rhomboid: the lats are the paths that reach down to the waist).
function heightOf(d) {
  let p = 0, x = 0, y = 0, sx = 0, sy = 0, cmd = '', lo = Infinity, hi = -Infinity
  const ws = () => { while (p < d.length && /[\s,]/.test(d[p])) p++ }
  const num = () => { ws(); const m = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?/i.exec(d.slice(p)); p += m[0].length; return parseFloat(m[0]) }
  const flag = () => { ws(); return +d[p++] }
  const N = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 }
  const at = py => { lo = Math.min(lo, py); hi = Math.max(hi, py) }
  for (;;) {
    ws(); if (p >= d.length) break
    if (/[a-zA-Z]/.test(d[p])) cmd = d[p++]
    const lc = cmd.toLowerCase(), rel = cmd !== cmd.toUpperCase()
    if (lc === 'z') { x = sx; y = sy; continue }
    const a = []; for (let k = 0; k < N[lc]; k++) a.push(lc === 'a' && (k === 3 || k === 4) ? flag() : num())
    if (lc === 'h') x = rel ? x + a[0] : a[0]
    else if (lc === 'v') y = rel ? y + a[0] : a[0]
    else if (lc === 'a') { x = rel ? x + a[5] : a[5]; y = rel ? y + a[6] : a[6] }
    else { for (let k = 1; k < a.length - 2; k += 2) at(rel ? y + a[k] : a[k]); x = rel ? x + a[a.length - 2] : a[a.length - 2]; y = rel ? y + a[a.length - 1] : a[a.length - 1] }
    at(y)
    if (lc === 'm') { sx = x; sy = y; cmd = rel ? 'l' : 'L' }
  }
  return hi - lo
}

describe('the split body map', () => {
  it('keeps every path: nothing is lost or drawn twice', () => {
    for (const body of ['male', 'female']) for (const side of ['front', 'back']) {
      const raw = Object.values(RAW[body][side].p).flat().sort()
      const geo = Object.values(GEO[body][side].p).flat().sort()
      expect(geo).toEqual(raw)
      expect(GEO[body][side].p.deltoids).toBeUndefined()
    }
  })

  it('draws the lats as the tall paths of the back, the upper back as the small ones', () => {
    for (const body of ['male', 'female']) {
      const v = GEO[body].back.p
      expect(v.lats.length).toBe(2)
      for (const d of v.lats) expect(heightOf(d)).toBeGreaterThan(150)
      for (const d of v['upper-back']) expect(heightOf(d)).toBeLessThan(100)
    }
    expect(Object.keys(BODY_SPLIT)).toEqual(['male', 'female'])
  })

  it('draws every shoulder head somewhere, and only muscles the model knows', () => {
    const drawn = new Set()
    for (const body of ['male', 'female']) for (const side of ['front', 'back']) Object.keys(GEO[body][side].p).forEach(k => drawn.add(k))
    for (const m of ['front-delts', 'side-delts', 'rear-delts', 'lats', 'upper-back']) expect(drawn.has(m)).toBe(true)
    for (const k of drawn) if (!['head', 'hair', 'neck', 'hands', 'feet', 'knees', 'ankles'].includes(k)) expect(MUSCLES).toContain(k)
  })

  it('shades a shoulder with the side head where the view has no side head of its own', () => {
    const lv = { 'side-delts': 4, 'front-delts': 1, 'rear-delts': 0 }
    expect(regionLevel(lv, 'front-delts', GEO.male.front)).toBe(4)
    expect(regionLevel(lv, 'rear-delts', GEO.male.back)).toBe(4)
    // The female front draws the side head itself.
    expect(regionLevel(lv, 'front-delts', GEO.female.front)).toBe(1)
    expect(regionLevel(lv, 'side-delts', GEO.female.front)).toBe(4)
    expect(regionLevel({}, 'chest', GEO.male.front)).toBe(0)
  })
})
