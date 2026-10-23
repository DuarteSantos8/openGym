import { useNavigate, useLocation, useSearchParams } from 'react-router-dom'
import { MUSCLES } from '../lib/muscles.js'
import { t } from '../lib/i18n.js'
import MuscleExplorer from '../components/MuscleExplorer.jsx'
import { exerciseDetailSheet, addToRoutineSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'

// `?m=<muscle>` opens on that muscle (Stats' untrained muscles, #553), and back goes where it came from.
export default function Muscles() {
  const nav = useNavigate()
  const loc = useLocation()
  const [params] = useSearchParams()
  const m = params.get('m')
  const initial = m && MUSCLES.includes(m) ? m : null
  const back = loc.state?.from === '/stats' ? '/stats' : '/library'
  return <>
    <div className="hdr"><button className="iconbtn" data-back={back} onClick={() => nav(back)} aria-label={back === '/stats' ? t('Stats') : t('Exercises')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginInlineStart: 12 }}><h1>{t('Explore muscles')}</h1><div className="sub">{t('Choose a muscle to see exercises that train it.')}</div></div></div>

    <MuscleExplorer key={initial || ''} initial={initial} onDetail={exerciseDetailSheet} onPlan={addToRoutineSheet} />
  </>
}
