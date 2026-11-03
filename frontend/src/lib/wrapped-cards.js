// "Your year in openGym": the year's numbers (lib/wrapped.js yearStats) as story cards, and each
// card as a picture to share. The same model feeds the full-screen stories (components/Wrapped.jsx)
// and the canvas, so what is shared is what was shown:
//   wrappedCards       — the cards, in order, as words: a card with nothing to say is left out
//   layoutWrappedCard  — where a card's words go on a 9:16 story or a 1:1 square
//   drawWrappedCard    — paints a layout onto a 2D canvas context
// Every word is a translated string; every number is formatted for the language. The copy is
// friendly on purpose: a light year is a good start, a body-weight change is just a change.
import { personalityOf, comparisonFor } from './wrapped.js'
import { EXIDX } from './exercises.js'
import { MUSCLE_NAME, levelsOf } from './muscles.js'
import { fmtDate, fmtDur, fmtNum, exerciseNameText, DAYN, MONTHS_LONG, MONTHS } from './format.js'
import { shownWeight, exUnitOf } from './ex-unit.js'
import { t, tn, tnf, dateLocale } from './i18n-core.js'
import { FORMATS, drawBrand, roundRect, mixColor } from './card-draw.js'
import { wrapText, fitSize, mapColors, drawView, drawCardBase, drawText, CARD_FONT } from './workout-card.js'

const nf = (n, max = 0, min = 0) => {
  try { return new Intl.NumberFormat(dateLocale(), { maximumFractionDigits: max, minimumFractionDigits: min }).format(n) } catch (e) { return String(Math.round(n)) }
}
/** A count, one decimal under 10 (2.5 whales), whole above. */
export const fmtCount = n => nf(n, n < 10 && n % 1 ? 1 : 0)
const compact = n => {
  try { return new Intl.NumberFormat(dateLocale(), { notation: 'compact', maximumFractionDigits: 1 }).format(n) } catch (e) { return nf(n) }
}

/**
 * The year's total in the profile's unit, as a big number and its unit: tonnes from a tonne up
 * (kg profiles), a compact number of pounds past ten thousand (lb profiles).
 */
export function volumeParts(volume, unit) {
  if (unit === 'lb') return volume >= 10000 ? { value: compact(volume), unit: 'lb' } : { value: nf(volume), unit: 'lb' }
  if (volume >= 1000) { const tn_ = volume / 1000; return { value: nf(tn_, tn_ < 100 ? 1 : 0), unit: 't' } }
  return { value: nf(volume), unit: 'kg' }
}
export const hoursOf = ms => { const h = ms / 3600000; return h < 10 ? Math.round(h * 10) / 10 : Math.round(h) }

// The things a year of lifting compares to (lib/wrapped.js THINGS), one sentence each, with the
// count in it. Kept as literals so the string check finds them.
const THING_LINE = {
  eiffel: n => tnf('That is {0} Eiffel Tower. Gustave would be proud.', 'That is {0} Eiffel Towers. Gustave would be proud.', n, fmtCount(n)),
  iss: n => tnf('That is {0} International Space Station. Houston, we have gains.', 'That is {0} International Space Stations. Houston, we have gains.', n, fmtCount(n)),
  whale: n => tnf('That is {0} blue whale. Lifted. By you.', 'That is {0} blue whales. Lifted. By you.', n, fmtCount(n)),
  trex: n => tnf('That is {0} T. rex. Tiny arms, huge respect.', 'That is {0} T. rexes. Tiny arms, huge respect.', n, fmtCount(n)),
  elephant: n => tnf('That is {0} elephant. They never forget, neither will your legs.', 'That is {0} elephants. They never forget, neither will your legs.', n, fmtCount(n)),
  car: n => tnf('That is {0} car. Who needs a jack?', 'That is {0} cars. Who needs a jack?', n, fmtCount(n)),
  piano: n => tnf('That is {0} grand piano. Movers hate this one trick.', 'That is {0} grand pianos. Movers hate this one trick.', n, fmtCount(n)),
  panda: n => tnf('That is {0} giant panda. Bamboo not included.', 'That is {0} giant pandas. Bamboo not included.', n, fmtCount(n)),
  cat: n => tnf('That is {0} house cat. It did not approve.', 'That is {0} house cats. None of them approved.', n, fmtCount(n)),
}
export const comparisonLine = cmp => (cmp && THING_LINE[cmp.key] ? THING_LINE[cmp.key](cmp.count) : null)

