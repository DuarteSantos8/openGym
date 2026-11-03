// The comparison of progress photos as one picture to share (#950): the same two layouts the
// screen offers, drawn on a canvas. compareLayout is pure (sizes in, rectangles out) so it is
// tested without a canvas; drawCompare and renderCompareImage are the thin part that paints it.
import { mediaStore } from './media-store.js'
import { cellRatio, coverCrop, rowsOf } from './photo-compare.js'

export const IMAGE_WIDTH = 1500
const PAD = 40
const GAP = 16
const HEADER = 110
const CAPTION = 76
const MAX_FRAME_H = 2000

/** The largest rectangle of `item` (w × h) that fits `box`, centred in it. */
function contain(item, box) {
  const k = Math.min(box.w / item.w, box.h / item.h)
  const w = item.w * k, h = item.h * k
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h }
}

/**
 * Where everything goes. `items` are the photos earliest first: { w, h, label }, the pixel size of
 * each and the date to print for it. `mode` is 'side' (one row, a caption under each) or 'slider'
 * (exactly two, split at `pct` percent of the way across, the earlier on the left).
 */
export function compareLayout(items, { mode = 'side', pct = 50, title = '' } = {}) {
  const width = IMAGE_WIDTH
  const inner = width - 2 * PAD
  const head = { text: title, x: width / 2, y: PAD + HEADER / 2 }
  if (mode === 'slider' && items.length === 2) {
    const frameH = Math.min(MAX_FRAME_H, Math.round(inner * items[0].h / items[0].w))
    const frame = { x: PAD, y: PAD + HEADER, w: inner, h: frameH }
    const at = Math.max(0, Math.min(100, pct))
    return {
      width, height: PAD + HEADER + frameH + PAD, title: head, mode: 'slider',
      frame, splitX: frame.x + frame.w * at / 100,
      rects: items.map(it => contain(it, frame)),
      labels: [
        { text: items[0].label, x: frame.x + 24, y: frame.y + frame.h - 24, align: 'left', font: 30 },
        { text: items[1].label, x: frame.x + frame.w - 24, y: frame.y + frame.h - 24, align: 'right', font: 30 },
      ],
    }
  }
  // Rows of at most three, every photo the size of one column, a shorter last row centred.
  const { cols, sizes } = rowsOf(items.length)
  const cellW = (inner - GAP * (cols - 1)) / cols
  const cellH = cellW * cellRatio(items)           // every photo has the same height; a photo of another shape is cropped to it
  const top = PAD + HEADER
  const font = 28
  const cells = []
  sizes.forEach((size, r) => {
    const x0 = PAD + (inner - (size * cellW + (size - 1) * GAP)) / 2
    for (let k = 0; k < size; k++) {
      const it = items[cells.length]
      const x = x0 + k * (cellW + GAP), y = top + r * (cellH + GAP)
      cells.push({ x, y, w: cellW, h: cellH, crop: coverCrop(it.w, it.h, cellW, cellH, it.px, it.py) })
    }
  })
  return {
    width, height: Math.round(top + sizes.length * cellH + Math.max(0, sizes.length - 1) * GAP + PAD), title: head, mode: 'side',
    cells, rects: cells.map(c => ({ x: c.x, y: c.y, w: c.w, h: c.h })),
    // the date is a pill on the photo, at its bottom left, like the date pills in the gallery
    labels: items.map((it, i) => ({ text: it.label, x: cells[i].x + Math.round(font * 0.5), y: cells[i].y + cellH - Math.round(font * 1.3), align: 'left', font })),
  }
}

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'

/** Paints a compareLayout() onto `ctx` with the decoded `images` (same order as the layout's rects). */
export function drawCompare(ctx, layout, images) {
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, layout.width, layout.height)
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#fff'
  ctx.globalAlpha = 0.85
  ctx.font = `500 38px ${FONT}`
  ctx.textAlign = 'center'
  ctx.fillText(layout.title.text, layout.title.x, layout.title.y)
  ctx.globalAlpha = 1
  const draw = (img, r) => ctx.drawImage(img, r.x, r.y, r.w, r.h)
  // The date pill: translucent black, white semibold text, round ends (the gallery's date pills).
  const pills = () => {
    for (const l of layout.labels) {
      ctx.font = `600 ${l.font}px ${FONT}`
      const h = Math.round(l.font * 1.6), w = ctx.measureText(l.text).width + l.font * 1.2
      const x = l.align === 'left' ? l.x : l.x - w
      ctx.fillStyle = 'rgba(0,0,0,.6)'
      ctx.beginPath(); ctx.roundRect(x, l.y - h / 2, w, h, h / 2); ctx.fill()
      ctx.fillStyle = '#fff'; ctx.textAlign = 'left'
      ctx.fillText(l.text, x + l.font * 0.6, l.y)
    }
  }
  if (layout.mode === 'slider') {
    const { frame, splitX } = layout
    ctx.save()
    ctx.beginPath(); ctx.rect(frame.x, frame.y, frame.w, frame.h); ctx.clip()
    draw(images[1], layout.rects[1])
    ctx.save()
    ctx.beginPath(); ctx.rect(frame.x, frame.y, splitX - frame.x, frame.h); ctx.clip()
    draw(images[0], layout.rects[0])
    ctx.restore()
    ctx.fillStyle = '#fff'
    ctx.fillRect(splitX - 2, frame.y, 4, frame.h)
    ctx.beginPath(); ctx.arc(splitX, frame.y + frame.h / 2, 28, 0, Math.PI * 2); ctx.fill()
    ctx.restore()
    pills()
    return
  }
  layout.cells.forEach((c, i) => ctx.drawImage(images[i], c.crop.sx, c.crop.sy, c.crop.sw, c.crop.sh, c.x, c.y, c.w, c.h))
  pills()
}

/**
 * The comparison as a PNG blob, or null when a photo is not on this device yet or the canvas
 * cannot be made. `photos` are progressPhotosOf() entries, earliest first; `labels` their printed
 * dates in the same order; `pans` where each photo was dragged to in its cell ({ x, y }, 0 to 1), in
 * the same order, so the picture is the one on the screen.
 */
export async function renderCompareImage({ photos, labels, pans = [], mode, pct, title }) {
  const bitmaps = []
  try {
    for (const p of photos) {
      const rec = await mediaStore.get(p.m.hash)
      if (!rec) return null
      bitmaps.push(await createImageBitmap(rec.blob))
    }
    const layout = compareLayout(bitmaps.map((b, i) => ({ w: b.width, h: b.height, label: labels[i], px: pans[i] && pans[i].x, py: pans[i] && pans[i].y })), { mode, pct, title })
    const canvas = document.createElement('canvas')
    canvas.width = layout.width
    canvas.height = layout.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    drawCompare(ctx, layout, bitmaps)
    return await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
  } finally {
    for (const b of bitmaps) b.close?.()
  }
}
