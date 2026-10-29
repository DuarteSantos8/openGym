// "Your year in openGym": the year as full-screen stories, tap or swipe through, every card a
// picture to share. Loaded only when opened (App.jsx), so the rest of the year it costs nothing.
// The numbers come from lib/wrapped.js, the words from lib/wrapped-cards.js, the pictures are
// drawn on the device by the same layout (components/ShareCard.jsx). Nothing is sent anywhere.
//
// Getting around: tap the right side (the left in Arabic) or swipe for the next card, the other
// side for the one before, arrow keys on a keyboard, Escape or × to close. Every card is also a
// labelled group a screen reader lands on, with real Previous and Next buttons; with Reduce
// Motion on, the numbers stand still and the cards do not slide.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { useWrappedUI } from '../lib/wrapped-ui.js'
import { yearStats, withYear, wrappedOf } from '../lib/wrapped.js'
import { wrappedCards, layoutWrappedCard, drawWrappedCard } from '../lib/wrapped-cards.js'
import { cardPalette } from '../lib/card-draw.js'
import { makeCanvas, toPng, currentAccent, isRtl } from '../lib/share-image.js'
import { viewAspect, CARD_FONT } from '../lib/workout-card.js'
import { reducedMotion } from '../lib/seasonal.js'
import { t, useLang, dateLocale } from '../lib/i18n.js'
import Icon from './Icon.jsx'
import BodyMap from './BodyMap.jsx'
import ShareCardSheet from './ShareCard.jsx'
import './Wrapped.css'

/** A card's picture: the card laid out on a 9:16 or 1:1 canvas, PNG. */
export async function wrappedCardImage(card, { format, style, year, body }) {
  const colors = cardPalette(style, currentAccent())
  const geometry = card.map ? (await import('../lib/body-paths.js')).default : null
  const shape = geometry && (geometry[body] || geometry.male)
  const probe = makeCanvas(1, 1, CARD_FONT)
  if (!probe) return null
  const layout = layoutWrappedCard(card, { measure: probe.measure, format, rtl: isRtl(), year, map: shape ? { aspect: viewAspect(shape.front) } : null })
  const c = makeCanvas(layout.width, layout.height, CARD_FONT)
  if (!c) return null
  drawWrappedCard(c.ctx, layout, colors, shape ? { body: shape, levels: card.map } : null)
  return toPng(c.canvas)
}

// The big number counting up to itself as its card comes in: whole numbers only, never with
// Reduce Motion, and the final text is always the card's own (formatted) one.
function useCountUp(target, key, still) {
  const [v, setV] = useState(still || !Number.isInteger(target) ? null : 0)
  useEffect(() => {
    if (still || !Number.isInteger(target) || target <= 1) { setV(null); return }
    let raf = 0
    const t0 = performance.now()
    const dur = Math.min(1400, 500 + target * 6)
    const step = now => {
      const p = Math.min(1, (now - t0) / dur)
      const eased = 1 - Math.pow(1 - p, 3)
      if (p >= 1) { setV(null); return }
      setV(Math.round(target * eased))
      raf = requestAnimationFrame(step)
    }
    setV(0)
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, key, still])
  return v
}

function Card({ card, index, total, still, st, body, onHideBody }) {
  const count = useCountUp(card.num, card.id, still)
  const nfmt = n => { try { return new Intl.NumberFormat(dateLocale()).format(n) } catch (e) { return String(n) } }
  return <div className={'wr-card wr-' + card.id} role="group" aria-roledescription={t('Card')} aria-label={t('{0} of {1}', index + 1, total)}>
    <div className="wr-kicker" style={{ '--d': 0 }}>{card.kicker}</div>
    <div className="wr-body">
      {card.bigKind === 'number' && card.big && <div className="wr-big" style={{ '--d': 1 }}>
        <span className="wr-num" aria-hidden={count != null ? 'true' : undefined}>{count != null ? nfmt(count) : card.big}</span>
        {count != null && <span className="vh">{card.big}</span>}
        {card.unit && <span className="wr-unit"> {card.unit}</span>}
      </div>}
      {card.bigKind === 'text' && card.big && <div className="wr-bigtext" style={{ '--d': 1 }}>{card.big}</div>}
      {card.title && <div className={card.bigKind === 'none' ? 'wr-title wr-title-lg' : 'wr-title'} style={{ '--d': 2 }}>{card.title}</div>}
      {(card.lines || []).map((line, i) => <div key={i} className="wr-line" style={{ '--d': 3 + i }}>{line}</div>)}
      {card.map && <div className="wr-map" style={{ '--d': 4 }} aria-hidden="true"><BodyMap load={st.load} body={body} /></div>}
      {card.bars && <div className="wr-bars" style={{ '--d': 4 }} aria-hidden="true">
        {card.bars.map((n, i) => {
          const max = Math.max(1, ...card.bars)
          return <div key={i} className={'wr-bar' + (i === card.barPeak ? ' peak' : '')}>
            <i style={{ height: Math.max(6, (n / max) * 100) + '%', '--b': i }} />
            <span>{(card.barLabels?.[i] || '').slice(0, 1)}</span>
          </div>
        })}
      </div>}
      {card.tiles && <div className="wr-tiles" style={{ '--d': 3 }}>
        {[...card.tiles.filter(x => !x.wide), ...card.tiles.filter(x => x.wide)].map((tile, i) => <div key={i} className={'wr-tile' + (tile.wide ? ' wide' : '')} style={{ '--t': i }}>
          <div className="l">{tile.label}</div><div className="v">{tile.value}</div>
        </div>)}
      </div>}
      {card.hideable && <button type="button" className="wr-hide" style={{ '--d': 6 }} onClick={e => { e.stopPropagation(); onHideBody() }}>
        {t('Leave body weight out of my year')}
      </button>}
    </div>
  </div>
}

