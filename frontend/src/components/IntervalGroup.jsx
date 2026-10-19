import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { intervalGroupReady, nextIntervalSet } from '../lib/interval-group.js'
import { supersetMeta } from '../lib/superset-meta.js'
import { exerciseNameFor, t } from '../lib/i18n.js'
import { unlock } from '../lib/sound.js'
import { exOr } from '../lib/exercises.js'
import { uid } from '../lib/format.js'
import { Button } from './ui.jsx'

export default function IntervalGroup({ unit, onComplete }) {
  const active = useStore(s => s.S.active)
  const { work, timer, sheets } = useUI()
  const run = useRef(null)
  const complete = useRef(onComplete)
  complete.current = onComplete
  const [running, setRunning] = useState(false)
  const signature = a => JSON.stringify(a?.entries)
  const stop = ({ keepRest = false } = {}) => {
    const own = run.current
    run.current = null
    if (own) {
      const ui = useUI.getState()
      if (ui.work?.owner?.interval === own.token) ui.stopWork()
      if (!keepRest && own.phase === 'rest' && ui.timer?.forIdx === own.timer?.forIdx && ui.timer?.forSet === own.timer?.forSet) ui.stopRest()
    }
    setRunning(false)
  }
  const valid = (own, allowSheet = false) => {
    const a = useStore.getState().S.active
    return run.current === own && a?.id === own.id && signature(a) === own.signature
      && !document.hidden && (allowSheet || !useUI.getState().sheets?.length)
  }
  const startNext = own => {
    if (!valid(own)) { stop(); return }
    const a = useStore.getState().S.active
    const next = own.next
    if (!next || !intervalGroupReady(a.entries, unit)) { stop(); return }
    const { idx, i } = next
    const entry = a.entries[idx]
    const seconds = supersetMeta(a.entries, unit, { onTarget: true }).work ?? Number(entry.sets[i].planSec ?? entry.sets[i].sec)
    own.phase = 'work'
    useStore.getState().update(s => { s.active.cur = idx })
    useUI.getState().startWork(seconds, exerciseNameFor(exOr(entry.id)), (elapsed, flags = {}) => {
      if (!valid(own) || flags.abandoned) { stop(); return }
      complete.current(idx, i, Math.min(seconds, elapsed), flags.chimed)
      const fresh = useStore.getState().S.active
      if (fresh?.id !== own.id) { stop(); return }
      own.signature = signature(fresh)
      own.next = nextIntervalSet(fresh.entries, unit, idx)
      if (!own.next) { stop(); return }
      const meta = supersetMeta(fresh.entries, unit, { onTarget: true })
      const rest = own.next.roundEnd ? (meta.roundRest ?? (meta.rest > 0 ? meta.rest : meta.intervalRest)) : meta.intervalRest
      own.phase = 'rest'
      const ui = useUI.getState()
      ui.startRest(rest, idx, { forSet: i })
      own.timer = useUI.getState().timer
      if (!rest) startNext(own)
    }, { idx, i, id: entry.id, interval: own.token })
  }
  useEffect(() => {
    const own = run.current
    if (!own) return
    if (!valid(own, own.phase === 'rest')) { stop(); return }
    // Keep recovery counting under its editor, but never start a set behind a sheet.
    if (sheets.length) return
    if (own.phase === 'rest' && (!timer || timer.ready)) startNext(own)
    else if ((own.phase === 'work' || own.phase === 'prep') && work?.owner?.interval !== own.token) stop()
    else if (own.phase === 'rest' && timer?.forIdx !== own.timer?.forIdx) stop()
  }, [active, work, timer, sheets])
  useEffect(() => {
    const hidden = () => { if (document.hidden) stop() }
    document.addEventListener('visibilitychange', hidden)
    window.addEventListener('pagehide', hidden)
    // Navigation ends automatic set progression, not the rest countdown shown app-wide.
    return () => { document.removeEventListener('visibilitychange', hidden); window.removeEventListener('pagehide', hidden); stop({ keepRest: true }) }
  }, [])
  const ready = intervalGroupReady(active.entries, unit)
  const next = nextIntervalSet(active.entries, unit)
  const start = () => {
    if (!next || document.hidden || useUI.getState().sheets.length || useStore.getState().S.active?.id !== active.id) return
    stop()
    unlock(useStore.getState().S.sound)
    const own = { id: active.id, signature: signature(active), token: uid(), next, phase: 'work' }
    run.current = own
    setRunning(true)
    const prep = supersetMeta(active.entries, unit, { onTarget: true }).prep ?? 0
    if (prep > 0) {
      own.phase = 'prep'
      useUI.getState().startWork(prep, t('Preparation before starting'), (_elapsed, flags = {}) => {
        if (valid(own) && !flags.abandoned) startNext(own); else stop()
      }, { interval: own.token, prep: true })
    } else startNext(own)
  }
  const action = useRef(null)
  action.current = running ? stop : start
  const canRun = !!next
  useEffect(() => {
    useUI.setState({ intervalAction: running || canRun ? {
      sessionId: active.id, label: running ? t('Stop intervals') : t('Start intervals'),
      icon: running ? 'pause' : 'play', run: () => action.current?.(),
    } : null })
    return () => { useUI.setState({ intervalAction: null }) }
  }, [active.id, running, canRun])
  return <div className="card">
    <Button variant="primary" icon={running ? 'pause' : 'play'} disabled={!running && !next} onClick={running ? stop : start}>
      {running ? t('Stop intervals') : t('Start intervals')}
    </Button>
    <p className="small muted">{ready
      ? t('Runs timed sets and rests automatically. Stops when you leave this workout. An interrupted set starts again.')
      : t('Use timed sets for every exercise. Finish warm-ups and remove per-side or failure sets before starting intervals.')}</p>
  </div>
}
