import { useEffect, useId, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { t, tn } from '../lib/i18n.js'
import { STREAK_BADGES, FREEZE_MAX, streakCelebration } from '../lib/streak.js'
import { reducedMotion } from '../lib/use-swipe-row.js'
import { vibrate } from '../lib/sound.js'
import Icon from './Icon.jsx'
import { SeasonDeco } from './Seasonal.jsx'

/* The week streak's extras (lib/streak.js): the best run and the freezes under the streak, the
   milestone badges on Stats, and Home's little party when a week is done or a badge is reached.
   The flame, the medals and the party banner live here too; Challenges.jsx reuses them. */

/**
 * The streak's flame: filled, a warm gradient with a light core, where the icon set's `flame` is a
 * thin outline (warm-ups keep that one). It flickers a few times when it appears, then rests
 * (index.css .flame.lit), and stays still with reduced motion. 1em square like an icon, so it sits
 * where the icon sat and the seasonal Santa hat (spot "streak-flame") still lands on its tip.
 * `lit` false (no streak yet) draws it in grey.
 */
export function StreakFlame ({ className = '', style, lit = true }) {
  const id = 'fl' + useId().replace(/[^a-zA-Z0-9]/g, '')
  return <svg className={'flame' + (lit ? ' lit' : ' out') + (className ? ' ' + className : '')} style={style} viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id={id + 'o'} x1="0" y1="1" x2="0" y2="0">
        <stop offset="0" className="flame-s1" />
        <stop offset=".55" className="flame-s2" />
        <stop offset="1" className="flame-s3" />
      </linearGradient>
      <linearGradient id={id + 'i'} x1="0" y1="1" x2="0" y2="0">
        <stop offset="0" className="flame-s4" />
        <stop offset="1" className="flame-s5" />
      </linearGradient>
    </defs>
    <g className="flame-o">
      <path fill={`url(#${id}o)`} d="M12 22c-4.1 0-7-2.8-7-6.7 0-2.9 1.5-5 3.2-6.6.2 1.5.9 2.6 2 3.1-.3-3.6 1.4-6.9 4.6-9.3-.1 2.9 1 4.7 2.5 6.4 1.6 1.8 2.9 3.6 2.9 6.3C20.2 19.2 17.1 22 12 22Z" />
    </g>
    <g className="flame-i">
      <path fill={`url(#${id}i)`} d="M12.1 22c-2.1 0-3.6-1.4-3.6-3.3 0-1.8 1-3 2.2-4.1.1 1 .6 1.7 1.2 2-.1-1.8.6-3.3 1.9-4.4.1 1.6.8 2.5 1.5 3.4.6.8 1 1.6 1 2.8 0 2.2-1.7 3.6-4.2 3.6Z" />
    </g>
  </svg>
}

// The medal tiers, lowest first: the streak's five milestones take one each, a month's three
// challenges the first three.
export const TIERS = ['bronze', 'silver', 'gold', 'platinum', 'legend']

/** A medal on its ribbon, coloured by tier (index.css .medal-*), or `locked` for one still to earn.
    Decorative: the row it sits in says what it is. */
export function Medal ({ tier = 'gold', className = '' }) {
  return <svg className={'medal medal-' + tier + (className ? ' ' + className : '')} viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" focusable="false">
    {/* Two straps crossing into a V: the right one is the left one mirrored, drawn first and a shade
        darker so it reads as the strap behind (it used to be a lopsided five-cornered patch). */}
    <path className="medal-rib medal-rib-back" d="M17 2.4h-3.7l-2.5 6.4 3.4 1.7Z" />
    <path className="medal-rib" d="M7 2.4h3.7l2.5 6.4-3.4 1.7Z" />
    <circle className="medal-disc" cx="12" cy="15.2" r="6.3" />
    <circle className="medal-ring" cx="12" cy="15.2" r="4.3" />
    <path className="medal-star" d="m12 12.6.8 1.6 1.8.3-1.3 1.2.3 1.8-1.6-.8-1.6.8.3-1.8-1.3-1.2 1.8-.3Z" />
  </svg>
}

/**
 * The party's burst: a dozen bits of confetti flying out of the icon, gone within a second
 * (index.css .burst). Decorative; the caller leaves it out with reduced motion.
 */
const BURST = 12
export function Burst () {
  return <span className="burst" aria-hidden="true">
    {Array.from({ length: BURST }, (_, i) => {
      const a = (i / BURST) * Math.PI * 2 + (i % 2 ? 0.22 : -0.12)
      const d = [30, 23, 17][i % 3]
      return <i key={i} style={{ '--dx': Math.round(Math.cos(a) * d) + 'px', '--dy': Math.round(Math.sin(a) * d) + 'px', '--rot': ((i * 67) % 240 - 120) + 'deg', animationDelay: (i % 4) * 30 + 'ms' }} />
    })}
  </span>
}

/** Snowflakes for the freezes banked: filled chips are there, outlined ones still to earn. */
export function Freezes ({ n, className = '' }) {
  const label = t('Streak freezes: {0} of {1}', n, FREEZE_MAX)
  return <span className={'streak-freezes ' + className} role="img" aria-label={label} title={label}>
    {Array.from({ length: FREEZE_MAX }, (_, i) => <span key={i} className={'frz' + (i < n ? ' on' : '')}><Icon name="snowflake" className={i < n ? 'on' : ''} /></span>)}
  </span>
}

/** "Best 12 · ❄❄": one line under the streak. */
export function StreakMeta ({ info }) {
  return <span className="streak-meta">
    <span>{t('Best: {0}', info.best)}</span>
    <Freezes n={info.freezes} />
  </span>
}

/** The milestones as a row of medals, bronze to legend; the ones still to reach are outlined. */
export function StreakBadges ({ info }) {
  return <div className="streak-badges" role="list" aria-label={t('Streak badges')}>
    {STREAK_BADGES.map((b, i) => {
      const got = info.badges.includes(b)
      return <div key={b} role="listitem" className={'streak-badge' + (got ? ' got' : '')} data-tier={TIERS[i]}
        aria-label={got ? t('{0} weeks: reached', b) : t('{0} weeks: not yet', b)}>
        <span className="streak-badge-art" aria-hidden="true">
          <Medal tier={got ? TIERS[i] || 'gold' : 'locked'} />
          {!got && <Icon name="lock" className="lk" />}
        </span>
        <span className="n">{b}</span>
      </div>
    })}
  </div>
}

/** Stats: the streak with its best, the freezes, the badges and how far the next one is. */
export function StreakCard ({ info }) {
  const hint = info.freezes >= FREEZE_MAX
    ? t('Freezes full. A missed week uses one, no harm done.')
    : tn('One more week with a workout earns a freeze.', '{0} more weeks with a workout earn a freeze.', info.toNextFreeze)
  const nextLine = info.next ? t('Next badge at {0} weeks.', info.next) : t('Every badge collected. Legend.')
  return <div className="card streak-card" data-streak-card>
    <div className="row between" style={{ alignItems: 'flex-start' }}>
      <div>
        <h2 style={{ margin: 0 }}>{t('Week streak')}</h2>
        <div className="streak-num"><StreakFlame lit={info.current > 0} /><span>{info.current}</span></div>
      </div>
      <div className="streak-side">
        <div className="muted small">{t('Best: {0}', info.best)}</div>
        <Freezes n={info.freezes} className="big" />
      </div>
    </div>
    <StreakBadges info={info} />
    {info.next
      ? <div className="streak-next">
        <div className="pbar-t small"><span>{nextLine}</span><span className="pbar-n">{info.current} / {info.next}</span></div>
        <div className="pbar" role="progressbar" aria-label={nextLine} aria-valuemin={0} aria-valuemax={info.next} aria-valuenow={Math.min(info.current, info.next)}>
          <i style={{ '--p': Math.min(1, info.current / info.next) }} />
        </div>
      </div>
      : null}
    <div className="muted small streak-hint">{info.next ? '' : nextLine + ' '}{hint}</div>
  </div>
}

// How long a party stays when nobody taps it away.
export const PARTY_MS = 7000

/**
 * A party banner, the streak's and the challenges': the icon popping in with its burst, one line,
 * tap anywhere on it to close. It sits in the card's flow, never over anything, and one short buzz
 * on the phone goes with it (lib/sound.js vibrate; Settings → Vibrate turns it off).
 */
export function PartyBanner ({ text, icon, className = '', onClose, children }) {
  const still = reducedMotion()
  useEffect(() => { vibrate([14, 40, 22]) }, [text])
  // The live region wraps the button, so it is still announced as a button (a role on the button
  // itself would replace that).
  return <div className="party-live" role="status">
    <button type="button" className={'streak-party' + (still ? ' still' : '') + (className ? ' ' + className : '')}
      onClick={e => { e.stopPropagation(); onClose() }} aria-label={text}>
      {children}
      <span className="streak-party-icon" aria-hidden="true">
        <span className="streak-party-art">{icon}</span>
        {!still && <span className="sparks"><Burst /></span>}
      </span>
      <span className="streak-party-text">{text}</span>
    </button>
  </div>
}

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
  const text = party.kind === 'badge'
    ? t('{0} weeks in a row. New badge!', party.weeks)
    : t('Week done. The flame lives on.')
  const tier = TIERS[STREAK_BADGES.indexOf(party.weeks)] || 'gold'
  return <PartyBanner text={text} className={party.kind === 'badge' ? 'is-badge' : 'is-week'} onClose={() => setParty(null)}
    icon={party.kind === 'badge' ? <Medal tier={tier} /> : <StreakFlame />}>
    <SeasonDeco spot="streak-party" />
  </PartyBanner>
}
