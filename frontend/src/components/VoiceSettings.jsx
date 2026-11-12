// Settings → Timer alerts → Voice (v1.4.5): how the spoken cues sound.
//
//   the voice     one of this device's own voices for the app's language (lib/speech.js
//                 listVoices), kept on this device; speed and pitch, which sync
//   the style     a pack of lines per moment (lib/voice-styles.js), or lines of your own
//   the moments   per moment: its lines (read, or written when the style is your own) and up to
//                 three clips of your own, recorded here or picked from a file (lib/voice-clips.js),
//                 played instead of the line
//
// Everything here happens on the device: the voices are the phone's or the browser's, a clip is
// recorded and trimmed in the page (lib/sound-ingest.js), and a clip stays with the account that
// made it (never in the community library). Nothing imitates a real person.
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { speak, hush, listVoices, voiceLabel, voiceOpts, pickedVoice, setPickedVoice, speechRateNum, speechPitchNum, setSpeechRate, setSpeechPitch, speechSupported, SPEECH_MIN, SPEECH_MAX } from '../lib/speech.js'
import { sampleCue } from '../lib/spoken-cues.js'
import { MOMENTS, MOMENT_COPY, STYLE_COPY, STYLE_IDS, cueStyleOf, linesFor, ownLines, setOwnLines, startOwnFrom, hasOwnLines, sampleLine, LINES_MAX, LINE_MAX } from '../lib/voice-styles.js'
import { voiceClipsOf, addVoiceClip, removeVoiceClip, CLIPS_PER_MOMENT, CLIP_SEC } from '../lib/voice-clips.js'
import { offlineBuild } from '../lib/build-caps.js'
import { mediaStore } from '../lib/media-store.js'
import { fmtClip } from '../lib/media-refs.js'
import { unlock, chime } from '../lib/sound.js'
import { soundErrorText } from './OwnSounds.jsx'
import { Section, Row, Slider, Button, TextField } from './ui.jsx'
import Icon from './Icon.jsx'

const toast = m => useUI.getState().toast(m)
const S_ = () => useStore.getState().S
const sayIt = (text, extra = {}) => { hush(); speak(text, { ...voiceOpts(S_()), queue: false, ...extra }) }
const fmtX = n => `${Math.round(n * 100) / 100}×`

/** Why the microphone could not be used, as a sentence. */
export function micErrorText(e) {
  if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) return t('The microphone is off for openGym. Allow it in your phone’s settings and try again.')
  return t('No microphone here. Pick a file instead.')
}

/** The MediaRecorder type this browser can write, or '' for its default. */
export function recordType(MR = globalThis.MediaRecorder) {
  if (!MR || typeof MR.isTypeSupported !== 'function') return ''
  return ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find(x => { try { return MR.isTypeSupported(x) } catch { return false } }) || ''
}
export const canRecord = () => typeof globalThis.MediaRecorder === 'function' && typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function'

function useVoices() {
  const [voices, setVoices] = useState(null)
  useEffect(() => {
    let gone = false
    listVoices({ offline: offlineBuild() }).then(v => { if (!gone) setVoices(v) }, () => { if (!gone) setVoices([]) })
    return () => { gone = true }
  }, [])
  return voices
}

