// The recap as a picture (lib/recap.js): "Your week" or "Your month", its dates, four tiles
// (workouts, volume, records, streak), the muscle it hit most, and the brand. Drawn on the device
// with the share cards' palette and footer (lib/card-draw.js); shared through components/ShareCard.jsx.
import { FORMATS, cardPalette, drawBrand, roundRect } from './card-draw.js'
import { makeCanvas, toPng, currentAccent, isRtl } from './share-image.js'
import { CARD_FONT } from './workout-card.js'

/**
 * The words the card shows, already translated by the caller: { title, dates, tiles: [{ label,
 * value }] (four), top } so this file stays free of i18n and is drawn the same for every language.
 */
export function drawRecapCard(ctx, words, { width, height, colors, family = CARD_FONT, rtl = false }) {
  const pad = 80
  ctx.fillStyle = colors.bg
  ctx.fillRect(0, 0, width, height)
  ctx.direction = rtl ? 'rtl' : 'ltr'
  ctx.textAlign = rtl ? 'right' : 'left'
  const x0 = rtl ? width - pad : pad
  const story = height > width * 1.4
  let y = story ? 300 : 170
  ctx.fillStyle = colors.accText || colors.acc
  ctx.font = `700 40px ${family}`
  ctx.fillText(words.dates, x0, y)
  y += story ? 110 : 96
  ctx.fillStyle = colors.label
  ctx.font = `800 ${story ? 104 : 92}px ${family}`
  ctx.fillText(words.title, x0, y)
  y += story ? 90 : 60
  const gap = 28
  const tw = (width - pad * 2 - gap) / 2
  const th = story ? 300 : 210
  words.tiles.slice(0, 4).forEach((tile, i) => {
    const col = rtl ? 1 - (i % 2) : i % 2
    const tx = pad + col * (tw + gap)
    const ty = y + Math.floor(i / 2) * (th + gap)
    ctx.fillStyle = colors.surface
    roundRect(ctx, tx, ty, tw, th, 36)
    ctx.fill()
    const ix = rtl ? tx + tw - 44 : tx + 44
    ctx.fillStyle = colors.label
    ctx.font = `800 ${story ? 96 : 76}px ${family}`
    ctx.fillText(String(tile.value), ix, ty + th * 0.52)
    ctx.fillStyle = colors.label2
    ctx.font = `600 ${story ? 40 : 34}px ${family}`
    ctx.fillText(String(tile.label), ix, ty + th * 0.52 + (story ? 70 : 56))
  })
  y += th * 2 + gap + (story ? 120 : 76)
  if (words.top) {
    ctx.fillStyle = colors.label2
    ctx.font = `600 ${story ? 44 : 36}px ${family}`
    ctx.fillText(words.top, x0, y)
  }
  drawBrand(ctx, { x: pad, y: height - (story ? 140 : 80), width: width - pad * 2, colors, family })
}

/** The picture as a PNG blob, or null where there is no canvas. */
export async function recapCardImage(words, { format = 'story', style = 'dark' } = {}) {
  const { width, height } = FORMATS[format] || FORMATS.story
  const c = makeCanvas(width, height, CARD_FONT)
  if (!c) return null
  drawRecapCard(c.ctx, words, { width, height, colors: cardPalette(style, currentAccent()), rtl: isRtl() })
  return toPng(c.canvas)
}
