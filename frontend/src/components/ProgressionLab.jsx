// The Extension Lab's progression rule lab (EP09): paste a Liftosaur-style progression rule and see
// it beside openGym's own linear rule over a simulated block of 3 × 5 sessions
// (lib/liftoscript-parity.js). Simulation only: nothing here reads or changes a routine or a
// workout, and the rule's answer is never adopted.
import { useState } from 'react'
import { simulateParity, MAX_WEEKS } from '../lib/liftoscript-parity.js'
import { EXDB } from '../lib/exercises.js'
import { t, tn } from '../lib/i18n.js'

// A plainly loaded lift: bodyweight, assisted, banded and cardio work progress by other rules.
const PLAIN = EXDB.find(e => e.bp !== 'cardio' && !['upper legs', 'lower legs', 'back', 'hips', 'glutes'].includes(e.bp) &&
  !['body weight', 'band', 'resistance band'].includes(e.eq) && !e.assisted)?.id
const EXAMPLE = 'if (completedReps >= reps) { weight += 2.5 }'
const PATTERN = new RegExp(`^[HM]{1,${MAX_WEEKS}}$`)

export default function ProgressionLab({ unit = 'kg' }) {
  const [script, setScript] = useState(EXAMPLE)
  const [start, setStart] = useState('60')
  const [pattern, setPattern] = useState('HHMHHMMHHHMH')
  const [res, setRes] = useState(null)
  const [problem, setProblem] = useState('')

  const run = ev => {
    ev.preventDefault()
    setRes(null)
    const p = pattern.trim().toUpperCase()
    if (!PATTERN.test(p)) return setProblem(t('Use H for a session that hit every rep and M for a miss, 1 to {0} weeks.', MAX_WEEKS))
    const w = Number(String(start).replace(',', '.'))
    if (!Number.isFinite(w) || w <= 0 || w > 1000) return setProblem(t('Enter a start weight above 0 and up to 1000.'))
    try {
      setRes(simulateParity({ script, exId: PLAIN, sets: 3, reps: 5, start: w, unit, outcomes: [...p].map(c => c === 'H') }))
      setProblem('')
    } catch (e) { setProblem(t(e?.message || 'Could not simulate this rule')) }
  }

  return <section className="addon-card" aria-labelledby="addon-prog-title">
    <div className="addon-headline">
      <div><span className="addon-kicker">{t('Programming · simulation only')}</span><h2 id="addon-prog-title">{t('Progression rule lab')}</h2></div>
      <span className="addon-state">{t('Writes nothing')}</span>
    </div>
    <p>{t('Paste a Liftosaur-style progression rule and compare it with openGym’s linear rule over a simulated block of 3 × 5 sessions.')}</p>
    <form onSubmit={run} className="addon-form addon-prog-form">
      <label className="addon-field">{t('Rule')}
        <textarea aria-label={t('Progression rule')} value={script} onChange={e => setScript(e.target.value)} rows={3} maxLength={2000} spellCheck={false} />
      </label>
      <div className="addon-input-row">
        <label className="addon-field">{t('Start weight ({0})', unit)}
          <input aria-label={t('Start weight')} inputMode="decimal" value={start} onChange={e => setStart(e.target.value)} />
        </label>
        <label className="addon-field">{t('Sessions (H = hit, M = miss)')}
          <input aria-label={t('Session outcomes')} value={pattern} onChange={e => setPattern(e.target.value)} maxLength={MAX_WEEKS} autoCapitalize="characters" spellCheck={false} />
        </label>
        <button type="submit" className="btn">{t('Simulate')}</button>
      </div>
    </form>
    {problem && <p className="addon-error" role="alert">{problem}</p>}
    {res?.error && <p className="addon-error" role="alert">{t('This rule cannot run: {0}', res.error)}</p>}
    {res && !res.error && <div aria-live="polite">
      <p data-summary>{res.divergences === 0 ? t('Matches openGym on every week.') : tn('{0} of {1} weeks differs from openGym.', '{0} of {1} weeks differ from openGym.', res.divergences, res.weeks.length)}</p>
      {res.unsafe > 0 && <p className="addon-error" role="alert">{tn('{0} week adds load after a missed session.', '{0} weeks add load after a missed session.', res.unsafe)}</p>}
      <div className="addon-table-wrap">
        <table className="addon-table">
          <caption className="addon-sr">{t('Week by week: the weight lifted, then what each rule prescribes next')}</caption>
          <thead><tr><th scope="col">{t('Week')}</th><th scope="col">{t('Session')}</th><th scope="col">{t('Weight')}</th><th scope="col">{t('openGym next')}</th><th scope="col">{t('Rule next')}</th></tr></thead>
          <tbody>{res.weeks.map(w => <tr key={w.week} data-diverges={w.diverges ? '' : undefined}>
            <td>{w.week}</td><td>{w.hit ? t('Hit') : t('Missed')}</td><td>{w.weight}</td>
            <td>{w.native}{w.nativeKind === 'deload' ? ` (${t('deload')})` : ''}</td>
            <td>{w.script}{w.unsafe ? ` (${t('unsafe')})` : ''}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </div>}
    <p className="addon-footnote">{t('Simulation only: nothing here changes a routine or a workout. A rule that needs memory across sessions, like a deload after repeated misses, shows as a difference.')}</p>
  </section>
}
