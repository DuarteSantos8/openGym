import { describe, expect, it } from 'vitest'
import { workoutCardModel, layoutWorkoutCard, wrapText, parseColor, mixColor, mapColors, viewAspect, MAX_RECORDS, CARD_WIDTH } from './workout-card.js'
import { cardPalette, FORMATS } from './card-draw.js'
import { fmtDate } from './format.js'

// #453: a finished workout shared as a picture. A fake measure stands in for the canvas — every
// character is half its font size wide — so the layout can be checked without one.
const measure = (text, weight, size) => String(text).length * size * 0.5

describe('workoutCardModel', () => {
  const names = { bench: 'barbell bench press', curl: 'dumbbell curl', lunge: 'dumbbell lunge' }
  const nameOf = e => names[e.id] || e.id
  const w = {
    id: 'w1', d: '2026-09-03', start: 0, end: 58 * 60000, name: 'Push', vol: 1790,
    prs: ['curl', 'bench', 'curl'],
    entries: [
      { id: 'bench', target: { mode: 'reps' }, sets: [
        { w: 40, r: 8, done: true, phase: 'warmup' },
        { w: 60, r: 8, done: true },
        { w: 60, r: 6, done: true },
        { w: 60, r: 8, done: false },
      ] },
      { id: 'curl', target: { mode: 'reps' }, sets: [{ w: 12, r: 10, done: true }] },
      { id: 'lunge', target: { mode: 'reps', side: true }, sets: [
        { w: 10, r: 16, done: true, sides: { L: { w: 10, r: 8, done: true }, R: { w: 10, r: 8, done: true } } },
      ] },
    ],
  }

  const stat = m => m.stats.map(s => s.label + ' ' + s.value)

  it('says the name, the dated day, duration, work sets and volume', () => {
    const m = workoutCardModel(w, { unit: 'kg', nameOf })
    expect(m.title).toBe('Push')
    expect(m.date).toBe(fmtDate('2026-09-03', true, true))
    // 2 bench work sets (the warm-up and the unticked set are not counted), 1 curl, and the
    // per-side lunge set once per side.
    expect(stat(m)).toEqual(['Duration 58 min', 'Volume 1,790 kg', 'Sets 5', 'PRs 🏆 2'])
  })

  it('lists each new best once, in the order the workout lists the exercises, title-cased', () => {
    expect(workoutCardModel(w, { unit: 'kg', nameOf }).records).toEqual(['Barbell Bench Press', 'Dumbbell Curl'])
  })

  it('leaves out a duration it does not know and works the volume out when none was saved', () => {
    const imported = { ...w, start: undefined, end: undefined, vol: undefined, prs: undefined }
    const m = workoutCardModel(imported, { unit: 'lb', nameOf })
    // 60×8 + 60×6 bench, 12×10 curl, 10×8 a side on the lunge; the warm-up adds nothing.
    expect(stat(m)).toEqual(['Volume 1,120 lb', 'Sets 5', 'PRs –'])
    expect(m.records).toEqual([])
  })

  it('carries the session\'s muscle map, shaded against its own hardest-worked muscle', () => {
    const bench = { ...w, entries: [{ id: '0025', target: { mode: 'reps' }, sets: [
      { w: 40, r: 8, done: true, phase: 'warmup' }, { w: 60, r: 8, done: true }, { w: 60, r: 8, done: false },
    ] }] }
    const { levels } = workoutCardModel(bench, { unit: 'kg', nameOf })
    expect(levels.chest).toBe(4)
    expect(levels.triceps).toBeGreaterThan(0)
    expect(levels.quadriceps).toBe(0)
  })

  it('has no muscle map when no set reached a muscle the map shows', () => {
    expect(workoutCardModel(w, { unit: 'kg', nameOf }).levels).toBeNull()
  })

  it('carries the week streak for its flame, none when there is none', () => {
    expect(workoutCardModel(w, { unit: 'kg', nameOf, streak: 7 }).streak).toBe(7)
    expect(workoutCardModel(w, { unit: 'kg', nameOf }).streak).toBe(0)
    expect(workoutCardModel(w, { unit: 'kg', nameOf, streak: 'x' }).streak).toBe(0)
  })
})

