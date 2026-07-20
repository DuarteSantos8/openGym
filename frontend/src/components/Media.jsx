import { useState } from 'react'
import { imgSrc, gifSrc } from '../lib/exercises.js'

// Big autoplaying animation; tap toggles to the still frame.
export default function Media({ ex, id }) {
  const [playing, setPlaying] = useState(true)
  return (
    <div className="exmedia" id={id} onClick={() => setPlaying(p => !p)}>
      <img decoding="async" src={playing ? gifSrc(ex) : imgSrc(ex)} alt={ex.n} />
      <span className="gifhint">{playing ? '⏸ tap to pause' : '▶ tap to play'}</span>
    </div>
  )
}

export function Thumb({ ex }) {
  return <img className="thumb" loading="lazy" decoding="async" src={imgSrc(ex)} alt="" />
}
