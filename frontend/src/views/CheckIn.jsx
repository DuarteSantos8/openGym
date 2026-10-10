import { useLayoutEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { uid } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { canRenderFmt, canRenderCode, cardCodeValue, normalizeFmt } from '../lib/qr.js'
import { scanCode, importCodeFromImage } from '../lib/scan.js'
import { MOBILE } from '../lib/mobile.js'
import Icon from '../components/Icon.jsx'
import CardCode from '../components/CardCode.jsx'
import CameraScan from '../components/CameraScan.jsx'
import { Button, TextField } from '../components/ui.jsx'
import { confirmSheet } from '../sheets.jsx'

// Move the card at `from` to sit at index `to`, returning a new array (the input is left alone).
// Backs the on-card ◀ ▶ reorder buttons. Out-of-range or no-op moves return an unchanged copy
// rather than throwing, so a button at either end is simply inert.
export function moveGymCard(cards, from, to) {
  const next = [...cards]
  if (from < 0 || from >= next.length) return next
  const target = Math.max(0, Math.min(to, next.length - 1))
  if (target === from) return next
  const [moved] = next.splice(from, 1)
  next.splice(target, 0, moved)
  return next
}

// Gym check-in (reached from the Home "Check in" card; app and PWA alike). Shows each saved
// membership code as a QR or Code 128 barcode (whichever it was scanned as) the turnstile can read, swiped through horizontally, with a trailing
// "+" to add another. We only ever store the code's value + symbology; the code is regenerated from
// it here every time (see lib/qr.js, lib/code128.js), so nothing sensitive is kept as an image.
//
// The rail reopens on the card you used last (lastGymCardId) and remembers the one you settle on,
// so a member with two gyms lands on the right code without swiping. Cards are added by scanning
// or importing a photo only — never by typing a code, which is too easy to fat-finger into a
// code that silently fails at the turnstile. An existing card can be edited (rename, re-scan), and
// with more than one card each carries ◀ ▶ buttons to nudge its position along the rail.
export default function CheckIn() {
  const nav = useNavigate()
  const cards = useStore(s => s.S.gymCards) || []
  const lastId = useStore(s => s.S.lastGymCardId)
  const update = useStore(s => s.update)
  const railRef = useRef(null)
  const [active, setActive] = useState(0)

  // Open on the last-used card. Done once on mount (and whenever the saved id changes from
  // elsewhere) with layout effect so the jump happens before paint — no visible scroll from 0.
  // A stale id (its card was removed) falls back to the first card.
  useLayoutEffect(() => {
    const rail = railRef.current
    if (!rail || !cards.length) return
    const idx = Math.max(0, cards.findIndex(c => c.id === lastId))
    rail.scrollLeft = idx * rail.clientWidth
    setActive(idx)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastId, cards.length])

  // Which card the horizontal scroll has settled on — drives the dots and gets remembered as the
  // last-used card. Reading it off the scroll position keeps the rail itself the single control.
  const onScroll = () => {
    const rail = railRef.current
    if (!rail) return
    const i = Math.round(rail.scrollLeft / rail.clientWidth)
    if (i === active) return
    setActive(i)
    const card = cards[i]
    if (card && card.id !== lastId) update(s => { s.lastGymCardId = card.id }, false)
  }

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/home')} aria-label={t('Home')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1 }}>
        <h1 style={{ fontSize: 28 }}>{t('Check in')}</h1>
        <div className="sub">{cards.length ? t('Show this at the gym') : t('Add your gym card')}</div>
      </div>
    </div>

    <div className="ci-rail" ref={railRef} onScroll={onScroll}>
      {cards.map((card, i) => <CardFace
        key={card.id}
        card={card}
        index={i}
        count={cards.length}
      />)}
      <button className="ci-add" onClick={openAddCard}>
        <Icon name="plus" />
        <span className="ci-add-t">{t('Add a card')}</span>
      </button>
    </div>

    {(cards.length > 0) && <div className="ci-dots">
      {cards.map((c, i) => <span key={c.id} className={'ci-dot' + (i === active ? ' on' : '')} />)}
      {/* the add card is a slide too, so it gets a dot */}
      <span className={'ci-dot' + (active >= cards.length ? ' on' : '')} />
    </div>}

    {!cards.length && <div className="muted small" style={{ textAlign: 'center', marginTop: 18, lineHeight: 1.5 }}>
      {t('Import a photo of your membership card or scan it with the camera. No extra app needed at the gym, just open this screen.')}
    </div>}
  </div>
}

// One saved card: its label centered above the QR, and the raw value underneath (handy when a
// reader is fussy and a staff member types it in). The edit button opens the same sheet used to
// add a card, pre-filled; the trash button removes it after a confirm. With more than one card, a
// row of ◀ ▶ buttons nudges this card one slot along the rail — a plain, reliable reorder that
// doesn't fight the rail's horizontal scroll the way a drag gesture did.
function CardFace({ card, index, count }) {
  const update = useStore(s => s.update)
  const remove = () => confirmSheet({
    title: t('Remove this card?'),
    message: card.label,
    confirmText: t('Remove'),
    danger: true,
    onConfirm: () => update(s => {
      s.gymCards = (s.gymCards || []).filter(c => c.id !== card.id)
      if (s.lastGymCardId === card.id) s.lastGymCardId = (s.gymCards[0]?.id) || null
    }),
  })
  const move = to => update(s => { s.gymCards = moveGymCard(s.gymCards, index, to) })
  return <div className="ci-card">
    <div className="ci-card-hd">
      <button className="iconbtn ci-card-btn" onClick={() => openEditCard(card)} aria-label={t('Edit')}><Icon name="pencil" /></button>
      <div className="ci-label">{card.label}</div>
      <button className="iconbtn ci-card-btn" style={{ color: 'var(--red)' }} onClick={remove} aria-label={t('Remove')}><Icon name="trash" /></button>
    </div>
    {/* a card stored before scans were checked can hold a code we can't draw: say so, rather than
        show an empty plate that looks like it should scan */}
    {canRenderCode(card.value, card.fmt)
      ? <div className="ci-qr-plate"><CardCode value={card.value} fmt={card.fmt} size={isBarcode(card.fmt) ? 280 : 230} /></div>
      : <div className="ci-unusable">{UNDRAWABLE()}</div>}
    <div className="ci-value">{card.value}</div>
    {count > 1 && <div className="ci-reorder">
      <button className="iconbtn ci-card-btn" onClick={() => move(index - 1)} disabled={index === 0} aria-label={t('Move left')}><Icon name="chevronLeft" /></button>
      <span className="ci-pos">{index + 1} / {count}</span>
      <button className="iconbtn ci-card-btn" onClick={() => move(index + 1)} disabled={index === count - 1} aria-label={t('Move right')}><Icon name="chevronRight" /></button>
    </div>}
  </div>
}

/* ------------------------------------------------------------- add/edit sheet -- */

// Opens the add-card sheet. Co-located with the view (not sheets.jsx) because it pulls in the
// scanner paths — keeping it here keeps them out of the shared sheets module.
export function openAddCard() {
  useUI.getState().openSheet(close => <CardSheet close={close} />)
}

// Opens the same sheet on an existing card to rename it or re-scan its code.
export function openEditCard(card) {
  useUI.getState().openSheet(close => <CardSheet close={close} card={card} />)
}

// Shared sheet for adding and editing a card. Without `card` it creates a new one; with `card` it
// updates that entry in place. The code always comes from a scan or a photo — there is no text
// field for it — so an edit that only renames keeps the existing scanned code untouched.
function CardSheet({ close, card }) {
  const editing = !!card
  const [label, setLabel] = useState(card?.label || '')
  const [value, setValue] = useState(card?.value || '')
  const [fmt, setFmt] = useState(card?.fmt || 'qrcode')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef(null)
  const toast = useUI(s => s.toast)

  const code = cardCodeValue(value, fmt)
  const commit = () => {
    if (!code) { toast(t('Scan or import a code first')); return }
    if (!canRenderCode(code, fmt)) { toast(UNDRAWABLE()); return }
    const update = useStore.getState().update
    if (editing) {
      // The card can be removed on another device while this sheet is open. Checking inside the
      // mutator returned from the MUTATOR, not from here, so the sheet still said "Card updated",
      // closed, and pushed a write that changed nothing. Look first, and say what happened.
      if (!(useStore.getState().S.gymCards || []).some(x => x.id === card.id)) {
        toast(t('That card was removed on another device'))
        close()
        return
      }
      update(s => {
        const c = (s.gymCards || []).find(x => x.id === card.id)
        if (!c) return
        c.label = label.trim() || t('Gym card')
        c.value = code
        c.fmt = fmt
      })
      toast(t('Card updated'))
    } else {
      update(s => {
        if (!Array.isArray(s.gymCards)) s.gymCards = []
        const id = uid()
        s.gymCards.push({ id, label: label.trim() || t('Gym card'), value: code, fmt })
        s.lastGymCardId = id
      })
      toast(t('Card added'))
    }
    close()
  }

  // Every capture path lands here. A code we can't redraw is refused before it touches the form,
  // so a bad re-scan leaves the card's working code (and its preview) exactly as they were.
  const take = found => {
    if (!canRenderFmt(found.fmt)) { toast(UNSUPPORTED()); return }
    if (!canRenderCode(found.value, found.fmt)) { toast(UNDRAWABLE()); return }
    const f = normalizeFmt(found.fmt)
    setValue(cardCodeValue(found.value, f)); setFmt(f)
  }

  // Camera scan: in the app, hands off to the native scanner; in a browser, opens our own camera
  // sheet on top of this one. Either way the value drops straight into the form so the user can
  // still name it before saving.
  const doScan = async () => {
    if (!MOBILE) {
      useUI.getState().openSheet(closeCam => <CameraScan
        onCancel={closeCam}
        onFound={found => {
          closeCam()
          take(found)
        }} />)
      return
    }
    setBusy(true)
    try {
      const found = await scanCode()
      if (!found) return                      // user backed out
      take(found)
    } catch (e) {
      toast(scanErrorMessage(e))
    } finally { setBusy(false) }
  }

  const onFile = async ev => {
    const file = ev.target.files && ev.target.files[0]
    ev.target.value = ''                       // let the same file be picked again later
    if (!file) return
    setBusy(true)
    try {
      const found = await importCodeFromImage(file)
      if (!found) { toast(t('No QR code or barcode found in that image')); return }
      take(found)
    } catch (e) {
      toast(t('Could not read that image'))
    } finally { setBusy(false) }
  }

  return <>
    <h3>{editing ? t('Edit card') : t('Add a card')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>{t('Scan it with the camera or import a photo.')}</div>

    <div className="row" style={{ gap: 8, marginBottom: 16 }}>
      <Button variant="tinted" icon="camera" onClick={doScan} disabled={busy}>{editing ? t('Re-scan') : t('Scan')}</Button>
      <Button variant="tinted" icon="image" onClick={() => fileRef.current?.click()} disabled={busy}>{t('Import photo')}</Button>
    </div>

    <label className="sect-t">{t('Label')}</label>
    <TextField value={label} onChange={e => setLabel(e.target.value)} placeholder={t('e.g. FitZone downtown')} style={{ marginBottom: 16 }} />

    {code && <div className="ci-qr-plate" style={{ alignSelf: 'center', marginBottom: 16 }}><CardCode value={code} fmt={fmt} size={isBarcode(fmt) ? 220 : 150} /></div>}

    <Button variant="primary" onClick={commit} disabled={busy || !code}>{editing ? t('Save card') : t('Save card')}</Button>

    <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
  </>
}

const isBarcode = fmt => normalizeFmt(fmt) === 'code128'
const UNDRAWABLE = () => t("This code can't be drawn as a barcode. Scan the card again")
const UNSUPPORTED = () => t("That code type can't be shown here. Only QR codes and Code 128 barcodes work")

// Map the thrown reasons from lib/scan.js to something a person can act on.
function scanErrorMessage(e) {
  const m = String(e && e.message)
  if (m === 'permission-denied') return t('Camera permission is needed to scan. Enable it in Settings.')
  if (m === 'unsupported') return t('Scanning is not available on this device.')
  return t('Could not start the scanner')
}