const DAYPART_LINE = {
  morning: () => t('Mostly in the morning. The early bird gets the barbell.'),
  midday: () => t('Mostly around lunch. Who needs a lunch break anyway?'),
  afternoon: () => t('Mostly in the afternoon. The sweet spot.'),
  evening: () => t('Mostly in the evening. Work, then work out.'),
  night: () => t('Mostly late at night. The gym is all yours.'),
}

// The personalities (lib/wrapped.js personalityOf): a name and one line about it.
export const PERSONALITY = {
  early: () => [t('Early bird'), t('Most of your sessions started before 9. The sun was still catching up.')],
  night: () => [t('Night owl'), t('Most of your sessions started after 8 pm. The quiet gym is your gym.')],
  legs: () => [t('Leg-day loyalist'), t('You never skipped leg day. Stairs fear you.')],
  streak: () => [t('Clockwork'), t('Week after week after week. Your calendar knows your name.')],
  records: () => [t('Record breaker'), t('So many new bests, your trophy shelf needs a trophy shelf.')],
  weekend: () => [t('Weekend warrior'), t('Saturdays and Sundays are for lifting. Brunch can wait.')],
  cardio: () => [t('Cardio comet'), t('Your heart is in great shape. Literally.')],
  marathon: () => [t('In it for the long haul'), t('Long sessions, no rush. The gym is basically your second home.')],
  quick: () => [t('In and out'), t('Short, sharp sessions. Efficiency is your love language.')],
  explorer: () => [t('Explorer'), t('So many different exercises, boredom never stood a chance.')],
  upper: () => [t('Upper-body enthusiast'), t('Chest, shoulders, arms. The mirror approves.')],
  steady: () => [t('Steady and sure'), t('No drama, just showing up. That is how it is done.')],
}

/** An exercise's name as the app shows it: the catalogue's, a custom one's, the saved one, or its id. */
export const exName = (id, fallback) => (EXIDX[id] ? exerciseNameText(EXIDX[id]) : fallback || id)

/**
 * The cards for one year, in order. `st` is yearStats(S, year), `S` the profile (for the units an
 * exercise is shown in). Each card: { id, kicker, big, bigKind ('number' | 'text'), unit, title,
 * lines, num (the big number, for counting up), map (muscle levels), bars (workouts a month),
 * tiles (the summary's) }. Cards with nothing to say are left out: no time card for a year of
 * imports without a clock, no records card without a record, no body card without two weigh-ins
 * (or with it switched off).
 */
