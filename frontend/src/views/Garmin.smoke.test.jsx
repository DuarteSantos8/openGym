// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
const days = Array.from({ length: 20 }, (_, i) => { const d = new Date(Date.now() - (19 - i) * 864e5).toISOString().slice(0, 10); return { date: d, sleepSec: 26000, sleepScore: 70 + i, hrv: 50, hrvLow: 45, hrvHigh: 60, restHr: 52, steps: 8000, bed: 1380, wake: 420, bb15: [[0, 40], [420, 90], [1000, 50]], bbMax: 90, kcal: 2500 } })
globalThis.__G = { connected: true, prefs: { hidden: ['acts'] }, days, acts: [{ id: 1, type: 'running', start: days[19].date + ' 07:00:00', dur: 1800, dist: 5000, speed: 3, hr: 150, load: 80, zones: [60, 600, 300, 0, 0] }], people: [{ uid: 'u2', name: 'Val' }], partners: [{ uid: 'u2', name: 'Val', ready: 'push', weekSteps: 50000 }], needTonight: { min: 480, bedFrom: 1350, bedTo: 1380 }, fitnessAge: { age: 30 } }
vi.mock('../components/useGarmin.js', () => ({ useGarmin: () => globalThis.__G, setGarmin: () => {}, refreshGarmin: () => {}, setGarminPrefs: async () => {} }))
vi.mock('../store/useStore.js', async (orig) => { const m = await orig(); return { ...m, useStore: sel => sel({ S: { workouts: [], routines: [] }, user: { id: 'u1' } }) } })
import Garmin from './Garmin.jsx'
import GarminSettings from '../components/GarminSettings.jsx'
import GarminHomeCard from '../components/GarminHomeCard.jsx'
describe('scratch', () => {
  it('renders', () => {
    const html = renderToString(<MemoryRouter><Garmin /><GarminHomeCard /></MemoryRouter>)
    for (const t of ['Body battery through the day', 'Shared with you', 'Together this week', 'be in bed by', '8 h 00 min', 'Training load']) expect(html).toContain(t)
    expect(html).not.toContain('No activities')
    const s = renderToString(<GarminSettings />)
    expect(s).toContain('Cards on the Garmin screen')
    expect(s).toContain('Val')
  })
})
