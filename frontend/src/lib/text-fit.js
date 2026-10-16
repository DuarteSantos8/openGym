import { useLayoutEffect, useState } from 'react'

// Text that has to fit a box it cannot grow: the search pill's placeholder and a sub-page's title.
// Both are measured in the element's own font on a canvas, again whenever the box is resized and
// whenever the text changes (a locale change). Where nothing can measure (no canvas), each falls
// back to what fits by design.

const px = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0 }
// The computed `font` shorthand is empty where it cannot say everything (font-variant-numeric).
const fontOf = (cs, size) => `${cs.fontStyle} ${cs.fontWeight} ${size ?? cs.fontSize} ${cs.fontFamily}`

function canvas2d() {
  try { return document.createElement('canvas').getContext('2d') } catch { return null }
}

/** A function measuring `text` in `el`'s font (at `size` px if given), letter spacing included, or null. */
export function textMeasurer(el) {
  const ctx = canvas2d()
  if (!ctx) return null
  return (text, size) => {
    const cs = getComputedStyle(el)
    const current = px(cs.fontSize) || 16
    ctx.font = fontOf(cs, size != null ? size + 'px' : undefined)
    // letter spacing scales with the size it is given in em
    const spacing = px(cs.letterSpacing) * ((size ?? current) / current)
    return ctx.measureText(text).width + spacing * [...text].length
  }
}

/** Whether the long string fits `width`. */
export const longFits = (long, width, measure) => measure(long) <= width

// --- the search pill's placeholder: the long one where it fits, else the short one ---

export function usePlaceholderFit(ref, long, short) {
  const [fits, setFits] = useState(long === short)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || long === short) { setFits(true); return undefined }
    const measure = textMeasurer(el)
    if (!measure) { setFits(false); return undefined }
    const check = () => setFits(longFits(long, el.clientWidth, measure))
    check()
    if (typeof ResizeObserver !== 'function') return undefined
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref, long, short])
  return fits ? long : short
}

// --- a sub-page's title: a step smaller where its longest word would break ---

// The title's sizes (ui-kit.css --fs-title2, --fs-title3, --fs-body), largest first.
export const TITLE_SIZES = [22, 20, 17]

/**
 * The index of the largest size in TITLE_SIZES at which `text` keeps every word whole in `room`
 * px and needs at most two lines; the smallest when none does. `measure(text, size)` is
 * textMeasurer's.
 */
export function titleStep(text, room, measure) {
  const words = text.split(/\s+/).filter(Boolean)
  for (let i = 0; i < TITLE_SIZES.length; i++) {
    const size = TITLE_SIZES[i]
    const widest = Math.max(0, ...words.map(w => measure(w, size)))
    // two balanced lines lose a little to where the break falls
    if (widest <= room && measure(text, size) <= room * 2 * 0.9) return i
  }
  return TITLE_SIZES.length - 1
}

/**
 * The step for `text` in the h1 `ref` points at, inside a SubHeader: the room is what the bar
 * leaves between back and the actions at their own widths (the title's column at its widest),
 * so the answer never depends on the size it picked.
 */
export function useTitleFit(ref, text) {
  const [step, setStep] = useState(0)
  useLayoutEffect(() => {
    const h1 = ref.current
    const bar = h1?.closest('.sub-hdr')
    if (!h1 || !bar || typeof text !== 'string') { setStep(0); return undefined }
    const measure = textMeasurer(h1)
    if (!measure) { setStep(0); return undefined }
    const check = () => {
      const cs = getComputedStyle(bar)
      const sides = [...bar.children].filter(c => !c.classList.contains('sub-hdr-t'))
      const room = bar.clientWidth - px(cs.paddingLeft) - px(cs.paddingRight)
        - sides.reduce((n, c) => n + c.offsetWidth, 0) - 2 * px(cs.columnGap)
      if (room > 0) setStep(titleStep(text, room, measure))
    }
    check()
    if (typeof ResizeObserver !== 'function') return undefined
    const ro = new ResizeObserver(check)
    ro.observe(bar)
    return () => ro.disconnect()
  }, [ref, text])
  return step
}
