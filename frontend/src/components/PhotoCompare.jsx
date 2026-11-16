// Comparing progress photos (#950): two to nine, oldest first. Two can be the before/after slider
// or side by side; more are side by side, in rows of at most three (lib/photo-compare.js). Every
// cell has the same shape, the middle one of the set's, so they all stand at the same height; a
// photo of another shape is cropped and can be dragged to choose what shows. Share draws what is
// on the screen into one picture (lib/compare-image.js) for the share sheet. The photos are only
// ever shown here; sharing the picture is something the person does on purpose, and it goes
// through the phone's share sheet or a download, never to the server or the community library.
import { MOBILE } from '../lib/mobile.js'
import { useLayoutEffect, useRef, useState } from 'react'
import { t, tn } from '../lib/i18n.js'
import { fmtDate } from '../lib/format.js'
import { compareRows, cellAspect, panBy, pinchZoom, clampZoom, daysApart } from '../lib/photo-compare.js'
import { useMediaUrl } from './CustomMedia.jsx'
import { Segmented } from './ui.jsx'
import Icon from './Icon.jsx'

const GAP = 6
const posCss = p => `${((p?.x ?? 0.5) * 100).toFixed(1)}% ${((p?.y ?? 0.5) * 100).toFixed(1)}%`

/** The cell size that fits `rows` of cells of shape `aspect` into a w x h box. */
export function fitCells(rows, aspect, w, h) {
  const cols = Math.max(1, ...rows), n = Math.max(1, rows.length)
  const byW = (w - GAP * (cols - 1)) / cols
  const byH = ((h - GAP * (n - 1)) / n) * aspect
  const cw = Math.max(0, Math.min(byW, byH))
  return { w: cw, h: cw / aspect }
}

/** The photo at its cover size times the zoom, placed by `pos` the way object-position would. */
function zoomedStyle(p, size, pos) {
  const z = clampZoom(pos?.z ?? 1)
  const w = p.m.width || 0, h = p.m.height || 0
  if (z <= 1 || !w || !h) return { objectPosition: posCss(pos) }
  const s = Math.max(size.w / w, size.h / h) * z
  return {
    position: 'absolute', width: w * s, height: h * s, maxWidth: 'none', objectFit: 'fill',
    left: (size.w - w * s) * (pos?.x ?? 0.5), top: (size.h - h * s) * (pos?.y ?? 0.5),
  }
}

// One finger drags the photo, two fingers pinch it bigger or smaller (the wheel does the same with
// a mouse or a trackpad). Pointers are tracked by hand: touch-action is none on the cell.
function Cell({ p, size, pos, onPos, urls }) {
  const { url } = useMediaUrl(p.m)
  urls.current[p.key] = url
  const fingers = useRef(new Map())
  const gesture = useRef(null)
  const at = pos || {}
  const sw = p.m.width || 1, sh = p.m.height || 1
  const begin = () => {
    const pts = [...fingers.current.values()]
    gesture.current = pts.length >= 2
      ? { d: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), pos: { x: 0.5, y: 0.5, ...at } }
      : pts.length === 1 ? { x: pts[0].x, y: pts[0].y, pos: { x: 0.5, y: 0.5, ...at } } : null
  }
  const down = e => {
    fingers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    e.currentTarget.setPointerCapture?.(e.pointerId)
    begin()
  }
  const move = e => {
    if (!fingers.current.has(e.pointerId)) return
    fingers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const g = gesture.current
    if (!g) return
    const pts = [...fingers.current.values()]
    if (pts.length >= 2 && g.d != null) {
      const z = pinchZoom(g.pos.z, g.d, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y))
      onPos(panBy({ ...g.pos, z }, 0, 0, sw, sh, size.w, size.h))
    } else if (pts.length === 1 && g.x != null) {
      onPos(panBy(g.pos, pts[0].x - g.x, pts[0].y - g.y, sw, sh, size.w, size.h))
    }
  }
  const up = e => { fingers.current.delete(e.pointerId); begin() }
  const wheel = e => {
    const z = clampZoom((at.z ?? 1) * Math.exp(-e.deltaY / 300))
    onPos(panBy({ x: 0.5, y: 0.5, ...at, z }, 0, 0, sw, sh, size.w, size.h))
  }
  return <div className="pcmp-cell" style={{ width: size.w, height: size.h }}
    onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onWheel={wheel}>
    {url && <img src={url} alt="" draggable={false} style={zoomedStyle(p, size, pos)} />}
    <span className="pp-pill">{fmtDate(p.d, true)}</span>
  </div>
}

