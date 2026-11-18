// The Movement Lab's camera loop (EP10-T01/T02).
//
// The camera opens on an explicit tap only, and the MediaPipe pose model loads only then, from this
// build's own files (scripts/stage-mediapipe.mjs copies the runtime and the checksum-pinned model
// into public/mediapipe/), never from Google's servers at run time; MediaPipe's own usage logging
// is stripped from its bundle at build time (scripts/vite-no-mediapipe-telemetry.mjs). Frames are processed on the
// device and neither stored nor sent anywhere. Each frame's landmarks go to lib/pose-core.js, which
// measures the knee and counts reps; a frame without a usable body is reported as such and counts
// nothing. A hidden page processes no frames; stop() releases camera and model at once.
import { landmarkProblem, jointAngle, createRepCounter } from './pose-core.js'

export const WASM_PATH = 'mediapipe/wasm'
export const MODEL_PATH = 'mediapipe/pose_landmarker_lite.task'
// BlazePose indices: hip, knee, ankle.
export const SIDES = Object.freeze({ left: [23, 25, 27], right: [24, 26, 28] })
// About 15 frames a second: plenty for a squat, light on a phone's battery.
export const FRAME_MS = 66
// A squat rep: down once the knee closes past 100°, back up once it opens past 160°.
export const SQUAT = Object.freeze({ downBelow: 100, upAbove: 160 })

const fail = (code, cause) => Object.assign(new Error(code), { code, cause })


/** The knee angle of one frame's landmarks on `side`, or null with the reason it cannot be trusted. */
export function kneeFrame(landmarks, side = 'left') {
  const idx = SIDES[side]
  if (!idx) return { angle: null, problem: 'Unknown side' }
  const pts = Array.isArray(landmarks) ? idx.map(i => landmarks[i]) : null
  const problem = landmarkProblem(pts)
  if (problem) return { angle: null, problem }
  const angle = jointAngle(pts[0], pts[1], pts[2])
  return angle == null ? { angle: null, problem: 'Landmarks missing from frame' } : { angle, problem: null }
}

/**
 * Opens the camera into `video`, loads the pose model and calls onFrame({ angle, problem, reps,
 * landmarks }) for each processed frame. Rejects with err.code 'unavailable' | 'denied' | 'model'.
 * Everything that touches the device is injectable for tests.
 */
export async function startPoseSession({
  video, onFrame, side = 'left', base = import.meta.env?.BASE_URL || './',
  media = globalThis.navigator?.mediaDevices, loadVision = () => import('@mediapipe/tasks-vision'),
  raf = f => globalThis.requestAnimationFrame(f), doc = globalThis.document
}) {
  if (!media || typeof media.getUserMedia !== 'function') throw fail('unavailable')
  let stream
  try {
    stream = await media.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } })
  } catch (e) {
    throw fail(e && (e.name === 'NotAllowedError' || e.name === 'SecurityError') ? 'denied' : 'unavailable', e)
  }
  const release = () => { for (const t of stream.getTracks()) t.stop(); video.srcObject = null }
  let landmarker
  try {
    video.srcObject = stream
    await video.play()
    const { FilesetResolver, PoseLandmarker } = await loadVision()
    const fileset = await FilesetResolver.forVisionTasks(base + WASM_PATH)
    landmarker = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: base + MODEL_PATH, delegate: 'GPU' },
      runningMode: 'VIDEO', numPoses: 1
    })
  } catch (e) {
    release()
    throw fail('model', e)
  }

  const counter = createRepCounter(SQUAT)
  let stopped = false
  let last = -Infinity
  const onVisibility = () => { last = -Infinity }
  doc?.addEventListener?.('visibilitychange', onVisibility)
  const tick = t => {
    if (stopped) return
    if (!doc?.hidden && t - last >= FRAME_MS) {
      last = t
      const res = landmarker.detectForVideo(video, t)
      const landmarks = res?.landmarks?.[0] || null
      const frame = kneeFrame(landmarks, side)
      if (frame.angle != null) counter.push(frame.angle)
      onFrame?.({ ...frame, reps: counter.count(), landmarks })
    }
    raf(tick)
  }
  raf(tick)

  return {
    stop() {
      if (stopped) return
      stopped = true
      doc?.removeEventListener?.('visibilitychange', onVisibility)
      try { landmarker.close() } catch { /* already closed */ }
      release()
    },
    reset: () => counter.reset()
  }
}
