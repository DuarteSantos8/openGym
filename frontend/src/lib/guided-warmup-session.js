import { normalizeWarmup } from '../../../api/training/guided-warmup.js'

// A separate session snapshot: changing a routine never changes preparation already under way.
export function createGuidedWarmup(routines, now = Date.now()) {
  const steps = [], seen = new Set()
  for (const routine of routines || []) {
    const config = normalizeWarmup(routine?.warmup)
    if (!config?.enabled) continue
    for (const step of config.steps) {
      if (seen.has(step.id)) continue
      seen.add(step.id)
      steps.push({ ...step, status: 'pending' })
    }
  }
  return steps.length ? { status: 'in_progress', steps, current: 0, startedAt: now } : undefined
}

export const pendingGuidedWarmup = active => !active?.editingWorkoutId && !active?.backfill
  && active?.warmup?.status === 'in_progress'
  && Array.isArray(active.warmup.steps) && active.warmup.steps.length > 0
  && Number.isInteger(active.warmup.current) && active.warmup.current >= 0
  && active.warmup.current < active.warmup.steps.length

export function warmupRemainingMs(warmup, now = Date.now()) {
  if (Number.isFinite(warmup?.timer?.endsAt)) return Math.max(0, warmup.timer.endsAt - now)
  if (Number.isFinite(warmup?.timer?.remainingMs)) return Math.max(0, warmup.timer.remainingMs)
  const step = warmup?.steps?.[warmup.current]
  return step?.mode === 'time' ? step.sec * 1000 * (step.perSide ? 2 : 1) : 0
}

// Every callback carries the session and movement it was rendered for. A late click, a
// confirmation sheet or another tab cannot advance a replacement workout or movement.
export function applyGuidedWarmupAction(active, sessionId, stepId, action, now = Date.now()) {
  if (active?.id !== sessionId || !pendingGuidedWarmup(active)) return false
  const warmup = active.warmup, step = warmup.steps[warmup.current]
  if (step?.id !== stepId) return false
  if (action === 'start_timer' && step.mode === 'time') {
    if (warmup.timer?.endsAt > now) return false
    const remaining = warmupRemainingMs(warmup, now)
    warmup.timer = { endsAt: now + (remaining || step.sec * 1000 * (step.perSide ? 2 : 1)) }
  } else if (action === 'pause_timer' && warmup.timer?.endsAt != null) {
    warmup.timer = { remainingMs: warmupRemainingMs(warmup, now) }
  } else if (action === 'previous' && warmup.current > 0) {
    delete warmup.timer
    warmup.current--
    warmup.steps[warmup.current].status = 'pending'
  } else if (action === 'done' || action === 'skip') {
    delete warmup.timer
    step.status = action === 'done' ? 'done' : 'skipped'
    warmup.current++
    if (warmup.current === warmup.steps.length) {
      warmup.status = 'complete'
      warmup.endedAt = now
    }
  } else if (action === 'skip_all') {
    delete warmup.timer
    for (const movement of warmup.steps) if (movement.status === 'pending') movement.status = 'skipped'
    warmup.status = 'skipped'
    warmup.endedAt = now
  } else return false
  return true
}

// Timers and navigation are transient. History keeps only dosage, explicit outcomes and time.
export function completedGuidedWarmup(warmup) {
  if (!['complete', 'skipped'].includes(warmup?.status)) return undefined
  const normalized = normalizeWarmup({ enabled: true, steps: warmup.steps })
  if (!normalized?.steps.length) return undefined
  const startedAt = Number.isFinite(warmup.startedAt) ? warmup.startedAt : 0
  const endedAt = Math.max(startedAt, Number.isFinite(warmup.endedAt) ? warmup.endedAt : startedAt)
  return {
    status: warmup.status,
    steps: normalized.steps.map(step => ({ ...step, status: warmup.steps.find(source => source?.id === step.id)?.status === 'done' ? 'done' : 'skipped' })),
    startedAt, endedAt, durationSec: Math.round((endedAt - startedAt) / 1000),
  }
}

export function repeatGuidedWarmup(summary, now = Date.now()) {
  return createGuidedWarmup([{ warmup: { enabled: true, steps: summary?.steps } }], now)
}
