import { t } from '../lib/i18n.js'
import MuscleExplorer from '../components/MuscleExplorer.jsx'
import SubHeader from '../components/SubHeader.jsx'
import { exerciseDetailSheet, addToRoutineSheet } from '../sheets.jsx'

export default function Muscles() {
  return <>
    <SubHeader title={t('Explore muscles')} sub={t('Choose a muscle to see exercises that train it.')} />
    <MuscleExplorer onDetail={exerciseDetailSheet} onPlan={addToRoutineSheet} />
  </>
}
