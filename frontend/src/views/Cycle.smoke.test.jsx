// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { addDays } from '../lib/cycle.js'
import { todayISO } from '../lib/format.js'

const today = todayISO()
const flow = start => Object.fromEntries([0, 1, 2, 3, 4].map(i => [addDays(start, i), { flow: 2 }]))
globalThis.__C = {
  days: { ...flow(addDays(today, -38)), ...flow(addDays(today, -10)), [today]: { sym: ['tender'] } },
  prefs: { share: { u2: 'phase' }, push: { period: true } },
  people: [{ uid: 'u2', name: 'Val' }, { uid: 'u3', name: 'Sam' }],
  partners: [{ uid: 'u2', name: 'Val', level: 'period', phase: 'luteal', day: 20, next: { from: addDays(today, 5), to: addDays(today, 7) } }],
}
vi.mock('../components/useCycle.js', () => ({ useCycle: () => globalThis.__C, saveDay: async () => {}, savePrefs: async () => {}, wipeCycle: async () => {}, refreshCycle: () => {} }))
vi.mock('../store/useStore.js', async orig => { const m = await orig(); return { ...m, useStore: sel => sel({ S: { workouts: [], routines: [] }, user: { id: 'u1' } }) } })
import Cycle from './Cycle.jsx'
import CycleHomeCard from '../components/CycleHomeCard.jsx'
import { DaySheet, CycleSettings } from '../components/CycleSheets.jsx'

describe('cycle screens', () => {
  it('renders the screen, the questions of the phase, averages and what is shared', () => {
    const html = renderToString(<MemoryRouter><Cycle /><CycleHomeCard /></MemoryRouter>)
    for (const s of ['Follicular phase', 'Felt strong in training?', 'Not contraception', 'Your averages', '28 days', 'Shared with you', 'Val']) expect(html).toContain(s)
  })
  it('the day sheet asks the phase questions and offers the rest', () => {
    const html = renderToString(<DaySheet date={today} />)
    for (const s of ['Flow', 'Often asked in your', 'More symptoms', 'Mood', 'Notes']) expect(html).toContain(s)
  })
  it('settings list every other account to pick from', () => {
    const html = renderToString(<CycleSettings />)
    for (const s of ['Val', 'Sam', 'Nobody sees anything until you pick them', 'Delete all cycle data']) expect(html).toContain(s)
  })
})