function Slider({ a, b, size, pos, pct, setPct, urls }) {
  const before = useMediaUrl(a.m), after = useMediaUrl(b.m)
  urls.current[a.key] = before.url
  urls.current[b.key] = after.url
  const ref = useRef(null)
  const dragging = useRef(false)
  const at = x => {
    const r = ref.current?.getBoundingClientRect()
    if (r && r.width) setPct(Math.max(0, Math.min(100, ((x - r.left) / r.width) * 100)))
  }
  const down = e => { dragging.current = true; e.currentTarget.setPointerCapture?.(e.pointerId); at(e.clientX) }
  const move = e => { if (dragging.current) at(e.clientX) }
  const up = () => { dragging.current = false }
  const onKey = e => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); setPct(v => Math.max(0, v - 5)) }
    if (e.key === 'ArrowRight') { e.preventDefault(); setPct(v => Math.min(100, v + 5)) }
  }
  return <div className="pp-compare pcmp-slider" ref={ref} style={{ width: size.w, height: size.h }}
    role="slider" tabIndex={0} aria-label={t('Before and after')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}
    onKeyDown={onKey} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
    {after.url && <img className="pp-img" src={after.url} alt="" draggable={false} style={{ objectPosition: posCss(pos[b.key]) }} />}
    {before.url && <img className="pp-img" src={before.url} alt="" draggable={false}
      style={{ objectPosition: posCss(pos[a.key]), clipPath: `inset(0 ${100 - pct}% 0 0)` }} />}
    <div className="pp-handle" style={{ left: pct + '%' }}><div className="pp-grip" /></div>
    <span className="pp-pill pp-label-before">{fmtDate(a.d, true)}</span>
    <span className="pp-pill pp-label-after">{fmtDate(b.d, true)}</span>
  </div>
}

/** `photos`: progressPhotosOf() entries, oldest first, two to nine. */
export default function PhotoCompare({ photos, close, toast }) {
  const two = photos.length === 2
  const [mode, setMode] = useState(two ? 'slider' : 'side')
  const [pct, setPct] = useState(50)
  const [pos, setPos] = useState({})
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [sharing, setSharing] = useState(false)
  const stageRef = useRef(null)
  const urls = useRef({})
  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return undefined
    const read = () => setBox({ w: el.clientWidth, h: el.clientHeight })
    read()
    if (typeof ResizeObserver !== 'function') return undefined
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const slider = two && mode === 'slider'
  const rows = slider ? [1] : compareRows(photos.length)
  const aspect = cellAspect(photos.map(p => p.m))
  const size = fitCells(rows, aspect, Math.max(0, box.w - 24), Math.max(0, box.h - 24))
  const first = photos[0], last = photos[photos.length - 1]
  const days = daysApart(first.d, last.d)
  const span = days > 0 ? tn('{0} day apart', '{0} days apart', days) : t('Same day')

  const share = async (save = false) => {
    if (sharing) return
    setSharing(true)
    try {
      const [{ renderCompare }, { shareImage, saveImage }] = await Promise.all([import('../lib/compare-image.js'), import('../lib/share-image.js')])
      // The slider shows each photo without its zoom, so the picture does too: it is what is on the screen.
      const items = photos.map(p => ({ url: urls.current[p.key], label: fmtDate(p.d, true, true), pos: slider && pos[p.key] ? { ...pos[p.key], z: 1 } : pos[p.key] }))
      if (items.some(it => !it.url)) { toast?.(t('Still loading the photos. Try again in a second.')); return }
      const blob = await renderCompare({ items, rows: slider ? [1] : rows, aspect, mode: slider ? 'slider' : 'side', pct, caption: span })
      if (!blob) { toast?.(t('This device could not draw the picture.')); return }
      await (save ? saveImage : shareImage)(blob, `opengym-progress-${first.d}-${last.d}.png`, t('Progress photos'), toast)
    } finally { setSharing(false) }
  }

  let k = 0
  return <div className="mviewer" role="dialog" aria-modal="true" aria-label={t('Compare photos')}>
    <div className="mviewer-bar">
      <button type="button" className="iconbtn" aria-label={t('Close')} onClick={close}><Icon name="xmark" /></button>
      <span className="mviewer-count">{span}</span>
      <span className="mviewer-acts">
        <button type="button" className="iconbtn" aria-label={t(MOBILE ? 'Save to Photos' : 'Save image')} disabled={sharing} onClick={() => share(true)}><Icon name="download" /></button>
        <button type="button" className="iconbtn" aria-label={t('Share as image')} disabled={sharing} onClick={() => share()}><Icon name="share" /></button>
      </span>
    </div>
    {/* A photo has no reading direction: before stays on the left in Arabic too. */}
    <div className="pcmp-stage" dir="ltr" ref={stageRef} data-swipe-ignore>
      {size.w > 0 && (slider
        ? <Slider a={first} b={last} size={size} pos={pos} pct={pct} setPct={setPct} urls={urls} />
        : <div className="pcmp-rows">
            {rows.map((n, r) => <div key={r} className="pcmp-row" style={{ gap: GAP }}>
              {photos.slice(k, k += n).map(p => <Cell key={p.key} p={p} size={size} pos={pos[p.key]} urls={urls}
                onPos={v => setPos(cur => ({ ...cur, [p.key]: v }))} />)}
            </div>)}
          </div>)}
    </div>
    <div className="pcmp-foot">
      {two
        ? <Segmented value={mode} onChange={setMode}
            options={[{ value: 'slider', label: t('Slider') }, { value: 'side', label: t('Side by side') }]} />
        : <div className="small" style={{ opacity: 0.7, textAlign: 'center' }}>{t('Drag a photo to move what shows, pinch to zoom.')}</div>}
    </div>
  </div>
}
