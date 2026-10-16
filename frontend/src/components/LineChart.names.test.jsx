// @vitest-environment happy-dom
// A chart is named for a screen reader: what it shows and where the line starts and ends. The
// guard at the bottom keeps every call site naming its chart (or saying why it need not).
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import LineChart from './LineChart.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const day = iso => new Date(iso + 'T12:00:00').getTime()
const points = [
  { t: day('2026-01-03'), y: 80.5, d: '2026-01-03' },
  { t: day('2026-02-01'), y: 79, d: '2026-02-01' },
  { t: day('2026-03-12'), y: 78.2, d: '2026-03-12' },
]

let host, root
afterEach(() => { act(() => root.unmount()); host.remove() })
const draw = props => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(<LineChart points={points} unit="kg" {...props} />))
  return host.querySelector('svg')
}

describe('LineChart: accessible name', () => {
  it('is an image named by its label, first and last reading', () => {
    const svg = draw({ label: 'Weight' })
    expect(svg.getAttribute('role')).toBe('img')
    expect(svg.getAttribute('aria-label')).toBe('Weight: 80.5 kg on Sat 3 Jan, 78.2 kg on Thu 12 Mar')
    expect(svg.getAttribute('aria-hidden')).toBeNull()
  })

  it('reads the first series of a multi-line chart', () => {
    const svg = draw({ label: 'Reps in each set', series: [{ points: points.slice(1), color: 'red' }, { points, color: 'blue' }] })
    expect(svg.getAttribute('aria-label')).toBe('Reps in each set: 79 kg on Sun 1 Feb, 78.2 kg on Thu 12 Mar')
  })

  it('hides a decorative chart from a screen reader', () => {
    const svg = draw({ decorative: true })
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(svg.getAttribute('aria-label')).toBeNull()
  })

  it('leaves the name to a parent when given no label', () => {
    const svg = draw({})
    expect(svg.getAttribute('role')).toBeNull()
    expect(svg.getAttribute('aria-hidden')).toBeNull()
  })
})

function sources(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) sources(p, out)
    else if (/\.jsx$/.test(name) && !/\.test\.jsx$/.test(name)) out.push(p)
  }
  return out
}

describe('LineChart call sites', () => {
  it('each names its chart, hides it, or sits inside ChartData', () => {
    const bare = []
    for (const file of sources(join(import.meta.dirname, '..'))) {
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, i) => {
        if (!line.includes('<LineChart')) return
        const named = /\blabel=|\bdecorative\b/.test(line) || /<ChartData\b/.test(lines.slice(Math.max(0, i - 2), i).join('\n'))
        if (!named) bare.push(`${file}:${i + 1}`)
      })
    }
    expect(bare).toEqual([])
  })
})
