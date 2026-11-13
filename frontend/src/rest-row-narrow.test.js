// The iPhone rest row at 320 pt (SE with Display Zoom): clock, −15, +15, pause and Skip did not
// fit in the row's 258 px and Skip ran off screen. Below 340 px Skip shows its icon only.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = f => readFileSync(resolve(process.cwd(), f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const css = read('src/index.css')

describe('rest row on a narrow iPhone', () => {
  const narrow = css.match(/@media \(max-width:339px\)\{([\s\S]*?)\n\}/)?.[1] || ''
  it('hides the Skip icon at normal width', () => {
    expect(css).toMatch(/:root\[data-platform="ios"\] \.trow \.sk \.icn\{display:none\}/)
  })
  it('below 340 px shows the icon, hides the word and tightens the row', () => {
    expect(narrow).toMatch(/\.trow \.sk \.icn\{display:inline-block\}/)
    expect(narrow).toMatch(/\.trow \.sk span\{display:none\}/)
    expect(narrow).toMatch(/\.trow \.sk\{min-width:44px\}/)
    expect(narrow).toMatch(/\.trow\{[^}]*gap:4px[^}]*padding-inline-start:12px/)
    expect(narrow).toMatch(/\.trow \.acts\{gap:4px\}/)
  })
  it('keeps the row height, so no spacing above it moves', () => {
    expect(narrow).not.toMatch(/height|--rh/)
  })
})

describe('Coach composer above the docked rest row', () => {
  const coach = read('src/coach.css')
  it('lifts the composer and the chat list by the row height while a rest docks', () => {
    expect(coach).toMatch(/:root\[data-platform="ios"\] body:has\(\.trow\.dock\) \.composer\{bottom:calc\(54px \+ var\(--sab\)\);padding-bottom:10px\}/)
    expect(coach).toMatch(/:root\[data-platform="ios"\] body:has\(\.trow\.dock\) \.chat\{padding-bottom:calc\(94px \+ var\(--sab\) \+ var\(--composer-extra,0px\)\)\}/)
  })
})
