// Pose-analysis core for the future MediaPipe integration: pure landmark
// math only. No camera, no model, no medical claims — a MediaPipe (or any)
// landmark source feeds frames in, and this decides angles and rep events.
// Frames with unusable landmarks are reported, never silently trusted.
const MIN_VISIBILITY = 0.5

export function landmarkProblem(landmarks) {
  if (!Array.isArray(landmarks) || landmarks.length === 0) return 'Landmarks missing from frame'
  if (landmarks.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) return 'Landmarks missing from frame'
  if (landmarks.some(p => Number.isFinite(p.visibility) && p.visibility < MIN_VISIBILITY)) return 'Landmark visibility too low'
  return null
}

export function jointAngle(a, b, c) {
  if (landmarkProblem([a, b, c])) return null
  const v1 = { x: a.x - b.x, y: a.y - b.y }
  const v2 = { x: c.x - b.x, y: c.y - b.y }
  const dot = v1.x * v2.x + v1.y * v2.y
  const mag = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y)
  if (!mag) return null
  const cosine = Math.min(1, Math.max(-1, dot / mag))
  return Math.acos(cosine) * 180 / Math.PI
}

export function createRepCounter({ downBelow, upAbove } = {}) {
  if (!(Number(downBelow) < Number(upAbove))) throw new Error('Rep thresholds must satisfy downBelow < upAbove')
  let phase = 'up'
  let reps = 0
  return {
    push(angle) {
      if (angle == null || !Number.isFinite(Number(angle))) return { type: 'ignored' }
      const value = Number(angle)
      if (phase === 'up' && value <= downBelow) { phase = 'down'; return { type: 'down', count: reps } }
      if (phase === 'down' && value >= upAbove) { phase = 'up'; reps++; return { type: 'rep', count: reps } }
      return { type: 'hold', count: reps }
    },
    count: () => reps,
    reset() { phase = 'up'; reps = 0 }
  }
}
