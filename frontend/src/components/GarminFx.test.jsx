import { describe, it, expect } from 'vitest'
import { renderToString } from 'react-dom/server'
import { nearest, CountUp, GHead, Ring } from './GarminFx.jsx'

describe('GarminFx', () => {
  it('picks the nearest point', () => {
    expect(nearest([10, 20, 30], 0)).toBe(0)
    expect(nearest([10, 20, 30], 24)).toBe(1)
    expect(nearest([10, 20, 30], 99)).toBe(2)
  })
  it('renders final values on the server and the (i) popover', () => {
    expect(renderToString(<CountUp value={8003} fmt={v => Math.round(v).toLocaleString('en')} />)).toContain('8,003')
    const h = renderToString(<GHead label="Fitness age" info="fitness" />)
    expect(h).toContain('popover')
    expect(h).toContain('About ')
    expect(renderToString(<Ring f={2} />)).toContain('--f:100')
  })
})
