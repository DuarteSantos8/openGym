import { useNavigate } from 'react-router-dom'
import { t } from '../lib/i18n.js'
import MuscleExplorer from '../components/MuscleExplorer.jsx'
import { exerciseDetailSheet, addToRoutineSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'

export default function Muscles() {
  const nav = useNavigate()
  return <>
    <div className="hdr"><button className="iconbtn" onClick={() => nav('/library')} aria-label={t('Exercises')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 12 }}><h1>{t('Explore muscles')}</h1><div className="sub">{t('Choose a muscle to see exercises that train it.')}</div></div></div>

    <MuscleExplorer onDetail={exerciseDetailSheet} onPlan={addToRoutineSheet} />
  </>
}
