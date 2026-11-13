// A progress-photo comparison as one picture (#950), the way it is on the screen: the same cells,
// the same crop of each photo (lib/photo-compare.js coverCrop, from where it was dragged to),
// the date on each, or the before/after slider at the place it was left. It is drawn here, on
// the device, and handed to the share sheet (lib/share-image.js); nothing is uploaded.
import { coverCrop } from './photo-compare.js'
import { makeCanvas, toPng } from './share-image.js'

const W = 1080, PAD = 36, GAP = 12, FOOT = 84
const FAMILY = '-apple-system, system-ui, "Segoe UI", Roboto, sans-serif'

/**
 * Where everything goes on the picture: { width, height, cells: [{ x, y, w, h }], foot } for
 * rows of photos (compareRows) in cells of shape `aspect`. The slider is one cell.
 */
export function compareCanvasLayout(rows, aspect, mode = 'side') {
  const list = mode === 'slider' ? [1] : (rows || []).filter(n => n > 0)
  const cols = Math.max(1, ...list)
  const cw = (W - PAD * 2 - GAP * (cols - 1)) / cols
  const ch = cw / (aspect > 0 ? aspect : 0.75)
  const cells = []
  list.forEach((n, r) => {
    const rowW = n * cw + (n - 1) * GAP
    const x0 = (W - rowW) / 2
    for (let i = 0; i < n; i++) cells.push({ x: x0 + i * (cw + GAP), y: PAD + r * (ch + GAP), w: cw, h: ch })
  })
  const bottom = PAD + list.length * ch + (list.length - 1) * GAP
  return { width: W, height: Math.round(bottom + FOOT), cells, foot: bottom + FOOT / 2 + 6 }
}

const loadImage = url => new Promise((resolve, reject) => {
  const img = new Image()
  img.onload = () => resolve(img)
  img.onerror = () => reject(new Error('image'))
  img.src = url
})

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function pill(ctx, text, x, y, alignEnd = false) {
  ctx.font = `600 26px ${FAMILY}`
  const tw = ctx.measureText(text).width
  const w = tw + 28, h = 42
  const left = alignEnd ? x - w : x
  ctx.fillStyle = 'rgba(0,0,0,0.55)'
  roundRect(ctx, left, y - h, w, h, h / 2)
  ctx.fill()
  ctx.fillStyle = '#fff'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.fillText(text, left + 14, y - h / 2 + 1)
}

function drawCover(ctx, img, cell, aspect, pos) {
  const c = coverCrop(img.naturalWidth || img.width, img.naturalHeight || img.height, aspect, pos)
  ctx.drawImage(img, c.sx, c.sy, c.sw, c.sh, cell.x, cell.y, cell.w, cell.h)
}

/**
 * The PNG of a comparison: `items` [{ url, label, pos }] oldest first, `rows` from compareRows,
 * `mode` 'side' or 'slider' (two photos, `pct` 0 to 100 of the earlier one showing), `caption`
 * the line under it. null where the device cannot draw it.
 */
export async function renderCompare({ items, rows, aspect, mode = 'side', pct = 50, caption = '' }) {
  const L = compareCanvasLayout(rows, aspect, mode)
  const made = makeCanvas(L.width, L.height, FAMILY)
  if (!made) return null
  const { canvas, ctx } = made
  const imgs = await Promise.all(items.map(it => loadImage(it.url).catch(() => null)))
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, L.width, L.height)
  if (mode === 'slider' && items.length === 2) {
    const cell = L.cells[0]
    ctx.save(); roundRect(ctx, cell.x, cell.y, cell.w, cell.h, 18); ctx.clip()
    if (imgs[1]) drawCover(ctx, imgs[1], cell, aspect, items[1].pos)
    const cut = cell.w * Math.max(0, Math.min(100, pct)) / 100
    ctx.save(); ctx.beginPath(); ctx.rect(cell.x, cell.y, cut, cell.h); ctx.clip()
    if (imgs[0]) drawCover(ctx, imgs[0], cell, aspect, items[0].pos)
    ctx.restore()
    ctx.fillStyle = '#fff'
    ctx.fillRect(cell.x + cut - 2, cell.y, 4, cell.h)
    ctx.restore()
    pill(ctx, items[0].label, cell.x + 20, cell.y + cell.h - 20)
    pill(ctx, items[1].label, cell.x + cell.w - 20, cell.y + cell.h - 20, true)
  } else {
    items.forEach((it, i) => {
      const cell = L.cells[i]
      if (!cell) return
      ctx.save(); roundRect(ctx, cell.x, cell.y, cell.w, cell.h, 14); ctx.clip()
      ctx.fillStyle = '#1c1c1e'; ctx.fillRect(cell.x, cell.y, cell.w, cell.h)
      if (imgs[i]) drawCover(ctx, imgs[i], cell, aspect, it.pos)
      ctx.restore()
      pill(ctx, it.label, cell.x + 14, cell.y + cell.h - 14)
    })
  }
  ctx.fillStyle = 'rgba(255,255,255,0.86)'
  ctx.font = `600 30px ${FAMILY}`
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.fillText('openGym', PAD, L.foot)
  if (caption) {
    ctx.fillStyle = 'rgba(255,255,255,0.6)'
    ctx.font = `500 26px ${FAMILY}`
    ctx.textAlign = 'right'
    ctx.fillText(caption, L.width - PAD, L.foot)
  }
  const blob = await toPng(canvas)
  canvas.width = 0; canvas.height = 0
  return blob
}
