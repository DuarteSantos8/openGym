// A circuit's card in the workout (lib/circuit.js): what the group is ("EMOM · every 1:00, 10
// times"), how it stands (ready, running, done with its score), and the one button that opens
// the full-screen player (components/CircuitPlayer.jsx). The sets below it stay the usual rows,
// filled in by the clock as the stations finish, and can be fixed by hand afterwards.
import { useStore } from '../store/useStore.js'
import { useCircuit } from '../store/useCircuit.js'
import { t } from '../lib/i18n.js'
import { circuitOf, previousResult, compareResult } from '../lib/circuit.js'
import { circuitLine, resultLine, roundLabel, compareLine, modeName, fmtClock } from '../lib/circuit-copy.js'
import { runStep } from '../lib/circuit.js'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'

export default function CircuitCard({ unit }) {
  const A = useStore(s => s.S.active)
  const run = useCircuit(s => s.run)
  if (!A || !unit?.length) return null
  const cfg = circuitOf(A.entries, unit, { onTarget: true })
  if (!cfg) return null
  // A saved workout opened for editing has no clock: its sets are fixed by hand.
  if (A.editingWorkoutId || A.backfill) return null
  const sg = A.entries[unit[0]]?.sg || null
  const mine = run && run.sg === sg && (run.wid == null || run.wid === A.id) ? run : null
  const live = mine && !mine.ended
  const done = (A.circuits || []).filter(c => c.sg === sg).at(-1)
  const step = live ? runStep(mine) : null
  const sub = live ? (mine.paused != null ? t('Paused') : roundLabel(mine.cfg, step, mine.stations.length))
    : done ? resultLine(done) : t('Tap start, put the phone down, follow the beeps.')
  return <div className="cc" data-circuit-card>
    <Icon name="stopwatch" style={{ fontSize: 22, color: 'var(--acc-ink)', flex: 'none' }} />
    <div className="cc-m">
      <span className="cc-t">{circuitLine(cfg)}</span>
      <span className="cc-s">{sub}</span>
    </div>
    <Button size="sm" variant={live ? 'tinted' : 'primary'} icon={live ? 'expand' : done ? 'repeat' : 'play'}
      onClick={() => useCircuit.getState().openAt(unit[0])}>{live ? t('Open') : done ? t('Again') : t('Start')}</Button>
  </div>
}

/**
 * A saved workout's circuits (history detail, the finish summary): what each one scored, its
 * round times, and how that compares with the same circuit the time before.
 */
export function CircuitResults({ w }) {
  const workouts = useStore(s => s.S.workouts)
  const list = Array.isArray(w?.circuits) ? w.circuits : []
  if (!list.length) return null
  // "The time before" is the newest one saved before this workout, not after it.
  const before = (workouts || []).filter(x => x && x.id !== w.id && (x.start || 0) < (w.start || 0))
  return <div className="cr" data-circuit-results>{list.map((c, k) => {
    const cmp = compareLine(compareResult(c, previousResult(before, c)))
    return <div key={k} className="cr-i">
      <div className="cr-h"><Icon name="stopwatch" /><span>{c.name ? `${c.name} · ` : ''}{modeName(c.cfg || c)}</span></div>
      <div className="cr-v">{resultLine(c)}</div>
      {c.roundTimes?.length > 1 && <div className="cr-s">{c.roundTimes.map((x, r) => `${t('Round {0}', r + 1)} ${fmtClock(x)}`).join('  ·  ')}</div>}
      {cmp && <div className="cr-s accent">{cmp}</div>}
    </div>
  })}</div>
}