function VoiceSheet({ close, voices }) {
  const [cur, setCur] = useState(pickedVoice())
  const pick = id => {
    setPickedVoice(id)
    setCur(id)
    sayIt(sampleLine(S_()) || sampleCue(S_().unit), { voice: id })
  }
  return <>
    <h3>{t('Voice')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Tap one to hear it. The voices are your device’s own.')}</div>
    <Section footer={voices.length ? null : t('No other voices for this language here. Your device’s settings can add more.')}>
      <Row icon={cur ? 'play' : 'speaker'} iconTint="var(--teal)" title={t('Default voice')} accessory={!cur ? 'check' : 'none'} onClick={() => pick('')} />
      {voices.map(v => <Row key={v.id} icon={cur === v.id ? 'speaker' : 'play'} iconTint="var(--teal)" title={voiceLabel(v)}
        subtitle={[v.quality === 'premium' ? t('Premium') : v.quality === 'enhanced' ? t('Enhanced') : null, v.online ? t('Needs internet') : null].filter(Boolean).join(' · ') || null}
        accessory={cur === v.id ? 'check' : 'none'} onClick={() => pick(v.id)} />)}
    </Section>
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={close}>{t('Done')}</Button>
  </>
}

/** A row with a slider under its title: speed or pitch, 0.5× to 2×. */
function SliderRow({ icon, title, value, set, low, high }) {
  const update = useStore(s => s.update)
  return <div className="lrow voice-sld">
    <span className="lrow-i" style={{ '--tint': 'var(--teal)' }}><Icon name={icon} /></span>
    <span className="lrow-m">
      <span className="voice-sld-h"><span className="lrow-t">{title}</span><span className="lrow-v">{fmtX(value)}</span></span>
      <Slider value={value} min={SPEECH_MIN} max={SPEECH_MAX} step={0.05} ariaLabel={title} ariaValueText={fmtX(value)}
        onChange={v => update(s => { set(s, v) })} onEnd={() => sayIt(sampleCue(S_().unit))} />
      <span className="voice-sld-ends" aria-hidden="true"><span>{low}</span><span>{high}</span></span>
    </span>
  </div>
}

/** A moment's lines: read and heard in a pack, written and heard when the style is your own. */
function MomentLines({ moment }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const style = cueStyleOf(S)
  const own = style === 'own'
  const [draft, setDraft] = useState(() => (own ? ownLines(S, moment) : []))
  const [replace, setReplace] = useState(false)
  useEffect(() => { if (own) setDraft(d => (d.length ? d : ownLines(useStore.getState().S, moment))) }, [own, moment])

  if (!own) {
    const lines = linesFor(S, moment)
    const makeOwn = () => {
      if (hasOwnLines(S) && !replace) { setReplace(true); return }
      update(s => { startOwnFrom(s, style) })
      setDraft(linesFor({ cueStyle: style }, moment))
      setReplace(false)
    }
    return <Section title={t('Lines')} footer={replace ? t('This replaces the lines you wrote before. Tap again to go ahead.') : t('One is picked at random each time.')}>
      {lines.map((l, i) => <Row key={i} icon="play" iconTint="var(--teal)" title={l} onClick={() => sayIt(l)} />)}
      {!lines.length && <Row icon="chat" iconTint="var(--grey)" title={t('Nothing said here in this style.')} />}
      <Row icon="pencil" iconTint="var(--acc)" title={replace ? t('Replace my lines') : t('Edit these lines')} subtitle={t('They become your own lines, for every moment.')} onClick={makeOwn} />
    </Section>
  }

  const commit = next => { setDraft(next); update(s => { setOwnLines(s, moment, next) }) }
  return <Section title={t('Your lines')} footer={t('One is picked at random each time. Up to {0} lines.', LINES_MAX)}>
    {draft.map((l, i) => <div key={i} className="lrow voice-line">
      <TextField value={l} maxLength={LINE_MAX} aria-label={t('Line {0}', i + 1)} placeholder={t('Something your coach would say')}
        onChange={e => commit(draft.map((x, j) => (j === i ? e.target.value : x)))} />
      <Button variant="ghost" size="sm" icon="play" aria-label={t('Hear it')} title={t('Hear it')} disabled={!l.trim()} onClick={() => sayIt(l)} />
      <Button variant="ghost" size="sm" icon="trash" aria-label={t('Remove line {0}', i + 1)} title={t('Remove')} onClick={() => commit(draft.filter((_, j) => j !== i))} />
    </div>)}
    {draft.length < LINES_MAX && <Row icon="plus" iconTint="var(--acc)" title={t('Add a line')} onClick={() => setDraft([...draft, ''])} />}
  </Section>
}

/** A moment's clips of your own: play, remove, record one, or pick a file. */
function MomentClips({ moment }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const clips = voiceClipsOf(S, moment)
  const [busy, setBusy] = useState(false)
  const [rec, setRec] = useState(null)   // { secs } while recording
  const file = useRef(null)
  const recorder = useRef(null)
  useEffect(() => () => { try { recorder.current?.stop() } catch { /* already stopped */ } }, [])

  const keep = async (blob, name) => {
    setBusy(true)
    try {
      const { ingestSoundFile } = await import('../lib/sound-ingest.js')
      const out = await ingestSoundFile(blob, { maxSec: CLIP_SEC })
      await mediaStore.put(out.media.hash, out.blob, { mime: 'audio/wav', pending: true })
      let id = null
      update(s => { id = addVoiceClip(s, moment, { name, m: out.media }) })
      if (id) { unlock(true); chime(true, 'u:' + out.media.hash); toast(t('Clip added. It plays instead of the line.')) }
    } catch (e) {
      toast(soundErrorText(e))
    } finally { setBusy(false) }
  }
  const onFile = ev => {
    const f = ev.target.files && ev.target.files[0]
    ev.target.value = ''
    if (f) keep(f, String(f.name || '').replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[_-]+/g, ' ') || t('Clip'))
  }
  const startRec = async () => {
    unlock(true)
    hush()
    let stream
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }) } catch (e) { toast(micErrorText(e)); return }
    const type = recordType()
    let mr
    try { mr = new MediaRecorder(stream, type ? { mimeType: type } : undefined) } catch (e) { stream.getTracks().forEach(x => x.stop()); toast(micErrorText(e)); return }
    const parts = []
    const started = Date.now()
    const tick = setInterval(() => {
      const secs = Math.floor((Date.now() - started) / 1000)
      setRec({ secs })
      if (secs >= CLIP_SEC) { try { mr.stop() } catch { /* */ } }
    }, 250)
    mr.ondataavailable = e => { if (e.data && e.data.size) parts.push(e.data) }
    mr.onstop = () => {
      clearInterval(tick)
      stream.getTracks().forEach(x => x.stop())
      recorder.current = null
      setRec(null)
      if (parts.length) keep(new Blob(parts, { type: mr.mimeType || type || 'audio/webm' }), t('Recording {0}', clips.length + 1))
    }
    recorder.current = mr
    setRec({ secs: 0 })
    mr.start()
  }
  const stopRec = () => { try { recorder.current?.stop() } catch { /* */ } }

  const full = clips.length >= CLIPS_PER_MOMENT
  return <Section title={t('Your own clips')} footer={t('A clip plays instead of the line. Up to {0} here, {1} seconds each. Your clips stay yours: they sync to your own devices and are never shared.', CLIPS_PER_MOMENT, CLIP_SEC)}>
    {clips.map(c => <div key={c.id} className="lrow own-snd" data-voice-clip={c.id}>
      <button type="button" className="own-snd-pick" onClick={() => { unlock(true); chime(true, 'u:' + c.m.hash) }}>
        <span className="lrow-i" style={{ '--tint': 'var(--pink)' }}><Icon name="play" /></span>
        <span className="lrow-m">
          <span className="lrow-t">{c.name}</span>
          {c.m.dur != null && <span className="lrow-s">{fmtClip(c.m.dur)}</span>}
        </span>
      </button>
      <Button variant="ghost" size="sm" icon="trash" aria-label={t('Remove {0}', c.name)} title={t('Remove')} onClick={() => { update(s => { removeVoiceClip(s, c.id) }); toast(t('Clip removed.')) }} />
    </div>)}
    {!full && canRecord() && (rec
      ? <Row icon="stop" iconTint="var(--red)" title={t('Stop recording')} subtitle={t('{0} of {1} seconds', rec.secs, CLIP_SEC)} className="voice-rec" onClick={stopRec} />
      : <Row icon={busy ? 'hourglass' : 'mic'} iconTint="var(--red)" title={busy ? t('Loading…') : t('Record a clip')} onClick={() => { if (!busy) startRec() }} />)}
    {/* Your own voice from somewhere else, or someone else's (TestFlight 11-08): any audio file this
        device decodes, cut to CLIP_SEC and kept like a recording. openGym ships no voices of its own. */}
    {!full && !rec && <Row icon="folder" iconTint="var(--pink)" title={t('Pick an audio file')} subtitle={t('MP3, M4A, WAV, AAC or OGG. Yours, or a friend’s with their OK.')}
      onClick={() => { if (!busy) file.current?.click() }} />}
    <input ref={file} type="file" accept="audio/*,audio/mpeg,audio/mp4,audio/x-m4a,audio/aac,audio/wav,audio/x-wav,audio/ogg,.mp3,.m4a,.aac,.wav,.ogg,.oga,.opus" hidden onChange={onFile} data-voice-clip-input />
  </Section>
}

