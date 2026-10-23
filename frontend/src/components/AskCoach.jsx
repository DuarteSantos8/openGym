import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { DEMO } from '../lib/demo.js'
import { MOBILE } from '../lib/mobile.js'
import { coachAvailable } from '../lib/coach.js'
import Icon from './Icon.jsx'

/** Whether the Coach can be asked here: the predicate every Coach surface uses. */
export function useCoachReachable() {
  const config = useStore(s => s.config)
  const user = useStore(s => s.user)
  const coachMode = useStore(s => s.coachLocal?.mode)
  return coachAvailable(config, user, { demo: DEMO, mobile: MOBILE, coachMode })
}

/**
 * The way into the Coach's chat from anywhere it is useful (Home, a running workout): one header
 * button, there only when the Coach is. The chat itself sends a first-time user through the intake.
 */
export default function AskCoachButton() {
  const nav = useNavigate()
  if (!useCoachReachable()) return null
  return <button className="iconbtn" onClick={() => nav('/coach')} aria-label={t('Ask the Coach')} title={t('Ask the Coach')}
    style={{ color: 'var(--acc)' }}><Icon name="chat" /></button>
}
