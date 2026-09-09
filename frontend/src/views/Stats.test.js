import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { bestWeightForEntry, metricModeForEntry, metricRowsForEntry } from '../lib/history.js'

const source = readFileSync(new URL('./Stats.jsx', import.meta.url), 'utf8')
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
    expect(cssSource).toContain('flex:0 1 auto;max-width:45%;min-width:0;')
    expect(cssSource).toContain('overflow:hidden;text-overflow:ellipsis;white-space:nowrap')
  })
})
