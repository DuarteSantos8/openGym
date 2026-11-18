// Settings → Sound: the sounds of one's own (lib/user-sounds.js), below the built-in ones in the
// sound sheet. Add one from a file (lib/sound-ingest.js trims and checks it and writes the WAV
// every platform plays), tap one to pick it for the slot the sheet is on and hear it, rename or
// remove it. The file goes into the media store like a photo (pending, then up to the server
// that keeps sounds), so the other devices of the account get it too.
import { useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { mediaStore } from '../lib/media-store.js'
import { fmtClip } from '../lib/media-refs.js'
import { unlock, chime } from '../lib/sound.js'
import { soundsOf, addSound, removeSound, setSlot, slotChoice, nameFromFile, SOUNDS_MAX } from '../lib/user-sounds.js'
import { Section, Row, Button } from './ui.jsx'
import Icon from './Icon.jsx'

const toast = m => useUI.getState().toast(m)

/** The sentence for a sound that was refused (lib/sound-ingest.js MediaError codes). */
export function soundErrorText(e) {
  switch (e?.code) {
    case 'too-large': return t('That file is too big. Max {0} MB.', e.mb)
    case 'silent': return t('That file is all silence. Nothing to play.')
    default: return t('This sound cannot be read here. Try an MP3, M4A, WAV or OGG file.')
  }
}

const loadIngest = () => import('../lib/sound-ingest.js')

/** Plays a sound of one's own (or the chime, should its file be missing). */
export const previewOwn = m => { unlock(true); chime(true, 'u:' + m.hash) }

export default function OwnSounds({ slot = 'rest' }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const list = soundsOf(S)
  const cur = slotChoice(S, slot)
  const [busy, setBusy] = useState(false)
  const file = useRef(null)

  const pickOwn = e => {
    update(s => { setSlot(s, slot, 'u:' + e.id) })
    previewOwn(e.m)
  }
  const onFile = async ev => {
    const f = ev.target.files && ev.target.files[0]
    ev.target.value = ''
    if (!f) return
    setBusy(true)
    try {
      const { ingestSoundFile } = await loadIngest()
      const out = await ingestSoundFile(f)
      await mediaStore.put(out.media.hash, out.blob, { mime: 'audio/wav', pending: true })
      let id = null
      update(s => {
        id = addSound(s, { name: nameFromFile(f.name), m: out.media })
        if (id) setSlot(s, slot, 'u:' + id)
      })
      if (id) { previewOwn(out.media); toast(t('Added and picked. Tap it any time to hear it.')) }
    } catch (e) {
      toast(soundErrorText(e))
    } finally {
      setBusy(false)
    }
  }
  const remove = e => {
    update(s => { removeSound(s, e.id) })
    toast(t('Sound removed.'))
  }

  return <Section title={t('Your own sounds')} footer={t('Up to 30 seconds, from an MP3, M4A, WAV or OGG file. Silence at either end is trimmed off.')}>
    {list.map(e => {
      const on = cur === 'u:' + e.id
      // Picking and removing are two buttons side by side, never one inside the other.
      return <div key={e.id} className="lrow own-snd" data-own-sound={e.id}>
        <button type="button" className="own-snd-pick" onClick={() => pickOwn(e)} aria-pressed={on}>
          <span className="lrow-i" style={{ '--tint': 'var(--pink)' }}><Icon name={on ? 'speaker' : 'play'} /></span>
          <span className="lrow-m">
            <span className="lrow-t">{e.name}</span>
            {e.m.dur != null && <span className="lrow-s">{fmtClip(e.m.dur)}</span>}
          </span>
          {on && <Icon name="check" className="lrow-k" />}
        </button>
        <Button variant="ghost" size="sm" icon="trash" aria-label={t('Remove {0}', e.name)} title={t('Remove')} onClick={() => remove(e)} />
      </div>
    })}
    {list.length < SOUNDS_MAX && <Row icon={busy ? 'hourglass' : 'plus'} iconTint="var(--pink)" title={busy ? t('Loading…') : t('Add a sound')}
      accessory="none" onClick={() => { if (!busy) file.current?.click() }} />}
    <input ref={file} type="file" accept="audio/*,.mp3,.m4a,.aac,.wav,.ogg,.oga,.opus" hidden onChange={onFile} data-own-sound-input />
  </Section>
}

