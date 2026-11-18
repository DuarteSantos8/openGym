import { t } from '../lib/i18n.js'
import { MUSCLE_NAME } from '../lib/muscles.js'
import { EVIDENCE } from '../../../api/coach/core/evidence.js'

/* The line under a review change: the numbers the app checked (as stored on the change, never
   recounted) and the studies its tag stands on, linked to docs/COACH_EVIDENCE.md. */
const DOCS = 'https://github.com/DuarteSantos8/openGym/blob/main/docs/COACH_EVIDENCE.md#'

// "Schoenfeld, Ogborn & Krieger 2017, *J Sports Sci* ..." -> "Schoenfeld 2017"
const shortCite = s => s.grade === 'our rule' ? t('our rule') : `${s.cite.split(/[ ,]/)[0]} ${s.cite.match(/\b\d{4}\b/)?.[0] ?? ''}`.trim()

function checkText(ref, c) {
  if (!c) return null
  if (ref === 'volume' || ref === 'volume-cap') return t('{0}: {1} sets a week, your range {2} to {3}', t(MUSCLE_NAME[c.muscle] || c.muscle), c.sets, c.low, c.high)
  if (ref === 'frequency') return t('{0}: trained in one session a week', t(MUSCLE_NAME[c.muscle] || c.muscle))
  if (ref === 'sets-per-exercise') return t('{0} sets on this exercise', c.sets)
  return null
}

export default function EvidenceLine({ change }) {
  const e = Object.hasOwn(EVIDENCE, change.ref) && EVIDENCE[change.ref]
  if (!e) return null
  const check = checkText(change.ref, change.refCheck)
  const url = DOCS + change.ref
  return <div className="pcard-chg-e small dim">
    {check && <div>{check}</div>}
    <a href={url} target="_blank" rel="noopener" onClick={ev => { ev.preventDefault(); window.open(url, '_blank', 'noopener') }}>
      {t('Based on {0}', e.sources.map(shortCite).join(', '))}
    </a>
  </div>
}
