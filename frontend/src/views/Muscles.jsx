import { useNavigate, useLocation, useSearchParams } from 'react-router-dom'
import { MUSCLES } from '../lib/muscles.js'
import { t } from '../lib/i18n.js'
import MuscleExplorer from '../components/MuscleExplorer.jsx'
import { exerciseDetailSheet, addToRoutineSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { sessionBuilderSheet } from '../components/SessionBuilder.jsx'

// `?m=<muscle>` opens on that muscle (Stats' untrained muscles, #553), and back goes where it came from.
// `?m=a,b,c` (Today's body picker) opens on several, matching any of them.
export default function Muscles() {
  const nav = useNavigate()
  const loc = useLocation()
  const [params] = useSearchParams()
  const picked = (params.get('m') || '').split(',').filter(x => MUSCLES.includes(x))
  const initial = picked.length > 1 ? picked : picked[0] || null
  const from = loc.state?.from
  const back = from === '/stats' ? '/stats' : from === '/' ? '/' : '/library'
  return <>
    <div className="hdr"><button className="iconbtn" data-back={back} onClick={() => nav(back)} aria-label={back === '/stats' ? t('Progress') : back === '/' ? t('Today') : t('Library')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginInlineStart: 12 }}><h1>{t('Explore muscles')}</h1><div className="sub">{t('Choose a muscle to see exercises that train it, or build a session from it.')}</div></div></div>

    <MuscleExplorer key={picked.join(',')} initial={initial} initialMatch={picked.length > 1 ? 'any' : 'all'} onDetail={exerciseDetailSheet} onPlan={addToRoutineSheet} onBuild={sessionBuilderSheet} />
  </>
}