describe('wrapText', () => {
  const width = 100
  const m = s => s.length * 10

  it('keeps a line that fits as it is', () => {
    expect(wrapText('Leg day', width, m, 2)).toEqual(['Leg day'])
  })

  it('wraps at words and cuts the last line with an ellipsis when it runs out of lines', () => {
    const lines = wrapText('upper body strength and conditioning', width, m, 2)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe('upper body')
    expect(lines[1].endsWith('…')).toBe(true)
    for (const line of lines) expect(m(line)).toBeLessThanOrEqual(width)
  })

  it('cuts a single word wider than the line instead of overflowing', () => {
    const [line] = wrapText('Oberkörpertrainingseinheit', width, m, 1)
    expect(line.endsWith('…')).toBe(true)
    expect(m(line)).toBeLessThanOrEqual(width)
  })
})

describe('layoutWorkoutCard', () => {
  const model = {
    title: 'Push', date: 'Thu, 3 Sep 2026',
    stats: [{ label: 'Duration', value: '58 min' }, { label: 'Volume', value: '1,790 kg' }, { label: 'Sets', value: '5' }, { label: 'PRs', value: '🏆 1' }],
    records: ['Barbell Bench Press'],
    streak: 6,
    levels: { chest: 4 },
  }
  const texts = layout => layout.items.filter(i => i.kind === 'text').map(i => i.text)
  const kinds = (layout, kind) => layout.items.filter(i => i.kind === kind)
  const map = { aspect: 1280 / 727 }
  const inside = layout => {
    for (const item of layout.items) {
      if (item.kind === 'text' && item.anchor !== 'left') {
        const w = measure(item.text, item.weight, item.size)
        const [l, r] = layout.rtl ? [item.x - w, item.x] : [item.x, item.x + w]
        expect(l, item.text).toBeGreaterThanOrEqual(0)
        expect(r, item.text).toBeLessThanOrEqual(layout.width)
      }
      if ('y' in item) {
        expect(item.y, item.kind + ' ' + (item.text || '')).toBeGreaterThanOrEqual(0)
        expect(item.y + (item.h || 0), item.kind + ' ' + (item.text || '')).toBeLessThanOrEqual(layout.height)
      }
    }
  }

  it('makes a 9:16 story by default and a 1:1 square when asked', () => {
    expect(layoutWorkoutCard(model, { measure })).toMatchObject({ ...FORMATS.story, format: 'story' })
    expect(layoutWorkoutCard(model, { measure, format: 'square' })).toMatchObject({ ...FORMATS.square, format: 'square' })
    expect(CARD_WIDTH).toBe(FORMATS.story.width)
  })

  it('stacks the title, date, stat tiles, records, the streak and the logo, top to bottom', () => {
    const layout = layoutWorkoutCard(model, { measure })
    expect(texts(layout)).toEqual(['Push', 'Thu, 3 Sep 2026', 'Duration', '58 min', 'Volume', '1,790 kg', 'Sets', '5', 'PRs', '🏆 1', 'New personal records', 'Barbell Bench Press', '6 week streak'])
    expect(kinds(layout, 'tile')).toHaveLength(4)
    expect(kinds(layout, 'trophy')).toHaveLength(1)
    expect(kinds(layout, 'flame')).toHaveLength(1)
    const [brand] = kinds(layout, 'brand')
    const flame = kinds(layout, 'flame')[0]
    const records = layout.items.find(i => i.text === 'New personal records')
    expect(records.y).toBeLessThan(flame.y)
    expect(flame.y + flame.size).toBeLessThan(brand.y)
    inside(layout)
  })

  it('lays the tiles out two by two on a story and in one row on a square, equal and inside the card', () => {
    const story = kinds(layoutWorkoutCard(model, { measure }), 'tile')
    expect(new Set(story.map(t => t.w)).size).toBe(1)
    expect(new Set(story.map(t => t.y)).size).toBe(2)
    const square = kinds(layoutWorkoutCard(model, { measure, format: 'square' }), 'tile')
    expect(new Set(square.map(t => t.y)).size).toBe(1)
    for (let i = 1; i < square.length; i++) expect(square[i].x).toBeGreaterThan(square[i - 1].x + square[i - 1].w)
    expect(square[3].x + square[3].w).toBeLessThanOrEqual(FORMATS.square.width)
  })

  it('shrinks a number too wide for its tile instead of running into the next one', () => {
    const big = { ...model, stats: [model.stats[0], { label: 'Volume', value: '123,456,789.5 kg' }, ...model.stats.slice(2)] }
    for (const format of ['story', 'square']) {
      const layout = layoutWorkoutCard(big, { measure, format })
      const tile = kinds(layout, 'tile')[1]
      const value = layout.items.find(i => String(i.text).startsWith('123,'))
      expect(value.size).toBeLessThan(64)
      expect(value.x + measure(value.text, value.weight, value.size)).toBeLessThanOrEqual(tile.x + tile.w)
    }
  })

  it('keeps everything inside the picture, whatever the names, in both formats and both directions', () => {
    const long = { ...model, title: 'A very long routine name that will never fit on one line of the card at all', records: Array.from({ length: 9 }, (_, i) => 'an exercise with a name far too long to fit on one line of the card ' + i) }
    for (const format of ['story', 'square']) for (const rtl of [false, true]) inside(layoutWorkoutCard(long, { measure, map, format, rtl }))
  })

  it('adds the front and back of the body, centred, with a less-to-more legend, when there is room', () => {
    const without = layoutWorkoutCard(model, { measure })
    const layout = layoutWorkoutCard(model, { measure, map })
    expect(kinds(without, 'map')).toHaveLength(0)
    const [front, back] = kinds(layout, 'map')
    expect([front.view, back.view]).toEqual(['front', 'back'])
    expect(front.h / front.w).toBeCloseTo(map.aspect)
    expect(front.x - 0).toBeCloseTo(CARD_WIDTH - (back.x + back.w))
    expect(kinds(layout, 'swatch').map(s => s.level)).toEqual([0, 1, 2, 3, 4])
    expect(texts(layout)).toEqual(expect.arrayContaining(['Less', 'More']))
    // The map sits between the tiles and the records.
    const tilesEnd = Math.max(...kinds(layout, 'tile').map(t => t.y + t.h))
    const records = layout.items.find(i => i.text === 'New personal records')
    expect(front.y).toBeGreaterThan(tilesEnd)
    expect(records.y).toBeGreaterThan(front.y + front.h)
    // A square has a smaller one, still inside.
    const sq = layoutWorkoutCard(model, { measure, map, format: 'square' })
    expect(kinds(sq, 'map')[0].h).toBeLessThan(front.h)
    inside(sq)
  })

  it('leaves the map out of a card whose workout has none, even when asked', () => {
    expect(kinds(layoutWorkoutCard({ ...model, levels: null }, { measure, map }), 'map')).toHaveLength(0)
  })

  it('counts the new bests past the limit instead of growing without end', () => {
    const many = { ...model, records: Array.from({ length: 9 }, (_, i) => 'lift ' + i) }
    const layout = layoutWorkoutCard(many, { measure })
    expect(kinds(layout, 'trophy')).toHaveLength(MAX_RECORDS - 1)
    expect(texts(layout)).toContain('and 4 more')
    // A square lists what fits beside the map and counts the rest.
    const sq = layoutWorkoutCard(many, { measure, format: 'square', map })
    const listed = kinds(sq, 'trophy').length
    expect(listed).toBeGreaterThan(0)
    expect(listed).toBeLessThan(4)
    expect(texts(sq)).toContain(`and ${9 - listed} more`)
  })

  it('leaves the records and the streak out when there are none', () => {
    const layout = layoutWorkoutCard({ ...model, records: [], streak: 0 }, { measure })
    expect(texts(layout)).not.toContain('New personal records')
    expect(layout.items.some(i => i.kind === 'trophy' || i.kind === 'flame')).toBe(false)
  })

  it('mirrors for a right-to-left language: lines start at the right edge, tiles run right to left', () => {
    const ltr = layoutWorkoutCard(model, { measure, map })
    const rtl = layoutWorkoutCard(model, { measure, map, rtl: true })
    expect(rtl.rtl).toBe(true)
    const title = l => l.items.find(i => i.text === 'Push')
    expect(title(rtl).x).toBe(rtl.width - title(ltr).x)
    expect(kinds(rtl, 'trophy')[0].x).toBeGreaterThan(rtl.width / 2)
    expect(kinds(rtl, 'flame')[0].x).toBeGreaterThan(rtl.width / 2)
    const first = l => kinds(l, 'tile')[0]
    expect(first(rtl).x + first(rtl).w).toBeCloseTo(rtl.width - first(ltr).x)
    expect(kinds(rtl, 'swatch').map(s => s.level)).toEqual([4, 3, 2, 1, 0])
    // The logo is a logo: it does not mirror.
    expect(kinds(rtl, 'brand')[0].x).toBe(kinds(ltr, 'brand')[0].x)
  })
})

