// Grayscale crops → black text on white, the way Tesseract reads best. Pure, no image library.
//
// Each crop gets its own threshold (Otsu's method), so a caption over a scene that brightens or
// darkens mid-video is still cut cleanly. Which side of the threshold is the text is decided by
// which side is smaller: text is thin, the background around it is not. Captions are white on a
// dark band far more often than the reverse, so a crop that is evenly split stays as it was
// read — bright text — and is inverted.

/** Otsu's threshold for 8-bit gray pixels. */
export function otsu(px) {
  const hist = new Array(256).fill(0)
  for (let i = 0; i < px.length; i++) hist[px[i]]++
  const total = px.length
  let sum = 0
  for (let i = 0; i < 256; i++) sum += i * hist[i]
  let sumB = 0, wB = 0, best = 0, threshold = 127
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (!wB) continue
    const wF = total - wB
    if (!wF) break
    sumB += t * hist[t]
    const mB = sumB / wB, mF = (sum - sumB) / wF
    const between = wB * wF * (mB - mF) * (mB - mF)
    if (between > best) { best = between; threshold = t }
  }
  return threshold
}

/** Binarised copy: text pixels 0, everything else 255. `contrast` is how far apart the classes were. */
export function binarize(px) {
  const t = otsu(px)
  let bright = 0, sumHi = 0, sumLo = 0
  for (let i = 0; i < px.length; i++) {
    if (px[i] > t) { bright++; sumHi += px[i] } else sumLo += px[i]
  }
  const dark = px.length - bright
  const textIsBright = bright <= dark
  const out = new Uint8Array(px.length)
  for (let i = 0; i < px.length; i++) {
    const hi = px[i] > t
    out[i] = hi === textIsBright ? 0 : 255
  }
  const contrast = bright && dark ? sumHi / bright - sumLo / dark : 0
  return { px: out, threshold: t, contrast, ink: (textIsBright ? bright : dark) / px.length }
}

/** A binary PGM — Tesseract (Leptonica) reads it, and it needs no encoder. */
export function pgm(px, w, h) {
  return Buffer.concat([Buffer.from(`P5\n${w} ${h}\n255\n`, 'ascii'), Buffer.from(px.buffer, px.byteOffset, px.byteLength)])
}

/** A crop with nothing on it: too little contrast, or no ink at all (or nearly all ink). */
export function blank({ contrast, ink }) {
  return contrast < 40 || ink < 0.005 || ink > 0.6
}

/** Share of pixels that differ between two binarised crops of one size (0–1). */
export function difference(a, b) {
  if (!a || !b || a.length !== b.length) return 1
  let n = 0
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++
  return n / a.length
}

/**
 * A timer crop with only its digits left: the dashes of a progress ring, a tick mark, the arc
 * that sweeps round a countdown — anything small, or anything that runs into the edge of the
 * box, goes. Digits are the tall marks in the middle. Works on binarised pixels (0 = ink).
 * If cleaning would leave no digit-sized mark at all, the crop is returned as it was: a box
 * drawn tight round the digits must not lose them for touching its edge.
 */
export function digitsOnly(px, w, h, { minHeight = 0.35 } = {}) {
  const seen = new Uint8Array(px.length)
  const keep = new Uint8Array(px.length).fill(255)
  const stack = []
  let kept = 0
  for (let start = 0; start < px.length; start++) {
    if (px[start] !== 0 || seen[start]) continue
    // One connected mark, 4-neighbourhood.
    const comp = []
    let x0 = w, y0 = h, x1 = 0, y1 = 0
    stack.push(start); seen[start] = 1
    while (stack.length) {
      const i = stack.pop()
      comp.push(i)
      const x = i % w, y = (i - x) / w
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
        if (j >= 0 && !seen[j] && px[j] === 0) { seen[j] = 1; stack.push(j) }
      }
    }
    const tall = (y1 - y0 + 1) >= h * minHeight
    const edge = x0 === 0 || y0 === 0 || x1 === w - 1 || y1 === h - 1
    if (tall && !edge) { for (const i of comp) keep[i] = 0; kept++ }
  }
  return kept ? keep : px
}

