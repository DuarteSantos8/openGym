// The Extension Lab's 3D body (EP12): which muscles the logged training reached, on an anatomical
// model, with the same levels as the 2D muscle map (lib/muscle-3d.js). WebGL and the model load
// only when the person opens it; the list below the model carries the same information for
// keyboard and screen-reader use and when WebGL is unavailable. English-only like the rest of the Lab.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { MUSCLES, MUSCLE_NAME } from '../lib/muscles.js'
import { weekStartOf } from '../lib/format.js'
import { muscleLevels3d, levelColors, MODEL_URL, WINDOWS, LEVEL_WORD } from '../lib/muscle-3d.js'

const base = () => (import.meta.env?.BASE_URL || './')
const loadScene = async (...args) => (await import('../lib/anatomy-scene.js')).createAnatomyScene(...args)

export default function AnatomyViewer({ createScene = loadScene, now }) {
  const S = useStore(s => s.S)
  const host = useRef(null)
  const scene = useRef(null)
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState('closed')     // closed | loading | ready | error
  const [problem, setProblem] = useState('')
  const [win, setWin] = useState(7)
  const [selected, setSelected] = useState(null)
  const levels = useMemo(() => muscleLevels3d(S?.workouts, { win, ...(now ? { now } : {}), ws: weekStartOf(S) }), [S, win, now])

  useEffect(() => {
    if (!open) return undefined
    let alive = true
    setStatus('loading'); setProblem('')
    const reduceMotion = !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    createScene(host.current, {
      url: base() + MODEL_URL, colors: levelColors(), reduceMotion,
      onPick: ({ id, lost }) => {
        if (lost) { setStatus('error'); setProblem('The 3D view stopped. Close it and open it again.'); return }
        setSelected(id || null)
      }
    }).then(s => {
      if (!alive) { s.dispose(); return }
      scene.current = s; setStatus('ready')
    }).catch(e => {
      if (!alive) return
      setStatus('error')
      setProblem(e?.code === 'webgl' ? 'This device or browser cannot show 3D. The list below has the same information.' : 'The 3D body could not load. The list below has the same information.')
    })
    return () => { alive = false; scene.current?.dispose(); scene.current = null; setStatus('closed') }
  }, [open, createScene])

  useEffect(() => { scene.current?.setLevels(levels) }, [levels, status])
  useEffect(() => { scene.current?.highlight(selected) }, [selected, status])

  return <section className="addon-card" aria-labelledby="addon-anatomy-title">
    <div className="addon-headline">
      <div><span className="addon-kicker">ANATOMY / YOUR TRAINING</span><h2 id="addon-anatomy-title">3D muscle map</h2></div>
      <span className="addon-state">{open ? '3D on' : '3D off'}</span>
    </div>
    <p>The muscles your logged sets reached, on an anatomical model, shaded like the muscle map in Stats.</p>
    <div className="addon-input-row">
      <label className="addon-field">Window
        <select value={win} onChange={e => setWin(Number(e.target.value))}>
          {WINDOWS.map(w => <option key={w.days} value={w.days}>{w.label}</option>)}
        </select>
      </label>
      <button type="button" className="btn" onClick={() => setOpen(o => !o)}>{open ? 'Close 3D' : 'Show in 3D'}</button>
    </div>
    {problem && <p className="addon-error" role="alert">{problem}</p>}
    {open && <div ref={host} className="addon-3d" aria-hidden="true">
      {status === 'loading' && <p className="addon-note">Loading the model…</p>}
    </div>}
    {open && status === 'ready' && <p className="addon-footnote">Drag to turn the body; tap a muscle to find it in the list.</p>}
    <ul className="addon-muscles" aria-label="Muscles and how much this window trained them">
      {MUSCLES.map(m => <li key={m}>
        <button type="button" aria-pressed={selected === m} onClick={() => setSelected(s => (s === m ? null : m))}>
          <span className={'hm-c l' + (levels[m] | 0)} aria-hidden="true" />
          <span>{MUSCLE_NAME[m] || m}</span><small>{LEVEL_WORD[levels[m] | 0]}</small>
        </button>
      </li>)}
    </ul>
    <p className="addon-footnote">Model: Z-Anatomy (CC BY-SA 4.0), from BodyParts3D © The Database Center for Life Science (CC BY-SA 2.1 Japan); simplified for openGym. Not a diagnostic tool.</p>
  </section>
}
