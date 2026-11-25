// Button labels against their buttons. `input` has no text-overflow, so a label wider than its button
// is clipped at both ends. Rough glyph width: 0.55 x font-size for Latin, Cyrillic and Greek, 1.0 for
// CJK and Hangul: an estimate, not a render. Languages the watch shows in English anyway are skipped.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { TEXTS, KEYS } from '../entry/src/main/js/MainAbility/common/texts.js'

const css = readFileSync(new URL('../entry/src/main/js/MainAbility/pages/index/index.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const rule = c => { const m = css.match(new RegExp('\\.' + c + '\\s*\\{([^}]*)\\}')); const o = {}; m[1].split(';').forEach(p => { const i = p.indexOf(':'); if (i > 0) o[p.slice(0, i).trim()] = p.slice(i + 1).trim() }); return o }

// the word on each button, and the class of that button in index.hml
const USES = {
  skip: 'mid3', cancel: 'menuBtn', menu: 'menuBtn', done: 'done', save: 'done', start_hold: 'done', finish_workout: 'wide', next_exercise: 'wide',
  start_workout: 'btn', quick_start: 'btn', routines: 'btn', keep_going: 'btn', finish_and_save: 'btn', discard_workout: 'btn',
  previous_set: 'btn', overview: 'btn', skip_set: 'btn', continue_workout: 'btn', stop: 'btn', try_again: 'btnA',
  checkin_skip: 'btn', save_and_start: 'longA', start_without_weighin: 'long', add_set: 'btn', remove_set: 'btn'
}
const NO_GLYPHS = ['ar', 'bn', 'fa', 'hi', 'th'] // shown in English: see view.js
const wide = ch => /[ᄀ-ᇿ⺀-鿿가-힯豈-﫿＀-￯]/.test(ch)
const need = (s, fs) => [...s].reduce((a, ch) => a + (wide(ch) ? 1.0 : 0.55) * fs, 0)

test('labels fit their buttons on the round screen (block 70% of 466) and the rectangle (336)', () => {
  const over = []
  Object.keys(TEXTS).filter(l => NO_GLYPHS.indexOf(l) < 0).forEach(lang => {
    const words = TEXTS[lang].split('\n')
    Object.keys(USES).forEach(k => {
      const p = rule(USES[k])
      const fs = parseFloat(p['font-size'])
      const frac = parseFloat(p.width) / 100
      ;[466 * 0.7, 336].forEach(scr => {
        const label = words[KEYS.indexOf(k)]
        if (need(label, fs) > frac * scr - 8) over.push(lang + ' ' + k + ' (' + USES[k] + ' ' + Math.round(frac * scr) + 'px): "' + label + '" ~' + Math.round(need(label, fs)))
      })
    })
  })
  assert.deepEqual(over, [])
})

// The check-in's title is one line, its scale words (1 = lo, 5 = hi) may take two.
test('the check-in\'s title fits one line and its scale words two, on both screens', () => {
  const over = []
  const lines = (label, fs, box) => Math.ceil(need(label, fs) / (box - 8))
  Object.keys(TEXTS).filter(l => NO_GLYPHS.indexOf(l) < 0).forEach(lang => {
    const words = TEXTS[lang].split('\n')
    const word = k => words[KEYS.indexOf(k)]
    ;[466 * 0.7, 336].forEach(scr => {
      const head = rule('head')
      if (lines(word('checkin_title'), parseFloat(head['font-size']), parseFloat(head.width) / 100 * scr) > 1) over.push(lang + ' title')
      ;['lo', 'hi'].forEach(c => {
        const p = rule(c)
        const rows = Math.floor(parseFloat(p.height) / (parseFloat(p['font-size']) + 4))
        ;['sleep', 'energy', 'sore'].forEach(q => { if (lines(word('checkin_' + q + '_' + c), parseFloat(p['font-size']), parseFloat(p.width) / 100 * scr) > rows) over.push(lang + ' ' + q + ' ' + c) })
      })
    })
  })
  assert.deepEqual(over, [])
})