/**
 * Text in a crop as black on white, or null when nothing in it looks like text.
 *
 * Captions and timers are drawn to stand out — the brightest or the darkest marks in their box —
 * but over a sky or a light wall a threshold chosen for the whole crop picks a tree or a shadow
 * instead. So several thresholds are tried in both polarities, and the marks each leaves are
 * judged as characters: the right height for the box, solid enough to be a stroke (the thin
 * ring round a countdown is not), clear of the edges, the same height as their neighbours and
 * lined up with them. The candidate with the most such characters wins.
 *   opts.digits: a timer — 1–4 characters of one height on one line, solid strokes (not blocks).
 */
export function textMask(gray, w, h, { digits = false, both = false } = {}) {
  const sorted = Uint8Array.from(gray).sort()
  const at = q => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
  const hi = at(0.995), lo = at(0.005)
  if (hi - lo < 40) return null
  const minH = digits ? 0.15 : 0.1, maxH = digits ? 0.8 : 0.7
  let best = null
  const per = {}
  for (const bright of [true, false]) {
    // Thin digits a shade brighter than the wall behind them need a threshold close to white; on
    // a caption the same threshold breaks letters into pieces.
    for (const k of digits ? [0.04, 0.08, 0.12, 0.22, 0.32, 0.45] : [0.12, 0.22, 0.32, 0.45]) {
      const thr = bright ? hi - (hi - lo) * k : lo + (hi - lo) * k
      const ink = new Uint8Array(gray.length)
      for (let i = 0; i < gray.length; i++) ink[i] = bright ? gray[i] >= thr : gray[i] <= thr
      // A stroke is drawn to stand out from what is right round it; a patch of shadow is not.
      const standsOut = c => {
        let inside = 0, around = 0, n = 0
        for (const i of c.px) inside += gray[i]
        for (let y = Math.max(0, c.y0 - 2); y <= Math.min(h - 1, c.y1 + 2); y++) {
          for (let x = Math.max(0, c.x0 - 2); x <= Math.min(w - 1, c.x1 + 2); x++) {
            const i = y * w + x
            if (!ink[i]) { around += gray[i]; n++ }
          }
        }
        return !n || Math.abs(inside / c.n - around / n) >= 35
      }
      const chars = components(ink, w, h).filter(c => {
        const ch = c.y1 - c.y0 + 1, cw = c.x1 - c.x0 + 1
        const fill = c.n / (cw * ch)
        // A box drawn tight round a caption cuts its "p" and "g": letters may touch the top and the
        // bottom of a name's box. Digits keep clear of every edge (the ring touches them).
        const clear = digits ? c.y0 > 0 && c.y1 < h - 1 : true
        // Block digits ("8" in a heavy sports font) fill most of their box and can be as wide as
        // they are tall; a patch of shadow is told from them by its contrast (standsOut).
        return ch >= h * minH && ch <= h * maxH && cw <= ch * (digits ? 1.7 : 4) && fill >= 0.2 &&
          (!digits || fill <= 0.88) && c.x0 > 0 && c.x1 < w - 1 && clear && standsOut(c)
      })
      if (!chars.length) continue
      let line
      if (digits) {
        // Digits of one number: one height.
        const hs = chars.map(c => c.y1 - c.y0).sort((x, y) => x - y)
        line = []
        for (const ref of hs) {
          const same = chars.filter(c => Math.abs(c.y1 - c.y0 - ref) <= Math.max(2, ref * 0.3))
          if (same.length > line.length) line = same
        }
      } else {
        // Letters of a caption: about one size (a "q" or a "g" reaches below the others, a dot of
        // dust does not reach the middle), on lines of their own.
        const m = median(chars.map(c => c.y1 - c.y0))
        const sized = chars.filter(c => c.y1 - c.y0 >= m * 0.45 && c.y1 - c.y0 <= m * 1.8)
        const rows = []
        for (const c of sized.sort((a, b) => a.y0 - b.y0)) {
          const row = rows.find(r => c.y0 < r.y1 - m * 0.3 && c.y1 > r.y0 + m * 0.3)
          if (row) { row.list.push(c); row.y0 = Math.min(row.y0, c.y0); row.y1 = Math.max(row.y1, c.y1) } else rows.push({ y0: c.y0, y1: c.y1, list: [c] })
        }
        line = rows.filter(r => r.list.length >= 2).flatMap(r => r.list)
      }
      if (digits) {
        const cy = line.map(c => (c.y0 + c.y1) / 2)
        const ref = line[0] ? line[0].y1 - line[0].y0 : 0
        line = line.filter((c, i) => Math.abs(cy[i] - median(cy)) <= ref * 0.3)
        if (!line.length || line.length > 4) continue
      } else if (line.length < 2) continue
      const score = Math.min(line.length, digits ? 3 : 40) * 10 + line.reduce((t, c) => t + c.n, 0) / gray.length
      if (!best || score > best.score) best = { score, line }
      if (!per[bright] || score > per[bright].score) per[bright] = { score, line }
    }
  }
  const paint = b => {
    const out = new Uint8Array(gray.length).fill(255)
    for (const c of b.line) for (const i of c.px) out[i] = 0
    return out
  }
  // both: the best candidate of each polarity, best first — light digits on a dark ring, or dark
  // digits on a light floor, and only the count they read can tell which was the number.
  if (both) return [per.true, per.false].filter(Boolean).sort((a, b) => b.score - a.score).map(paint)
  return best ? paint(best) : null
}

