import TrainerNotice from '../components/TrainerNotice.jsx'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { effectiveRoutines, effectiveRoutineIds, nextTrainingDay, lastBW, setsDoneActive, setsDone, workoutDay, workoutDuration, workoutVolume, supersetUnits, unitOf, setUnitsTotal } from '../lib/history.js'
import { streakInfo } from '../lib/streak.js'
import { StreakFlame, StreakMeta, StreakParty } from '../components/Streak.jsx'
import { StreakRuleWelcome } from '../components/StreakRule.jsx'
import { fmtNum, fmtDate, fmtVol, durPart, todayISO, isoOf, weekStartOf, weekDayOffset, DAYS, DAYN } from '../lib/format.js'
import { t, tn, dateLocale } from '../lib/i18n.js'
import { bwSheet, goalSheet, dayOverrideSheet, calendarSheet, starterPlanSheet, bwDeltaColor, weighInsSheet, workoutDetailSheet } from '../sheets.jsx'
import { startOrPreview, startPickerSheet } from '../components/StartSheets.jsx'
import { daySessionsStatus } from '../lib/day-sessions.js'
import { deriveSessionName } from '../lib/session-merge.js'
import LineChart from '../components/LineChart.jsx'
import Heatmap from '../components/Heatmap.jsx'
import Icon from '../components/Icon.jsx'
import Elapsed from '../components/Elapsed.jsx'
import CardHead from '../components/CardHead.jsx'
import QueueRow from '../components/QueueRow.jsx'
import MiniBodyMap from '../components/MiniBodyMap.jsx'
import { queueOf, queueView, weekTally, pinState } from '../lib/queue.js'
import { workoutsLeft } from '../lib/week-left.js'
import { WeeklySetsHomeLine } from '../components/WeeklySets.jsx'
import { RecapHomeCard } from '../components/Recap.jsx'
import { scheduleModeOf } from '../lib/rotation.js'
import { useConnectionTrouble } from '../components/SyncBanner.jsx'
import { Button } from '../components/ui.jsx'
import { tappable } from '../lib/use-sheet-keyboard.js'
import { glyphOf } from '../lib/glyphs.js'
import { dayNoteOf } from '../lib/day-notes.js'
import { weighInAt } from '../lib/bodyweight.js'
import WeightRate from '../components/WeightRate.jsx'
import { programmeChip } from '../lib/programmes.js'
import { SeasonDeco } from '../components/Seasonal.jsx'
import { WrappedHomeCard } from '../components/WrappedEntry.jsx'
import { DeloadCard } from '../components/DeloadCard.jsx'
import RecoveryHint from '../components/RecoveryHint.jsx'
import { FastingLine } from '../components/SisterApps.jsx'
import { ChallengesCard } from '../components/Challenges.jsx'
import { isOn } from '../lib/modules.js'
import { useDesktop } from '../lib/use-desktop.js'
import { fatigueOf } from '../lib/recovery.js'
import { fatigueStateOf, fatigueLabel, profileBodyweightKg } from '../lib/recovery-view.js'
import { MUSCLES, MUSCLE_NAME } from '../lib/muscles.js'

