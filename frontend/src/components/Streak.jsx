import { useEffect, useId, useMemo, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { t, tn } from '../lib/i18n.js'
import { fmtDate } from '../lib/format.js'
import { STREAK_BADGES, FREEZE_MAX, streakCelebration, streakInfo } from '../lib/streak.js'
import { reducedMotion } from '../lib/use-swipe-row.js'
import { vibrate } from '../lib/sound.js'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'
import { SeasonDeco } from './Seasonal.jsx'
import { iconChoice } from '../lib/streak-icons.js'
import { freezeLine } from '../lib/streak-explain.js'
import { levelOf, earnedBadges, pinnedBadges, pinnedIds, togglePin, PIN_MAX } from '../lib/levels.js'
import { monthLabel } from '../lib/challenge-copy.js'
import { useUI } from '../store/useUI.js'

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
export function StreakFlame ({ className = '', style, lit = true, plain = false }) {
  const id = 'fl' + useId().replace(/[^a-zA-Z0-9]/g, '')
  // Settings → Icons → Streak flame (lib/streak-icons.js): your own icon or emoji, in the same
  // 1em box, tinted by index.css from its own colour. It wins over the openGym/Emoji switch.
  // `plain` is the default flame whatever was picked (the picker's own "default" cell).
  const own = iconChoice({ flameIcon: useStore(s => s.S?.flameIcon) }, 'flame')
  if (own && !plain) return <OwnSymbol own={own} cls={'flame flame-own' + (lit ? ' lit' : ' out') + (className ? ' ' + className : '')} style={style} />
  return <svg className={'flame' + (lit ? ' lit glyph-svg' : ' out') + (className ? ' ' + className : '')} style={style} viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" focusable="false">
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
    {lit && svgEmoji('🔥')}
  </svg>
}

// The medal tiers, lowest first: the streak's five milestones take one each, a month's three
// challenges the first three.
export const TIERS = ['bronze', 'silver', 'gold', 'platinum', 'legend']

/** A medal on its ribbon, coloured by tier (index.css .medal-*), or `locked` for one still to earn.
    Decorative: the row it sits in says what it is. */
// The emoji a medal is with Settings → Icons on Emoji (components/Glyph.jsx: the drawing hides and
// the emoji, drawn in the same box, shows). One still to earn stays drawn.
const MEDAL_EMOJI = { bronze: '🥉', silver: '🥈', gold: '🥇', platinum: '🏅', legend: '🏆' }
// The emoji inside an svg of ours, in its 24×24 box, shown only with emoji chosen (index.css).
const svgEmoji = e => <text className="glyph-e" x="12" y="19.5" textAnchor="middle" fontSize="19">{e}</text>

export function Medal ({ tier = 'gold', className = '' }) {
  const emoji = MEDAL_EMOJI[tier]
  return <svg className={'medal medal-' + tier + (emoji ? ' glyph-svg' : '') + (className ? ' ' + className : '')} viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" focusable="false">
    {/* Two straps crossing into a V: the right one is the left one mirrored, drawn first and a shade
        darker so it reads as the strap behind (it used to be a lopsided five-cornered patch). */}
    <path className="medal-rib medal-rib-back" d="M17 2.4h-3.7l-2.5 6.4 3.4 1.7Z" />
    <path className="medal-rib" d="M7 2.4h3.7l2.5 6.4-3.4 1.7Z" />
    <circle className="medal-disc" cx="12" cy="15.2" r="6.3" />
    <circle className="medal-ring" cx="12" cy="15.2" r="4.3" />
    <path className="medal-star" d="m12 12.6.8 1.6 1.8.3-1.3 1.2.3 1.8-1.6-.8-1.6.8.3-1.8-1.3-1.2 1.8-.3Z" />
    {emoji && svgEmoji(emoji)}
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

/** A chosen flame or freeze: an openGym icon in its own colour, or the emoji itself. */
function OwnSymbol ({ own, cls, style }) {
  return <span className={cls + ' own-' + own.k} style={style} aria-hidden="true">
    {own.k === 'icon' ? <Icon name={own.v} /> : <span className="own-e">{own.v}</span>}
  </span>
}

/**
 * The freeze's symbol: the snowflake (or ❄️ with Icons on Emoji), or the one picked in Settings →
 * Icons → Streak freeze. `on` false is a freeze still to earn: always the plain outline, so an
 * empty slot reads the same whatever was picked.
 */
export function FreezeGlyph ({ on = true, className = '' }) {
  const own = iconChoice({ freezeIcon: useStore(s => s.S?.freezeIcon) }, 'freeze')
  if (on && own) return <OwnSymbol own={own} cls={'frz-g frz-own' + (className ? ' ' + className : '')} />
  return <span className={'frz-g' + (on ? ' glyph' : '') + (className ? ' ' + className : '')} aria-hidden="true">
    <Icon name="snowflake" className={on ? 'on' : ''} />{on && <span className="glyph-e">❄️</span>}
  </span>
}

/** Snowflakes for the freezes banked: filled chips are there, outlined ones still to earn. */
export function Freezes ({ n, max = FREEZE_MAX, className = '' }) {
  // A rule without freezes (lib/streak-rule.js) has no chips to show.
  if (!max) return null
  const label = t('Streak freezes: {0} of {1}', n, max)
  return <span className={'streak-freezes ' + className} role="img" aria-label={label} title={label}>
    {Array.from({ length: max }, (_, i) => <span key={i} className={'frz' + (i < n ? ' on' : '')}><FreezeGlyph on={i < n} /></span>)}
  </span>
}

/** "Best 12 · ❄❄": one line under the streak. */
export function StreakMeta ({ info }) {
  return <span className="streak-meta">
    <span>{t('Best: {0}', info.best)}</span>
    <Freezes n={info.freezes} max={info.max ?? FREEZE_MAX} />
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
export function StreakCard ({ info, onHelp }) {
  const hint = freezeLine(info)
  const nextLine = info.next ? t('Next badge at {0} weeks.', info.next) : t('Every badge collected. Legend.')
  return <div className="card streak-card" data-streak-card>
    <div className="row between" style={{ alignItems: 'flex-start' }}>
      <div>
        <h2 style={{ margin: 0 }}>{t('Week streak')}</h2>
        <div className="streak-num"><StreakFlame lit={info.current > 0} /><span>{info.current}</span></div>
        {/* What the number counts, right under it (Discord 11-04: it read as workouts, or as a bug). */}
        <div className="muted small streak-what">{t('Weeks in a row with at least one workout.')}</div>
      </div>
      <div className="streak-side">
        <div className="muted small">{t('Best: {0}', info.best)}</div>
        <Freezes n={info.freezes} max={info.max ?? FREEZE_MAX} className="big" />
      </div>
    </div>
    <StreakBadges info={info} />
    <LevelBar info={info} />
    {info.next
      ? <div className="streak-next">
        <div className="pbar-t small"><span>{nextLine}</span><span className="pbar-n">{info.current} / {info.next}</span></div>
        <div className="pbar" role="progressbar" aria-label={nextLine} aria-valuemin={0} aria-valuemax={info.next} aria-valuenow={Math.min(info.current, info.next)}>
          <i style={{ '--p': Math.min(1, info.current / info.next) }} />
        </div>
      </div>
      : null}
    <div className="muted small streak-hint">{info.next ? '' : nextLine + ' '}{hint}</div>
    <FrozenWeeks frozen={info.frozen} />
    <ExcusedWeeks excused={info.excused} left={info.excuseLeft} />
    {/* The calendar with every week's mark and the how-to (components/StreakCalendar.jsx). */}
    {onHelp && <button type="button" className="streak-how" onClick={onHelp} aria-haspopup="dialog">
      <Icon name="calendar" /><span>{t('How streaks work')}</span><Icon name="chevronRight" className="chev" />
    </button>}
  </div>
}

/**
 * Your level (lib/levels.js): the number, the points into it and how many the next one needs, from
 * weeks trained, streak badges and finished challenges. Tap for where the points come from and to
 * pin badges to your profile.
 */
export function LevelBar ({ info }) {
  const S = useStore(s => s.S)
  const lv = levelOf(S, info)
  if (!lv) return null
  const line = t('{0} points to level {1}', lv.need, lv.n + 1)
  return <button type="button" className="level-bar" data-level={lv.n} onClick={() => profileBadgesSheet(info)} aria-haspopup="dialog"
    aria-label={t('Level {0}', lv.n) + '. ' + line}>
    <span className="level-n" aria-hidden="true"><span className="level-k">{t('Level')}</span><b>{lv.n}</b></span>
    <span className="level-m">
      <span className="pbar-t small"><span>{line}</span></span>
      <span className="pbar" aria-hidden="true"><i style={{ '--p': Math.min(1, lv.pct) }} /></span>
    </span>
    <Icon name="chevronRight" className="chev" />
  </button>
}

/** One earned badge as a medal with its name: a streak milestone or a challenge month. */
export const badgeName = b => (b.kind === 'streak' ? t('{0} week streak', b.weeks) : (b.gold ? t('Gold month') + ' · ' : '') + monthLabel(b.key))
export function BadgeMedal ({ b, className = '' }) {
  return b.kind === 'month' && b.gold
    ? <span className={'badge-crown ' + className} aria-hidden="true"><Icon name="crown" /></span>
    : <Medal tier={b.tier} className={className} />
}

/** The badges pinned to the profile, beside the picture (Settings, the Account page). */
export function PinnedBadges ({ className = '' }) {
  const S = useStore(s => s.S)
  const pins = pinnedIds(S)
  // Only the pins' own badges are worked out, and only when there are pins.
  const list = useMemo(() => (pins.length ? pinnedBadges(S, null, earnedBadges(S, streakInfo(S))) : []), [pins.join(), S.workouts, S.challenges, S.weekStart, S.streakRule, S.dayNotes, S.streakExcuse]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!list.length) return null
  return <span className={'pinned-badges ' + className} role="img" aria-label={t('Pinned badges: {0}', list.map(badgeName).join(', '))}>
    {list.map(b => <BadgeMedal key={b.id} b={b} />)}
  </span>
}

/** Where the points come from, and up to three badges to pin to your profile. */
export function ProfileBadgesSheet ({ info, close }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const lv = levelOf(S, info)
  const earned = earnedBadges(S, info)
  const pins = pinnedIds(S)
  const flip = id => update(s => { s.profileBadges = togglePin(s, id); if (!s.profileBadges.length) delete s.profileBadges })
  return <div className="badges-sheet">
    <h3>{lv ? t('Level {0}', lv.n) : t('Your badges')}</h3>
    {lv && <div className="lv-parts small muted" data-level-parts>
      <span>{tn('{0} week trained', '{0} weeks trained', lv.parts.weeks)}</span>
      <span>{tn('{0} streak badge', '{0} streak badges', lv.parts.badges)}</span>
      <span>{tn('{0} challenge done', '{0} challenges done', lv.parts.challenges)}</span>
    </div>}
    <h4 className="sec" style={{ marginTop: 16 }}>{t('Pin to your profile')}</h4>
    <div className="muted small" style={{ marginBottom: 10 }}>{t('Pick up to {0}. They sit next to your picture.', PIN_MAX)}</div>
    {earned.length
      ? <div className="badge-pick" role="group" aria-label={t('Pin to your profile')}>
        {earned.map(b => {
          const on = pins.includes(b.id)
          return <button key={b.id} type="button" className={'badge-opt' + (on ? ' on' : '')} aria-pressed={on} onClick={() => flip(b.id)}>
            <span className="badge-opt-art"><BadgeMedal b={b} /></span>
            <span className="badge-opt-t">{badgeName(b)}</span>
            {on && <Icon name="pin" className="badge-opt-pin" />}
          </button>
        })}
      </div>
      : <div className="muted small">{t('No badges yet. Four weeks in a row gets you the first one.')}</div>}
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={close}>{t('Done')}</Button>
  </div>
}
export const profileBadgesSheet = info => useUI.getState().openSheet(close => <ProfileBadgesSheet info={info} close={close} />)

/**
 * The weeks a freeze covered in the running streak, the newest three. Without it a streak that ran
 * through a gap you can see on the calendar looked like a counting error (Discord, dimarei: 11
 * weeks with a hole in September). The freeze week itself adds nothing to the count.
 */
export function FrozenWeeks ({ frozen }) {
  if (!Array.isArray(frozen) || !frozen.length) return null
  const shown = frozen.slice(-3).map(wk => fmtDate(wk, false, wk.slice(0, 4) !== String(new Date().getFullYear()))).join(', ')
  return <div className="muted small streak-frozen" data-streak-frozen>
    <FreezeGlyph />
    <span>{frozen.length === 1 ? t('A freeze covered the week of {0}, so the streak kept going.', shown) : t('Freezes covered the weeks of {0}, so the streak kept going.', shown)}</span>
  </div>
}

/**
 * The weeks a sick or travel note carried in the running streak (api/coach/core/streak.js), the
 * newest three, with how many are left this year. Same idea as FrozenWeeks: a gap you can see on
 * the calendar is never a mystery.
 */
export function ExcusedWeeks ({ excused, left }) {
  if (!Array.isArray(excused) || !excused.length) return null
  const shown = excused.slice(-3).map(wk => fmtDate(wk, false, wk.slice(0, 4) !== String(new Date().getFullYear()))).join(', ')
  return <div className="muted small streak-excused" data-streak-excused>
    <span className="wk-exc" aria-hidden="true"><Icon name="cloud" /></span>
    <span>{excused.length === 1 ? t('A sick or travel note excused the week of {0}.', shown) : t('Sick or travel notes excused the weeks of {0}.', shown)}{' '}{tn('One left this year.', '{0} left this year.', left ?? 0)}</span>
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
      onClick={onClose} aria-label={text}>
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
