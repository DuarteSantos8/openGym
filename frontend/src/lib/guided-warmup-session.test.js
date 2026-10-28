import { describe, expect, it } from 'vitest'
import { WARMUP_IDS, defaultWarmupStep, normalizeWarmup } from '../../../api/training/guided-warmup.js'
import { createGuidedWarmup, pendingGuidedWarmup, applyGuidedWarmupAction, warmupRemainingMs, completedGuidedWarmup, repeatGuidedWarmup } from './guided-warmup-session.js'

const shoulders = { id: '3905', mode: 'time', sec: 30 }
const ankles = { id: '1368', mode: 'time', sec: 20, perSide: true }
const legs = { id: '3502', mode: 'reps', reps: 10, perSide: true }
const routine = (...steps) => ({ warmup: { enabled: true, steps } })
const session = (...steps) => ({ id: 'session-1', warmup: createGuidedWarmup([routine(...steps)], 1000), entries: [{ id: '0025', sets: [{ w: 50, r: 8, done: false }] }] })
const action = (active, kind, now = 2000) => applyGuidedWarmupAction(active, active.id, active.warmup.steps[active.warmup.current].id, kind, now)

describe('guided warm-up session snapshot', () => {
  it('combines enabled routines, keeping the first dosage of a movement and no references to plans', () => {
    const first = routine(shoulders, legs), second = routine({ ...shoulders, sec: 60 }, ankles)
    const warmup = createGuidedWarmup([first, { warmup: { enabled: false, steps: [ankles] } }, second], 1000)
    expect(warmup.steps.map(s => s.id)).toEqual(['3905', '3502', '1368'])
    expect(warmup.steps[0].sec).toBe(30)
    first.warmup.steps[0] = { ...shoulders, sec: 90 }
    expect(warmup.steps[0].sec).toBe(30)
    expect(createGuidedWarmup([{ ex: [] }, routine()], 1000)).toBeUndefined()
  })

  it('never routes saved-workout editing or backfilling through preparation', () => {
    const active = session(shoulders)
    expect(pendingGuidedWarmup(active)).toBe(true)
    expect(pendingGuidedWarmup({ ...active, editingWorkoutId: 'old' })).toBe(false)
    expect(pendingGuidedWarmup({ ...active, backfill: true })).toBe(false)
    expect(pendingGuidedWarmup({ ...active, warmup: { ...active.warmup, current: 50 } })).toBe(false)
  })

  it('combines two valid routines with eight and five distinct movements without truncation', () => {
    const steps = WARMUP_IDS.map(defaultWarmupStep)
    const first = routine(...steps.slice(0, 8)), second = routine(...steps.slice(8))
    expect(first.warmup.steps).toHaveLength(8)
    expect(second.warmup.steps).toHaveLength(5)
    expect(normalizeWarmup(first.warmup)).toEqual(first.warmup)
    expect(normalizeWarmup(second.warmup)).toEqual(second.warmup)
    const combined = createGuidedWarmup([first, second, routine({ ...steps[0], sec: 90 })], 1000)
    expect(combined.steps).toEqual(steps.map(step => ({ ...step, status: 'pending' })))
    expect(combined.steps).toHaveLength(WARMUP_IDS.length)
  })
})

