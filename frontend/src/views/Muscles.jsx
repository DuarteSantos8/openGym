import { useNavigate, useLocation, useSearchParams } from 'react-router-dom'
import { MUSCLES } from '../lib/muscles.js'
import { t } from '../lib/i18n.js'
import MuscleExplorer from '../components/MuscleExplorer.jsx'
import { exerciseDetailSheet, addToRoutineSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import ScreenHeader from '../components/ScreenHeader.jsx'
import { sessionBuilderSheet } from '../components/SessionBuilder.jsx'

// `?m=<muscle>` opens on that muscle (Stats' untrained muscles, #553), and back goes where it came from.
export default function Muscles() {
  const nav = useNavigate()
  const loc = useLocation()
  const [params] = useSearchParams()
  const m = params.get('m')
  const initial = m && MUSCLES.includes(m) ? m : null
  const back = loc.state?.from === '/stats' ? '/stats' : '/library'
  return <>
    <ScreenHeader hard title={t('Explore muscles')} sub={t('Choose a muscle to see exercises that train it, or build a session from it.')}
      left={<button className="iconbtn" data-back={back} onClick={() => nav(back)} aria-label={back === '/stats' ? t('Stats') : t('Exercises')}><Icon name="chevronLeft" /></button>} />

    <MuscleExplorer key={initial || ''} initial={initial} onDetail={exerciseDetailSheet} onPlan={addToRoutineSheet} onBuild={sessionBuilderSheet} />
  </>
}
