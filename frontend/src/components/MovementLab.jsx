// The Extension Lab's movement lab (EP10): a squat-rep counter and knee angle from the front camera.
// The camera opens on Start only; frames are analysed on this device (lib/pose-session.js) and are
// never saved or sent. Educational feedback, not a medical or form assessment.
import { useEffect, useRef, useState } from 'react'
import { startPoseSession, SQUAT } from '../lib/pose-session.js'
import { t } from '../lib/i18n.js'

const MSG = () => ({
  unavailable: t('This device or browser has no camera the app can use.'),
  denied: t('Camera access was declined. Allow it in your browser or system settings to try again.'),
  model: t('The pose model is not in this build or could not load. Manual logging is unaffected.')
})
// The limbs drawn over the video (BlazePose indices): shoulders, hips, legs and arms.
const BONES = [[11, 12], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28], [11, 13], [13, 15], [12, 14], [14, 16]]
const SEEN = p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && (p.visibility === undefined || p.visibility >= 0.5)

function draw(canvas, landmarks) {
  const ctx = canvas?.getContext?.('2d')
  if (!ctx) return
  const { width: w, height: h } = canvas
  ctx.clearRect(0, 0, w, h)
  if (!Array.isArray(landmarks)) return
  ctx.lineWidth = 3
  ctx.strokeStyle = 'rgba(255,255,255,.85)'
  for (const [a, b] of BONES) {
    const p = landmarks[a], q = landmarks[b]
    if (!SEEN(p) || !SEEN(q)) continue          // never join a point the model did not see
    ctx.beginPath(); ctx.moveTo(p.x * w, p.y * h); ctx.lineTo(q.x * w, q.y * h); ctx.stroke()
  }
}

export default function MovementLab({ startSession = startPoseSession }) {
  const video = useRef(null)
  const canvas = useRef(null)
  const session = useRef(null)
  const [state, setState] = useState('idle')      // idle | starting | live | error
  const [error, setError] = useState('')
  const [frame, setFrame] = useState(null)
  const [side, setSide] = useState('left')
  useEffect(() => () => { session.current?.stop(); session.current = null }, [])

  const start = async () => {
    setState('starting'); setError(''); setFrame(null)
    try {
      session.current = await startSession({
        video: video.current, side,
        onFrame: f => { setFrame({ angle: f.angle, problem: f.problem, reps: f.reps }); draw(canvas.current, f.landmarks) }
      })
      setState('live')
    } catch (e) {
      session.current = null
      setState('error'); setError(MSG()[e?.code] || MSG().unavailable)
    }
  }
  const stop = () => {
    session.current?.stop(); session.current = null
    setState('idle'); setFrame(null); draw(canvas.current, null)
  }
  const live = state === 'live'

  return <section className="addon-card" aria-labelledby="addon-move-title">
    <div className="addon-headline">
      <div><span className="addon-kicker">{t('Movement · on this device')}</span><h2 id="addon-move-title">{t('Movement lab')}</h2></div>
      <span className="addon-state">{live ? t('Camera on') : t('Camera off')}</span>
    </div>
    <p>{t('Counts squat reps from your front camera and shows the knee angle. Frames are analysed on this device and never saved or sent.')}</p>
    <div className="addon-input-row">
      <label className="addon-field">{t('Knee')}
        <select value={side} onChange={e => setSide(e.target.value)} disabled={live || state === 'starting'}>
          <option value="left">{t('Left')}</option><option value="right">{t('Right')}</option>
        </select>
      </label>
      {live
        ? <button type="button" className="btn" onClick={stop}>{t('Stop camera')}</button>
        : <button type="button" className="btn" onClick={start} disabled={state === 'starting'}>{state === 'starting' ? t('Starting…') : t('Start camera')}</button>}
    </div>
    {error && <p className="addon-error" role="alert">{error}</p>}
    <div className="addon-cam" hidden={!live && state !== 'starting'}>
      <video ref={video} muted playsInline aria-hidden="true" />
      <canvas ref={canvas} width={640} height={480} aria-hidden="true" />
    </div>
    {live && <div className="addon-metrics" aria-live="polite">
      <div className="addon-metric"><span className="addon-metric-label">{t('Reps')}</span><strong>{frame?.reps ?? 0}</strong></div>
      {frame?.angle != null
        ? <div className="addon-metric"><span className="addon-metric-label">{t('Knee')}</span><strong>{Math.round(frame.angle)}°</strong></div>
        : <p className="addon-note">{t('Step back until your hip, knee and ankle are in view.')}</p>}
    </div>}
    <p className="addon-footnote">{t('Educational feedback only, not a medical or form assessment. A rep counts when the knee closes past {0}° and opens past {1}°.', SQUAT.downBelow, SQUAT.upAbove)}</p>
  </section>
}
