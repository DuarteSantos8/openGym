// @vitest-environment happy-dom
// Own icons instead of system emoji ("is there any plan to replace system emojis like 🔥, medals
// and ❄️ with custom icons that match the rest of the app?"): every picture the app uses as UI is
// openGym's icon, and Settings → Icons → Emoji brings the emoji back for those who want them.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import Glyph, { EmojiText, splitEmoji } from './Glyph.jsx'
import { Medal, StreakFlame, Freezes } from './Streak.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const render = el => {
  const host = document.createElement('div')
  const root = createRoot(host)
  act(() => root.render(el))
  return host
}

describe('Glyph', () => {
  it('carries the icon and the emoji, one of which the stylesheet shows', () => {
    const h = render(<Glyph icon="flame" emoji="🔥" />)
    expect(h.querySelector('.glyph svg[data-icon="flame"]')).toBeTruthy()
    expect(h.querySelector('.glyph .glyph-e').textContent).toBe('🔥')
    expect(h.querySelector('.glyph').getAttribute('aria-hidden')).toBe('true')
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')
    expect(css).toMatch(/\.glyph-e\{display:none/)
    expect(css).toMatch(/:root\[data-icons="emoji"\] \.glyph-e\{display:inline\}/)
    expect(css).toMatch(/:root\[data-icons="emoji"\] \.glyph > svg\{display:none\}/)
  })

  it('names itself when it is all there is', () => {
    const h = render(<Glyph icon="flame" emoji="🔥" label="Warm-up" />)
    expect(h.querySelector('.glyph').getAttribute('aria-label')).toBe('Warm-up')
  })

  it('takes an emoji off the end of a translated line', () => {
    expect(splitEmoji('Your 2026 in openGym is ready 🎉')).toEqual({ text: 'Your 2026 in openGym is ready', emoji: '🎉' })
    expect(splitEmoji('No peeking 👀')).toEqual({ text: 'No peeking', emoji: '👀' })
    expect(splitEmoji('🎄 Advent')).toEqual({ text: 'Advent', emoji: '🎄' })
    expect(splitEmoji('Plain')).toEqual({ text: 'Plain', emoji: '' })
    const h = render(<EmojiText text="Ready 🎉" />)
    expect(h.textContent).toBe('Ready 🎉')
    expect(h.querySelector('.glyph-e')).toBeTruthy()
  })

  it('the streak flame, the medals and the freezes have their emoji beside the drawing', () => {
    expect(render(<StreakFlame />).querySelector('.glyph-e').textContent).toBe('🔥')
    expect(render(<StreakFlame lit={false} />).querySelector('.glyph-e')).toBe(null)
    expect(render(<Medal tier="gold" />).querySelector('.glyph-e').textContent).toBe('🥇')
    expect(render(<Medal tier="locked" />).querySelector('.glyph-e')).toBe(null)
    expect(render(<Freezes n={1} />).querySelectorAll('.glyph-e')).toHaveLength(1)
  })
})

// No emoji drawn as UI in the app's own screens: notifications (the system draws those), share
// text, and the words of a translation are left alone; a Glyph's emoji is the opt-in fallback.
describe('no system emoji in the app\'s UI', () => {
  const SRC = resolve(process.cwd(), 'src')
  const files = (dir, out = []) => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n)
      if (statSync(p).isDirectory()) { if (!['locales', 'exercise-names', 'exercise-desc', 'instr', 'fixtures'].includes(n)) files(p, out) } else if (/\.jsx$/.test(n) && !/\.test\./.test(n)) out.push(p)
    }
    return out
  }
  const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2744}\u{2B50}\u{2705}\u{21BB}]/u
  // What may still hold one: a Glyph's emoji= fallback, a t('…') key (its words), a comment.
  const allowed = line => /emoji=|glyph-e|svgEmoji\('|t\('[^']*[\u{1F300}-\u{1FAFF}]|MEDAL_EMOJI|\[\['\w+', '/u.test(line)
  const code = line => line.replace(/\/\*.*?\*\//g, '').replace(/(^|\s)\/\/.*$/, '').replace(/^\s*\*.*$/, '')
  it('only as the emoji fallback of a Glyph, a translated line or a comment', () => {
    const hits = []
    for (const f of files(SRC)) {
      readFileSync(f, 'utf8').split('\n').forEach((l, i) => { if (EMOJI.test(code(l)) && !allowed(code(l))) hits.push(`${f.slice(SRC.length + 1)}:${i + 1}: ${l.trim().slice(0, 90)}`) })
    }
    expect(hits).toEqual([])
  })

  it('the share cards draw their trophy instead of typing one', () => {
    for (const f of ['lib/workout-card.js', 'lib/wrapped-cards.js']) expect(readFileSync(join(SRC, f), 'utf8')).not.toMatch(/🏆/u)
  })
})