/** The timer's digits (see textMask). */
export const timerMask = (gray, w, h) => textMask(gray, w, h, { digits: true })
/** Up to two readings of a timer crop, one per polarity, best first. */
export const timerMasks = (gray, w, h) => textMask(gray, w, h, { digits: true, both: true }) || []

const median = a => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0 }

/** Connected marks (4-neighbourhood) of a 0/1 mask: { x0, y0, x1, y1, n, px }. */
function components(ink, w, h) {
  const seen = new Uint8Array(ink.length)
  const out = []
  const stack = []
  for (let s = 0; s < ink.length; s++) {
    if (!ink[s] || seen[s]) continue
    const c = { x0: w, y0: h, x1: 0, y1: 0, n: 0, px: [] }
    seen[s] = 1; stack.push(s)
    while (stack.length) {
      const i = stack.pop()
      c.px.push(i); c.n++
      const x = i % w, y = (i - x) / w
      if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y
      if (x > 0 && ink[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack.push(i - 1) }
      if (x < w - 1 && ink[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack.push(i + 1) }
      if (y > 0 && ink[i - w] && !seen[i - w]) { seen[i - w] = 1; stack.push(i - w) }
      if (y < h - 1 && ink[i + w] && !seen[i + w]) { seen[i + w] = 1; stack.push(i + w) }
    }
    out.push(c)
  }
  return out
}

/**
 * A mask cut down to its ink with a white margin round it: Tesseract reads a number that fills
 * its picture far better than one lost in the middle of a wide box. { px, w, h } or the input
 * as it was when there is no ink.
 */
export function tightCrop(px, w, h, pad = 10) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let i = 0; i < px.length; i++) {
    if (px[i] !== 0) continue
    const x = i % w, y = (i - x) / w
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y
  }
  if (x1 < 0) return { px, w, h }
  const W = x1 - x0 + 1 + 2 * pad, H = y1 - y0 + 1 + 2 * pad
  const out = new Uint8Array(W * H).fill(255)
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out[(y - y0 + pad) * W + (x - x0 + pad)] = px[y * w + x]
  return { px: out, w: W, h: H }
}
