// The 3D rig behind the movement demo (EP26-T01, E5a). It is loaded on demand and only once the
// device has said it can make a WebGL context; the sheet shows a still picture instead when it
// cannot, or when the person asked for no motion. When the sheet closes, the rig is freed.
import { useEffect, useRef } from 'react'

const loadScene = async (...args) => (await import('./scene.js')).createMannequinScene(...args)

export default function Mannequin({ pattern, playing, createScene = loadScene, onFrame, onError }) {
  const host = useRef(null)
  const scene = useRef(null)
  const want = useRef(playing)
  want.current = playing

  useEffect(() => {
    let alive = true
    createScene(host.current, { pattern, onFrame, onError })
      .then(s => {
        if (!alive) { s.dispose(); return }
        scene.current = s
        if (want.current) s.play()
      })
      .catch(() => { if (alive) onError?.() })
    return () => { alive = false; scene.current?.dispose(); scene.current = null }
  }, [pattern, createScene])

  useEffect(() => {
    const s = scene.current
    if (!s) return
    if (playing) s.play(); else s.pause()
  }, [playing])

  return <div className="mm-rig" ref={host} aria-hidden="true" />
}