export default function Wrapped() {
  const year = useWrappedUI(s => s.year)
  const close = useWrappedUI(s => s.close)
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const lang = useLang()
  const st = useMemo(() => (year ? yearStats(S, year) : null), [year, S.workouts, S.bodyweight, S.unit, S.weekStart, S.wrappedBody, S.exUnit]) // eslint-disable-line react-hooks/exhaustive-deps
  const cards = useMemo(() => wrappedCards(st, S), [st, lang]) // eslint-disable-line react-hooks/exhaustive-deps
  const [i, setI] = useState(0)
  const [dir, setDir] = useState(1)
  const still = useMemo(() => reducedMotion(), [])
  const rtl = isRtl()
  const root = useRef(null)
  const stage = useRef(null)
  const back = useRef(null)
  const idx = Math.min(i, Math.max(0, cards.length - 1))
  const card = cards[idx]

  // Opened once is enough for the Home card to go (lib/wrapped.js homeCardYear).
  useEffect(() => {
    if (!year || !st) return
    if (!wrappedOf(S).opened.includes(year)) update(s => { s.wrapped = withYear(s, 'opened', year) })
  }, [year, !!st]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setI(0) }, [year])
  // Focus moves in, the page under it stops scrolling, and focus goes back where it was after.
  useEffect(() => {
    if (!year) return
    back.current = document.activeElement
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev; try { back.current?.focus?.() } catch (e) { /* gone */ } }
  }, [year])
  useEffect(() => { stage.current?.focus?.({ preventScroll: true }) }, [idx, year])

  const go = d => {
    setDir(d)
    setI(x => {
      const n = Math.min(cards.length - 1, Math.max(0, Math.min(x, cards.length - 1) + d))
      return n
    })
  }
  const next = () => { if (idx >= cards.length - 1) return; go(1) }
  const prev = () => go(-1)
  const sheetOpen = () => useUI.getState().sheets.length > 0
  useEffect(() => {
    if (!year) return
    const onKey = e => {
      if (sheetOpen()) return
      if (e.key === 'Escape') { e.preventDefault(); close() }
      else if (e.key === 'ArrowRight') { e.preventDefault(); rtl ? prev() : next() }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); rtl ? next() : prev() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // A tap on the far side goes back, anywhere else forward; a swipe goes the way it was swiped.
  const touch = useRef(null)
  const onDown = e => { touch.current = { x: e.clientX, y: e.clientY, t: Date.now() } }
  const onUp = e => {
    const s = touch.current
    touch.current = null
    if (!s || e.target.closest?.('button')) return
    const dx = e.clientX - s.x, dy = e.clientY - s.y
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) { (dx < 0) !== rtl ? next() : prev(); return }
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) return
    const box = stage.current?.getBoundingClientRect()
    if (!box) return
    const atStart = rtl ? e.clientX > box.right - box.width / 3 : e.clientX < box.left + box.width / 3
    atStart ? prev() : next()
  }

  if (!year || !st || !card) return null
  const share = c => {
    const body = S.body
    useUI.getState().openSheet(closeSheet => <ShareCardSheet title={t('Share this card')} close={closeSheet} toast={m => useUI.getState().toast(m)}
      name={`opengym-${year}-${c.id}.png`} shareTitle={t('Your {0} in openGym', String(year))}
      render={pref => wrappedCardImage(c, { ...pref, year, body })} />)
  }
  const hideBody = () => update(s => { s.wrappedBody = false })
  const last = idx === cards.length - 1
  return <div className={'wrapped' + (still ? ' still' : '')} ref={root} role="dialog" aria-modal="true" aria-label={t('Your {0} in openGym', String(year))}>
    <div className="wr-glow" aria-hidden="true"><i /><i /><i /></div>
    <div className="wr-top">
      <div className="wr-progress" aria-hidden="true">
        {cards.map((c, n) => <span key={c.id} className={n < idx ? 'done' : n === idx ? 'on' : ''} />)}
      </div>
      <div className="wr-bar-row">
        <span className="wr-year">{year}</span>
        <button type="button" className="wr-btn" onClick={() => share(card)} aria-label={t('Share this card')}><Icon name="share" /></button>
        <button type="button" className="wr-btn" onClick={close} aria-label={t('Close')}><Icon name="xmark" /></button>
      </div>
    </div>
    <div className="wr-stage" ref={stage} tabIndex={-1} aria-live="polite" onPointerDown={onDown} onPointerUp={onUp}>
      <div key={card.id} className={'wr-slide ' + (dir > 0 ? 'from-end' : 'from-start')}>
        <Card card={card} index={idx} total={cards.length} still={still} st={st} body={S.body} onHideBody={hideBody} />
      </div>
    </div>
    <div className="wr-foot">
      <button type="button" className="wr-nav" onClick={prev} disabled={idx === 0} aria-label={t('Previous card')}><Icon name={rtl ? 'chevronRight' : 'chevronLeft'} /></button>
      {last
        ? <button type="button" className="wr-cta" onClick={() => share(card)}><Icon name="share" /><span>{t('Share my year')}</span></button>
        : <button type="button" className="wr-cta ghost" onClick={() => share(card)}><Icon name="share" /><span>{t('Share')}</span></button>}
      {last
        ? <button type="button" className="wr-nav" onClick={close} aria-label={t('Done')}><Icon name="check" /></button>
        : <button type="button" className="wr-nav" onClick={next} aria-label={t('Next card')}><Icon name={rtl ? 'chevronLeft' : 'chevronRight'} /></button>}
    </div>
  </div>
}