export function wrappedCards(st, S) {
  if (!st) return []
  const y = st.year
  const cards = []
  const personality = personalityOf(st)
  const [pName, pLine] = PERSONALITY[personality]()

  cards.push({ id: 'intro', kicker: t('Your year in openGym'), big: String(y), bigKind: 'number', title: t('Grab a shake. This one is all about you.'), lines: [t('Tap to start')] })

  const perWeek = st.perWeek
  cards.push({
    id: 'workouts', kicker: t('Showing up'), big: nf(st.workouts), num: st.workouts, bigKind: 'number', title: t('Workouts this year'),
    lines: [perWeek >= 0.95
      ? t('About {0} a week. Like clockwork.', nf(perWeek, 1))
      : t('One every {0} weeks or so. Every single one counted.', nf(Math.max(2, Math.round(1 / perWeek))))],
  })

  if (st.ms >= 3600000 || (st.ms > 0 && st.timed > 0)) {
    const h = hoursOf(st.ms)
    const movies = Math.floor(st.ms / (2 * 3600000))
    cards.push({
      id: 'time', kicker: t('Time well spent'), big: nf(h, h < 10 ? 1 : 0), num: h, bigKind: 'number', title: t('Hours of training'),
      lines: [t('Your average session: {0}', fmtDur(st.avgMs)), ...(movies >= 2 ? [t('That is {0} movies you did not watch. Worth it.', nf(movies))] : [])],
    })
  }

  if (st.volume > 0) {
    const v = volumeParts(st.volume, st.unit)
    cards.push({ id: 'volume', kicker: t('Heavy lifting'), big: v.value, unit: v.unit, bigKind: 'number', title: t('Lifted in total'), lines: [comparisonLine(comparisonFor(st.volumeKg))].filter(Boolean) })
  }

  if (st.streak.weeks > 0) {
    const w = st.streak.weeks
    const to = st.streak.to ? new Date(st.streak.to + 'T12:00:00') : null
    if (to) to.setDate(to.getDate() + 6)
    const toIso = to ? `${to.getFullYear()}-${String(to.getMonth() + 1).padStart(2, '0')}-${String(to.getDate()).padStart(2, '0')}` : null
    cards.push({
      id: 'streak', kicker: t('Consistency'), big: nf(w), num: w, bigKind: 'number', title: tn('Week with a workout, your longest run', 'Weeks in a row with a workout, your longest run', w),
      lines: [
        ...(w > 1 && st.streak.from && toIso ? [t('From {0} to {1}.', fmtDate(st.streak.from, false), fmtDate(toIso, false))] : []),
        w >= 12 ? t('That is not a streak any more. That is a habit.') : t('Every long streak starts with one week.'),
      ],
    })
  }

  if (st.topExercise) {
    const { id, sets, name } = st.topExercise
    cards.push({
      id: 'top', kicker: t('Your signature move'), big: exName(id, name), bigKind: 'text', title: tnf('{0} set this year', '{0} sets this year', sets, nf(sets)),
      lines: st.topMuscle ? [t('Most trained muscle: {0}', t(MUSCLE_NAME[st.topMuscle.id] || st.topMuscle.id))] : [],
      map: st.topMuscle ? levelsOf(st.load) : null,
    })
  }

  if (st.prs > 0) {
    const b = st.biggestPr
    const lines = []
    if (b) {
      const unit = exUnitOf(S, b.id)
      const w = fmtNum(shownWeight(S, b.id, b.w)) + ' ' + unit
      lines.push(t('Biggest: {0}, {1}', exName(b.id), w))
      if (b.gain > 0) lines.push(t('That is {0} more than your best before {1}.', fmtNum(shownWeight(S, b.id, b.gain)) + ' ' + unit, String(y)))
    }
    cards.push({ id: 'records', kicker: t('Records'), big: nf(st.prs), num: st.prs, bigKind: 'number', title: t('New personal records'), lines })
  }

  if (st.favDay) {
    cards.push({
      id: 'rhythm', kicker: t('Your rhythm'), big: t(DAYN[st.favDay.day]), bigKind: 'text', title: t('Your favourite day to train'),
      lines: st.daypart ? [DAYPART_LINE[st.daypart.part]()] : [],
    })
  }

  if (st.bestMonth && st.workouts >= 3) {
    cards.push({
      id: 'month', kicker: t('Peak season'), big: t(MONTHS_LONG[st.bestMonth.month]), bigKind: 'text', title: t('Your best month'),
      lines: [tnf('{0} workout', '{0} workouts', st.bestMonth.n, nf(st.bestMonth.n))], bars: st.months, barLabels: MONTHS.map(m => t(m)), barPeak: st.bestMonth.month,
    })
  }

  if (st.body) {
    const d = st.body.delta
    const unit = st.unit
    const steady = Math.abs(d) < (unit === 'lb' ? 1 : 0.5)
    cards.push({
      id: 'body', kicker: t('Body weight'), big: steady ? '±0' : (d > 0 ? '+' : '−') + fmtNum(Math.abs(d)), unit: steady ? '' : unit, bigKind: 'number',
      title: steady ? t('Steady all year') : d < 0 ? t('Down since your first weigh-in of the year') : t('Up since your first weigh-in of the year'),
      lines: [t('From {0} to {1}.', fmtNum(st.body.from) + ' ' + unit, fmtNum(st.body.to) + ' ' + unit), t('Bodies change. You kept showing up, and that is the part that counts.')],
      hideable: true,
    })
  }

  cards.push({ id: 'personality', kicker: t('Your training personality'), big: pName, bigKind: 'text', title: pLine, lines: [], personality })

  const v = volumeParts(st.volume, st.unit)
  const tiles = [
    { label: t('Workouts'), value: nf(st.workouts) },
    ...(st.ms > 0 ? [{ label: t('Hours'), value: nf(hoursOf(st.ms), hoursOf(st.ms) < 10 ? 1 : 0) }] : []),
    ...(st.volume > 0 ? [{ label: t('Lifted in total'), value: v.value + ' ' + v.unit }] : []),
    { label: t('Longest streak'), value: tnf('{0} week', '{0} weeks', st.streak.weeks, nf(st.streak.weeks)) },
    ...(st.prs > 0 ? [{ label: t('Records'), value: '🏆 ' + nf(st.prs) }] : []),
    ...(st.topExercise ? [{ label: t('Signature move'), value: exName(st.topExercise.id, st.topExercise.name), wide: true }] : []),
    { label: t('Training personality'), value: pName, wide: true },
  ]
  cards.push({ id: 'summary', kicker: t('Your {0} in openGym', String(y)), big: '', bigKind: 'none', title: t('That is a wrap. See you in {0}.', String(y + 1)), lines: [], tiles })
  return cards
}

