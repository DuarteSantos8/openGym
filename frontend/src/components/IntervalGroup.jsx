import { useEffect, useRef } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { bindIntervalCompletion, startIntervals, stopIntervals, useIntervalRun } from '../store/interval-run.js'
import { intervalGroupReady, nextIntervalSet } from '../lib/interval-group.js'
import { t } from '../lib/i18n.js'
import { unlock } from '../lib/sound.js'
import { Button } from './ui.jsx'

export default function IntervalGroup({ unit, onComplete }) {
  const active = useStore(s => s.S.active)
  const run = useIntervalRun(s => s.run)
  const running = run?.id === active.id && run.unit.join() === unit.join()
  const complete = useRef(onComplete)
  complete.current = onComplete
  useEffect(() => bindIntervalCompletion(active.id, (...args) => complete.current(...args)), [active.id])
  const ready = intervalGroupReady(active.entries, unit)
  const canRun = !!nextIntervalSet(active.entries, unit)
  const start = () => { unlock(useStore.getState().S.sound); startIntervals(unit) }
  const action = useRef(null)
  action.current = running ? stopIntervals : start
  useEffect(() => {
    useUI.setState({ intervalAction: running || canRun ? {
      sessionId: active.id, label: running ? t('Stop intervals') : t('Start intervals'),
      icon: running ? 'pause' : 'play', run: () => action.current?.(),
    } : null })
    return () => { useUI.setState({ intervalAction: null }) }
  }, [active.id, running, canRun])
  return <div className="card">
    <Button variant="primary" icon={running ? 'pause' : 'play'} disabled={!running && !canRun} onClick={running ? stopIntervals : start}>
      {running ? t('Stop intervals') : t('Start intervals')}
    </Button>
    <p className="small muted">{ready
      ? t('Intervals continue when you leave this page. Background alerts depend on your browser and notification settings.')
      : t('Use timed sets for every exercise. Finish warm-ups and remove per-side or failure sets before starting intervals.')}</p>
  </div>
}
