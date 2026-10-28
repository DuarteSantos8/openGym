// @vitest-environment happy-dom
//
// The step where the user marks the name and the timer. When the worker tried to find the boxes
// itself and its read was too thin, the job comes back at `needs_roi` with `roiSetup.unsure`, and
// the screen says why the boxes are being asked for again; an ordinary `needs_roi` (nothing found,
// or "mark them myself") says nothing of the kind.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ job: null }))

vi.mock('../store/useStore.js', () => {
  const snap = () => ({ user: { id: 'u1' }, config: { video_import: true }, S: { routines: [], customEx: [] }, update: vi.fn(), refreshConfig: vi.fn() })
  const useStore = selector => selector ? selector(snap()) : snap()
  useStore.getState = snap
  return { useStore }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: vi.fn() })
  const useUI = selector => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../sheets.jsx', () => ({ exercisePicker: vi.fn() }))
vi.mock('../lib/video-import-api.js', () => ({
  videoImportAvailable: () => true,
  startVideoImport: vi.fn(),
  videoImportJob: vi.fn(async () => mocks.job),
  submitVideoRoi: vi.fn(),
  cancelVideoImport: vi.fn(),
  stageText: s => s,
  videoImportError: (c, m) => m || c
}))

const NOTE = 'We could not read this video reliably on our own.'
const setup = extra => ({
  status: 'needs_roi', stage: 'needs_roi', pct: 30, source: { channel: 'Coach' },
  roiSetup: { samples: [{ t: 10, src: 'data:image/jpeg;base64,AA' }], suggest: { name: { x: 0.1, y: 0.8, w: 0.4, h: 0.08 }, timer: null }, width: 640, height: 360, ...extra }
})

let root, host
beforeEach(() => { sessionStorage.setItem('gym_video_import_job', 'job1'); host = document.createElement('div'); document.body.appendChild(host) })
afterEach(() => { act(() => root?.unmount()); host.remove(); sessionStorage.clear() })

async function show(job) {
  mocks.job = job
  const { default: VideoImport } = await import('./VideoImport.jsx')
  root = createRoot(host)
  await act(async () => { root.render(<VideoImport />) })
  await act(async () => { await Promise.resolve() })
  return host.textContent
}

describe('the boxes step after a read the worker was not sure of', () => {
  it('says the program looked on its own and the boxes show where', async () => {
    const text = await show(setup({ unsure: true }))
    expect(text).toContain(NOTE)
    expect(text).toContain('Mark the name and the timer')
  })

  it('says nothing of it when the worker found nothing, or the user asked to mark them', async () => {
    const text = await show(setup({}))
    expect(text).not.toContain(NOTE)
    expect(text).toContain('Mark the name and the timer')
  })
})