/* ---------- the picture ---------- */

const PAD = 96

/**
 * Where a card's words go. `measure(text, weight, size)` measures text; `format` 'story' or
 * 'square'; `rtl` anchors the text on the right; `map` { aspect } when the profile's body geometry
 * is at hand for a card with a muscle map. The block of words sits a little above the middle; a
 * card with a map, the month bars or the summary tiles puts them under it.
 */
export function layoutWrappedCard(card, { measure, format = 'story', rtl = false, map = null, year }) {
  const square = format === 'square'
  const { width, height } = square ? FORMATS.square : FORMATS.story
  const inner = width - PAD * 2
  const start = rtl ? width - PAD : PAD
  const items = []
  const s = square ? 0.72 : 1
  let y = PAD + (square ? 0 : 30)

  // The kicker and the year as a pill, like the stories show them.
  items.push({ kind: 'deco', x: width, y: 0, r: square ? 360 : 520 })
  const kSize = Math.round(40 * s + (square ? 6 : 0))
  const [kick] = wrapText(card.kicker, inner - 200, x => measure(x, 700, kSize), 1)
  items.push({ kind: 'text', text: kick, x: start, y: y + kSize, size: kSize, weight: 700, color: 'accText' })
  if (year && card.id !== 'intro') {
    const label = String(year)
    const pw = measure(label, 700, 32) + 40
    items.push({ kind: 'pill', x: rtl ? PAD : width - PAD - pw, y: y + kSize / 2 - 26, w: pw, h: 52, text: label })
  }
  y += kSize + (square ? 24 : 60)

  // What sits under the words, measured first so the words can be centred in what is left.
  const footY = height - PAD
  const footRoom = 120
  let extraH = 0
  const cols = square ? 3 : 2
  if (card.tiles) {
    const rows = tileRows(card.tiles, cols)
    extraH = rows.length * (square ? 112 : 170) + (rows.length - 1) * 18
  } else if (card.map && map) extraH = square ? 300 : 620
  else if (card.bars) extraH = square ? 200 : 340

  const words = []
  const add = (text, size, weight, color, gapAfter = 0) => words.push({ text, size, weight, color, gapAfter })
  if (card.bigKind === 'number' && card.big) {
    const unitSize = Math.round((square ? 64 : 96))
    const unitW = card.unit ? measure(' ' + card.unit, 700, unitSize) : 0
    const size = fitSize(card.big, inner - unitW, measure, 800, square ? 210 : 300, 72)
    words.push({ text: card.big, size, weight: 800, color: 'accText', unit: card.unit, unitSize, gapAfter: square ? 4 : 18, big: true })
  } else if (card.bigKind === 'text' && card.big) {
    const size = square ? 84 : 116
    const lines = wrapText(card.big, inner, x => measure(x, 800, size), square ? 2 : 3)
    lines.forEach((l, i) => add(l, size, 800, 'accText', i === lines.length - 1 ? (square ? 10 : 26) : 0))
  }
  if (card.title) {
    const size = Math.round(card.bigKind === 'none' ? 66 * s + 6 : 54 * s + 4)
    wrapText(card.title, inner, x => measure(x, 700, size), card.bigKind === 'text' && card.id === 'personality' ? 4 : 3)
      .forEach((l, i, a) => add(l, size, 700, 'label', i === a.length - 1 ? (square ? 16 : 30) : 0))
  }
  for (const line of card.lines || []) {
    const size = Math.round(40 * s + 4)
    wrapText(line, inner, x => measure(x, 400, size), square ? 2 : 3).forEach((l, i, a) => add(l, size, 400, 'label2', i === a.length - 1 ? 14 : 0))
  }
  const lineH = w => Math.round(w.size * (w.big ? 1.0 : 1.22)) + w.gapAfter
  const wordsH = words.reduce((n, w) => n + lineH(w), 0)
  const room = footY - footRoom - y - extraH - (extraH ? (square ? 24 : 56) : 0)
  let wy = y + Math.max(0, (room - wordsH) * (extraH ? 0.5 : 0.42))
  for (const w of words) {
    items.push({ kind: 'text', text: w.text, x: start, y: wy + w.size * (w.big ? 0.86 : 0.92), size: w.size, weight: w.weight, color: w.color })
    if (w.unit) {
      const bw = measure(w.text, 800, w.size)
      items.push({ kind: 'text', text: w.unit, x: start + (rtl ? -1 : 1) * (bw + measure(' ', 700, w.unitSize)), y: wy + w.size * 0.86, size: w.unitSize, weight: 700, color: 'label2' })
    }
    wy += lineH(w)
  }
  y = Math.max(wy, y) + (extraH ? (square ? 24 : 56) : 0)

  if (card.tiles) {
    const rows = tileRows(card.tiles, cols)
    const gap = 18
    // As tall as they can be up to their size, never into the footer.
    const tileH = Math.min(square ? 112 : 170, Math.floor((footY - footRoom - y - gap * (rows.length - 1)) / rows.length))
    for (const row of rows) {
      const w = (inner - gap * (row.length - 1)) / row.length
      row.forEach((tile, i) => {
        const x = rtl ? width - PAD - (i + 1) * w - i * gap : PAD + i * (w + gap)
        const tx = rtl ? x + w - 28 : x + 28
        items.push({ kind: 'tile', x, y, w, h: tileH })
        const ls = Math.min(square ? 24 : 30, Math.round(tileH * 0.24))
        const [label] = wrapText(tile.label, w - 56, z => measure(z, 500, ls), 1)
        items.push({ kind: 'text', text: label, x: tx, y: y + 22 + ls, size: ls, weight: 500, color: 'label2' })
        const vs = fitSize(tile.value, w - 56, measure, 700, Math.min(square ? 44 : 62, Math.round(tileH * 0.42)), 22)
        const [value] = wrapText(tile.value, w - 56, z => measure(z, 700, vs), 1)
        items.push({ kind: 'text', text: value, x: tx, y: y + tileH - Math.round(tileH * (square ? 0.2 : 0.2)), size: vs, weight: 700, color: 'label' })
      })
      y += tileH + gap
    }
  } else if (card.map && map) {
    const viewGap = 40
    let viewH = extraH
    let viewW = viewH / map.aspect
    if (viewW * 2 + viewGap > inner) { viewW = (inner - viewGap) / 2; viewH = viewW * map.aspect }
    const left = (width - (viewW * 2 + viewGap)) / 2
    items.push({ kind: 'map', view: 'front', x: left, y, w: viewW, h: viewH })
    items.push({ kind: 'map', view: 'back', x: left + viewW + viewGap, y, w: viewW, h: viewH })
  } else if (card.bars) {
    const max = Math.max(1, ...card.bars)
    const n = card.bars.length
    const gap = square ? 10 : 14
    const bw = (inner - gap * (n - 1)) / n
    const labelH = 40
    const h = extraH - labelH
    card.bars.forEach((v, i) => {
      const idx = rtl ? n - 1 - i : i
      const x = PAD + idx * (bw + gap)
      const bh = Math.max(8, (v / max) * h)
      items.push({ kind: 'barv', x, y: y + h - bh, w: bw, h: bh, peak: i === card.barPeak })
      const label = (card.barLabels?.[i] || '').slice(0, 1)
      items.push({ kind: 'text', text: label, x: x + bw / 2, y: y + h + 34, size: square ? 22 : 26, weight: i === card.barPeak ? 700 : 500, color: i === card.barPeak ? 'accText' : 'label2', anchor: 'center' })
    })
  }

  items.push({ kind: 'sep', x: PAD, y: footY - 78, w: inner })
  items.push({ kind: 'brand', x: PAD, y: footY, w: inner, size: 40 })
  return { width, height, rtl, format: square ? 'square' : 'story', items }
}

