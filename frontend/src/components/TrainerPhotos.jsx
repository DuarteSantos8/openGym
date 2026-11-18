// A member's progress photos in the trainer dashboard (components/TrainerMember.jsx). The trainer
// fetches each file through GET /api/trainer/member/photo, which checks the photos grant every
// time; the bytes live in an object URL for as long as the card is on screen and nowhere else.
// In "See what Marco sees" the member looks at their own files, from this device first.
import { useEffect, useState } from 'react'
import { t } from '../lib/i18n.js'
import { fmtDate } from '../lib/format.js'
import { photoBlob } from '../lib/trainer-api.js'
import { apiBlob } from '../lib/api.js'
import { mediaStore } from '../lib/media-store.js'
import { Button } from './ui.jsx'
import Icon from './Icon.jsx'

const PAGE = 9

// One photo's URL: { url, failed }. Revoked (or released) the moment it leaves the screen.
function usePhoto(hash, memberId) {
  const [st, setSt] = useState({ url: null, failed: false })
  useEffect(() => {
    let alive = true, own = null, held = false
    const done = url => { if (alive) setSt({ url, failed: !url }) }
    ;(async () => {
      if (!memberId) {
        try { const u = await mediaStore.url(hash); if (u) { held = true; if (!alive) { mediaStore.release(hash); return } return done(u) } } catch { /* not on this device */ }
      }
      try {
        const b = memberId ? await photoBlob(memberId, hash) : await apiBlob('/api/media/' + hash)
        own = URL.createObjectURL(b)
        if (!alive) { URL.revokeObjectURL(own); return }
        done(own)
      } catch { done(null) }
    })()
    return () => {
      alive = false
      if (own) URL.revokeObjectURL(own)
      if (held) mediaStore.release(hash)
    }
  }, [hash, memberId])
  return st
}

function Thumb({ p, memberId, onOpen }) {
  const { url, failed } = usePhoto(p.hash, memberId)
  const label = t('Photo from {0}', fmtDate(p.d))
  return <button className={'tr-ph' + (url ? ' in' : '')} onClick={() => url && onOpen(p)} disabled={!url} aria-label={label}>
    {url ? <img src={url} alt="" draggable="false" /> : failed ? <Icon name="image" /> : null}
    <span className="tr-ph-d" aria-hidden="true">{fmtDate(p.d).replace(/\s\d{4}$/, '')}</span>
  </button>
}

function Big({ p, memberId, onClose }) {
  const { url } = usePhoto(p.hash, memberId)
  useEffect(() => {
    const k = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return <figure className="tr-ph-big">
    {url ? <img src={url} alt={t('Photo from {0}', fmtDate(p.d))} /> : <div className="tr-ph-wait" />}
    <figcaption><span>{fmtDate(p.d)}</span>
      <button className="tr-x" onClick={onClose} aria-label={t('Close')}><Icon name="xmark" /></button></figcaption>
  </figure>
}

/** `photos` is the projection's { count, last, items }; `memberId` null means "it's me". */
export default function TrainerPhotos({ photos, memberId = null }) {
  const [shown, setShown] = useState(PAGE)
  const [open, setOpen] = useState(null)
  const items = photos?.items || []
  return <div className="tr-card">
    <div className="tr-card-t">{t('Progress photos')}{photos?.count > 0 && <span className="tr-ph-n"> {photos.count}</span>}</div>
    {!items.length && <p className="tr-empty">{t('No progress photos yet.')}</p>}
    {open && <Big p={open} memberId={memberId} onClose={() => setOpen(null)} />}
    {items.length > 0 && <div className="tr-ph-grid">
      {items.slice(0, shown).map(p => <Thumb key={p.hash} p={p} memberId={memberId} onOpen={setOpen} />)}
    </div>}
    {items.length > shown && <div className="tr-wo-a"><Button size="sm" onClick={() => setShown(shown + PAGE)}>{t('Show more')}</Button></div>}
    {photos?.count > items.length && items.length <= shown && <p className="tr-tile-s">{t('The newest {0} are here.', items.length)}</p>}
  </div>
}
