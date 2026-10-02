// The editor's part of a custom exercise's photo, GIF or video, and its link (CustomExForm in
// sheets.jsx). The row follows #295's picture field (horusglez) — the thumb of the draft, a
// tinted Add/Change and a ghost Remove — and the link field is #246's (Vaibhav159).
//
// A picked file is turned into what the state keeps right here (lib/media-ingest.js: re-encoded
// or scrubbed, hashed, with a poster) and put into the local store as pending before the form is
// saved. That order is safe: an abandoned draft's files are unreferenced and the local clean-up
// takes them after an hour; the server marks an upload that nothing references yet and keeps it
// for its grace period, so the state push landing after the upload changes nothing.
//
// The file input accepts image/* and video/* and nothing more specific: iOS converts a HEIC
// photo to JPEG only when the page does not explicitly ask for HEIC, and every format is checked
// on its bytes anyway.
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { mediaOf, fmtClip } from '../lib/media-refs.js'
import { mediaStore } from '../lib/media-store.js'
import { MOBILE } from '../lib/mobile.js'
import { limitsFrom, fmtMB, MB } from '../lib/media-limits.js'
import { CustomThumb } from './CustomMedia.jsx'
import { Row, Button } from './ui.jsx'
import Icon from './Icon.jsx'

const toast = m => useUI.getState().toast(m)

// A write the local store refused for room — IndexedDB's quota (Firefox names it its own way), or
// a full phone under the file store. The file itself was fine; saying the browser cannot read it
// would send someone looking for a different file.
const noRoom = e => e?.name === 'QuotaExceededError' || e?.name === 'NS_ERROR_DOM_QUOTA_REACHED' || /ENOSPC|no space left/i.test(String(e?.message || ''))

/** The sentence for a refused file (MediaError codes from lib/media-ingest.js), or for a device
 *  that had no room to keep it. */
export function mediaErrorText(e) {
  if (noRoom(e)) return t('There is no room left on this device for that file.')
  switch (e?.code) {
    case 'type': return t('That file type is not supported — use a photo, a GIF, or an MP4, MOV or WebM video.')
    case 'too-large': return t('That file is too large — up to {0} MB.', fmtMB(e.mb))
    case 'too-long': return t('That video is too long — up to {0} seconds.', e.sec)
    case 'photo-too-big': return t('That photo is too large to process on this device.')
    default: return t('This browser cannot read that file.')
  }
}

const KIND_ICON = { image: 'image', gif: 'play', video: 'play' }

/**
 * The picking half of a media field, shared by the custom-exercise editor and a workout's photos
 * and videos (WorkoutMedia.jsx) so both run the very same ingest and store path. pick(file)
 * turns a picked file into what the state keeps (lib/media-ingest.js: re-encoded or scrubbed,
 * hashed, with a poster), puts its files into the local store as pending, and resolves the
 * MediaRef — or null after it toasted why not. `note` is the dim line that says where the files
 * will live; `canAdd` is false where nothing could keep them (a server without media, or a
 * browser that cannot store them), `showAdd` false only where the button should not even show,
 * `storable` false where this browser cannot keep a file at all.
 */