function MomentSheet({ moment, close }) {
  return <>
    <h3>{t(MOMENT_COPY[moment])}</h3>
    <MomentLines moment={moment} />
    <MomentClips moment={moment} />
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={close}>{t('Done')}</Button>
  </>
}
const momentSheet = moment => useUI.getState().openSheet(close => <MomentSheet moment={moment} close={close} />)

/** What a moment's row says: that a clip of your own plays, else the first line, else that it is quiet. */
export function momentSummary(S, moment) {
  if (voiceClipsOf(S, moment).length) return t('Your clip')
  return linesFor(S, moment)[0] || t('Quiet')
}

export default function VoiceSettings() {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const voices = useVoices()
  const style = cueStyleOf(S)
  const cur = pickedVoice()
  const curVoice = voices?.find(v => v.id === cur)
  const pickStyle = id => {
    update(s => { s.cueStyle = id })
    const after = { ...S_(), cueStyle: id }
    sayIt(sampleLine(after))
  }
  // Shown in full even where nothing can speak (this browser): the lines and clips sync to the
  // devices that can, and the footer says why nothing is heard here.
  const footer = !speechSupported() ? t('This browser can’t speak. Try another one.')
    : S.spokenCues === true ? null : t('Spoken cues are off. Switch them on in Timer alerts to hear any of this in a workout.')
  return <>
    <Section footer={footer}>
      <Row icon="personCircle" iconTint="var(--teal)" title={t('Voice')} value={curVoice ? voiceLabel(curVoice) : t('Default voice')} accessory="chevron"
        onClick={() => { if (voices) useUI.getState().openSheet(close => <VoiceSheet close={close} voices={voices} />) }} />
      <SliderRow icon="gauge" title={t('Speed')} value={speechRateNum(S)} set={setSpeechRate} low={t('Slower')} high={t('Faster')} />
      <SliderRow icon="speaker" title={t('Pitch')} value={speechPitchNum(S)} set={setSpeechPitch} low={t('Lower')} high={t('Higher')} />
      <Row icon="play" iconTint="var(--green)" title={t('Try it')} onClick={() => { sayIt(sampleCue(S.unit)); speak(sampleLine(S), { ...voiceOpts(S) }) }} />
    </Section>
    <Section title={t('Style')} footer={t('Only the words change. The voice is always one of your device’s own.')}>
      {STYLE_IDS.map(id => <Row key={id} icon="chat" iconTint="var(--teal)" title={t(STYLE_COPY[id][0])} subtitle={t(STYLE_COPY[id][1])}
        accessory={style === id ? 'check' : 'none'} onClick={() => pickStyle(id)} />)}
    </Section>
    {/* Where your own voice goes in (TestFlight 11-08: "upload my own voice, or a file"): said
        up front, since the clips sit one tap down, in each moment's sheet. */}
    <Section title={t('Moments')} footer={<>{t('Tap a moment to record your own voice for it or pick an audio file, up to {0} seconds.', CLIP_SEC)} {t('Your next set is still said first when a rest starts. The count of a hold stays a count.')}</>}>
      {MOMENTS.map(m => <Row key={m} icon="bell" iconTint="var(--orange)" title={t(MOMENT_COPY[m])} subtitle={momentSummary(S, m)} accessory="chevron" onClick={() => momentSheet(m)} />)}
    </Section>
  </>
}
