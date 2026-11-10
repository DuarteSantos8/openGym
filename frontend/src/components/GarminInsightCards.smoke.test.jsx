import { describe, it, expect } from 'vitest'
import { renderToString } from 'react-dom/server'
import { BodyBatteryCard, SessionCostCard, SleepStrengthCard, RunEfficiencyCard, TrainingLoadCard, PartnerCard, TeamCard } from './GarminInsightCards.jsx'
import { todayISO } from '../lib/format.js'

const today = todayISO()
const acts = Array.from({ length: 6 }, (_, i) => ({ type: 'running', start: `2026-0${i + 1}-10 07:00:00`, speed: 3 + i * 0.1, hr: 150, dur: 1800, load: 80 }))
const g = {
  days: [{ date: today, bb15: [[0, 80], [600, 50], [1200, 30]], steps: 9000, imMod: 20, imVig: 10 }],
  acts,
  partners: [{ uid: 'u', name: 'Sam', ready: 'sick', sleepSec: 27000, sleepScore: 81, steps: 5000, weekSteps: 50000, bb: 60 }],
}
const S = { workouts: [{ d: today, start: `${today}T10:00:00`, end: `${today}T11:00:00`, name: 'Push', entries: [{ id: 'a', sets: [{ w: 50, r: 5, done: true }] }] }], routines: [] }

describe('GarminInsightCards', () => {
  it('renders with data', () => {
    expect(renderToString(<BodyBatteryCard g={g} S={S} />)).toContain('Push')
    expect(renderToString(<RunEfficiencyCard g={g} />)).toContain('fitter')
    expect(renderToString(<TrainingLoadCard g={g} S={S} />)).toContain('Watch load')
    expect(renderToString(<PartnerCard g={g} />)).toContain('May be fighting something')
    expect(renderToString(<TeamCard g={g} />)).toContain('Together this week')
  })
  it('renders nothing without data', () => {
    const e = { days: [], acts: [] }, s = { workouts: [], routines: [] }
    for (const el of [<BodyBatteryCard g={e} S={s} />, <SessionCostCard g={e} S={s} />, <SleepStrengthCard g={e} S={s} />, <RunEfficiencyCard g={e} />, <TrainingLoadCard g={e} S={s} />, <PartnerCard g={e} />, <TeamCard g={e} />]) {
      expect(renderToString(el)).toBe('')
    }
  })
})
