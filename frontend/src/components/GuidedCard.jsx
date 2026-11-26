import { useEffect } from 'react'
import { cuesFor, easierOf } from '../lib/guided.js'
import { guideFor, isReviewed } from '../lib/exercise-guide.js'
import { baseLang, getLang, t } from '../lib/i18n.js'
import { exOr } from '../lib/exercises.js'
import { exerciseNameText } from '../lib/format.js'
import { cuesOn } from '../lib/spoken-cues.js'
import { hush, listVoices, speak, voiceOpts } from '../lib/speech.js'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import Icon from './Icon.jsx'

export default function GuidedCard({ exerciseId, index, total, onNext, onSwap, busy }) {
  const spoken = useStore(s => cuesOn(s.S))
  const cues = cuesFor(exerciseId)
  const easier = easierOf(exerciseId)
  const text = cues.join(' ')
  // The source guide is in English, even when the workout controls are translated.
  useEffect(() => {
    if (!spoken || !text || document.hidden) return
    let current = true
    let speaking = false
    listVoices({ lang: 'en', offline: true }).then(voices => {
      if (!current || !voices.length || document.hidden) return
      const options = voiceOpts(useStore.getState().S)
      const voice = voices.find(v => v.id === options.voice) || voices[0]
      speaking = true
      return speak(text, { ...options, lang: 'en', voice: voice.id, queue: false })
    }).catch(() => {})
    return () => { current = false; if (speaking) hush() }
  }, [spoken, text, exerciseId, index])

  return <section className="guided-card" aria-label={t('Guided workout')}>
    <div className="guided-heading">
      <strong>{t('Guided workout')}</strong>
      <span>{t('Exercise {0} of {1}', index + 1, total)}</span>
    </div>
    {cues.length > 0 && <>
      {baseLang(getLang()) !== 'en' && <span className="small dim">{t('instructions in English')}</span>}
      <ul lang="en" dir="ltr">{cues.map(cue => <li key={cue}>{cue}</li>)}</ul>
      <small className="guided-source">{!isReviewed(guideFor(exerciseId)) && <>{t('Draft')} · </>}{t('General guidance. Stop if something hurts.')}</small>
    </>}
    <div className="guided-actions">
      {easier && <button type="button" disabled={busy} onClick={() => onSwap(easier, () => {
        useUI.getState().toast(t('Using {0} for this workout.', exerciseNameText(exOr(easier))))
      })}>{t('Too hard')}</button>}
      <button type="button" disabled={index + 1 >= total || busy} onClick={onNext}>{t('Next')}<Icon name="chevronRight" /></button>
    </div>
  </section>
}
