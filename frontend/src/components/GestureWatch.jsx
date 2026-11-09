// The picture at the top of Settings → Apple Watch → Gestures: a watch (an Ultra with its orange
// button on the Action Button tab) whose screen plays what the chosen action does, in CSS only
// (transform and opacity). Reduce Motion, the system's or the app's, holds one still frame with a
// Before / After switch instead. The faces are drawn after the watch app's own screens
// (ios/App/Watch: SetPage, RestHold); the words on them are the watch's own, so they are translated.
import { useState } from 'react'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'

const TIME = '9:41'
const mmss = s => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')

const Top = ({ title }) => <div className="gw-top"><b>{title}</b><span>{TIME}</span></div>

// `tgt`: the control the system lights up before the action.
function SetFace({ name, n, kg, reps, tgt }) {
  return <div className="gw-in">
    <Top title={name} />
    <div className="gw-sub">{t('Set {0} of {1}', n, 4)}</div>
    <div className="gw-nums"><div><b>{kg}</b><i>kg</i></div><div><b>{reps}</b><i>{t('reps')}</i></div></div>
    <div className={'gw-btn pri' + (tgt ? ' tgt' : '')}>{t('Done')}</div>
  </div>
}

function Ring({ sec, total }) {
  const c = 2 * Math.PI * 34
  return <div className="gw-ring">
    <svg viewBox="0 0 80 80" aria-hidden="true"><circle className="rt" cx="40" cy="40" r="34" />
      <circle className="rp" cx="40" cy="40" r="34" strokeDasharray={c.toFixed(1)} strokeDashoffset={(c * (1 - sec / total)).toFixed(1)} transform="rotate(-90 40 40)" /></svg>
    <b>{mmss(sec)}</b>
  </div>
}

function RestFace({ sec, tgt }) {
  return <div className="gw-in">
    <Top title={t('Rest')} />
    <Ring sec={sec} total={90} />
    <div className="gw-row"><div className="gw-btn sm">-15</div>
      <div className={'gw-btn pri sm' + (tgt === 'skip' ? ' tgt' : '')}>{t('Skip')}</div>
      <div className={'gw-btn sm' + (tgt === 'add' ? ' tgt' : '')}>+15</div></div>
  </div>
}

function HoldFace({ sec, run }) {
  return <div className="gw-in">
    <Top title={t('Plank')} />
    <Ring sec={sec} total={30} />
    <div className={'gw-btn pri' + (run ? '' : ' tgt')}>{run ? t('Stop') : t('Start')}</div>
  </div>
}

function DoneFace() {
  return <div className="gw-in">
    <Top title={t('Bench press')} />
    <div className="gw-tick"><Icon name="check" /></div>
    <div className="gw-ttl">{t('All sets done')}</div>
    <div className="gw-btn pri tgt">{t('Next')}</div>
  </div>
}

function MetricsFace() {
  return <div className="gw-in">
    <Top title={t('Metrics')} />
    <div className="gw-big">142</div>
    <div className="gw-ttl">{t('Heart rate')}</div>
  </div>
}

// Two frames per action: before, and after the press. Smart plays a set, then a rest.
const bench = tgt => <SetFace name={t('Bench press')} n={3} kg={80} reps={8} tgt={tgt} />
// A function, not a constant: the words follow the app's language when it changes.
const framesFor = action => ({
  smart: [bench(true), <RestFace sec={90} tgt="skip" />],
  logSet: [bench(true), <RestFace sec={90} />],
  skipRest: [<RestFace sec={42} tgt="skip" />, <SetFace name={t('Bench press')} n={4} kg={80} reps={8} />],
  addRest: [<RestFace sec={42} tgt="add" />, <RestFace sec={57} />],
  hold: [<HoldFace sec={0} />, <HoldFace sec={12} run />],
  nextExercise: [<DoneFace />, <SetFace name={t('Barbell row')} n={1} kg={60} reps={10} />],
  showMetrics: [bench(false), <MetricsFace />],
  none: [],   // the screen shows only its message
})[action] || [bench(false)]

const Haptic = ({ side }) => <svg className={'gw-hap ' + side} viewBox="0 0 16 60" aria-hidden="true">
  <path d={side === 'l' ? 'M12 6C6 18 6 42 12 54' : 'M4 6c6 12 6 36 0 48'} /></svg>

/**
 * `input`: 'doubleTap' | 'actionButton'. `action`: a GESTURE_ACTIONS id. `say`: what a screen
 * reader hears for the picture (the page words it, as it knows the action's name).
 */
export default function GestureWatch({ input, action, say }) {
  const [after, setAfter] = useState(false)
  const ab = input === 'actionButton'
  const off = action === 'none'
  const frames = framesFor(action)
  return <>
    <div className={'gw-hero ' + (ab ? 'ab' : 'dt') + (off ? ' off' : '')}>
      <div className={'gw-stage' + (ab ? ' ultra' : '')} role="img" aria-label={say}>
        <div className="gw-strap t" /><div className="gw-strap b" />
        <div className="gw-case">
          <i className="gw-guard" /><i className="gw-crown" /><i className="gw-side" /><i className="gw-abtn" />
          <div className="gw-screen">
            {/* keyed: a new action starts its loop from the first frame */}
            <div key={input + action} className={'gw-face' + (action === 'smart' ? ' smart' : '') + (after ? ' b' : '')}>
              {frames.map((f, i) => <div key={i} className={'gw-fr ' + (i ? 'fb' + (action === 'nextExercise' || action === 'showMetrics' ? ' sl' : '') : 'fa')}>{f}</div>)}
              {off && <div className="gw-offmsg">{t('Do nothing')}</div>}
            </div>
          </div>
          {!off && <><Haptic side="l" /><Haptic side="r" /></>}
          {!ab && !off && <i className="gw-rip" />}
        </div>
      </div>
      <div className="gw-tag">{ab ? t('Action Button') : <><Icon name="pinch" />{t('Pinch twice')}</>}</div>
    </div>
    <div className="gw-ba" role="group" aria-label={t('Preview')}>
      <button aria-pressed={!after} onClick={() => setAfter(false)}>{t('Before')}</button>
      <button aria-pressed={after} onClick={() => setAfter(true)}>{t('After')}</button>
    </div>
  </>
}