describe('deadline countdown and explicit progress', () => {
  it('resumes a serialised deadline and never completes a movement on expiry', () => {
    const active = session(shoulders, legs)
    action(active, 'start_timer', 2000)
    const restored = JSON.parse(JSON.stringify(active))
    expect(warmupRemainingMs(restored.warmup, 12000)).toBe(20000)
    expect(warmupRemainingMs(restored.warmup, 40000)).toBe(0)
    expect(restored.warmup.steps[0].status).toBe('pending')
    expect(restored.warmup.current).toBe(0)
    expect(restored.warmup.timer.endsAt).toBe(32000)
    action(restored, 'done', 40000)
    expect(restored.warmup.current).toBe(1)
    expect(restored.warmup.timer).toBeUndefined()
  })

  it('pauses and resumes the remaining duration, with both sides counted', () => {
    const active = session(ankles)
    expect(warmupRemainingMs(active.warmup, 1000)).toBe(40000)
    action(active, 'start_timer', 2000)
    action(active, 'pause_timer', 12000)
    expect(active.warmup.timer).toEqual({ remainingMs: 30000 })
    expect(warmupRemainingMs(active.warmup, 90000)).toBe(30000)
    action(active, 'start_timer', 90000)
    expect(active.warmup.timer).toEqual({ endsAt: 120000 })
  })

  it('discards timers when skipping or revisiting and leaves the main workout unchanged', () => {
    const active = session(shoulders, legs)
    const entries = structuredClone(active.entries)
    action(active, 'start_timer')
    action(active, 'skip')
    expect(active.warmup.steps[0].status).toBe('skipped')
    expect(active.warmup.timer).toBeUndefined()
    action(active, 'previous')
    expect(active.warmup.current).toBe(0)
    expect(active.warmup.steps[0].status).toBe('pending')
    action(active, 'done')
    action(active, 'done', 61000)
    expect(pendingGuidedWarmup(active)).toBe(false)
    expect(active.entries).toEqual(entries)
    expect(completedGuidedWarmup(active.warmup)).toEqual({
      status: 'complete', startedAt: 1000, endedAt: 61000, durationSec: 60,
      steps: [{ ...shoulders, status: 'done' }, { ...legs, status: 'done' }],
    })
  })

  it('rejects stale callbacks for a different session, movement or completed sequence', () => {
    const active = session(shoulders, legs)
    expect(applyGuidedWarmupAction(active, 'replaced', shoulders.id, 'done')).toBe(false)
    action(active, 'done')
    expect(applyGuidedWarmupAction(active, active.id, shoulders.id, 'skip_all')).toBe(false)
    action(active, 'skip_all')
    expect(applyGuidedWarmupAction(active, active.id, legs.id, 'done')).toBe(false)
    expect(active.warmup.steps.map(s => s.status)).toEqual(['done', 'skipped'])
  })

  it('saves no navigation or timer state and repeats a skipped sequence as fresh preparation', () => {
    const active = session(shoulders, legs)
    expect(completedGuidedWarmup(active.warmup)).toBeUndefined()
    action(active, 'start_timer')
    action(active, 'skip_all', 5000)
    const summary = completedGuidedWarmup(active.warmup)
    expect(summary.status).toBe('skipped')
    expect(summary.timer).toBeUndefined()
    expect(summary.current).toBeUndefined()
    const repeated = repeatGuidedWarmup(summary, 9000)
    expect(repeated).toMatchObject({ current: 0, status: 'in_progress', startedAt: 9000 })
    expect(repeated.steps.every(step => step.status === 'pending')).toBe(true)
    expect(repeated.timer).toBeUndefined()
  })

  it('retains all thirteen movements through completion, summary and repeat with fresh progress', () => {
    const steps = WARMUP_IDS.map(defaultWarmupStep)
    const active = session(...steps)
    action(active, 'start_timer', 2000)
    for (let index = 0; index < steps.length; index++) action(active, 'done', 3000 + index * 1000)
    expect(pendingGuidedWarmup(active)).toBe(false)
    const summary = completedGuidedWarmup(active.warmup)
    expect(summary.steps).toEqual(steps.map(step => ({ ...step, status: 'done' })))
    expect(summary.timer).toBeUndefined()
    const before = structuredClone(summary)
    const repeated = repeatGuidedWarmup(summary, 90000)
    expect(repeated).toEqual({
      status: 'in_progress', current: 0, startedAt: 90000,
      steps: steps.map(step => ({ ...step, status: 'pending' })),
    })
    expect(summary).toEqual(before)
    expect(pendingGuidedWarmup({ id: 'repeated', warmup: repeated })).toBe(true)
    expect(repeated.endedAt).toBeUndefined()
    expect(repeated.timer).toBeUndefined()
  })
})