export function useMediaPicker() {
  const user = useStore(s => s.user)
  const config = useStore(s => s.config)
  const [busy, setBusy] = useState(false)
  const [warning, setWarning] = useState(null)
  // Whether files picked here outlive the tab: false when IndexedDB is blocked and the store runs
  // in memory — then nothing is offered, since a saved exercise would point at nothing tomorrow.
  const [storable, setStorable] = useState(true)
  useEffect(() => {
    let alive = true
    mediaStore.ready().then(() => { if (alive) setStorable(mediaStore.persistent) }).catch(() => { if (alive) setStorable(false) })
    return () => { alive = false }
  }, [])
  // Signed in to a server that answered without a `media` block: it predates the feature or has
  // MEDIA_UPLOADS=0. Nothing would ever reach it. A config not known yet (an offline start) is
  // not that answer — a file picked then waits here and goes up once the server is reached. A
  // guest in the browser is on that same server, and what it picks would be owed and never sent
  // once it signs up; a phone in local mode has no server (a config left from an earlier pairing
  // says nothing about it).
  const serverLacks = (!!user || !MOBILE) && !!config && !config.media

  const pick = async file => {
    if (!file) return null
    setBusy(true)
    setWarning(null)
    try {
      // The ingest (decoders, canvas, the MP4 walk) only loads when someone picks a file.
      const { ingestMediaFile } = await import('../lib/media-ingest.js')
      const out = await ingestMediaFile(file, limitsFrom(config))
      for (const b of out.blobs) await mediaStore.put(b.hash, b.blob, { mime: b.mime, pending: true })
      // A guest's or a local phone's copy is the only one: ask the browser not to evict it under
      // storage pressure. Best effort, and absent on plain http.
      if (!user) { try { globalThis.navigator?.storage?.persist?.()?.catch?.(() => {}) } catch { /* not offered */ } }
      if (out.warnings.includes('codec')) setWarning(t('This video may not play on every device — MP4 (H.264) plays everywhere.'))
      return out.media
    } catch (e) {
      toast(mediaErrorText(e))
      return null
    } finally {
      setBusy(false)
    }
  }
  const note = !storable ? t('This browser cannot store photos or videos here.')
    : serverLacks ? t('Your server does not store photos and videos yet.')
      : !user ? t('Kept on this device only — Export with photos & videos keeps a copy.')
        : null
  return { pick, busy, warning, setWarning, note, storable, showAdd: !serverLacks, canAdd: !busy && storable && !serverLacks }
}

export default function CustomMediaField({ media, url, onChange }) {
  const { pick, busy, warning, setWarning, note, showAdd, canAdd } = useMediaPicker()
  const fileRef = useRef(null)
  const m = mediaOf({ media })
  // The draft's files stay out of the local clean-up for as long as this form is open: its
  // one-hour grace would otherwise take a file picked in a form left open longer, and the saved
  // exercise would point at nothing.
  const mainHash = m?.hash, posterHash = m?.poster?.hash
  useEffect(() => {
    if (!mainHash) return undefined
    return mediaStore.hold([mainHash, posterHash])
  }, [mainHash, posterHash])

  const onFile = async ev => {
    const file = ev.target.files && ev.target.files[0]
    ev.target.value = ''   // picking the same file again still fires onChange
    const got = await pick(file)
    if (got) onChange({ media: got })
  }

  // "0:07 · 2.4 MB": the length of a clip or an animation, and the size of the file itself (the
  // unit through the packs' own "{0} MB", so it reads Mo, МБ, م.ب where it should, and the
  // number with the language's own decimal mark).
  const sizeLine = m ? [m.dur != null && m.kind !== 'image' ? fmtClip(m.dur) : null, t('{0} MB', fmtMB(Math.max(0.1, m.size / MB), { fixed: true }))].filter(Boolean).join(' · ') : null
  const subtitle = m
    ? <span className="cmf-sub"><Icon name={KIND_ICON[m.kind]} />{sizeLine}</span>
    : t('Optional — a picture makes it easier to spot in a list.')

  return <div className="cmf">
    <Row icon="image" iconTint="var(--blue)" title={t('Photo, GIF or video')} subtitle={subtitle}>
      <div className="cmf-act">
        {m && <span className="cmf-thumb"><CustomThumb ex={{ custom: true, media: m }} /></span>}
        {/* Hidden on a server that will never take a file; shown but off where this browser
            cannot keep one, with the note below saying why. */}
        {showAdd && <Button variant="tinted" size="sm" icon={busy ? undefined : 'image'} disabled={!canAdd} onClick={() => fileRef.current?.click()}>
          {busy ? t('Loading…') : m ? t('Change') : t('Add')}
        </Button>}
        {m && <Button variant="ghost" size="sm" icon="xmark" aria-label={t('Remove')} title={t('Remove')} disabled={busy} onClick={() => { setWarning(null); onChange({ media: null }) }} />}
      </div>
    </Row>
    <input ref={fileRef} type="file" accept="image/*,video/*" hidden onChange={onFile} />
    {warning && <div className="small dim cmf-note">{warning}</div>}
    {note && <div className="small dim cmf-note">{note}</div>}
    <input className="input cmf-link" type="url" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false}
      dir={url ? 'ltr' : undefined} placeholder={t('Video or guide link (optional)')}
      value={url || ''} onChange={e => onChange({ url: e.target.value })} />
  </div>
}
