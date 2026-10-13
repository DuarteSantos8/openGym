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
