// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { ACCENTS } from './format.js'
import {
  cleanHex, sanitizeAccent, accentKey, accentValue, contrast, inkOn, readableIn, adjustedIn,
  customAccentVars, accentPair, applyAccent, THEMES, isGrey, inkOnBoth, mix, GREY_TEXT, GREY_GAP,
} from './accent.js'
import { mergeStates, stampChange } from './sync-merge.js'

describe('cleanHex', () => {
  it('takes #rrggbb only, in lowercase', () => {
    expect(cleanHex('#A1b2C3')).toBe('#a1b2c3')
    expect(cleanHex(' #00ff00 ')).toBe('#00ff00')
    for (const bad of ['#abc', 'abcdef', '#abcdeg', '#abcdef00', 'red', 'rgb(1,2,3)', '', null, undefined, 123, {}, ['#abcdef'],
      '#000000;background:url(x)', '#000000}body{display:none', 'var(--x)'])
      expect(cleanHex(bad), String(bad)).toBe(null)
  })
})

describe('sanitizeAccent', () => {
  it('drops a malformed own colour and keeps a good one', () => {
    expect(sanitizeAccent({ accent: 'custom', accentCustom: '#FF00AA' })).toEqual({ accent: 'custom', accentCustom: '#ff00aa' })
    expect(sanitizeAccent({ accent: 'custom', accentCustom: 'red;}' })).toEqual({ accent: 'custom' })
  })
  it('keeps an unknown preset word (a newer app’s) but not junk', () => {
    expect(sanitizeAccent({ accent: 'mint' }).accent).toBe('mint')
    expect(sanitizeAccent({ accent: '"><script>' }).accent).toBe('lime')
    expect(sanitizeAccent({ accent: 42 }).accent).toBe('lime')
    expect(sanitizeAccent({ theme: 'dark' })).toEqual({ theme: 'dark' })
  })
})

describe('accentKey / accentValue', () => {
  it('draws a preset, the own colour, or the default', () => {
    expect(accentKey({ accent: 'sky' })).toBe('sky')
    expect(accentKey({})).toBe('lime')
    expect(accentKey({ accent: 'mint' })).toBe('lime')
    expect(accentKey({ accent: 'toString' })).toBe('lime')
    expect(accentKey({ accent: 'custom' })).toBe('lime')
    expect(accentKey({ accent: 'custom', accentCustom: 'nope' })).toBe('lime')
    expect(accentValue({ accent: 'custom', accentCustom: '#123ABC' })).toBe('#123abc')
    // the own colour is kept while a preset is the accent
    expect(accentValue({ accent: 'red', accentCustom: '#123abc' })).toBe('red')
  })
})

describe('contrast and the text on the accent', () => {
  it('measures WCAG contrast', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrast('#777777', '#777777')).toBeCloseTo(1, 5)
  })
  it('puts black on light colours and white on dark ones', () => {
    expect(inkOn('#ffd60a')).toBe('#000000')
    expect(inkOn('#30d158')).toBe('#000000')
    expect(inkOn('#1a237e')).toBe('#ffffff')
    expect(inkOn('#8b0000')).toBe('#ffffff')
  })
  it('the chosen ink always reads at least 4.5:1', () => {
    for (let i = 0; i < 400; i++) {
      const hex = '#' + Math.floor((i * 2654435761) % 0xffffff).toString(16).padStart(6, '0')
      expect(contrast(hex, inkOn(hex)), hex).toBeGreaterThanOrEqual(4.5)
    }
  })
})

