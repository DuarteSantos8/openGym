import { describe, expect, it } from 'vitest'
import { A4_MM, PX_PER_MM, drawExerciseSheet, iosHomeScreenApp, jpegPdf, wrapText } from './print-sheet.js'

const measure = s => s.length * 10   // 10 px per character

describe('wrapText', () => {
  it('breaks by words to fit the width', () => {
    expect(wrapText('one two three four', 100, measure)).toEqual(['one two', 'three four'])
    expect(wrapText('one two three four', 90, measure)).toEqual(['one two', 'three', 'four'])
  })
  it('keeps paragraphs apart and breaks a word longer than a line', () => {
    expect(wrapText('ab\ncdefghij', 40, measure)).toEqual(['ab', 'cdef', 'ghij'])
  })
  it('is empty for nothing', () => {
    expect(wrapText('', 100, measure)).toEqual([])
    expect(wrapText(null, 100, measure)).toEqual([])
  })
})

describe('iosHomeScreenApp', () => {
  it('is the home-screen app on iOS only', () => {
    expect(iosHomeScreenApp({ standalone: true })).toBe(true)
    expect(iosHomeScreenApp({ standalone: false })).toBe(false)
    expect(iosHomeScreenApp({})).toBe(false)
    expect(iosHomeScreenApp(undefined)).toBe(false)
  })
})

// A canvas context that records what is drawn.
function fakeCtx() {
  const calls = []
  return {
    calls,
    fillRect: (...a) => calls.push(['fillRect', ...a]),
    fillText: (t, x, y) => calls.push(['fillText', t, x, y]),
    drawImage: (img, x, y, w, h) => calls.push(['drawImage', img.id, x, y, w, h]),
    measureText: s => ({ width: s.length * 20 }),
    set font(v) { calls.push(['font', v]) },
    set fillStyle(v) {}, set textAlign(v) {}, set textBaseline(v) {}, set direction(v) {},
    set imageSmoothingEnabled(v) { calls.push(['smoothing', v]) },
  }
}
const texts = ctx => ctx.calls.filter(c => c[0] === 'fillText').map(c => c[1])

describe('drawExerciseSheet', () => {
  const qr = { id: 'qr', width: 33, height: 33 }

  it('draws the code at exactly 3 × 3 cm, top right, without smoothing', () => {
    const ctx = fakeCtx()
    const out = drawExerciseSheet(ctx, { name: 'Bench Press', qr, labels: { caption: 'Scan me' } })
    const mm30 = Math.round(30 * PX_PER_MM)
    expect(out.qr.size).toBe(mm30)
    expect(out.qr.size / PX_PER_MM).toBeCloseTo(30, 0)
    expect(out.width).toBe(Math.round(A4_MM.w * PX_PER_MM))
    expect(out.qr.x + mm30).toBe(out.width - Math.round(15 * PX_PER_MM))
    const draw = ctx.calls.find(c => c[0] === 'drawImage' && c[1] === 'qr')
    expect(draw.slice(4)).toEqual([mm30, mm30])
    const i = ctx.calls.indexOf(draw)
    expect(ctx.calls[i - 1]).toEqual(['smoothing', false])
  })

  it('writes the name, tags, description and numbered steps, and the picture', () => {
    const ctx = fakeCtx()
    drawExerciseSheet(ctx, {
      name: 'Bench', tags: ['Chest', 'Barbell'], description: 'Press it.', steps: ['Lie down.', 'Press.'],
      qr, picture: { id: 'pic', width: 400, height: 300 }, labels: { caption: 'Scan', howTo: 'How to' },
    })
    expect(texts(ctx)).toEqual(expect.arrayContaining(['OPENGYM', 'Bench', 'Chest · Barbell', 'Press it.', 'HOW TO', '1. Lie down.', '2. Press.', 'Scan']))
    const pic = ctx.calls.find(c => c[0] === 'drawImage' && c[1] === 'pic')
    // At most 90 × 95 mm, keeping its shape.
    expect(pic[4] / PX_PER_MM).toBeLessThanOrEqual(90.1)
    expect(pic[4] / pic[5]).toBeCloseTo(4 / 3, 1)
  })

  it('capitalises the tags word by word', () => {
    const ctx = fakeCtx()
    drawExerciseSheet(ctx, { name: 'Bench', qr, tags: ['full body', 'body weight', 'Quads'] })
    expect(texts(ctx)).toContain('Full Body · Body Weight · Quads')
  })

  it('leaves out what is not there', () => {
    const ctx = fakeCtx()
    drawExerciseSheet(ctx, { name: 'Bench', qr })
    expect(ctx.calls.some(c => c[0] === 'drawImage' && c[1] === 'pic')).toBe(false)
    expect(texts(ctx)).not.toContain('HOW TO')
  })

  it('stops at the bottom margin with "…"', () => {
    const ctx = fakeCtx()
    const steps = Array.from({ length: 200 }, (_, i) => 'step number ' + i)
    drawExerciseSheet(ctx, { name: 'Bench', qr, steps, labels: { howTo: 'How to' } })
    const ys = ctx.calls.filter(c => c[0] === 'fillText').map(c => c[3])
    const bottom = Math.round(A4_MM.h * PX_PER_MM) - Math.round(15 * PX_PER_MM)
    expect(Math.max(...ys)).toBeLessThan(bottom)
    expect(texts(ctx).some(t => t.endsWith(' …'))).toBe(true)
  })
})

describe('jpegPdf', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9])
  const pdf = jpegPdf(jpeg, 1654, 2339)
  const text = new TextDecoder('latin1').decode(pdf)

  it('is one A4 page showing the picture over all of it', () => {
    expect(text.startsWith('%PDF-1.4')).toBe(true)
    expect(text).toContain('/MediaBox [0 0 595.28 841.89]')
    expect(text).toContain('/Width 1654 /Height 2339')
    expect(text).toContain('/Filter /DCTDecode /Length 7')
    expect(text).toContain('q 595.28 0 0 841.89 0 0 cm /Im0 Do Q')
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true)
  })

  it('carries the JPEG bytes unchanged', () => {
    const at = text.indexOf('stream\n', text.indexOf('/DCTDecode')) + 'stream\n'.length
    expect([...pdf.slice(at, at + jpeg.length)]).toEqual([...jpeg])
  })

  it('has a cross-reference table that points at every object', () => {
    const xrefAt = Number(text.match(/startxref\n(\d+)/)[1])
    expect(text.slice(xrefAt, xrefAt + 4)).toBe('xref')
    const rows = text.slice(xrefAt).split('\n').slice(3, 8)
    rows.forEach((row, i) => {
      const off = Number(row.slice(0, 10))
      expect(text.slice(off, off + 8)).toBe(`${i + 1} 0 obj\n`)
    })
  })
})
