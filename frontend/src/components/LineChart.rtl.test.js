import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Full QA 146: in Persian and Arabic the line chart's SVG text anchors flipped with the page, so
// the y tick labels slid into the plot and the "↑ Harder" hint was drawn off the left edge.
describe('the line chart in a right-to-left language', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')
  const jsx = readFileSync(resolve(process.cwd(), 'src/components/LineChart.jsx'), 'utf8')
  it('keeps its SVG left to right, as it is drawn', () => {
    expect(css).toMatch(/\[dir="rtl"\] \.chart-i svg\{direction:ltr\}/)
    expect(jsx).toContain('className="chart-i"')
  })
})