describe('readable on the theme', () => {
  const darkPresets = ['#30d158', '#0a84ff', '#ff9f0a', '#bf5af2', '#ff375f', '#ff453a', '#40c8e0', '#ffd60a']
  const lightPresets = ['#34c759', '#007aff', '#ff9500', '#af52de', '#ff2d55', '#ff3b30', '#30b0c7']
  it('leaves every dark preset shade as it is, and darkens the light ones under 3:1', () => {
    for (const c of darkPresets) expect(adjustedIn(c, 'dark'), c).toBe(false)
    // the presets draw their own index.css shades; as an own colour, Apple's light green,
    // orange and teal (about 2:1 on the light page) are taken a step darker
    for (const c of lightPresets) {
      const r = readableIn(c, 'light')
      for (const bg of THEMES.light.bgs) expect(contrast(r, bg), c).toBeGreaterThanOrEqual(3)
    }
    expect(adjustedIn('#007aff', 'light')).toBe(false)
    expect(adjustedIn('#ffcc00', 'light')).toBe(true)
  })
  it('an own colour reaches 3:1 on both fills of either theme', () => {
    for (let i = 0; i < 600; i++) {
      const hex = '#' + Math.floor((i * 2654435761) % 0xffffff).toString(16).padStart(6, '0')
      for (const theme of ['dark', 'light'])
        for (const bg of THEMES[theme].bgs) expect(contrast(readableIn(hex, theme), bg), hex + ' ' + theme).toBeGreaterThanOrEqual(3)
    }
  })
  it('bright yellow in light mode turns a dark gold, not olive', () => {
    const y = readableIn('#ffff00', 'light')
    const [r, g, b] = [1, 3, 5].map(i => parseInt(y.slice(i, i + 2), 16))
    expect(r).toBeGreaterThan(g)       // towards orange: red leads green
    expect(b).toBeLessThan(20)
  })
  it('a grey never ends up near the secondary label colour', () => {
    // white in light mode and black in dark mode, a mid grey, near-whites and near-blacks
    const greys = ['#ffffff', '#000000', '#808080', '#f5f5f5', '#fafafa', '#0a0a0a', '#1c1c1e', '#9a9a9a', '#707070', '#f0f0f5', '#c8c8c8']
    for (const g of greys) {
      expect(isGrey(g), g).toBe(true)
      for (const theme of ['dark', 'light']) {
        const r = readableIn(g, theme)
        for (const bg of THEMES[theme].bgs) expect(contrast(r, bg), g + ' ' + theme).toBeGreaterThanOrEqual(GREY_TEXT)
        for (const l2 of THEMES[theme].label2) expect(contrast(r, l2), g + ' ' + theme).toBeGreaterThanOrEqual(GREY_GAP)
      }
    }
    // a grey that already stands apart is left alone
    expect(readableIn('#333333', 'light')).toBe('#333333')
    expect(readableIn('#e0e0e0', 'dark')).toBe('#e0e0e0')
    expect(isGrey('#ff00aa')).toBe(false)
  })
  it('lightens a very dark colour in dark mode and darkens a very light one in light mode', () => {
    const navy = readableIn('#000033', 'dark')
    expect(navy).not.toBe('#000033')
    for (const bg of THEMES.dark.bgs) expect(contrast(navy, bg)).toBeGreaterThanOrEqual(THEMES.dark.min)
    expect(readableIn('#000033', 'light')).toBe('#000033')
    const pale = readableIn('#fff8e1', 'light')
    expect(pale).not.toBe('#fff8e1')
    for (const bg of THEMES.light.bgs) expect(contrast(pale, bg)).toBeGreaterThanOrEqual(THEMES.light.min)
    expect(readableIn('#fff8e1', 'dark')).toBe('#fff8e1')
    // the extremes still end somewhere readable
    expect(contrast(readableIn('#000000', 'dark'), '#1c1c1e')).toBeGreaterThanOrEqual(3)
    expect(contrast(readableIn('#ffffff', 'light'), '#f2f2f7')).toBeGreaterThanOrEqual(4.5)
  })
  it('a colour with a hue is never adjusted for both themes', () => {
    for (let i = 0; i < 400; i++) {
      const hex = '#' + Math.floor((i * 40503 * 977) % 0xffffff).toString(16).padStart(6, '0')
      if (isGrey(hex)) continue
      expect(adjustedIn(hex, 'dark') && adjustedIn(hex, 'light'), hex).toBe(false)
    }
  })
})

describe('CSS for the own colour', () => {
  it('derives the accent, its pressed shade and its text', () => {
    expect(customAccentVars('#0a84ff', 'dark')).toEqual({ '--acc': '#0a84ff', '--acc-2': '#0863bf', '--on-acc': '#000000', '--knob-ring': 'transparent' })
    const v = customAccentVars('#000033', 'dark')
    expect(v['--acc']).toBe(readableIn('#000033', 'dark'))
    expect(v['--on-acc']).toBe(inkOn(v['--acc']))
  })
  it('the button text reads on the pressed shade too, not only at rest', () => {
    // #eb0037 in dark mode: black reads on it at rest but only 2.9:1 on its pressed shade
    const red = customAccentVars('#eb0037', 'dark')
    expect(red['--on-acc']).toBe('#ffffff')
    expect(contrast(red['--acc-2'], red['--on-acc'])).toBeGreaterThanOrEqual(3)
    let restMin = 99
    for (let r = 0; r < 256; r += 15) for (let g = 0; g < 256; g += 15) for (let b = 0; b < 256; b += 15) {
      const hex = '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('')
      for (const theme of ['dark', 'light']) {
        const v = customAccentVars(hex, theme)
        expect(contrast(v['--acc-2'], v['--on-acc']), hex + ' ' + theme).toBeGreaterThanOrEqual(3)
        restMin = Math.min(restMin, contrast(v['--acc'], v['--on-acc']))
      }
    }
    expect(restMin).toBeGreaterThanOrEqual(4.3)
    // the ink keeps inkOn's pick whenever that one holds on the pressed shade
    expect(inkOnBoth('#30d158', mix('#30d158', '#000000', 0.25))).toBe('#000000')
  })
  it('rings the switch knob on an accent nearly as light as it', () => {
    expect(customAccentVars('#ffffff', 'dark')['--knob-ring']).not.toBe('transparent')
    expect(customAccentVars('#fff6c2', 'dark')['--knob-ring']).not.toBe('transparent')
    expect(customAccentVars('#ffff00', 'dark')['--knob-ring']).not.toBe('transparent')
    expect(customAccentVars('#ffffff', 'light')['--knob-ring']).toBe('transparent')
    expect(customAccentVars('#0a84ff', 'dark')['--knob-ring']).toBe('transparent')
  })
  it('gives nothing for a value that is not a colour', () => {
    expect(customAccentVars('red}body{', 'dark')).toBe(null)
    expect(customAccentVars('lime', 'dark')).toBe(null)
  })
  it('puts a preset or the own colour on the page root and takes the own colour off again', () => {
    const el = document.createElement('html')
    applyAccent(el, '#ff00aa', 'light')
    expect(el.dataset.accent).toBe('custom')
    expect(el.style.getPropertyValue('--acc')).toBe('#ff00aa')
    expect(el.style.getPropertyValue('--on-acc')).toBe(inkOn('#ff00aa'))
    applyAccent(el, 'sky', 'light')
    expect(el.dataset.accent).toBe('sky')
    expect(el.style.getPropertyValue('--acc')).toBe('')
    expect(el.style.getPropertyValue('--knob-ring')).toBe('')
    applyAccent(el, 'url(x)', 'dark')
    expect(el.dataset.accent).toBe('lime')
  })
})

