// #306: the end-of-rest sounds are played twice over, by the page (lib/sound.js, Web Audio) and by
// a locked Android phone (RestTone.java, rendered samples). The Java side cannot run here (no
// gradle in the test run), so its numbers are read out of the source and held against the table
// the page plays from: a note changed on one side only fails here.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { REST_SOUNDS, REST_SOUND_IDS } from './rest-sounds.js'
import { TIMBRES } from './sound.js'

const java = name => readFileSync(new URL(`../../android/app/src/main/java/ch/duartesantos/opengym/${name}.java`, import.meta.url), 'utf8')
const tone = java('RestTone')
const numbers = text => text.match(/-?\d+(\.\d+)?/g).map(Number)
// `{{a, b, c}, {d, e, f, g}}` → [[a, b, c], [d, e, f, g]]
const notesOf = name => {
  const m = new RegExp(`${name}\\s*=\\s*\\{(\\{[^;]*\\})\\};`).exec(tone)
  expect(m, name).toBeTruthy()
  return m[1].split(/\}\s*,\s*\{/).map(numbers)
}
const arrayOf = name => {
  const m = new RegExp(`double\\[\\] ${name}\\s*=\\s*\\{([^}]*)\\}`).exec(tone)
  expect(m, name).toBeTruthy()
  return numbers(m[1])
}
// case "bell": return withTail(renderNotes(BELL_NOTES, 0.55, 0, BELL));
const caseOf = kind => {
  const m = new RegExp(`case "${kind}": return withTail\\(renderNotes\\((\\w+), ([\\d.]+), ([\\d.]+), (\\w+)\\)\\)`).exec(tone)
  expect(m, kind).toBeTruthy()
  return { notes: notesOf(m[1]), peak: Number(m[2]), hold: Number(m[3]), timbre: m[4] }
}
const TIMBRE_OF = { BRIGHT: 'bright', BELL: 'bell', SINE: undefined }

describe('RestTone.java plays what the page plays', () => {
  it('knows every sound Settings offers, by the same names', () => {
    const kinds = /KINDS = \{([^}]*)\}/.exec(tone)[1].match(/"(\w+)"/g).map(s => s.slice(1, -1))
    expect(kinds).toEqual(REST_SOUND_IDS)
    for (const k of REST_SOUND_IDS.filter(k => k !== 'chime' && k !== 'classic')) expect(tone).toContain(`case "${k}"`)
  })

  it('has the same timbres', () => {
    expect(arrayOf('BRIGHT')).toEqual(TIMBRES.bright)
    expect(arrayOf('BELL')).toEqual(TIMBRES.bell)
    expect(arrayOf('SINE')).toEqual([1])
  })

  it('has the chime\'s notes, peak and hold', () => {
    expect(notesOf('CHIME')).toEqual(REST_SOUNDS.chime.notes)
    expect(Number(/CHIME_PEAK = ([\d.]+);/.exec(tone)[1])).toBe(REST_SOUNDS.chime.peak)
    expect(Number(/CHIME_HOLD = ([\d.]+);/.exec(tone)[1])).toBe(REST_SOUNDS.chime.hold)
  })

  it('has every other sound number for number', () => {
    for (const k of ['bell', 'beep', 'whistle', 'soft']) {
      const j = caseOf(k), page = REST_SOUNDS[k]
      expect(j.notes, k).toEqual(page.notes)
      expect([j.peak, j.hold, TIMBRE_OF[j.timbre]], k).toEqual([page.peak, page.hold, page.timbre])
    }
  })

  it('takes the sound from the page by name, and the old classic switch from a page before it', () => {
    expect(java('RestAlertPlugin')).toMatch(/call\.getString\("tone", Boolean\.TRUE\.equals\(call\.getBoolean\("classic", Boolean\.FALSE\)\) \? "classic" : "chime"\)/)
    const alert = java('RestAlert')
    expect(alert).toMatch(/intent\.getStringExtra\("tone"\)/)
    expect(alert).toMatch(/RestTone\.render\(tone\)/)
  })
})
