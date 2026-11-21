import { useMemo, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, tn, exerciseNameFor, exerciseNameClass, dateLocale } from '../lib/i18n.js'
import { uid } from '../lib/format.js'
import { exOr } from '../lib/exercises.js'
import { MUSCLE_NAME } from '../lib/muscles.js'
import { groupOfTerm, groupTerm, toggleTerm, MUSCLE_GROUPS } from '../lib/muscle-filter.js'
import { buildSession, swapPick, addPick, sessionRoutine, estimateMinutes, DURATIONS } from '../lib/session-builder.js'
import { gymsOf, gymLabel, switchGym } from '../lib/gym-inventory.js'
import { startBuiltSession, exerciseDetailSheet, exercisePicker } from '../sheets.jsx'
import { nav } from '../lib/nav.js'
import { Thumb } from './Media.jsx'
import Icon from './Icon.jsx'
import { Button, Segmented } from './ui.jsx'
import { isoRun } from '../lib/bidi.js'

/* Tap muscles, get a session (lib/session-builder.js). Opened from Exercises → By muscle once a
   muscle or a group is picked: how long you have, the session it makes with a line on why each
   exercise is there, one exercise swapped or the whole thing shuffled, then Start or Save as
   routine. It reads the active gym, the bench, your own kit and what is still recovering. */

const termName = term => { const g = groupOfTerm(term); return g ? t(g.name) : t(MUSCLE_NAME[term] || term) }
const whyLine = why => why.map(w => (w[0] === 'A classic for {0}' ? t(w[0], t(w[1])) : t(...w))).join(' · ')
const amount = c => isoRun(
  c.min > 0 ? t('{0} min', c.min)
    : c.mode === 'time' ? `${c.sets} × ${c.sec} s`
      : c.mode === 'distance' ? `${c.sets} × ${c.m} m`
        : `${c.sets} × ${c.reps}`)

