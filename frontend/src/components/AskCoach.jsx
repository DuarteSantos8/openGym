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

// A phone may run an OpenAI-compatible model on its own loopback interface.
function onThisPhone(baseUrl) {
  try {
    const { hostname } = new URL(baseUrl)
    return hostname === 'localhost' || hostname.endsWith('.localhost') || /^127[.][0-9.]+$/.test(hostname) || hostname === '[::1]'
  } catch { return false }
}

function StarterCard() {
  const nav = useNavigate()
  const { ok } = useCoachGate()
  const online = useOnline()
  const offline = useStore(s => s.sync?.offline)
  const phone = useStore(s => MOBILE ? s.coachLocal : null)
  const byok = phone?.mode === 'byok'
  const reachable = byok ? online || onThisPhone(phone.baseUrl) : online && !offline
  if (!ok || (!DEMO && !reachable)) return null

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
