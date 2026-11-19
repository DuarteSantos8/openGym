// @vitest-environment happy-dom
// The heart tab reads a session's readings once per version of its kept curve: a sync that fills
// a gap (same start, same length) reads them again, an unchanged record does not.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/health-sync.js', async real => ({ ...(await real()), workoutSamples: vi.fn(async () => []) }))
const { workoutSamples } = await import('../lib/health-sync.js')
const { default: ExerciseHeart, useHeartPick } = await import('./ExerciseHeart.jsx')

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const ROPE = '2612'
const T0 = Date.UTC(2026, 10, 1, 9)
const workout = v => ({
  id: 'w0', d: '2026-11-01', start: T0, end: T0 + 600000,
  hrc: { s: T0, step: 5, v },
  entries: [{ id: ROPE, target: { mode: 'time' }, sets: [{ done: true, sec: 60, at: T0 + 120000, hr: { avg: 150, max: 170 } }] }],
})

function Tab ({ workouts }) {
  const pick = useHeartPick(workouts, ROPE)
  return <ExerciseHeart workouts={workouts} exId={ROPE} pick={pick} />
}

let root, host
const render = async workouts => {
  if (!root) { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) }
  await act(async () => root.render(<Tab workouts={workouts} />))
}
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = host = null; workoutSamples.mockClear() })

describe('ExerciseHeart', () => {
  it('reads a session again when a sync changes its curve, even with the same start and length', async () => {
    await render([workout([120, 0, 140])])
    expect(workoutSamples).toHaveBeenCalledTimes(1)
    await render([workout([120, 0, 140])]) // a new record, the same curve: kept
    expect(workoutSamples).toHaveBeenCalledTimes(1)
    await render([workout([116, 124, 140])]) // the gap filled, a 32-bit hash would not see it
    expect(workoutSamples).toHaveBeenCalledTimes(2)
  })
})