export function SessionBuilder ({ terms: initial, close }) {
  const [terms, setTerms] = useState(initial)
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const [minutes, setMinutes] = useState(40)
  const [seed, setSeed] = useState(1)
  const [swaps, setSwaps] = useState([])   // [exercise id, seed] swaps, [exercise id, null] removals and [exercise id, 'add'] additions, in order, replayed over the base
  const session = useMemo(() => {
    let out = buildSession(S, { terms, minutes, seed })
    // Every exercise a slot has already shown stays out of it, so repeated taps walk on
    // through the alternatives instead of flipping between two; a removed one stays out of all.
    const seen = out.picks.map(() => [])
    const gone = []
    // An edit names the exercise it was made on, so one whose exercise is no longer in the
    // session (the base moved under it) is dropped instead of landing on a neighbour.
    for (const [id, sd] of swaps) {
      if (sd === 'add') {
        out = addPick(S, out, exOr(id))
        seen.push([])
        continue
      }
      const i = out.picks.findIndex(p => p.id === id)
      if (i < 0) continue
      if (sd === null) {
        gone.push(id)
        const picks = out.picks.filter((_, k) => k !== i)
        seen.splice(i, 1)
        out = { ...out, picks, minutes: estimateMinutes(picks.map(x => x.cfg)) }
        continue
      }
      seen[i].push(id)
      out = swapPick(S, out, i, { seed: sd, exclude: [...seen[i], ...gone] })
    }
    return out
  }, [S.workouts, S.equipProfiles, S.activeEquipId, S.equipFilterOn, S.bench, S.dumbbells, S.customEx, S.favEx, terms, minutes, seed, swaps]) // eslint-disable-line react-hooks/exhaustive-deps
  const title = terms.map(termName).join(' + ')
  const shuffle = () => { setSwaps([]); setSeed(x => x + 1) }
  const swapOne = i => setSwaps(list => [...list, [session.picks[i].id, seed * 31 + list.length + 7]])
  const addOne = () => {
    const sheet = exercisePicker(ex => { sheet.close(); setSwaps(list => [...list, [ex.id, 'add']]) }, { title: t('Add exercise') })
  }
  // The focus: tap a group to add it or take it off; the last one stays.
  const toggleFocus = term => { const next = toggleTerm(terms, term); if (next.length) { setSwaps([]); setTerms(next) } }
  const focusTerms = [...MUSCLE_GROUPS.map(g => groupTerm(g.id)), ...terms.filter(x => !groupOfTerm(x))]
  const removeOne = i => setSwaps(list => [...list, [session.picks[i].id, null]])
  const start = () => startBuiltSession(session.picks.map(p => p.cfg), title, close)
  const save = () => {
    const r = sessionRoutine(session, { id: uid(), name: title })
    update(s => { s.routines.push(r) })
    close()
    useUI.getState().toast(t('Saved as “{0}”.', r.name))
    nav('/plan/r/' + r.id)
  }
  const empty = !session.picks.length
  // Two or more gyms: say where you are right here. Picking one makes it the active gym and turns
  // the equipment filter on, so the session is built from what that place has.
  const gyms = gymsOf(S)
  const gymId = S.equipFilterOn ? S.activeEquipId : ''
  const pickGym = id => { setSwaps([]); update(s => { switchGym(s, id); s.equipFilterOn = true }) }
  return <div className="sb" data-session-builder>
    <h3 style={{ marginBottom: 2 }}>{t('Session for {0}', title)}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>
      {session.profileName ? t('Built from what “{0}” has.', session.profileName) : t('Built from the whole library. Pick a gym in Settings to narrow it.')}
    </div>
    {gyms.length > 1 && <div style={{ marginBottom: 10 }}>
      <Segmented value={gymId || ''} onChange={pickGym} options={gyms.map(g => ({ value: g.id, label: gymLabel(g) }))} />
    </div>}
    <div className="chips" style={{ flexWrap: 'wrap', overflow: 'visible', marginBottom: 10 }} role="group" aria-label={t('Focus')}>
      {focusTerms.map(x => <button key={x} type="button" className={'chip' + (terms.includes(x) ? ' on' : '')} aria-pressed={terms.includes(x)} onClick={() => toggleFocus(x)}>{termName(x)}</button>)}
    </div>
    <Segmented value={String(minutes)} onChange={v => { setSwaps([]); setMinutes(Number(v)) }}
      options={DURATIONS.map(m => ({ value: String(m), label: t('{0} min', m) }))} />
    {session.tired.length > 0 && <div className="sb-note small" data-sb-tired>
      <Icon name="figureStrength" />
      <span>{tn('{1} is still recovering, so it sits this one out.', '{1} are still recovering, so they sit this one out.', session.tired.length, new Intl.ListFormat(dateLocale(), { type: 'conjunction' }).format(session.tired.map(m => t(MUSCLE_NAME[m]))))}</span>
    </div>}
    {session.allTired && <div className="sb-note small" data-sb-alltired>
      <Icon name="info" /><span>{t('Everything you picked is still recovering. Here it is anyway, go easy.')}</span>
    </div>}
    {empty
      ? <div className="empty" style={{ marginTop: 14 }}><div className="ico"><Icon name="kettlebell" /></div>{t('Nothing here trains that with the equipment you have. Try another muscle or Show all equipment.')}</div>
      : <div className="list sb-list" style={{ marginTop: 14 }}>
        {session.picks.map((p, i) => {
          const ex = exOr(p.id)
          return <div key={p.id + ':' + i} className="item sb-item tap-host">
            <Thumb ex={ex} />
            <button type="button" className="grow item-open tap-main" onClick={() => exerciseDetailSheet(ex)}>
              <span className={'tt ' + exerciseNameClass(ex)}>{exerciseNameFor(ex)}</span>
              <span className="ss">{amount(p.cfg)}{p.why.length ? ' · ' + whyLine(p.why) : ''}</span>
            </button>
            <button type="button" className="iconbtn" aria-label={t('Swap {0}', exerciseNameFor(ex))} title={t('Swap')} onClick={() => swapOne(i)}><Icon name="swap" /></button>
            <button type="button" className="iconbtn" aria-label={t('Remove {0}', exerciseNameFor(ex))} title={t('Remove')} onClick={() => removeOne(i)}><Icon name="xmark" /></button>
          </div>
        })}
      </div>}
    <Button variant="tinted" icon="plus" onClick={addOne}>{t('Add exercise')}</Button>
    {!empty && <div className="small muted sb-total">{t('About {0} min, {1}.', session.minutes, tn('{0} exercise', '{0} exercises', session.picks.length))}</div>}
    <div className="sb-actions">
      <Button variant="primary" icon="play" disabled={empty} onClick={start}>{t('Start workout')}</Button>
      <div className="sb-actions-2">
        <Button variant="tinted" icon="shuffle" onClick={shuffle}>{t('Shuffle')}</Button>
        <Button variant="tinted" icon="clipboard" disabled={empty} onClick={save}>{t('Save as routine')}</Button>
      </div>
    </div>
  </div>
}

export const sessionBuilderSheet = terms => useUI.getState().openSheet(close => <SessionBuilder terms={terms} close={close} />)
