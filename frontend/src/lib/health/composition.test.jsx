// @vitest-environment happy-dom
// The body composition values a scale's cloud brings (api/health/composition.js): known to the
// health area, named in every language, a RENPHO reading labelled as such, and the segmental
// analysis built from the latest weigh-in that has segment values.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { COMPOSITION } from '../../../../api/health/composition.js'
import { HEALTH_METRICS, BIA_TYPES } from './metrics.js'
import { sourceLabel } from './providers.js'
import SegmentalAnalysis, { latestSegmental } from '../../components/SegmentalAnalysis.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe('composition types', () => {
  it('are health metrics; the segmental ones are marked, and none of the cloud-only ones is in the form', () => {
    for (const type of Object.keys(COMPOSITION)) expect(HEALTH_METRICS[type], type).toBeTruthy()
    expect(HEALTH_METRICS.segFatLeftArm.seg).toEqual({ kind: 'segFat', part: 'leftArm' })
    expect(HEALTH_METRICS.imp100Trunk.unit).toBe('Ω')
    expect(BIA_TYPES).toContain('muscleMass')
    expect(BIA_TYPES).not.toContain('skeletalMuscle')
    expect(BIA_TYPES).not.toContain('segFatLeftArm')
  })

  it('have a name in every locale pack', async () => {
    const dir = resolve(__dirname, '../../locales')
    for (const f of readdirSync(dir).filter(f => /^[a-z]{2}(-[A-Z]{2})?\.js$/.test(f) && f !== 'pt-BR.js')) {
      const pack = (await import(/* @vite-ignore */ resolve(dir, f))).default
      for (const x of Object.values(COMPOSITION)) expect(pack[x.label], `${f}: ${x.label}`).toBeTruthy()
    }
    expect(readFileSync(resolve(dir, 'pt-BR.js'), 'utf8')).toContain("'Fat, left arm'")
  })

  it('a RENPHO reading says RENPHO, a typed one Manual', () => {
    expect(sourceLabel('renpho')).toBe('RENPHO')
    expect(sourceLabel('manual')).toBe('Manual')
  })
})

const rec = (g, t, type, v) => ({ id: g + type, g, t, d: '2026-10-1' + (t % 10), type, v, src: 'renpho' })

describe('segmental analysis', () => {
  it('takes the latest weigh-in with segment values, not a later one without', () => {
    const health = [
      rec('renpho:1', 1, 'segFatLeftArm', 1.2), rec('renpho:1', 1, 'segFatRightArm', 1.4),
      rec('renpho:2', 2, 'segMuscleLeftLeg', 9.1), rec('renpho:2', 2, 'imp20Trunk', 25),
      rec('renpho:3', 3, 'weight', 80),
    ]
    const m = latestSegmental(health)
    expect(m.g).toBe('renpho:2')
    expect(m.values).toEqual({ segMuscleLeftLeg: 9.1, imp20Trunk: 25 })
    expect(latestSegmental([rec('x', 1, 'weight', 80)])).toBe(null)
  })

  it('shows left against right, muscle and fat apart, the trunk, and both impedances', () => {
    const health = [
      ['segMuscleLeftArm', 3.1], ['segMuscleRightArm', 3.3], ['segMuscleLeftLeg', 9.6], ['segMuscleRightLeg', 9.4], ['segMuscleTrunk', 24.2],
      ['segFatLeftArm', 1.1], ['segFatRightArm', 1.2], ['segFatTrunk', 8.4],
      ['imp20LeftArm', 300], ['imp100LeftArm', 280], ['imp20Trunk', 22],
    ].map(([type, v]) => rec('renpho:9', 9, type, v))
    const host = document.createElement('div')
    const root = createRoot(host)
    act(() => root.render(<SegmentalAnalysis health={health} />))
    const text = host.textContent
    expect(text).toContain('Segmental analysis')
    expect(text).toContain('RENPHO')
    const cards = [...host.querySelectorAll('.seg-card')].map(c => c.querySelector('.seg-h').textContent)
    expect(cards).toEqual(['Muscle', 'Fat', 'Impedance'])
    expect(host.querySelectorAll('.seg-card')[0].textContent).toContain('24.2')
    expect(host.querySelectorAll('.seg-card')[0].textContent).toContain('6% apart')
    expect(text).toContain('300 Ω')
    expect(text).toContain('280 Ω')
    act(() => root.unmount())
  })

  it('renders nothing without segment values', () => {
    const host = document.createElement('div')
    const root = createRoot(host)
    act(() => root.render(<SegmentalAnalysis health={[rec('renpho:1', 1, 'weight', 80)]} />))
    expect(host.innerHTML).toBe('')
    act(() => root.unmount())
  })
})
