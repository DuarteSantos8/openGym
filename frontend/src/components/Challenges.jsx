import { useCallback, useEffect, useMemo, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'
import { reducedMotion } from '../lib/use-swipe-row.js'
import {
  monthKeyOf, shiftMonth, monthChallenges, progressOf, newlyDone, savePicks, markDone, isGold,
  cleanChallenges, storedMonth, shelfOf, challengesOn, hiddenFor, factsFor,
} from '../lib/challenges.js'
import { challengeTitle, challengeCount, monthLabel, doneLine } from '../lib/challenge-copy.js'

/* The monthly challenges (lib/challenges.js): Home's card with the month's three and their
   progress, a small party when one is done, and Stats' card with the trophy shelf. */

// How long a party stays when nobody taps it away (as the streak's, components/Streak.jsx).
const PARTY_MS = 7000
// The first days of a month say why the goals changed.
const NEW_MONTH_DAYS = 3

/** The month's three as rows with a bar each. */
export function ChallengeRows({ progress, unit }) {
  return <div className="ch-list">
    {progress.map(p => {
      const title = challengeTitle(p, unit)
      return <div key={p.id} className={'ch-row' + (p.done ? ' done' : '')} data-challenge={p.id}>
        <span className="ch-ic" aria-hidden="true"><Icon name={p.done ? 'checkCircle' : p.icon} /></span>
        <div className="ch-body">
          <div className="ch-t"><span className="ch-name">{title}</span><span className="ch-n">{challengeCount(p, unit)}</span></div>
          <div className="ch-bar" role="progressbar" aria-label={title} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p.pct * 100)}>
            <i style={{ width: Math.round(p.pct * 100) + '%' }} />
          </div>
        </div>
      </div>
    })}
  </div>
}

/** One challenge done, or all three: said once, the way the streak's party says a week is done. */
function ChallengeParty({ party, onClose }) {
  useEffect(() => {
    const tm = setTimeout(onClose, PARTY_MS)
    return () => clearTimeout(tm)
  }, [party, onClose])
  const still = reducedMotion()
  const text = party.gold ? t('All three done. Gold month!') : t('Challenge done: {0}. New badge!', party.title)
  return <button type="button" className={'streak-party ch-party' + (still ? ' still' : '') + (party.gold ? ' gold' : '')} role="status"
    onClick={e => { e.stopPropagation(); onClose() }} aria-label={text}>
    <span className="streak-party-icon" aria-hidden="true">
      <Icon name={party.gold ? 'crown' : 'medal'} />
      {!still && <span className="sparks">{Array.from({ length: 6 }, (_, i) => <i key={i} />)}</span>}
    </span>
    <span className="streak-party-text">{text}</span>
  </button>
}