// The summary's tiles `cols` to a row, the numbers first, a wide one on a row of its own.
export function tileRows(tiles, cols = 2) {
  const rows = []
  let row = []
  for (const tile of tiles.filter(x => !x.wide)) {
    row.push(tile)
    if (row.length === cols) { rows.push(row); row = [] }
  }
  if (row.length) rows.push(row)
  for (const tile of tiles.filter(x => x.wide)) rows.push([tile])
  return rows
}

/** Paint a layout. `colors` is a cardPalette; `map` { body, levels } for a card with a muscle map. */
export function drawWrappedCard(ctx, layout, colors, map = null, family = CARD_FONT) {
  const { width, height, rtl, items } = layout
  drawCardBase(ctx, width, height, colors)
  const shades = mapColors(colors)
  for (const item of items) {
    if (item.kind === 'deco') {
      // A soft disc of the accent in the corner, cut by the card's edge: the stories' glow.
      ctx.save()
      roundRect(ctx, 36, 36, width - 72, height - 72, 56)
      ctx.clip()
      ctx.fillStyle = mixColor(colors.acc, colors.surface, colors.light ? 0.16 : 0.2)
      ctx.beginPath(); ctx.arc(item.x - 80, item.y + 80, item.r, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = mixColor(colors.acc, colors.surface, colors.light ? 0.08 : 0.1)
      ctx.beginPath(); ctx.arc(80, height - 300, item.r * 0.55, 0, Math.PI * 2); ctx.fill()
      ctx.restore()
    } else if (item.kind === 'pill') {
      ctx.fillStyle = colors.tile
      roundRect(ctx, item.x, item.y, item.w, item.h, item.h / 2)
      ctx.fill()
      drawText(ctx, { text: item.text, x: item.x + item.w / 2, y: item.y + item.h / 2 + 11, size: 32, weight: 700, color: 'label', anchor: 'center' }, colors, false, family)
    } else if (item.kind === 'tile') {
      ctx.fillStyle = colors.tile
      roundRect(ctx, item.x, item.y, item.w, item.h, 28)
      ctx.fill()
    } else if (item.kind === 'barv') {
      ctx.fillStyle = item.peak ? colors.acc : mixColor(colors.acc, colors.surface, 0.35)
      roundRect(ctx, item.x, item.y, item.w, item.h, Math.min(12, item.w / 2))
      ctx.fill()
    } else if (item.kind === 'map') {
      const view = map?.body?.[item.view]
      if (view) drawView(ctx, view, item, map.levels, shades)
    } else if (item.kind === 'sep') {
      ctx.fillStyle = colors.sep
      ctx.fillRect(item.x, item.y, item.w, 2)
    } else if (item.kind === 'brand') {
      drawBrand(ctx, { x: item.x, y: item.y, width: item.w, colors, family, size: item.size })
    } else if (item.kind === 'text') {
      drawText(ctx, item, colors, rtl, family)
    }
  }
}
