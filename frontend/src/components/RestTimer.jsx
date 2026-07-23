import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { Button } from './ui.jsx'

export default function RestTimer() {
  const timer = useUI(s => s.timer)
  const { addRest, stopRest } = useUI()
  if (!timer) return null
  const pct = (timer.left / timer.total) * 100
  const m = Math.floor(timer.left / 60), s = String(timer.left % 60).padStart(2, '0')
  return (
    <div id="timer">
      <div className="t">{m}:{s}</div>
      <div className="bar"><i style={{ width: pct + '%' }} /></div>
      <Button size="sm" icon="plus" onClick={() => addRest(15)}>15s</Button>
      <Button size="sm" variant="primary" onClick={stopRest}>{t('Skip')}</Button>
    </div>
  )
}
