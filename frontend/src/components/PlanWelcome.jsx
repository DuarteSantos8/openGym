import { useNavigate } from 'react-router-dom'
import { t } from '../lib/i18n.js'
import { starterPlanSheet } from '../sheets.jsx'
import { Card, EmptyState } from './blocks.jsx'
import { LineArt } from './line-art.jsx'

// No routine yet (Home's This week, Training's Routines): a starter plan, or your own.
export default function PlanWelcome() {
  const nav = useNavigate()
  return <Card>
    <EmptyState art={<LineArt scene="routine" state={{ days: 0 }} />} title={t('Welcome!')}
      action={{ label: t('Load starter plan'), icon: 'clipboard', onClick: starterPlanSheet }}
      secondary={{ label: t('Build my own plan'), onClick: () => nav('/train/routines') }}>
      {t('Set up your weekly routine to get going, or grab a ready-made starter plan.')}
    </EmptyState>
  </Card>
}
