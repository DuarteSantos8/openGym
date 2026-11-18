// The Extension Lab's progression rule lab (EP09): paste a Liftosaur-style progression rule and see
// it beside openGym's own linear rule over a simulated block of 3 × 5 sessions
// (lib/liftoscript-parity.js). Simulation only: nothing here reads or changes a routine or a
// workout, and the rule's answer is never adopted. English-only like the rest of the Lab.
import { useState } from 'react'
import { simulateParity, MAX_WEEKS } from '../lib/liftoscript-parity.js'
import { EXDB } from '../lib/exercises.js'

// A plainly loaded lift: bodyweight, assisted, banded and cardio work progress by other rules.
const PLAIN = EXDB.find(e => e.bp !== 'cardio' && !['upper legs', 'lower legs', 'back', 'hips', 'glutes'].includes(e.bp) &&
  !['body weight', 'band', 'resistance band'].includes(e.eq) && !e.assisted)?.id
const EXAMPLE = 'if (completedReps >= reps) { weight += 2.5 }'
const PATTERN = new RegExp(`^[HM]{1,${MAX_WEEKS}}$`)
const weeks = n => `${n} ${n === 1 ? 'week' : 'weeks'}`

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
    if (!PATTERN.test(p)) return setProblem(`Use H for a session that hit every rep and M for a miss, 1 to ${MAX_WEEKS} weeks.`)
    const w = Number(String(start).replace(',', '.'))
    if (!Number.isFinite(w) || w <= 0 || w > 1000) return setProblem('Enter a start weight above 0 and up to 1000.')
    try {
      setRes(simulateParity({ script, exId: PLAIN, sets: 3, reps: 5, start: w, unit, outcomes: [...p].map(c => c === 'H') }))
      setProblem('')
    } catch (e) { setProblem(e?.message || 'Could not simulate this rule') }
  }

  return <section className="addon-card" aria-labelledby="addon-prog-title">
    <div className="addon-headline">
      <div><span className="addon-kicker">PROGRAMMING / SIMULATION ONLY</span><h2 id="addon-prog-title">Progression rule lab</h2></div>
      <span className="addon-state">Writes nothing</span>
    </div>
    <p>Paste a Liftosaur-style progression rule and compare it with openGym’s linear rule over a simulated block of 3 × 5 sessions.</p>
    <form onSubmit={run} className="addon-form addon-prog-form">
      <label className="addon-field">Rule
        <textarea aria-label="Progression rule" value={script} onChange={e => setScript(e.target.value)} rows={3} maxLength={2000} spellCheck={false} />
      </label>
      <div className="addon-input-row">
        <label className="addon-field">Start weight ({unit})
          <input aria-label="Start weight" inputMode="decimal" value={start} onChange={e => setStart(e.target.value)} />
        </label>
        <label className="addon-field">Sessions (H = hit, M = miss)
          <input aria-label="Session outcomes" value={pattern} onChange={e => setPattern(e.target.value)} maxLength={MAX_WEEKS} autoCapitalize="characters" spellCheck={false} />
        </label>
        <button type="submit" className="btn">Simulate</button>
      </div>
    </form>
    {problem && <p className="addon-error" role="alert">{problem}</p>}
    {res?.error && <p className="addon-error" role="alert">This rule cannot run: {res.error}</p>}
    {res && !res.error && <div aria-live="polite">
      <p data-summary>{res.divergences === 0 ? 'Matches openGym on every week.' : `${weeks(res.divergences)} of ${res.weeks.length} ${res.divergences === 1 ? 'differs' : 'differ'} from openGym.`}</p>
      {res.unsafe > 0 && <p className="addon-error" role="alert">{weeks(res.unsafe)} add load after a missed session.</p>}
      <div className="addon-table-wrap">
        <table className="addon-table">
          <caption className="addon-sr">Week by week: the weight lifted, then what each rule prescribes next</caption>
          <thead><tr><th scope="col">Week</th><th scope="col">Session</th><th scope="col">Weight</th><th scope="col">openGym next</th><th scope="col">Rule next</th></tr></thead>
          <tbody>{res.weeks.map(w => <tr key={w.week} data-diverges={w.diverges ? '' : undefined}>
            <td>{w.week}</td><td>{w.hit ? 'Hit' : 'Missed'}</td><td>{w.weight}</td>
            <td>{w.native}{w.nativeKind === 'deload' ? ' (deload)' : ''}</td>
            <td>{w.script}{w.unsafe ? ' (unsafe)' : ''}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </div>}
    <p className="addon-footnote">Simulation only: nothing here changes a routine or a workout. A rule that needs memory across sessions, like a deload after repeated misses, shows as a difference.</p>
  </section>
}
