import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { effortOf, fmtSec } from '../lib/history.js'
import { GET_READY_SEC, getReadyOf, runsFlows } from '../lib/blocks.js'
import { workoutControls } from '../lib/workout-controls.js'
import { unlock, vibrateSupported, appleTouchDevice } from '../lib/sound.js'
import { wakeLockSupported } from '../lib/wakelock.js'
import { MOBILE } from '../lib/mobile.js'
import { closeThenNav } from '../lib/nav.js'
import { REST_MAX, fmtRest } from '../lib/duration.js'
import { durationSheet } from './DurationWheel.jsx'
import { Section, Row, Switch, Segmented, Button } from './ui.jsx'

// The settings people touch at the gym, without leaving the workout (v1.3.11, opened from the
// workout's ⋯ → Workout settings). Every row writes the same S.* field as Settings → Workout and
// Settings → Timer alerts, so a change here sticks for the next session too; nothing in it is
// for this session only. The one exception to "same as Settings" is Layout: the running session
// may carry its own layout from the ⋯ menu (S.active.workoutView), and choosing one here clears
// that, or the saved choice would not show until the next workout.
export function WorkoutSettings({ close }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const canVibrate = vibrateSupported()
  const iPhone = appleTouchDevice()
  const wakeOK = wakeLockSupported()
  const layout = ['list', 'compact'].includes(S.active?.workoutView || S.workoutView) ? (S.active?.workoutView || S.workoutView) : 'cards'
  const gif = S.gifSize === 'mini' || S.gifSize === 'off' ? S.gifSize : 'full'
  const allSettings = () => closeThenNav(close, '/settings/workout')
  return <div className="ws-sheet">
    <div className="row between" style={{ marginBottom: 2 }}>
      <h3 style={{ margin: 0 }}>{t('Workout settings')}</h3>
      <Button size="sm" variant="ghost" onClick={close}>{t('Done')}</Button>
    </div>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Changes stick for your next workouts too.')}</div>
    <Section>
      <Row icon="timer" iconTint="var(--orange)" title={t('Rest timer')} value={fmtRest(S.restSec)} accessory="chevron"
        onClick={() => durationSheet({
          title: t('Rest timer'), value: S.restSec, max: REST_MAX, off: t('Off'),
          footer: t('Scroll to 0:00 to turn the rest timer off.'),
          onDone: v => update(s => { s.restSec = v }),
        })} />
      {/* The count before each hold of a warm-up or cool-down that runs itself (Settings → Workout →
          Fine-tuning, the same field). It is the one people reach for mid-workout, the first
          time a stretch on the floor starts before they are down on the mat; a change here
          applies from the next hold. Only in a live session: editing a saved workout or logging a
          past one, no block runs itself (lib/blocks.js runsFlows), so there is nothing to
          count in. */}
      {runsFlows(S.active) && <Row icon="timer" iconTint="var(--orange)" title={t('Get ready before each hold')}
        subtitle={t('Warm-ups and cool-downs that run themselves count down before each hold, so you can get into position.')}>
        <Segmented className="seg-inline"
          options={[{ value: 0, label: t('Off') }, ...GET_READY_SEC.map(n => ({ value: n, label: fmtSec(n) }))]}
          value={getReadyOf(S)} onChange={v => update(s => { s.flowGetReady = v })} />
      </Row>}
      <Row icon="speaker" iconTint="var(--pink)" title={t('Play a sound')}>
        {/* A tap: unlock the audio now so a rest ending before the next tick can sound (iOS, #152).
            A rest or hold already running had its count-in queued when it started: queue it again,
            or call it off (useUI.restartCountdown). */}
        <Switch checked={!!S.sound} onChange={v => { if (v) unlock(true); update(s => { s.sound = v }); useUI.getState().restartCountdown() }} />
      </Row>
      <Row icon="vibrate" iconTint="var(--indigo)" title={t('Vibrate')} className={canVibrate ? '' : 'dis'}
        subtitle={canVibrate ? null : iPhone ? t('Not on iPhone') : t('Not supported in this browser.')}>
        <Switch checked={canVibrate && S.vibrate !== false} disabled={!canVibrate} onChange={v => update(s => { s.vibrate = v })} />
      </Row>
      <Row icon="sun" iconTint="var(--yellow)" title={t('Flash the screen')}>
        <Switch checked={!!S.timerFlash} onChange={v => update(s => { s.timerFlash = v })} />
      </Row>
      {(wakeOK || !MOBILE) && <Row icon="phoneScreen" iconTint="var(--yellow)" title={t('Keep screen awake')}
        subtitle={wakeOK ? t('The screen stays on while a workout is running, so you don’t have to unlock your phone between sets.') : t('Not supported in this browser.')}>
        <Switch checked={wakeOK && S.keepAwake !== false} disabled={!wakeOK} onChange={v => update(s => { s.keepAwake = v })} />
      </Row>}
    </Section>
    <Section>
      <Row icon="layout" iconTint="var(--blue)" title={t('Layout')}>
        <Segmented className="seg-inline"
          options={[{ value: 'cards', label: t('Cards') }, { value: 'list', label: t('List') }, { value: 'compact', label: t('Compact') }]}
          value={layout} onChange={v => update(s => { s.workoutView = v; if (s.active) delete s.active.workoutView })} />
      </Row>
      <Row icon="gauge" iconTint="var(--purple)" title={t('Effort per set')}>
        <Segmented className="seg-inline"
          options={[{ value: 'none', label: t('Off') }, { value: 'rir', label: t('RIR') }, { value: 'rpe', label: t('RPE') }]}
          value={effortOf(S)} onChange={v => update(s => { s.effort = v; delete s.showRir })} />
      </Row>
      <Row icon="swap" iconTint="var(--indigo)" title={t('Swipe actions')} subtitle={t('Sets, routines and the loop: left removes, right copies')}>
        <Switch aria-label={t('Swipe actions')} checked={workoutControls(S).swipeSets}
          onChange={v => update(s => { s.wc = { ...workoutControls(s), swipeSets: v } })} />
      </Row>
      <Row icon="image" iconTint="var(--teal)" title={t('Exercise animations')}>
        <Segmented className="seg-inline"
          options={[{ value: 'full', label: t('Full') }, { value: 'mini', label: t('Small') }, { value: 'off', label: t('Hidden') }]}
          value={gif} onChange={v => update(s => { s.gifSize = v })} />
      </Row>
    </Section>
    <Section>
      <Row icon="gear" iconTint="var(--grey)" title={t('All settings')} accessory="chevron" onClick={allSettings} />
    </Section>
  </div>
}

/** Opens the in-workout settings sheet. */
export function workoutSettingsSheet() {
  return useUI.getState().openSheet(close => <WorkoutSettings close={close} />)
}
