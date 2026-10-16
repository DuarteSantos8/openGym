import { t } from '../lib/i18n.js'
import MuscleExplorer from '../components/MuscleExplorer.jsx'
import { Page } from '../components/layout.jsx'
import { exerciseDetailSheet, addToRoutineSheet } from '../sheets.jsx'

export default function Muscles() {
  return <Page title={t('Explore muscles')} sub={t('Choose a muscle to see exercises that train it.')}>
    <MuscleExplorer onDetail={exerciseDetailSheet} onPlan={addToRoutineSheet} />
  </Page>
}
