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
 * A timer crop as black digits on white, or null when no digits stand out.
 *
 * A timer is the brightest (or darkest) thing in its box: white digits over a wall that is
 * nearly as light defeats a threshold chosen for the whole crop, but not one taken just under the
 * brightest pixels. Both polarities are tried; each keeps only marks the size of a digit — taller
 * than a third of the box, shorter than nearly all of it (the ring round a countdown is), clear
 * of the edges — and the one that leaves 1–3 such marks of one height, side by side, wins.
 */
export function timerMask(gray, w, h) {
  const sorted = Uint8Array.from(gray).sort()
  const at = q => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
  let best = null
  for (const bright of [true, false]) {
    const hi = at(0.995), lo = at(0.005)
    if (hi - lo < 40) continue
    const thr = bright ? hi - Math.max(20, (hi - lo) * 0.18) : lo + Math.max(20, (hi - lo) * 0.18)
    const ink = new Uint8Array(gray.length)
    for (let i = 0; i < gray.length; i++) ink[i] = bright ? gray[i] >= thr : gray[i] <= thr
    const comps = components(ink, w, h).filter(c => {
      const ch = c.y1 - c.y0 + 1, cw = c.x1 - c.x0 + 1
      return ch >= h * 0.3 && ch <= h * 0.8 && cw <= ch * 1.1 && c.x0 > 0 && c.y0 > 0 && c.x1 < w - 1 && c.y1 < h - 1 && c.n >= ch * 2
    })
    // Digits of one number: one height, one line.
    const hs = comps.map(c => c.y1 - c.y0)
    const mid = hs.slice().sort((a, b) => a - b)[hs.length >> 1]
    const line = comps.filter(c => Math.abs(c.y1 - c.y0 - mid) <= mid * 0.25)
    if (!line.length || line.length > 4) continue
    const cy = line.map(c => (c.y0 + c.y1) / 2)
    if (Math.max(...cy) - Math.min(...cy) > mid * 0.3) continue
    const score = Math.min(line.length, 3) * 10 + line.reduce((t, c) => t + c.n, 0) / gray.length
    if (!best || score > best.score) best = { score, line }
  }
  if (!best) return null
  const out = new Uint8Array(gray.length).fill(255)
  for (const c of best.line) for (const i of c.px) out[i] = 0
  return out
}

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