// Home = what to do now + a quick glance. Deep charts & history live in Stats.
export default function Home() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  // The banner switched off and the sync stuck: a dot on the gear (Settings → Show connection status).
  const trouble = useConnectionTrouble()
  const [weekOffset, setWeekOffset] = useState(0)
  const desktop = useDesktop()
  // The six most tired muscles, for the desktop Recovery card. Only worked out on a wide window:
  // a phone never shows it, and the model walks the whole history.
  const recovery = useMemo(() => {
    if (!desktop || !S.workouts.length) return null
    const f = fatigueOf(S.workouts, Date.now(), { bodyweightKg: profileBodyweightKg(S), unit: S.unit })
    return MUSCLES.map(m => [m, f[m] || 0]).sort((a, b) => b[1] - a[1]).slice(0, 6)
  }, [desktop, S.workouts, S.bodyweight, S.unit])

  const today = new Date()
  // A weekday can hold several routines. `todayRoutines` is the whole day; `routine` is the
  // first, kept for the one-routine glyph. The derived session name joins them (§9).
  const todayRoutines = effectiveRoutines(S, todayISO())
  const routine = todayRoutines[0] || null
  const todayName = todayRoutines.map(r => r.name).join(' + ')
  // A fulfilled pin (a coach session pinned to today and since done) reads as no override.
  const todayOvr = S.dayPlan[todayISO()] !== undefined && pinState(S, S.dayPlan[todayISO()]) !== 'done'
  // An open editor on a saved workout (lib/session-edit.js) holds S.active too, but it is not a
  // session in progress: the row takes you back to it as an edit, the way the tab bar does.
  const editingSaved = !!S.active?.editingWorkoutId
  const bw = lastBW(S)
  const prevBW = S.bodyweight.length > 1 ? S.bodyweight[S.bodyweight.length - 2] : null
  const delta = bw && prevBW ? bw.w - prevBW.w : null

  const ws = weekStartOf(S)
  // The first day of the shown week. Named for the role, not for Monday — which day that is
  // is the setting.
  const wkStart = new Date(today)
  wkStart.setDate(today.getDate() - weekDayOffset(today.getDay(), ws) + weekOffset * 7)
  const doneDays = new Set(S.workouts.map(w => w.d))
  // The last session logged for today, if any — what the row below reports instead of asking
  // you to start the one you already did. Last wins, so a second session names itself. Only once
  // today's plan is covered, though: a freestyle session on a planned day, or the rotation's
  // first session done when its next one is today's too, leaves the row offering what is still
  // to do, as Start and the progress row already do. A queue session is never "covered" by an
  // earlier workout: the queue only names one it does not count as done yet.
  const loggedToday = S.workouts.filter(w => w.d === todayISO())
  const queueIds = queueOf(S)?.ids || []
  const coveredToday = id => !queueIds.includes(id) && loggedToday.some(w => (Array.isArray(w.routineIds) ? w.routineIds : [w.routineId]).includes(id))
  const doneToday = (todayRoutines.every(r => coveredToday(r.id)) && loggedToday.at(-1)) || null
  const strip = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(wkStart); d.setDate(wkStart.getDate() + i)
    const iso = isoOf(d)
    // In a rotation the weekdays plan nothing (lib/rotation.js); only what was done shows (desktop).
    const fixedWeek = scheduleModeOf(S) !== 'rotation'
    const eff = fixedWeek && effectiveRoutineIds(S, iso).length > 0, ovr = S.dayPlan[iso] !== undefined, done = doneDays.has(iso)
    const dayName = !desktop ? '' : done ? S.workouts.filter(w => w.d === iso).map(w => w.name).filter(Boolean).join(' + ')
      : eff ? effectiveRoutines(S, iso).map(r => r.name).join(' + ') : ''
    // A day off with a note (#261) reads as excused, not as a plan that went by.
    const dot = done ? ' done' : dayNoteOf(S, iso) ? ' noted' : ovr && eff ? ' ovr' : eff ? ' plan' : ''
    strip.push(<div key={i} className={'wday' + (iso === todayISO() ? ' today' : '')} {...tappable(() => dayOverrideSheet(iso))}>
      <div className="lbl">{t(DAYS[d.getDay()])}</div><div className="num">{d.getDate()}</div><div className={'dot' + dot} />
      {desktop && <div className="nm" title={dayName}>{dayName}</div>}</div>)
  }
  const wkEnd = new Date(wkStart); wkEnd.setDate(wkStart.getDate() + 6)
  const wkLabel = weekOffset === 0 ? t('This week') : `${wkStart.getDate()} ${wkStart.toLocaleDateString(dateLocale(), { month: 'short' })} – ${wkEnd.getDate()} ${wkEnd.toLocaleDateString(dateLocale(), { month: 'short' })}`

  // A coach week (S.queue) read through the same tolerant reader QueueRow uses, so a malformed
  // queue from another client shows the weekday dots, never an empty card.
  const queue = queueView(S, todayISO())
  // This card shows one thing or the other — QueueRow for a live queue, or Rotation chosen with
  // nothing built yet (S.scheduleMode), in which case there is no queue for QueueRow to render and
  // an empty-state card takes its place. Plan does the same in rotation mode: no weekday grid, only
  // the days that add a routine the loop does not have (Plan.jsx, "Also on fixed days").
  const rotating = scheduleModeOf(S) === 'rotation'
  // A planner-written queue (no rotationId) still names its weekday when it hasn't started yet —
  // that copy predates rotation and stays as it is. Our own rotation has no weekday of its own
  // (lib/rotation.js): naming one here — including on the pass's own one-day empty gap (THE
  // ONE-DAY BOUNDARY, rotation.js) or before a first routine is even added — would be the
  // fixed-week model leaking into a schedule that was never weekday-based.
  const liveQ = queueOf(S)
  const plannerQueue = !!queue && !liveQ?.rotationId
  // Ownership, not mere presence of a rotationId: a stale id left over from a rebuilt rotation
  // would otherwise still read as "this app manages it" (lib/rotation.js).
  const managedQueue = !!liveQ && !!S.rotation && liveQ.rotationId === S.rotation.id
  // On a rest day, saying when you train next beats leaving the row as a full stop.
  const next = !S.active && !todayRoutines.length && !(rotating && !plannerQueue) ? nextTrainingDay(S, todayISO()) : null
  // The streak card's fraction: this calendar week's workouts over the weekdays with a plan, or,
  // in a coach week, the queue's sessions and your own days together (lib/queue.js weekTally).
  const tally = weekTally(S, todayISO())
  const { done: doneThisWeek, planned: plannedPerWeek } = tally
  const left = workoutsLeft(S, todayISO())
  // The streak with its best run and freezes (lib/streak.js), read back from the workouts.
  const todayKey = todayISO()
  const streak = useMemo(() => streakInfo(S, todayKey), [S.workouts, S.weekStart, S.streakRule, S.recoverySessions, S.recoveryStreak, S.activities, S.activityStreak, todayKey]) // eslint-disable-line react-hooks/exhaustive-deps
  // Settings → Modules (lib/modules.js): what a module switched off hides here.
  const on = id => isOn(S, id)
  const bwPoints = S.bodyweight.slice(-30).map(b => ({ t: weighInAt(b), y: b.w, d: b.d }))

  // today's session shown right under the week strip
  const onToday = () => { if (S.active) nav('/workout'); else if (todayRoutines.length) startOrPreview(effectiveRoutineIds(S, todayISO())); else dayOverrideSheet(todayISO()) }
  // A chip on the coach week's progress row starts that one routine, in any order. A session
  // already in progress wins, as on the today row — starting another would overwrite it.
  const progChip = programmeChip(S)
  const onQueueStart = id => { if (S.active) nav('/workout'); else startOrPreview([id]) }
  // A weekday trained separately (#908): each of its sessions gets a row of its own below, with
  // its own Start and its own Done. Only while nothing runs; a running one is the row above.
  const apartSessions = S.active ? [] : daySessionsStatus(S, todayISO()).filter(x => x.routines.length)
  const splitDay = apartSessions.length > 1

  const header = <>
    <div className="hdr">
      <SeasonDeco spot="header-bats" />
      <div><h1>{user ? t('Hi {0}', user.name) : 'openGym'}</h1><div className="sub">{today.toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' })}</div></div>
      <button className="iconbtn" data-tour="settings-gear" onClick={() => nav('/settings')} aria-label={trouble ? t('Settings') + ', ' + t('Connection problem') : t('Settings')}><Icon name="gear" />{trouble && <span className="tab-dot" aria-hidden="true" />}</button>
    </div>
    <TrainerNotice />
  </>
  const weekCard = <>
    <div className="card">
      {/* A running programme (lib/programmes.js) wrote this week's plan: where it stands, one tap from its screen. */}
      {progChip && <button type="button" className="chip ichip prog-chip" onClick={() => nav('/plan/programmes')}><Icon name="calendar" /><span>{progChip}</span></button>}
      {/* A coach week runs by order, not by weekday, so its progress row stands in for the
          seven dots (components/QueueRow.jsx). The today row below stays as it is: the queue's
          next session reaches it through effectiveRoutineIds like any planned routine. */}
      {rotating && (queue ? <QueueRow S={S} today={todayISO()} onStart={onQueueStart} managed={managedQueue} /> : <div className="empty">
        {t('No rotation yet. Add routines to it in Plan.')}
        <div style={{ marginTop: 10 }}><Button size="sm" variant="tinted" onClick={() => nav('/plan')}>{t('Set up in Plan')}</Button></div>
      </div>)}
      {(!rotating || desktop) && <>
        {desktop ? <div className="row between wk-head">
          <h2>{wkLabel}</h2>
          <div className="row" style={{ gap: 4 }}>
            <button className="iconbtn" onClick={() => setWeekOffset(w => w - 1)} aria-label={t('Previous week')}><Icon name="chevronLeft" /></button>
            <button className="iconbtn" onClick={() => setWeekOffset(w => w + 1)} aria-label={t('Next week')}><Icon name="chevronRight" /></button>
          </div>
        </div> : <div className="row between" style={{ marginBottom: 8 }}>
          <button className="iconbtn" style={{ width: 30, height: 30, fontSize: 'var(--fs-subhead)' }} onClick={() => setWeekOffset(w => w - 1)} aria-label={t('Previous week')}><Icon name="chevronLeft" /></button>
          <div className="small muted" style={{ fontWeight: 500 }}>{wkLabel}</div>
          <button className="iconbtn" style={{ width: 30, height: 30, fontSize: 'var(--fs-subhead)' }} onClick={() => setWeekOffset(w => w + 1)} aria-label={t('Next week')}><Icon name="chevronRight" /></button>
        </div>}
        <div className="week">{strip}</div>
      </>}
      {/* The week's plan as a countdown (#753, lib/week-left.js): "2 of 4 left this week". */}
      {left && <div className={'small dim wkleft' + (left.left > 0 ? '' : ' done')}>
        {left.left > 0 ? tn('{0} of {1} left this week', '{0} of {1} left this week', left.left, left.of) : t('All done this week. Nice.')}
      </div>}
      {/* Once today's session is logged the row stops asking for it. The week strip already
          knew (its dot goes 'done'); this row did not, so a finished day kept showing the
          routine name behind a green Start tag and read as still outstanding (issue #4).
          An in-progress session still wins — that one is happening right now. Tapping the
          row keeps working, so a second session in one day is a tap away, just not urged. */}
      {splitDay ? apartSessions.map((x, i) => {
        const name = deriveSessionName(x.routines.map(r => r.name))
        return <div key={x.ids.join('+')} className="today-row today-split" data-tour={i ? undefined : 'today'} {...tappable(() => startOrPreview(x.ids))}>
          <div className="row" style={{ gap: 9, minWidth: 0 }}>
            <span className="lrow-i" style={{ background: x.done ? 'var(--surface-3)' : 'var(--acc)' }}>
              <Icon name={x.done ? 'checkCircle' : glyphOf(x.routines[0].emoji)} style={x.done ? { color: 'var(--green)' } : undefined} />
            </span>
            <div style={{ minWidth: 0 }}>
              <div className="lbl2">{t('Today')} · {t('{0} of {1}', String(i + 1), String(apartSessions.length))}</div>
              <div className="ttl">{x.done ? t('{0} (done)', name) : name}</div>
            </div>
          </div>
          {x.done ? <span className="tag" style={{ color: 'var(--green)', background: 'color-mix(in srgb,var(--green) 16%,transparent)' }}>{t('Done')}</span>
            : <span className="row" style={{ gap: 8 }}><MiniBodyMap routines={x.routines} body={S.body} /><span className="tag acc">{t('Start')}</span></span>}
        </div>
      }) : <div className="today-row" data-tour="today" {...tappable(onToday)}>
        <div className="row" style={{ gap: 9, minWidth: 0 }}>
          <span className="lrow-i" style={{ background: S.active ? 'var(--orange)' : doneToday ? 'var(--surface-3)' : routine ? 'var(--acc)' : 'var(--surface-3)',
            // the rest day's moon on the grey square: white on #e3e3e8 vanished in the light theme
            ...(!S.active && !doneToday && !routine ? { color: 'var(--label-2)' } : {}) }}>
            <Icon name={S.active ? (editingSaved ? 'pencil' : 'play') : doneToday ? 'checkCircle' : routine ? glyphOf(routine.emoji) : 'moon'}
              style={doneToday && !S.active ? { color: 'var(--green)' } : undefined} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div className="lbl2">{t('Today')}</div>
            <div className="ttl">{S.active ? (editingSaved ? S.active.name : t('{0} (in progress)', S.active.name))
              : doneToday ? (doneToday.name ? t('{0} (done)', doneToday.name) : t('Workout done'))
              : routine ? todayName : t('Rest day')}{todayOvr && routine && !doneToday ? ' · ' + t('rescheduled') : ''}</div>
            {desktop && S.active && !editingSaved && S.active.entries.length > 0 && (() => {
              const units = supersetUnits(S.active.entries)
              const at = units.indexOf(unitOf(units, S.active.cur || 0)) + 1
              return <div className="ss">{t('Exercise {0} / {1}', at, units.length)} · {t('{0} sets', setsDoneActive(S.active) + '/' + setUnitsTotal(S.active.entries))} · <Elapsed start={S.active.start} pausedAt={S.active.pausedAt} /></div>
            })()}
            {next && !doneToday && !desktop && <div className="ss">{t('Next session: {0}, {1}', t(DAYN[next.weekday]), next.routine.name)}</div>}
          </div>
        </div>
        {S.active ? <span className="tag" style={{ color: 'var(--orange-ink)', background: 'color-mix(in srgb,var(--orange) 16%,transparent)' }}>{editingSaved ? t('Edit') : t('Resume')}</span>
          : doneToday ? <span className="tag" style={{ color: 'var(--green)', background: 'color-mix(in srgb,var(--green) 16%,transparent)' }}>{t('Done')}</span>
          : routine ? <span className="row" style={{ gap: 8 }}><MiniBodyMap routines={todayRoutines} body={S.body} /><span className="tag acc">{t('Start')}</span></span>
          : <Icon name="plus" className="chev" />}
      </div>}
      {/* openNutrition's fasting window (lib/sister-nutrition.js), when this device is linked. */}
      <FastingLine />
      {/* The row above starts today's plan in one tap, and so does the Start button in the tab
          bar — which is the whole problem when you want something else. Both jump straight into
          the planned session whenever there is one, so the Start screen (a freestyle session,
          and your other routines) is only reachable on a day with nothing planned. The one other
          way in, "Choose a different workout" on the weigh-in sheet, does not exist when the
          weigh-in is switched off. This is that door, and it starts nothing on its own. */}
      {!S.active && !desktop && <div style={{ display: 'flex', justifyContent: 'center', marginTop: 4 }}>
        <Button size="sm" variant="ghost" className="dim" icon="swap" onClick={startPickerSheet}>
          {t('Choose a different workout')}
        </Button>
      </div>}
      <SeasonDeco spot="home-hero" />
    </div>

  </>
  const noticeCards = <>
    {/* Monday: Your week; the 1st: Your month (lib/recap.js). Off in Settings → Look & Home. */}
    <RecapHomeCard S={S} />

    {/* Christmas (lib/seasonal.js): the advent calendar's card, 1 to 24 December, from the theme's chunk. */}
    <SeasonDeco spot="home-advent" />

    {/* December and January: the year in openGym is ready (lib/wrapped.js homeCardYear). */}
    {on('motivation') && <WrappedHomeCard S={S} />}

    {/* What has rested and what is still recovering, kindly (lib/recovery-hint.js). Desktop has its own Recovery card. */}
    {on('health') && !desktop && <RecoveryHint S={S} />}

    {/* A deload week now or next, or a lighter week suggested (lib/deload-cycle.js). */}
    <DeloadCard S={S} />

    {/* This month's three challenges and how far you are (lib/challenges.js). */}
    <ChallengesCard S={S} />

  </>
  const checkInCard = <>
    {/* Jump to the gym check-in cards (QR membership codes). Shown here as a quick tap on
        arrival at the gym; folds away per user via the "Gym check-in" switch in Settings. */}
    {on('checkin') && (
      <div className="card tap-host checkin-card">
        <CardHead icon="qr" tint="var(--blue)" eyebrow={t('At the gym')} title={t('Check in')} open={{ onClick: () => nav('/checkin') }}
          action={<Icon name="chevronRight" className="chev" />} />
      </div>
    )}

  </>
  const welcomeCard = <>
    {!S.routines.length && !S.active && (
      <div className="card">
        <CardHead icon="calendar" title={t('Welcome!')} sub={t('Set up your weekly routine to get going, or grab a ready-made starter plan.')} />
        <Button variant="primary" icon="clipboard" onClick={starterPlanSheet}>{t('Load starter plan')}</Button>
        <div style={{ height: 8 }} /><Button onClick={() => nav('/plan')}>{t('Build my own plan')}</Button>
      </div>
    )}

  </>
  const weightCard = <>
    {/* A new profile picks how forgiving its streak is, once, right under the plan it starts with
        (components/StreakRule.jsx). */}
    {on('motivation') && S.streakRuleAsk === true && !S.streakRule && <StreakRuleWelcome />}

    {on('body') && S.showWeightCard !== false && <div className="card">
      {/* one trailing action, Log; the goal lives with the goal line and the weigh-ins below (P2) */}
      <CardHead icon="scale" tint="var(--teal)" title={t('Body weight')} className="bw-head"
        action={<Button size="sm" icon="plus" onClick={() => bwSheet()}>{t('Log')}</Button>} />
      {bw ? <>
        <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
          <div className="big">{fmtNum(bw.w)} <span className="muted" style={{ fontSize: 'var(--fs-callout)' }}>{S.unit}</span></div>
          {/* only when it actually moved — an unchanged weight used to read as "− 0" */}
          {!!delta && (
            <span className="small row" style={{ gap: 2, fontWeight: 500, color: bwDeltaColor(delta, bw.w) }}>
              <Icon name={delta > 0 ? 'arrowUp' : 'arrowDown'} style={{ fontSize: 'var(--fs-caption)' }} />
              {fmtNum(Math.abs(delta))}
            </span>
          )}
          <span className="dim small" style={{ marginInlineStart: 'auto' }}>{fmtDate(bw.d, true)}</span>
        </div>
        {S.targetW && (
          <div className="small row" style={{ color: 'var(--gold-ink)', marginTop: 4, gap: 5 }}>
            <Icon name="target" style={{ fontSize: 'var(--fs-footnote)' }} />
            <span>{t('Goal')} {fmtNum(S.targetW)} {S.unit} · {Math.abs(S.targetW - bw.w) < 0.05 ? t('reached!') : t(S.targetW > bw.w ? '{0} to gain' : '{0} to lose', fmtNum(Math.abs(S.targetW - bw.w)) + ' ' + S.unit)}</span>
          </div>
        )}
        <div className="chart" style={{ marginTop: 8 }}><LineChart points={bwPoints} h={130} unit={S.unit} goal={S.targetW} /></div>
        {/* the weekly rate and, with one set, how it sits in its corridor (#759) */}
        <WeightRate S={S} />
        {/* every weigh-in, week by week with its average (Discord 'Weight') */}
        <div className="row between" style={{ marginTop: 4 }}>
          <Button size="sm" variant="ghost" icon="target" className="bw-goal" style={S.targetW ? { color: 'var(--gold-ink)' } : undefined} onClick={goalSheet}>{S.targetW ? fmtNum(S.targetW) : t('Goal')}</Button>
          <Button size="sm" variant="ghost" trailingIcon="chevronRight" data-tour="home-weighins" onClick={weighInsSheet}>{t('All weigh-ins')}</Button>
        </div>
      </> : <>
        <div className="muted small">{S.weighIn === false
          ? t('No weigh-ins yet. Log your weight to start the curve.')
          : t("No weigh-ins yet. Log your weight to start the curve (we also ask before every workout).")}</div>
        <Button size="sm" variant="ghost" icon="target" className="bw-goal" style={{ marginTop: 6, ...(S.targetW ? { color: 'var(--gold-ink)' } : {}) }} onClick={goalSheet}>{S.targetW ? fmtNum(S.targetW) : t('Goal')}</Button>
      </>}
    </div>}

  </>
  const streakCard = <>
    {/* The streak opens its calendar from its text (CardHead open); the weekly-sets line and the
        party banner are buttons of their own beside it, not inside a card that is a button. */}
    {on('motivation') ? <div className="card tap-host streak-card">
      <SeasonDeco spot="home-streak" />
      {/* in season, a Santa hat on the flame (components/Seasonal.jsx) */}
      <CardHead className="streak-head" glyph={<span className="streak-flame-wrap"><StreakFlame lit={streak.current > 0} /><SeasonDeco spot="streak-flame" /></span>}
        title={t('{0} week streak', streak.current)} open={{ onClick: () => calendarSheet(), haspopup: 'dialog' }}
        sub={<>{doneThisWeek}{plannedPerWeek ? ' / ' + plannedPerWeek : ''} {t('this week')} · {tn('{0} workout total', '{0} workouts total', S.workouts.length)}</>}
        action={<Icon name="calendar" className="chev" style={{ fontSize: 'var(--fs-title3)' }} />} />
      {(streak.best > 0 || streak.freezes > 0) && <div className="muted small card-head-indent streak-meta-line"><StreakMeta info={streak} /></div>}
      <StreakParty S={S} info={streak} tally={tally} />
      {/* Settings → Look & Home → Weekly sets on Home (lib/muscle-targets.js): the muscle with
          the most room this week, one tap from the Stats card. */}
      {/* Straight to Stats → Lifts, where the card is, not to the top of Overview (P5 deep link). */}
      {S.homeMuscleSets === true && <WeeklySetsHomeLine S={S} onOpen={() => nav('/stats?section=lifts')} />}
    </div>
      // Motivation off: no streak card, but the weekly sets line it carried keeps a card of its own.
      : S.homeMuscleSets === true && <div className="card wsets-solo"><WeeklySetsHomeLine S={S} onOpen={() => nav('/stats?section=lifts')} /></div>}
  </>

  // A wide window (lib/use-desktop.js) lays Home out as a dashboard (index.css .home-desk): what
  // to do now with the week beside the streak, body weight beside recovery, then the year of
  // training and the last sessions. The check-in sits in the sidebar there. A phone keeps the
  // single column below, in its own order.
  if (desktop) {
    const lastW = S.workouts.at(-1)
    // Within the last week a weekday says it ("Wed"); further back, the date.
    const dayOrDate = iso => (todayISO() > iso && (new Date(todayISO()) - new Date(iso)) < 6 * 86400000
      ? t(DAYS[new Date(iso + 'T12:00:00').getDay()]) : fmtDate(iso))
    const upNext = !(rotating && !plannerQueue) ? nextTrainingDay(S, todayISO()) : null
    const yearFrom = isoOf(new Date(Date.now() - 365 * 86400000))
    const year = S.workouts.filter(w => (workoutDay(w) || '') >= yearFrom)
    const kpis = [
      [year.length, t('Workouts')],
      [fmtNum(Math.round(year.reduce((n, w) => n + workoutDuration(w), 0) / 3600000)), t('Hours')],
      [year.reduce((n, w) => n + (w.prs?.length || 0), 0), t('PRs')],
      [streak.current, t('Week streak')],
    ]
    const recent = S.workouts.slice(-6).reverse().filter(w => Array.isArray(w.entries))
    return <div className="home-desk">
      <div className="hdr">
        <SeasonDeco spot="header-bats" />
        <div><h1>{user ? t('Hi {0}', user.name) : 'openGym'}</h1><div className="sub">{today.toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' })}</div></div>
        <div className="hdr-actions">
          {!S.active && <Button icon="swap" onClick={startPickerSheet}>{t('Choose a different workout')}</Button>}
          {S.active ? <Button variant="primary" icon="play" onClick={() => nav('/workout')}>{editingSaved ? t('Edit') : t('Resume')} · {S.active.name}</Button>
            : routine && !doneToday && <Button variant="primary" icon="play" onClick={onToday}>{t('Start')} · {todayName}</Button>}
        </div>
      </div>
      <TrainerNotice />
      {noticeCards}
      {welcomeCard}
      <div className="home-cols">
        {weekCard}
        {on('motivation') ? <div className="card dk-streak">
          <SeasonDeco spot="home-streak" />
          <div className="dk-streak-t"><StreakFlame lit={streak.current > 0} />{t('{0} week streak', streak.current)}</div>
          <div className="muted small">{doneThisWeek}{plannedPerWeek ? ' / ' + plannedPerWeek : ''} {t('this week')} · {tn('{0} workout total', '{0} workouts total', S.workouts.length)}</div>
          {(streak.best > 0 || streak.freezes > 0) && <div className="muted small streak-meta-line"><StreakMeta info={streak} /></div>}
          {plannedPerWeek > 0 && <div className="dk-bar"><i style={{ width: Math.min(100, doneThisWeek / plannedPerWeek * 100) + '%' }} /></div>}
          <StreakParty S={S} info={streak} tally={tally} />
          <div className="dk-kv">
            {upNext && <div className="row between"><span className="muted">{t('Next session')}</span><b>{t(DAYS[upNext.weekday])} · {upNext.routine.name}</b></div>}
            {lastW && <div className="row between"><span className="muted">{t('Last workout')}</span><span>{dayOrDate(lastW.d)} · {lastW.name}</span></div>}
          </div>
          {S.homeMuscleSets === true && <WeeklySetsHomeLine S={S} onOpen={() => nav('/stats?section=lifts')} />}
          <Button size="sm" icon="calendar" onClick={() => calendarSheet()}>{t('Calendar')}</Button>
        </div> : <div className="dk-side">
          {S.homeMuscleSets === true && <div className="card wsets-solo"><WeeklySetsHomeLine S={S} onOpen={() => nav('/stats?section=lifts')} /></div>}
        </div>}
        {weightCard}
        {recovery && <div className="card">
          <div className="row between"><h2 style={{ margin: 0 }}>{t('Recovery')}</h2>
            <Button size="sm" variant="ghost" trailingIcon="chevronRight" onClick={() => nav('/stats')}>{t('Open')}</Button></div>
          <div className="muted small" style={{ margin: '2px 0 8px' }}>{t('Fatigue shows how recently each muscle was trained. High means rest.')}</div>
          {recovery.map(([m, v]) => <div key={m} className={'dk-rec ' + fatigueStateOf(v)}>
            <span>{t(MUSCLE_NAME[m])}</span>
            <div className="dk-bar"><i style={{ width: Math.min(100, v * 100) + '%' }} /></div>
            <span className="tag nocap">{fatigueLabel(v)}</span>
          </div>)}
        </div>}
      </div>
      {S.workouts.length > 0 && <div className="card">
        <h2>{t('Activity (last 12 months)')}</h2>
        <div className="dk-kpis">{kpis.map(([v, l]) => <div key={l}><b>{v}</b><span>{l}</span></div>)}</div>
        <Heatmap S={S}
          metric={S.heatmapMetric === 'vol' ? 'vol' : 'time'}
          onMetricChange={metric => useStore.getState().update(s => { s.heatmapMetric = metric })}
          onDay={iso => calendarSheet(iso)} />
      </div>}
      {recent.length > 0 && <div className="card dk-recent">
        <div className="row between"><h2 style={{ margin: 0 }}>{t('Recent workouts')}</h2>
          <Button size="sm" variant="ghost" trailingIcon="chevronRight" onClick={() => nav('/history')}>{t('Progress & history')}</Button></div>
        <div className="dk-tr dk-th" aria-hidden="true"><span>{t('Workout')}</span><span>{t('Date')}</span><span className="num">{t('Duration')}</span><span className="num">{t('Sets')}</span><span className="num">{t('Volume')}</span><span className="num">{t('PRs')}</span></div>
        {recent.map(w => <button key={w.id} className="dk-tr" onClick={() => workoutDetailSheet(w)}>
          <b>{w.name}</b>
          <span className="muted">{fmtDate(w.d, true)}</span>
          <span className="num muted">{durPart(workoutDuration(w))[0] || '–'}</span>
          <span className="num">{setsDone(w)}</span>
          <span className="num"><b>{fmtVol(w.vol ?? workoutVolume(w), S.unit)}</b></span>
          <span className="num">{w.prs?.length ? <span className="tag nocap" style={{ color: 'var(--yellow)' }}>{w.prs.length}</span> : ''}</span>
        </button>)}
      </div>}
    </div>
  }

  return <div className="narrow">
    {header}
    {weekCard}
    {noticeCards}
    {checkInCard}
    {welcomeCard}
    {weightCard}
    {streakCard}
  </div>
}
