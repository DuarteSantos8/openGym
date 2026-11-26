import { useNavigate } from 'react-router-dom'
import CardHead from './CardHead.jsx'
import { Row } from './ui.jsx'
import { useOnline } from './ServerSync.jsx'
import { useCoachGate } from '../lib/use-coach-gate.js'
import { useStore } from '../store/useStore.js'
import { DEMO } from '../lib/demo.js'
import { MOBILE } from '../lib/mobile.js'
import { t } from '../lib/i18n.js'

export const STARTERS = [
  'Build me a back workout with no weights',
  'Add a push day on Tuesday and a pull day on Wednesday',
  'Make today shorter',
]

function StarterCard() {
  const nav = useNavigate()
  const { ok } = useCoachGate()
  const online = useOnline()
  const offline = useStore(s => s.sync?.offline)
  const local = useStore(s => MOBILE && s.coachLocal?.mode === 'byok')
  if (!ok || (!DEMO && !local && (!online || offline))) return null

  return <section className="card" aria-label={t('Ask your Coach')}>
    <CardHead icon="sparkles" title={t('Ask your Coach')} />
    {STARTERS.map(starter => {
      const prompt = t(starter)
      return <Row key={starter} title={prompt} accessory="chevron"
        onClick={() => nav('/coach', { state: { coachStarter: prompt } })} />
    })}
  </section>
}

export default function AskCoach({ level }) {
  return level === 'beginner' ? <StarterCard /> : null
}