/** Home: this month's challenges. Folds to one line, × hides it until next month, off in Settings. */
export function ChallengesCard({ S, now = new Date() }) {
  const sandbox = useStore(s => s.tourSandbox)
  const [party, setParty] = useState(null)
  const closeParty = useCallback(() => setParty(null), [])
  const key = monthKeyOf(now)
  const on = challengesOn(S) && !hiddenFor(S, key) && (S.workouts || []).length > 0
  const month = useMemo(() => (on ? monthChallenges(S, key) : null), [on, key, S.challenges, S.workouts, S.bodyweight, S.unit, S.weekStart]) // eslint-disable-line react-hooks/exhaustive-deps
  const progress = useMemo(() => (month ? progressOf(S, month) : []), [month, S.workouts, S.bodyweight, S.unit]) // eslint-disable-line react-hooks/exhaustive-deps
  const fresh = month ? newlyDone(month, progress) : []
  const freshKey = fresh.join(',')

  // Keep the month's picks once shown, and every challenge reached as done (its badge). The
  // practice copy of the app tour never writes or celebrates.
  useEffect(() => {
    if (!month || sandbox) return
    const { update } = useStore.getState()
    if (fresh.length) {
      let gold = false
      update(s => { markDone(s, key, fresh, month.picked); gold = isGold(cleanChallenges(s.challenges)?.[key]) })
      const p = progress.find(x => x.id === fresh[0])
      setParty({ gold, title: challengeTitle(p, S.unit), at: Date.now() })
    } else if (!month.stored) update(s => { savePicks(s, key, month.picked) })
    // Last month's goals reached on its last evening, with the app opened only now: the badge
    // still counts, quietly.
    const prev = shiftMonth(key, -1)
    const pm = storedMonth(S, prev)
    if (pm && pm.picked.length && !isGold(pm)) {
      const m = { key: prev, picked: pm.picked, done: pm.done }
      const late = newlyDone(m, progressOf(S, m, factsFor(S, [prev])[prev]))
      if (late.length) update(s => { markDone(s, prev, late, pm.picked) })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, month?.stored, freshKey, sandbox])

  if (!month) return null
  const folded = S.challengesFold === true
  const done = progress.filter(p => p.done).length
  const gold = progress.length > 0 && done === progress.length
  const prevMonth = storedMonth(S, shiftMonth(key, -1))
  const newMonth = now.getDate() <= NEW_MONTH_DAYS && !!prevMonth && !isGold(prevMonth)
  const update = fn => useStore.getState().update(fn)
  return <div className={'card challenges' + (gold ? ' gold' : '')} data-challenges>
    <div className="row between" style={{ alignItems: 'center', gap: 8 }}>
      <button type="button" className="ch-head" aria-expanded={!folded} onClick={() => update(s => { s.challengesFold = !folded })}>
        <span className="lrow-i" style={{ background: gold ? 'var(--yellow)' : 'var(--orange)' }}><Icon name={gold ? 'crown' : 'target'} /></span>
        <span className="ch-head-t">
          <span className="lbl2">{monthLabel(key)} · {doneLine(done, progress.length)}</span>
          <span className="ttl">{t('This month’s challenges')}</span>
        </span>
        <Icon name={folded ? 'chevronDown' : 'chevronUp'} className="chev" />
      </button>
      <button type="button" className="iconbtn" style={{ width: 30, height: 30, fontSize: 14, flex: 'none' }}
        onClick={() => update(s => { s.challengesHidden = key })} aria-label={t('Hide until next month')}><Icon name="xmark" /></button>
    </div>
    {folded
      ? <div className="ch-mini" aria-hidden="true">{progress.map(p => <span key={p.id} className={p.done ? 'done' : ''}><i style={{ width: Math.round(p.pct * 100) + '%' }} /></span>)}</div>
      : <ChallengeRows progress={progress} unit={S.unit} />}
    {!folded && gold && <div className="ch-note small"><Icon name="crown" /> {t('Gold month. Take a bow.')}</div>}
    {!folded && !gold && newMonth && <div className="ch-note small muted">{t('New month, new challenges.')}</div>}
    {party && <ChallengeParty party={party} onClose={closeParty} />}
  </div>
}

/** Stats: this month's progress and the trophy shelf, one shelf per month with a badge. */
export function ChallengesStatsCard({ S, now = new Date() }) {
  const key = monthKeyOf(now)
  const on = challengesOn(S)
  const month = useMemo(() => (on ? monthChallenges(S, key) : null), [on, key, S.challenges, S.workouts, S.bodyweight, S.unit, S.weekStart]) // eslint-disable-line react-hooks/exhaustive-deps
  const progress = useMemo(() => (month ? progressOf(S, month) : []), [month, S.workouts, S.bodyweight, S.unit]) // eslint-disable-line react-hooks/exhaustive-deps
  const shelf = useMemo(() => shelfOf(S), [S.challenges]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!month && !shelf.length) return null
  return <div className="card challenges-stats" data-challenge-shelf>
    <h2>{t('Challenges')}</h2>
    {month && <>
      <div className="small muted" style={{ marginBottom: 6 }}>{monthLabel(key)} · {doneLine(progress.filter(p => p.done).length, progress.length)}</div>
      <ChallengeRows progress={progress} unit={S.unit} />
    </>}
    <div className="lbl2" style={{ marginTop: 14 }}>{t('Trophy shelf')}</div>
    {shelf.length
      ? <div className="ch-shelf" role="list">
        {shelf.map(m => <div key={m.key} role="listitem" className={'ch-month' + (m.gold ? ' gold' : '')}
          aria-label={(m.gold ? t('Gold month') + ': ' : '') + t('{0}: {1} of {2} challenges', monthLabel(m.key), m.done, m.total)}>
          <span className="ch-medals" aria-hidden="true">
            {m.gold ? <Icon name="crown" /> : Array.from({ length: m.done }, (_, i) => <Icon key={i} name="medal" />)}
          </span>
          <span className="ch-m">{monthLabel(m.key, { short: true })}</span>
        </div>)}
      </div>
      : <div className="small muted" style={{ marginTop: 4 }}>{t('Every challenge you finish puts a badge here, one shelf per month.')}</div>}
  </div>
}
