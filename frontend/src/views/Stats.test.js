import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { bestWeightForEntry, metricModeForEntry, metricRowsForEntry } from '../lib/history.js'

const source = readFileSync(new URL('./Stats.jsx', import.meta.url), 'utf8')
const profileSource = readFileSync(new URL('./Profile.jsx', import.meta.url), 'utf8')
const socialSource = readFileSync(new URL('./Social.jsx', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8')
const tabBarSource = readFileSync(new URL('../components/TabBar.jsx', import.meta.url), 'utf8')
const uiSource = readFileSync(new URL('../components/ui.jsx', import.meta.url), 'utf8')
const cssSource = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

describe('Stats mixed-entry metric contract', () => {
  it('selects authoritative reps rows before timed rows without stale topW', () => {
    const entry = { target: { mode: 'time', sec: 60 }, topW: 200, sets: [
      { phase: 'work', mode: 'reps', w: 100, r: 5, done: true },
      { phase: 'work', mode: 'time', w: 200, sec: 60, done: true }
    ] }
    expect(metricModeForEntry(entry)).toBe('reps')
    expect(metricRowsForEntry(entry, metricModeForEntry(entry))).toEqual([entry.sets[0]])
    expect(bestWeightForEntry(entry)).toBe(100)
  })

  it('renders one clickable muscle exercise list rather than a duplicate non-clickable copy', () => {
    expect((source.match(/muscleExercises\.length \? muscleExercises\.map\(row =>/g) || []).length).toBe(1)
    expect(source).toContain('{...tappable(() => onExercise && onExercise(row.id))}')
  })

  it('uses the shared metric mode and row helpers rather than entryMode as a chart gate', () => {
    expect(source).toContain('metricModeForEntry')
    expect(source).toContain('metricRowsForEntry')
    expect(source).toContain('bestWeightForEntry')
    expect(source).not.toContain('const loggedMode = entryMode(en)')
    expect(source).not.toContain('(en.topW || 0)')
  })

  it('stacks the Stats exercise selector value without changing shared SelectRow defaults', () => {
    expect(source).toContain("onChange={setExId} stackedValue")
    expect(uiSource).toContain('sheetTitle, stackedValue = false')
    expect(uiSource).toContain("className={stackedValue ? 'lrow-stack-value' : ''}")
    expect(cssSource).toContain('.lrow.lrow-stack-value .lrow-m{grid-column:1;grid-row:1}')
    expect(cssSource).toContain('.lrow.lrow-stack-value .lrow-v{grid-column:1;grid-row:2;width:100%;max-width:none;text-align:left}')
    expect(cssSource).toContain('flex:0 1 auto;max-width:55%;min-width:0;')
    expect(cssSource).toContain('overflow:hidden;text-overflow:ellipsis;white-space:nowrap')
  })
})

describe('Profile navigation contract', () => {
  it('merges Stats and Social into one persistent Profile destination', () => {
    expect(tabBarSource).toContain('k="profile"')
    expect(tabBarSource).not.toContain('k="stats"')
    expect(tabBarSource).not.toContain('k="social"')
    expect(appSource).toContain('<Route path="/profile" element={<Profile />} />')
    expect(appSource).not.toContain('<Route path="/stats"')
    expect(appSource).not.toContain('<Route path="/social"')
  })

  it('keeps the identity header mounted while switching embedded content', () => {
    expect(profileSource).toContain("new URLSearchParams(loc.search).get('view')")
    expect(profileSource).toContain("view === 'stats' ? <Stats embedded /> : <Social embedded />")
    expect(source).toContain('export default function Stats({ embedded = false })')
    expect(socialSource).toContain('export default function Social({ embedded = false })')
  })

  it('gives the segmented profile sections tab semantics', () => {
    expect(profileSource).toContain('tablist ariaLabel={t(\'Profile sections\')}')
    expect(uiSource).toContain("role={tablist ? 'tablist' : undefined}")
    expect(uiSource).toContain("role={tablist ? 'tab' : undefined}")
    expect(uiSource).toContain('aria-selected={tablist ? o.value === value : undefined}')
  })
})
