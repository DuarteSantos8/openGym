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