describe('the native countdown colours', () => {
  it('takes a preset key or the own colour', () => {
    expect(accentPair('sky')).toEqual({ accent: ACCENTS.sky, ink: '#ffffff' })
    expect(accentPair('#ffd60a')).toEqual({ accent: '#ffd60a', ink: '#000000' })
    expect(accentPair('nonsense')).toEqual({ accent: ACCENTS.lime, ink: '#000000' })
    expect(accentPair(undefined)).toEqual({ accent: ACCENTS.lime, ink: '#000000' })
  })
})

describe('sync with an app from before own colours', () => {
  const base = { _ts: 1, unit: 'kg', workouts: [], routines: [], bodyweight: [] }
  it('an older copy picking a preset keeps the own colour for later', () => {
    const mine = { ...base, _ts: 10, accent: 'custom', accentCustom: '#ff00aa', edited: { accent: 10, accentCustom: 10 } }
    // the old app knows nothing of accentCustom; its copy still carries it untouched
    const old = { ...base, _ts: 20, accent: 'sky', accentCustom: '#ff00aa', edited: { accent: 20, accentCustom: 10 } }
    const out = mergeStates(mine, old)
    expect(out.accent).toBe('sky')
    expect(out.accentCustom).toBe('#ff00aa')
    expect(accentValue(out)).toBe('sky')
  })
  it('an older copy without the field does not lose it, and a newer one draws it', () => {
    const mine = { ...base, _ts: 30, accent: 'custom', accentCustom: '#123456', edited: { accent: 30, accentCustom: 30 } }
    const old = { ...base, _ts: 20, accent: 'lime' }
    const out = mergeStates(old, mine)
    expect(accentValue(out)).toBe('#123456')
  })
  it('what an old app makes of "custom": its own default, nothing broken', () => {
    // App.jsx before own colours: ACCENTS[accent] ? accent : 'lime'
    const S = { accent: 'custom', accentCustom: '#123456' }
    expect(ACCENTS[S.accent] ? S.accent : 'lime').toBe('lime')
  })
  it('a malformed colour from the other copy is dropped by the merge', () => {
    const mine = { ...base, _ts: 10, accent: 'red' }
    const theirs = { ...base, _ts: 20, accent: 'custom', accentCustom: '#fff;}*{color:red' }
    const out = mergeStates(mine, theirs)
    expect('accentCustom' in out).toBe(false)
    expect(accentValue(out)).toBe('lime')
  })
})

describe('an own colour and a preset picked on two devices', () => {
  // QA round 2 (2026-10-06): with the own colour already on, a new one changed only accentCustom,
  // so a preset picked earlier on the other device kept `accent` and the newer choice was undone.
  const T = 1_800_000_000_000
  const base = { _ts: T, unit: 'kg', workouts: [], routines: [], bodyweight: [], accent: 'custom', accentCustom: '#ff0000' }
  const change = (prev, wall, mut) => { const n = JSON.parse(JSON.stringify(prev)); mut(n); n._ts = stampChange(prev, n, wall); return n }
  it('a new own colour picked later wins both fields, in either merge order', () => {
    const B = change(base, T + 1000, s => { s.accent = 'sky' })
    const A = change(base, T + 4000, s => { s.accent = 'custom'; s.accentCustom = '#00aa00' })
    for (const out of [mergeStates(A, B), mergeStates(B, A)]) {
      expect(out.accent).toBe('custom')
      expect(out.accentCustom).toBe('#00aa00')
    }
  })
  it('a preset picked later still wins over an own colour picked earlier', () => {
    const A = change(base, T + 1000, s => { s.accent = 'custom'; s.accentCustom = '#00aa00' })
    const B = change(base, T + 4000, s => { s.accent = 'sky' })
    for (const out of [mergeStates(A, B), mergeStates(B, A)]) expect(out.accent).toBe('sky')
  })
})