describe('cardPalette', () => {
  it('is the app’s dark or light look with the accent, darker accent text on light paper', () => {
    const dark = cardPalette('dark', '#30d158')
    const light = cardPalette('light', '#30d158')
    expect(dark).toMatchObject({ bg: '#000000', surface: '#1c1c1e', label: '#ffffff', acc: '#30d158', accText: '#30d158' })
    expect(light).toMatchObject({ bg: '#f2f2f7', surface: '#ffffff', label: '#000000', acc: '#30d158' })
    expect(light.accText).not.toBe('#30d158')
    expect(parseColor(light.accText)[1]).toBeLessThan(parseColor('#30d158')[1])
    expect(cardPalette('dark', 'nonsense').acc).toBe('#30d158')
  })
})

describe('card colours', () => {
  it('reads hex and rgb colours, and nothing else', () => {
    expect(parseColor('#fff')).toEqual([255, 255, 255, 1])
    expect(parseColor('#30d158')).toEqual([48, 209, 88, 1])
    expect(parseColor('rgba(235,235,245,.6)')).toEqual([235, 235, 245, 0.6])
    expect(parseColor('rgb(10 20 30 / 50%)')).toEqual([10, 20, 30, 0.5])
    expect(parseColor('var(--acc)')).toBeNull()
  })

  it('mixes the way CSS color-mix(in srgb) does', () => {
    expect(mixColor('#ffffff', '#000000', 0.5)).toBe('rgb(128, 128, 128)')
    expect(mixColor('#30d158', '#1c1c1e', 1)).toBe('rgb(48, 209, 88)')
    // An unreadable colour falls back to the other one rather than to black.
    expect(mixColor('nonsense', '#1c1c1e', 0.5)).toBe('#1c1c1e')
  })

  it('shades the map from the surface towards the accent, five steps, as the app does', () => {
    const { sil, levels } = mapColors({ label: '#ffffff', surface: '#000000', acc: '#ff0000' })
    expect(sil).toBe('rgb(46, 46, 46)')
    expect(levels[0]).toBe('rgb(28, 28, 28)')
    expect(levels[4]).toBe('#ff0000')
    const reds = levels.slice(0, 4).map(c => parseColor(c)[0])
    expect([...reds].sort((a, b) => a - b)).toEqual(reds)
  })

  it('flattens a see-through label onto the surface first, as the light theme needs', () => {
    const { levels } = mapColors({ label: 'rgba(0,0,0,.5)', surface: '#ffffff', acc: '#0000ff' })
    // Half-black over white is mid-grey; 11 % of that over white.
    expect(levels[0]).toBe('rgb(241, 241, 241)')
  })

  it('reads a body view\'s height over its width from its viewBox', () => {
    expect(viewAspect({ vb: '0 95 727 1280' })).toBeCloseTo(1280 / 727)
    expect(viewAspect({})).toBeGreaterThan(1)
  })
})
