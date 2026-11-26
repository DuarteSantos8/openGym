// Button labels against their buttons. `input` has no text-overflow, so a label wider than its button
// is clipped at both ends. Rough glyph width: 0.55 x font-size for Latin, Cyrillic and Greek, 1.0 for
// CJK and Hangul: an estimate, not a render. Languages with no i18n file show English, which en-US covers.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { FILES } from './i18n.js'

const css = ['index', 'lift'].map(p => readFileSync(new URL('../entry/src/main/js/MainAbility/pages/' + p + '/index.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')).join('\n')
const rule = c => { const m = css.match(new RegExp('\\.' + c + '\\s*\\{([^}]*)\\}')); const o = {}; m[1].split(';').forEach(p => { const i = p.indexOf(':'); if (i > 0) o[p.slice(0, i).trim()] = p.slice(i + 1).trim() }); return o }

// the word on each button, and the class of that button in the pages' index.hml
const USES = {
  skip: 'capMid', cancel: 'pill', menu: 'menuS', done: 'done', save: 'done', start_hold: 'done', finish_workout: 'wide', next_exercise: 'wide',
  start_workout: 'btn', quick_start: 'btn', routines: 'btn', keep_going: 'btn', finish_and_save: 'btn', discard_workout: 'btn',
  previous_set: 'btn', overview: 'btn', skip_set: 'btn', continue_workout: 'btn', stop: 'btn', try_again: 'btnA'
}
const wide = ch => /[ᄀ-ᇿ⺀-鿿가-힯豈-﫿＀-￯]/.test(ch)
const need = (s, fs) => [...s].reduce((a, ch) => a + (wide(ch) ? 1.0 : 0.55) * fs, 0)

test('labels fit their buttons on the round screen (the 90% block) and the rectangle (336)', () => {
  const over = []
  Object.keys(FILES).forEach(lang => {
    const words = FILES[lang]
    Object.keys(USES).forEach(k => {
      const p = rule(USES[k])
      const fs = parseFloat(p['font-size'])
      const frac = parseFloat(p.width) / 100
      ;[466, 336].map(w => w * parseFloat(rule('scr').width) / 100).forEach(scr => {
        const label = words[k]
        if (need(label, fs) > frac * scr - 8) over.push(lang + ' ' + k + ' (' + USES[k] + ' ' + Math.round(frac * scr) + 'px): "' + label + '" ~' + Math.round(need(label, fs)))
      })
    })
  })
  assert.deepEqual(over, [])
})

// The words the Set page and the 3-2-1 draw in boxes the table above does not cover: the pill ("12/12 Menu"), the
// tiles' upper-case labels (a tile is 48% of the block) and "Go!" inside the 3-2-1's ring (200 px, a 12 px stroke).
const BOXES = [
  ['pill', k => '12/12 ' + k.menu, 'pill', () => parseFloat(rule('pill').width)],
  ['weight tile', k => k.weight.toUpperCase(), 'tLabel', scr => 0.48 * scr],
  ['added weight tile', k => (k.added_weight.length <= 14 ? k.added_weight : k.weight).toUpperCase(), 'tLabel', scr => 0.48 * scr],
  ['reps tile', k => k.reps.toUpperCase(), 'tLabel', scr => 0.48 * scr],
  ['hold tile', k => k.hold.toUpperCase(), 'tLabel', scr => 0.48 * scr],
  ['Go!', k => k.go, 'cGo', () => 200 - 24]
]
test('the pill, the tile labels and Go! fit their boxes on the round screen and the rectangle', () => {
  const over = []
  Object.keys(FILES).forEach(lang => {
    const k = FILES[lang]
    BOXES.forEach(([what, label, cls, box]) => {
      ;[466, 336].map(w => w * parseFloat(rule('scr').width) / 100).forEach(scr => {
        const fs = parseFloat(rule(cls)['font-size'])
        if (need(label(k), fs) > box(scr) - 8) over.push(lang + ' ' + what + ' "' + label(k) + '" ~' + Math.round(need(label(k), fs)) + ' in ' + Math.round(box(scr)))
      })
    })
  })
  assert.deepEqual(over, [])
})
