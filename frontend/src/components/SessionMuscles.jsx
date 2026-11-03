import { useMemo, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { fmtNum } from '../lib/format.js'
import { isWarmupRow } from '../lib/workout-model.js'
import { sessionLoad, sessionLevels, MUSCLES, MUSCLE_NAME } from '../lib/muscles.js'
import BodyMap from './BodyMap.jsx'
import { Button } from './ui.jsx'

// What the running session hits (#670): a tiny body in the workout header that lights up as sets
// are ticked, and a sheet behind it with the full map and done/planned sets per muscle. The
// header re-renders on every keystroke in a set row, so the load is worked out again only when
// the exercises or their ticks change, not when a weight is typed.
const tickKey = entries => (entries || []).map(e =>
  e.id + ':' + (e.sets || []).map(s => (isWarmupRow(s) ? 'w' : s.done ? '1' : '0')).join('')).join('|')

export function useSessionLoad(entries) {
  const key = tickKey(entries)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => sessionLoad(entries), [key])
}

const any = load => MUSCLES.some(m => (load[m] || 0) > 0)

/** The header button. Nothing at all until the session has a working set to show. */
export function SessionMapButton({ entries, body }) {
  const load = useSessionLoad(entries)
  const levels = useMemo(() => sessionLevels(load), [load])
  if (!any(load.planned)) return null
  return <button type="button" className="iconbtn whdr-map" data-session-map aria-label={t('What this session hits')}
    title={t('What this session hits')} onClick={sessionMusclesSheet}>
    <BodyMap className="bm-mini bm-session" levels={levels} body={body} />
  </button>
}

// A secondary muscle counts as part of a set (bench is 0.4 of a set for the shoulders), which is
// right for the bar but reads odd as "1/11.2". The numbers say whole sets; a little that would
// round to nothing says "<1", so a muscle on the list never reads as 0 planned.
const sets = v => (v > 0 && v < 0.5 ? '<1' : fmtNum(Math.round(v)))
const ROWS = 6

// The sheet reads the live session itself, so a set ticked behind it (the watch, another tab)
// shows up while it is open.
export function SessionMuscles({ close }) {
  const entries = useStore(s => s.S.active?.entries)
  const body = useStore(s => s.S.body)
  const load = useSessionLoad(entries)
  const levels = useMemo(() => sessionLevels(load), [load])
  const [all, setAll] = useState(false)
  const { done, planned } = load
  const muscles = MUSCLES.filter(m => (planned[m] || 0) > 0)
    .sort((a, b) => (done[b] || 0) - (done[a] || 0) || planned[b] - planned[a] || MUSCLES.indexOf(a) - MUSCLES.indexOf(b))
  return <div className="sm-sheet">
    <div className="row between" style={{ marginBottom: 8 }}>
      <h3 style={{ margin: 0 }}>{t('What this session hits')}</h3>
      <Button size="sm" variant="ghost" onClick={close}>{t('Done')}</Button>
    </div>
    <BodyMap className="bm-session" levels={levels} body={body} />
    <div className="hm-legend sm-legend">
      <span className="hm-c l4" />{t('Already worked')}<span className="hm-c l1" />{t('Still to come')}
    </div>
    {(all ? muscles : muscles.slice(0, ROWS)).map(m => {
      const d = done[m] || 0
      const p = planned[m]
      return <div className="mrow" key={m} data-muscle-session={m}>
        <span className="nm">{t(MUSCLE_NAME[m])}</span>
        <span className="bar"><i style={{ width: Math.round(Math.min(d / p, 1) * 100) + '%' }} /></span>
        <span className="v sess" aria-label={`${t('Completed')} ${t('{0} sets', sets(d))} · ${t('Planned')} ${t('{0} sets', sets(p))}`}>
          {sets(d)}/{sets(p)}
        </span>
      </div>
    })}
    {muscles.length > ROWS && <>
      <div style={{ height: 8 }} />
      <Button trailingIcon={all ? 'chevronUp' : 'chevronDown'} aria-expanded={all} onClick={() => setAll(v => !v)}>
        {t(all ? 'Show less' : 'Show more')}
      </Button>
    </>}
  </div>
}

/** Opens the session's muscle sheet from the workout header. */
export function sessionMusclesSheet() {
  return useUI.getState().openSheet(close => <SessionMuscles close={close} />)
}
