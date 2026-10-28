import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { t, tn } from '../lib/i18n.js'
import { STREAK_BADGES, FREEZE_MAX, streakCelebration } from '../lib/streak.js'
import { reducedMotion } from '../lib/use-swipe-row.js'
import Icon from './Icon.jsx'
import { SeasonDeco } from './Seasonal.jsx'

/* The week streak's extras (lib/streak.js): the best run and the freezes under the streak, the
   milestone badges on Stats, and Home's little party when a week is done or a badge is reached. */

/** Snowflakes for the freezes banked: filled ones are there, faint ones still to earn. */
export function Freezes ({ n, className = '' }) {
  const label = t('Streak freezes: {0} of {1}', n, FREEZE_MAX)
  return <span className={'streak-freezes ' + className} role="img" aria-label={label} title={label}>
    {Array.from({ length: FREEZE_MAX }, (_, i) => <Icon key={i} name="snowflake" className={i < n ? 'on' : ''} />)}
  </span>
}

/** "Best 12 · ❄❄": one line under the streak. */
export function StreakMeta ({ info }) {
  return <span className="streak-meta">
    <span>{t('Best: {0}', info.best)}</span>
    <Freezes n={info.freezes} />
  </span>
}

/** The milestones as a row of medals, the reached ones in colour. */
export function StreakBadges ({ info }) {
  return <div className="streak-badges" role="list" aria-label={t('Streak badges')}>
    {STREAK_BADGES.map(b => {
      const got = info.badges.includes(b)
      return <div key={b} role="listitem" className={'streak-badge' + (got ? ' got' : '')}
        aria-label={got ? t('{0} weeks: reached', b) : t('{0} weeks: not yet', b)}>
        <Icon name={got ? 'medal' : 'lock'} />
        <span className="n">{b}</span>
      </div>
    })}
  </div>
}

/** Stats: the streak with its best, the freezes, the badges and what comes next. */
export function StreakCard ({ info }) {
  const hint = info.freezes >= FREEZE_MAX
    ? t('Freezes full. A missed week uses one, no harm done.')
    : tn('One more week with a workout earns a freeze.', '{0} more weeks with a workout earn a freeze.', info.toNextFreeze)
  return <div className="card streak-card" data-streak-card>
    <div className="row between" style={{ alignItems: 'flex-start' }}>
      <div>
        <h2 style={{ margin: 0 }}>{t('Week streak')}</h2>
        <div className="row" style={{ gap: 7, marginTop: 6, fontSize: 30, fontWeight: 600, letterSpacing: '-.026em' }}>
          <Icon name="flame" style={{ color: 'var(--orange)' }} />{info.current}
        </div>
      </div>
      <div style={{ textAlign: 'end' }}>
        <div className="muted small">{t('Best: {0}', info.best)}</div>
        <Freezes n={info.freezes} className="big" />
      </div>
    </div>
    <StreakBadges info={info} />
    <div className="muted small" style={{ marginTop: 8 }}>
      {info.next ? t('Next badge at {0} weeks.', info.next) + ' ' : t('Every badge collected. Legend.') + ' '}{hint}
    </div>
  </div>
}

// How long the party stays when nobody taps it away.
const PARTY_MS = 7000

/**
 * Home: a week done or a badge reached, said once (S.streakSeen remembers it, synced like any
 * setting, so the other device does not say it again). The tour's practice copy never celebrates.
 */
export function StreakParty ({ S, info, tally }) {
  const sandbox = useStore(s => s.tourSandbox)
  const [party, setParty] = useState(null)
  const c = sandbox ? null : streakCelebration(S, info, tally)
  const seenKey = c ? JSON.stringify(c.seen) : null
  useEffect(() => {
    if (!c) return
    // Remember it at once: it shows for this visit, and never again.
    useStore.getState().update(s => { s.streakSeen = c.seen })
    setParty({ kind: c.kind, weeks: c.weeks })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seenKey])
  useEffect(() => {
    if (!party) return
    const tm = setTimeout(() => setParty(null), PARTY_MS)
    return () => clearTimeout(tm)
  }, [party])
  if (!party) return null
  const still = reducedMotion()
  const text = party.kind === 'badge'
    ? t('{0} weeks in a row. New badge!', party.weeks)
    : t('Week done. The flame lives on.')
  return <button type="button" className={'streak-party' + (still ? ' still' : '')} role="status"
    onClick={e => { e.stopPropagation(); setParty(null) }} aria-label={text}>
    <SeasonDeco spot="streak-party" />
    <span className="streak-party-icon" aria-hidden="true">
      <Icon name={party.kind === 'badge' ? 'medal' : 'flame'} />
      {!still && <span className="sparks">{Array.from({ length: 6 }, (_, i) => <i key={i} />)}</span>}
    </span>
    <span className="streak-party-text">{text}</span>
  </button>
}
