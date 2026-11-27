// The movement demo on the exercise sheet (EP26-T01, E5a): the rig when the device can show it
// and the person has not asked for no motion, and a still key pose with the words that go with
// it otherwise. The words are there either way, so the picture is never the only explanation.
import { lazy, Suspense, useMemo, useState } from 'react'
import { t } from '../../lib/i18n.js'
import { Button } from '../ui.jsx'
import { RIG, keyFrameFor, skeletonAt, project } from './poses.js'
import './mannequin.css'

const Mannequin = lazy(() => import('./Mannequin.jsx'))

/** Whether the device can make a WebGL context at all. The probe is given back straight away. */
function hasWebGL() {
  try {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('webgl2') || canvas.getContext('webgl')
    if (!ctx) return false
    ctx.getExtension?.('WEBGL_lose_context')?.loseContext()
    return true
  } catch { return false }
}

const reducedMotion = () => {
  try { return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
}

/**
 * The still picture: the key pose drawn from the same skeleton the 3D rig uses, so the two always
 * show the same thing. Plain SVG, so it needs no WebGL and no network.
 */
function MannequinStill({ pattern }) {
  const drawing = useMemo(() => {
    const key = keyFrameFor(pattern)
    const s = key ? skeletonAt(pattern, key.at) : null
    if (!s) return null
    const p = {}
    for (const [name, point] of Object.entries(s)) p[name] = project(point)
    return p
  }, [pattern])
  if (!drawing) return null
  const p = drawing
  // project() puts the rig's height upwards, so the picture's y runs the other way, as SVG wants.
  const line = (...names) => 'M ' + names.map(n => `${p[n][0].toFixed(3)} ${p[n][1].toFixed(3)}`).join(' L ')
  const used = ['hipL', 'kneeL', 'ankleL', 'heelL', 'toeL', 'hipR', 'kneeR', 'ankleR', 'heelR', 'toeR',
    'shoulderL', 'elbowL', 'wristL', 'shoulderR', 'elbowR', 'wristR', 'pelvis', 'chest', 'head']
  const xs = used.map(n => p[n][0])
  const ys = used.map(n => p[n][1])
  const pad = RIG.headR + 0.015 // Bounds use joint centers; leave room for the whole head.
  const left = Math.min(...xs) - pad
  const top = Math.min(...ys) - pad
  const width = Math.max(...xs) - Math.min(...xs) + pad * 2
  const height = Math.max(...ys) - Math.min(...ys) + pad * 2
  return <svg data-mm-still={pattern} className="mm-still" viewBox={`${left} ${top} ${width} ${height}`}
    role="img" aria-label={t('Movement demo')}>
    <line className="mm-still-floor" x1={left} y1={0} x2={left + width} y2={0} />
    <g className="mm-still-far">
      <path d={line('hipL', 'kneeL', 'ankleL', 'heelL')} />
      <path d={line('heelL', 'toeL')} />
      <path d={line('shoulderL', 'elbowL', 'wristL')} />
    </g>
    <g className="mm-still-near">
      <path d={line('hipR', 'kneeR', 'ankleR', 'heelR')} />
      <path d={line('heelR', 'toeR')} />
      <path d={line('shoulderR', 'elbowR', 'wristR')} />
    </g>
    <path className="mm-still-body" d={line('hipL', 'hipR')} />
    <path className="mm-still-body" d={line('pelvis', 'chest')} />
    <path className="mm-still-body" d={line('chest', 'head')} />
    <path className="mm-still-body" d={line('shoulderL', 'shoulderR')} />
    <circle className="mm-still-head" cx={p.head[0]} cy={p.head[1]} r={RIG.headR} />
  </svg>
}

export default function MannequinDemo({ pattern, createScene }) {
  const [why, setWhy] = useState(() => {
    if (!keyFrameFor(pattern)) return null
    if (reducedMotion()) return 'motion'
    return hasWebGL() ? null : 'webgl'
  })
  const [frame, setFrame] = useState(() => keyFrameFor(pattern))
  const [playing, setPlaying] = useState(false)

  const key = keyFrameFor(pattern)
  if (!key) return null
  const still = why !== null
  const note = (still ? key : frame || key).note

  return <section className="mm-demo" aria-label={t('Movement demo')}>
    <h4 className="sec">{pattern === 'squat' ? t('Movement demo') : t('Movement pattern example')}</h4>
    {still
      ? <MannequinStill pattern={pattern} />
      : <Suspense fallback={null}>
        <Mannequin pattern={pattern} playing={playing} createScene={createScene}
          onFrame={setFrame} onError={() => setWhy('webgl')} />
      </Suspense>}
    {why === 'motion' && <p className="mm-demo-note">{t('Motion is off on this device, so the key position is shown instead.')}</p>}
    {why === 'webgl' && <p className="mm-demo-note">{t('This device cannot show the 3D movement, so the key position is shown instead.')}</p>}
    <p className="mm-demo-text">{t(note)}</p>
    {!still && <Button type="button" variant="tinted" className="mm-demo-play"
      onClick={() => setPlaying(p => !p)}>{playing ? t('Pause') : t('Play')}</Button>}
  </section>
}
