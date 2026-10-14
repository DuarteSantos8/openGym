import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t, tn } from '../lib/i18n.js'
import { coachAvailable } from '../lib/coach.js'
import { DEMO } from '../lib/demo.js'
import { MOBILE } from '../lib/mobile.js'
import { tappable } from '../lib/use-sheet-keyboard.js'
import { scheduleModeOf } from '../lib/rotation.js'
import Icon from '../components/Icon.jsx'
import RootHeader from '../components/RootHeader.jsx'
import TodayCard from '../components/TodayCard.jsx'
import { Row, Section } from '../components/ui.jsx'

// The Training tab's root: today's session with the week, the four places training lives
// (History, Exercises, Schedule, Routines), and the rows that are not a place of their own.
export default function TrainHub() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const config = useStore(s => s.config)
  const user = useStore(s => s.user)
  const coachMode = useStore(s => s.coachLocal?.mode)
  const showCoach = coachAvailable(config, user, { demo: DEMO, mobile: MOBILE, coachMode })
  const ownEx = (S.customEx || []).filter(c => c && c.id).length

  const targets = [
    { path: '/train/history', icon: 'history', title: t('History'), sub: tn('{0} workout', '{0} workouts', S.workouts.length) },
    { path: '/train/exercises', icon: 'dumbbell', title: t('Exercises'), sub: ownEx ? t('{0} of your own', ownEx) : t('Library') },
    { path: '/train/schedule', icon: 'calendar', title: t('Schedule'), sub: scheduleModeOf(S) === 'rotation' ? t('Rotation') : t('Fixed Week') },
    { path: '/train/routines', icon: 'clipboard', title: t('Routines'), sub: tn('{0} routine', '{0} routines', S.routines.length) },
  ]

  return <div>
    <RootHeader title={t('Training')} />
    <TodayCard />
    <div className="tiles hub-tiles">
      {targets.map(x => (
        <div key={x.path} className="tile tappable hub-tile" role="button" {...tappable(() => nav(x.path))}>
          <Icon name={x.icon} className="hub-tile-i" />
          <div className="hub-tile-t">{x.title}</div>
          <div className="hub-tile-s">{x.sub}</div>
        </div>
      ))}
    </div>
    <Section>
      {!S.active && <Row icon="swap" iconTint="var(--blue)" title={t('Start a different workout')} accessory="chevron" onClick={() => nav('/train/workout')} />}
      {S.checkIn !== false && <Row icon="qr" iconTint="var(--blue)" title={t('Gym check-in')} accessory="chevron" onClick={() => nav('/train/checkin')} />}
      {showCoach && <Row icon="chat" iconTint="var(--green)" title={t('Coach')} accessory="chevron" onClick={() => nav('/train/coach')} />}
      <Row icon="kettlebell" iconTint="var(--indigo)" title={t('Equipment')} accessory="chevron" onClick={() => nav('/me/equipment')} />
      <Row icon="gear" iconTint="var(--grey)" title={t('Training settings')} accessory="chevron" onClick={() => nav('/me/workout')} />
    </Section>
  </div>
}
