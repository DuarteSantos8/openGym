// The first-session load finder (EP22-T04, lib/load-finder.js): for an exercise never logged,
// a light test set at the planned reps, "how did that feel?", and the next weight to try, ending
// on a weight to start the real sets with. The test sets are not logged; nothing is written until
// "Use this weight", and then only the weight of the sets not yet ticked.
import { useState } from 'react'
import { t } from '../lib/i18n.js'
import { fmtWeight, exerciseNameText } from '../lib/format.js'
import { useUI } from '../store/useUI.js'
import { Button, Stepper } from './ui.jsx'
import { begin, answer, startLoad, stepIn } from '../lib/load-finder.js'
import './load-finder.css'

// A plan without a rep count still gets a number to aim at.
const DEFAULT_REPS = 8

// Built per render so each label goes through t() as a literal the locale checks can see.
const answers = () => [
  ['easy', t('Easy'), t('I had 4 or more reps left')],
  ['right', t('About right'), t('I had 1 to 3 reps left')],
  ['hard', t('Too hard'), t('I could not finish, or it got shaky')],
]

export function LoadFinder({ ex, unit, step, floor = 0, weights = null, label, pair = false, reps, onUse, close }) {
  // A lift with a bar starts on the athlete's own bar (the floor), anything else on the usual light pick.
  // `pair`: the number means both dumbbells together, so the usual light pick counts twice.
  const first = () => begin(floor > 0 ? floor : startLoad(ex, unit) * (pair ? 2 : 1), step, { floor, weights })
  const [s, setS] = useState(first)
  const name = exerciseNameText(ex)
  return <div className="iv-lf" data-weight={s.weight} data-tries={s.tries}>
    <h3 style={{ marginBottom: 2 }}>{t('Find my weight')}</h3>
    <p className="small dim" style={{ marginTop: 0 }}>{name}</p>
    {s.done ? <>
      {s.atFloor
        ? <p className="iv-lf-floor">{t('That is the lightest this goes. If it was too hard, try an easier exercise first.')}</p>
        : <>
          <p className="iv-lf-found">{t('Start with {0}.', fmtWeight(s.weight, unit))}</p>
          <p className="small dim">{t('If the last reps of your first set feel easy, add a little next time. That is how it is meant to go.')}</p>
        </>}
      <div className="iv-lf-actions">
        {!s.atFloor && <Button variant="primary" data-use="" onClick={() => { onUse(s.weight); close() }}>{t('Use this weight')}</Button>}
        <Button variant="ghost" onClick={() => setS(begin(s.weight, step, { floor, weights }))}>{t('Try again')}</Button>
        {s.atFloor && <Button variant="ghost" onClick={close}>{t('Close')}</Button>}
      </div>
    </> : <>
      {s.tries > 0 && <p className="iv-lf-rest small">{t('Rest for a minute, then try this.')}</p>}
      <p className="iv-lf-try">{t('Do {0} reps with this weight, then say how it felt.', reps > 0 ? reps : DEFAULT_REPS)}</p>
      <Stepper label={label || t('Weight ({0})', unit)} value={s.weight} step={step > 0 ? step : 0.5} min={s.floor}
        onStep={s.weights ? (v, _step, dir) => stepIn(s.weights, v, dir) : undefined}
        onChange={v => setS(x => ({ ...x, weight: Math.max(x.floor || 0, v) }))} />
      <div className="iv-lf-answers" role="group" aria-label={t('How did that feel?')}>
        {answers().map(([feel, label, sub]) => <button key={feel} type="button" className="item" data-feel={feel} onClick={() => setS(x => answer(x, feel))}>
          <div className="grow"><div className="tt">{label}</div><div className="ts">{sub}</div></div>
        </button>)}
      </div>
    </>}
    <p className="iv-lf-foot small dim">{t('Test sets are not logged. Stop if something hurts.')}</p>
  </div>
}

/** Open the finder as a sheet. `onUse(weight)` gets the weight in the exercise's unit. */
export function loadFinderSheet(opts) {
  useUI.getState().openSheet(close => <LoadFinder {...opts} close={close} />)
}
