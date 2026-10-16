import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { exCount, todayISO } from '../lib/format.js'
import { effectiveRoutineIds } from '../lib/history.js'
import { queueOf } from '../lib/queue.js'
import { rotationIds, scheduleModeOf } from '../lib/rotation.js'
import { startFlow } from '../sheets.jsx'
import { Card } from './blocks.jsx'
import { LineArt } from './line-art.jsx'
import PlanWelcome from './PlanWelcome.jsx'
import { MediaRow, SectionHeader } from './tab-kit.jsx'

const SHOWN = 3

// The routines a plan holds a place for: the weekdays, or in rotation mode the coach week / saved rotation.
const scheduledIds = S => (scheduleModeOf(S) === 'rotation'
  ? [...(queueOf(S)?.ids ?? []), ...rotationIds(S)]
  : Object.values(S.week || {}).flat())

// Training's Routines (ux-redesign-tabs §4.1): the first three in your order, each opening its
// editor and starting from its ▶, See all for the rest, then a freestyle session. The art is the
// routine as a plan card, its first row lit when it is today's session and muted when no weekday
// holds it. A session in progress wins over a ▶, as everywhere: starting another would overwrite it.
export default function TrainRoutines() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const today = new Set(effectiveRoutineIds(S, todayISO()))
  const scheduled = new Set(scheduledIds(S))
  const start = ids => { if (S.active) nav('/train/workout'); else startFlow(ids) }

  return <>
    <SectionHeader title={t('Routines')} link={t('See all')} onLink={() => nav('/train/routines')} />
    {!S.routines.length && <PlanWelcome />}
    <Card>
      {S.routines.slice(0, SHOWN).map(r => <MediaRow key={r.id}
        art={<LineArt scene="routine" state={{ days: Math.min(SHOWN, r.ex.length), next: today.has(r.id) ? 0 : null, scheduled: scheduled.has(r.id) }} />}
        title={r.name} subtitle={exCount(r.ex.length)} onOpen={() => nav('/train/routines/' + r.id)}
        {...(r.ex.length
          ? { onPlay: () => start([r.id]), playLabel: t('Start {0}', r.name) }
          : { onPlay: () => nav('/train/routines/' + r.id), playLabel: `${t('Add exercise')}, ${r.name}` })} />)}
      <MediaRow art={<LineArt scene="equipment" state={{ eq: 'dumbbell' }} />} title={t('Freestyle')} subtitle={t('Pick exercises as you go')}
        onPlay={() => start([])} playLabel={t('Start a freestyle workout')} />
    </Card>
  </>
}
