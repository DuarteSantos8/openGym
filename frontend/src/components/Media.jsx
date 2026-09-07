import { useEffect, useState } from 'react'
import { imgSrc, gifSrc } from '../lib/exercises.js'
import { assetObjectUrl } from '../lib/api.js'
import { useStore } from '../store/useStore.js'
import { t, exerciseNameFor } from '../lib/i18n.js'
import Icon from './Icon.jsx'

function usePrivateAsset(ex) {
  const id = ex?.media?.id || null
  const remoteBase = globalThis.__opengymRemoteBase || ''
  const remoteVersion = globalThis.__opengymRemoteAssetVersion || 0
  const [src, setSrc] = useState(() => id && !remoteBase ? imgSrc(ex) : null)
  useEffect(() => {
    let alive = true
    if (!id) { setSrc(null); return () => { alive = false } }
    setSrc(remoteBase ? null : imgSrc(ex))
    assetObjectUrl(id).then(url => { if (alive) setSrc(url) }).catch(() => { if (alive) setSrc(null) })
    return () => { alive = false }
  }, [id, ex?.media?.sha256, remoteBase, remoteVersion])
  return src
}

// Big autoplaying animation; tap toggles to the still frame. `compact` shrinks it (superset cards).
// Custom exercise images are private API assets; they render as a still frame in every view.
// `minimizable` (workout view) adds a persistent minimize/expand control so the animation stops
// eating the screen; the chosen size is saved to settings and carries across exercises and
// future workouts (issue #12).
export default function Media({ ex, id, compact, minimizable }) {
  const [playing, setPlaying] = useState(true)
  const gifSize = useStore(s => s.S.gifSize)
  const update = useStore(s => s.update)
  const privateSrc = usePrivateAsset(ex)
  if (!ex.gif && !ex.media?.id) return null
  if (ex.media?.id && !privateSrc) return <div className={'exmedia' + (compact ? ' compact' : '')} id={id} aria-busy="true" />
  const mini = minimizable && gifSize === 'mini'
  const toggleSize = e => { e.stopPropagation(); update(s => { s.gifSize = mini ? 'full' : 'mini' }) }
  return (
    <div className={'exmedia' + (compact ? ' compact' : '') + (mini ? ' mini' : '')} id={id} onClick={() => setPlaying(p => !p)}>
      <img decoding="async" src={ex.media?.id ? privateSrc : (playing ? gifSrc(ex) : imgSrc(ex))} alt={exerciseNameFor(ex)} />
      {minimizable && (
        <button className="giftoggle" onClick={toggleSize}>
          <Icon name={mini ? 'expand' : 'minimize'} />{mini ? t('Expand') : t('Minimize')}
        </button>
      )}
      {!mini && (
        <span className="gifhint">
          <Icon name={playing ? 'pause' : 'play'} />{playing ? t('tap to pause') : t('tap to play')}
        </span>
      )}
    </div>
  )
}

export function Thumb({ ex }) {
  const privateSrc = usePrivateAsset(ex)
  if (!ex.img && !ex.media?.id) return <div className="thumb thumb-x"><Icon name="dumbbell" /></div>
  if (ex.media?.id && !privateSrc) return <div className="thumb thumb-x" aria-busy="true"><Icon name="dumbbell" /></div>
  return <img className="thumb" loading="lazy" decoding="async" src={ex.media?.id ? privateSrc : imgSrc(ex)} alt="" />
}
