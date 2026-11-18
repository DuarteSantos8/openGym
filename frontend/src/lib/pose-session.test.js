import { describe, it, expect, vi } from 'vitest'
import { kneeFrame, startPoseSession, FRAME_MS, MODEL_PATH, WASM_PATH } from './pose-session.js'

// A body whose left knee bends to `deg` (hip above the knee, ankle swinging out). BlazePose
// indices: 23 hip, 25 knee, 27 ankle.
const body = (deg, visibility = 0.9) => {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility }))
  const phi = (180 - deg) * Math.PI / 180
  lm[23] = { x: 0, y: 0, z: 0, visibility }
  lm[25] = { x: 0, y: 1, z: 0, visibility }
  lm[27] = { x: Math.sin(phi), y: 1 + Math.cos(phi), z: 0, visibility }
  return lm
}

function rig({ frames = [], getUserMedia, createFromOptions } = {}) {
  const track = { stop: vi.fn() }
  const stream = { getTracks: () => [track] }
  const media = { getUserMedia: getUserMedia || vi.fn(async () => stream) }
  const video = { srcObject: null, play: vi.fn(async () => {}) }
  const landmarker = { detectForVideo: vi.fn(() => ({ landmarks: frames.length ? [frames.shift()] : [] })), close: vi.fn() }
  const vision = {
    FilesetResolver: { forVisionTasks: vi.fn(async path => ({ path })) },
    PoseLandmarker: { createFromOptions: createFromOptions || vi.fn(async () => landmarker) }
  }
  const queue = []
  const listeners = {}
  const doc = { hidden: false, addEventListener: vi.fn((t, f) => { listeners[t] = f }), removeEventListener: vi.fn(t => { delete listeners[t] }) }
  const tick = t => { const f = queue.shift(); if (f) f(t) }
  const opts = { video, base: './', media, loadVision: vi.fn(async () => vision), raf: f => queue.push(f), doc }
  return { track, media, video, landmarker, vision, queue, tick, doc, listeners, opts }
}

describe('kneeFrame', () => {
  it('measures the knee from hip, knee and ankle', () => {
    expect(kneeFrame(body(180)).angle).toBeCloseTo(180, 5)
    expect(kneeFrame(body(90)).angle).toBeCloseTo(90, 5)
    expect(kneeFrame(body(90)).problem).toBeNull()
  })
  it('reports a frame it cannot trust instead of guessing an angle', () => {
    expect(kneeFrame(body(90, 0.1))).toEqual({ angle: null, problem: 'Landmark visibility too low' })
    expect(kneeFrame(null)).toEqual({ angle: null, problem: 'Landmarks missing from frame' })
    expect(kneeFrame(body(90), 'middle').problem).toMatch(/side/i)
  })
})

describe('startPoseSession: camera and model only on request, local files only', () => {
  it('asks for the front camera without audio, and loads the runtime and model from this build', async () => {
    const r = rig()
    const s = await startPoseSession({ ...r.opts, onFrame: () => {} })
    expect(r.media.getUserMedia).toHaveBeenCalledTimes(1)
    expect(r.media.getUserMedia.mock.calls[0][0]).toMatchObject({ audio: false, video: { facingMode: 'user' } })
    expect(r.vision.FilesetResolver.forVisionTasks).toHaveBeenCalledWith('./' + WASM_PATH)
    const [, options] = r.vision.PoseLandmarker.createFromOptions.mock.calls[0]
    expect(options).toMatchObject({ runningMode: 'VIDEO', numPoses: 1, baseOptions: { modelAssetPath: './' + MODEL_PATH } })
    expect(JSON.stringify(options) + r.vision.FilesetResolver.forVisionTasks.mock.calls[0][0]).not.toMatch(/https?:/)
    s.stop()
  })

  it('counts a squat from frames, once per full down-up cycle, throttled to its frame rate', async () => {
    const r = rig({ frames: [body(170), body(95), body(90), body(165), body(170), body(95), body(170)] })
    const seen = []
    const s = await startPoseSession({ ...r.opts, onFrame: f => seen.push(f) })
    let t = 0
    for (let i = 0; i < 7; i++) { r.tick(t); t += FRAME_MS }
    r.tick(t - FRAME_MS + 1)            // 1 ms after the last processed frame: skipped
    expect(r.landmarker.detectForVideo).toHaveBeenCalledTimes(7)
    expect(seen.at(-1).reps).toBe(2)
    expect(seen.every(f => !('image' in f))).toBe(true)
    s.stop()
  })

  it('a frame without a usable body shows no angle and counts nothing', async () => {
    const r = rig({ frames: [body(170), body(90, 0.2), body(170)] })
    const seen = []
    const s = await startPoseSession({ ...r.opts, onFrame: f => seen.push(f) })
    for (let i = 0; i < 3; i++) r.tick(i * FRAME_MS)
    expect(seen[1]).toMatchObject({ angle: null, problem: 'Landmark visibility too low', reps: 0 })
    expect(seen.at(-1).reps).toBe(0)
    s.stop()
  })

  it('processes nothing while the page is hidden', async () => {
    const r = rig({ frames: [body(170), body(90)] })
    const s = await startPoseSession({ ...r.opts, onFrame: () => {} })
    r.doc.hidden = true
    r.tick(0); r.tick(FRAME_MS)
    expect(r.landmarker.detectForVideo).not.toHaveBeenCalled()
    s.stop()
  })

  it('stop releases the camera and the model at once, and stays stopped', async () => {
    const r = rig({ frames: [body(170)] })
    const onFrame = vi.fn()
    const s = await startPoseSession({ ...r.opts, onFrame })
    s.stop(); s.stop()
    expect(r.track.stop).toHaveBeenCalledTimes(1)
    expect(r.landmarker.close).toHaveBeenCalledTimes(1)
    expect(r.video.srcObject).toBeNull()
    expect(r.doc.removeEventListener).toHaveBeenCalled()
    r.tick(0)
    expect(onFrame).not.toHaveBeenCalled()
  })

  it('a denied camera loads no model', async () => {
    const err = Object.assign(new Error('no'), { name: 'NotAllowedError' })
    const r = rig({ getUserMedia: vi.fn(async () => { throw err }) })
    await expect(startPoseSession({ ...r.opts, onFrame: () => {} })).rejects.toMatchObject({ code: 'denied' })
    expect(r.opts.loadVision).not.toHaveBeenCalled()
  })

  it('no camera API at all is reported as unavailable', async () => {
    const r = rig()
    await expect(startPoseSession({ ...r.opts, media: undefined, onFrame: () => {} })).rejects.toMatchObject({ code: 'unavailable' })
  })


  it('a model that will not load releases the camera it opened', async () => {
    const r = rig({ createFromOptions: vi.fn(async () => { throw new Error('404') }) })
    await expect(startPoseSession({ ...r.opts, onFrame: () => {} })).rejects.toMatchObject({ code: 'model' })
    expect(r.track.stop).toHaveBeenCalledTimes(1)
    expect(r.video.srcObject).toBeNull()
  })
})
