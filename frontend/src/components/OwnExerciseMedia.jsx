import { useRef } from 'react'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { nameIn } from '../lib/a11y-name.js'
import { exMediaOf, setExMedia, clearExMedia, setExMediaShow, serverTakesExMedia } from '../lib/ex-media.js'
import { isCustomEx } from '../lib/exercises.js'
import { useMediaPicker } from './CustomMediaField.jsx'
import { CustomThumb } from './CustomMedia.jsx'
import { Row, Segmented, Button } from './ui.jsx'
import Icon from './Icon.jsx'

// "Your photo or video" on a built-in exercise's page (#259, #534, lib/ex-media.js): film how you
// do it on your machine and it shows instead of the stock animation, or beside it, one tap apart.
// The same picker and store as a custom exercise's media (CustomMediaField.jsx useMediaPicker), so
// the file is shrunk, scrubbed and synced to your own folder the same way. Never shared.
export default function OwnExerciseMedia({ ex }) {
  // The raw entry, then read: a selector that builds a new object every time would re-render forever.
  const entry = useStore(s => s.S.exMedia?.[ex?.id])
  const own = exMediaOf({ exMedia: { [ex?.id]: entry } }, ex?.id)
  const update = useStore(s => s.update)
  const user = useStore(s => s.user)
  const config = useStore(s => s.config)
  const { pick, busy, busyLabel, warning, note, showAdd, canAdd } = useMediaPicker()
  const fileRef = useRef(null)
  if (!ex || ex.missing || isCustomEx(ex)) return null
  // A signed-in app on a server from before this would see the file swept: nothing is offered.
  if (!serverTakesExMedia(user, config)) return null
  const onFile = async ev => {
    const file = ev.target.files && ev.target.files[0]
    ev.target.value = ''
    const got = await pick(file)
    if (got) update(s => { setExMedia(s, ex.id, got) })
  }
  const m = own?.m
  return <div className="sect-b own-media">
    <Row icon="camera" iconTint="var(--indigo)" title={t('Your photo or video')}
      subtitle={m ? t('Only you see it. It travels with your account.') : t('Show how you do it, on your own machine. Only you see it.')}>
      <div className="cmf-act">
        {m && <span className="cmf-thumb"><CustomThumb ex={{ custom: true, media: m }} /></span>}
        {showAdd && <Button variant="tinted" size="sm" icon={busy ? undefined : 'camera'} disabled={!canAdd} aria-label={busy ? undefined : nameIn(t('Your photo or video'), m ? t('Change') : t('Add'))} onClick={() => fileRef.current?.click()}>
          {busy ? busyLabel : m ? t('Change') : t('Add')}
        </Button>}
        {m && <Button variant="ghost" size="sm" icon="xmark" aria-label={nameIn(t('Your photo or video'), t('Remove'))} title={t('Remove')} disabled={busy}
          onClick={() => update(s => { clearExMedia(s, ex.id) })} />}
      </div>
    </Row>
    {m && <Row icon="image" iconTint="var(--blue)" title={t('Show first')}>
      <Segmented value={own.show} onChange={v => update(s => { setExMediaShow(s, ex.id, v) })}
        options={[{ value: 'own', label: t('Yours') }, { value: 'stock', label: t('Animation') }]} />
    </Row>}
    <input ref={fileRef} type="file" accept="image/*,video/*" hidden onChange={onFile} />
    {warning && <div className="small dim cmf-note">{warning}</div>}
    {note && <div className="small dim cmf-note">{note}</div>}
  </div>
}

/** The little switch on the picture itself: flip between yours and the animation. */
export function OwnMediaFlip({ exId, showing }) {
  const update = useStore(s => s.update)
  const toStock = showing === 'own'
  return <button type="button" className="own-flip" data-swipe-ignore
    aria-label={toStock ? t('Show the animation') : t('Show yours')}
    onClick={e => { e.stopPropagation(); update(s => { setExMediaShow(s, exId, toStock ? 'stock' : 'own') }) }}>
    <Icon name={toStock ? 'play' : 'camera'} />{toStock ? t('Animation') : t('Yours')}
  </button>
}
