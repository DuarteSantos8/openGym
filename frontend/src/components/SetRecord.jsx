import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { celebrate, recentTick } from '../lib/feel.js'
import { t } from '../lib/i18n.js'
import { recordHintText } from '../lib/set-records.js'

// The record marks of lib/set-records.js, in the workout, in History and on the day's workout.
// A record is said in words, not only with the trophy, so each kind reads as the claim it is.

/** The words for one record kind. On an assistance machine the load is help, so less is more. */
export function recordKindLabel(kind, assisted = false) {
  if (kind === 'weight') return assisted ? t('Least help yet') : t('Heaviest yet')
  if (kind === 'reps') return assisted ? t('Most reps with this help') : t('Most reps at this weight')
  if (kind === 'e1rm') return t('Best e1RM')
  if (kind === 'volume') return t('Biggest set')
  return ''
}
export const recordKindsText = (kinds, assisted) => (kinds || []).map(k => recordKindLabel(k, assisted)).filter(Boolean).join(' · ')

/** Under a set row: the trophy and what kind of record the set just set. */
export function RecordMark({ kinds, assisted }) {
  const text = recordKindsText(kinds, assisted)
  // Mounting right after your own tick: the iPhone adds two sparkles, once (index.css .setrec.fresh).
  const [fresh] = useState(recentTick)
  const ref = useRef(null)
  // A record gets the full celebration on the set row just above it.
  useEffect(() => { if (fresh) celebrate(ref.current?.previousElementSibling) }, [])
  if (!text) return null
  return <div ref={ref} className={'setrec' + (fresh ? ' fresh' : '')} role="status">
    <Icon name="trophy" /><span><b>{t('Record!')}</b> {text}</span>
  </div>
}

/** After a set in History or the day view: a small trophy with the kinds as its name. */
export function RecordBadge({ kinds, assisted }) {
  const text = recordKindsText(kinds, assisted)
  if (!text) return null
  return <span className="setrec-mark" role="img" aria-label={t('Record: {0}', text)} title={text}><Icon name="trophy" /></span>
}

export { recordHintText }

/** Under the next open set: how close it is to a record, quietly. */
export function RecordHintLine({ hint }) {
  const text = recordHintText(hint)
  if (!text) return null
  return <div className="setrec-hint"><Icon name="chartLine" /><span>{text}</span></div>
}
