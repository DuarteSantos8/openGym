import { useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, exerciseNameFor, exerciseNameClass } from '../lib/i18n.js'
import { nameIn, said } from '../lib/a11y-name.js'
import { uid, exerciseNameText } from '../lib/format.js'
import { exOr } from '../lib/exercises.js'
import { allLadders, reachedRung, saveLadder, deleteLadder, STEPS_MAX, NAME_MAX } from '../lib/ladders.js'
import { LADDER_TOP, LADDER_BOTTOM } from '../lib/progression.js'
import { exerciseDetailSheet, exercisePicker, confirmSheet } from '../sheets.jsx'
import { DEFAULT_GLYPH } from '../lib/glyphs.js'
import RoutineTile from './RoutineTile.jsx'
import Icon from './Icon.jsx'
import { activeRoutines } from '../lib/routine-folders.js'
import { Button, TextField } from './ui.jsx'

/* Skill ladders (lib/ladders.js): bodyweight chains from easier to harder. Exercises → Ladders
   lists each one with the rungs you reached, and Train it puts the next rung into a routine on
   the Skill ladder rule (lib/progression.js), which names the rung after it once every set hits
   the top. Your own chains are made and edited here too. */

// The built-in chains' names, here inside t() so every language has them (check-source-strings).
const NAME = {
  'push-up': () => t('Push-up ladder'),
  'pull-up': () => t('Pull-up ladder'),
  dip: () => t('Dip ladder'),
  squat: () => t('Single-leg squat ladder'),
  hinge: () => t('Hinge ladder'),
  core: () => t('Core ladder'),
  handstand: () => t('Handstand ladder'),
}
export const ladderName = l => (l.own ? l.name : NAME[l.id]?.() || l.id)

/** A rung as it starts in a routine: three sets climbing from 5 to 12 reps on the ladder rule. */
export const rungEntry = id => ({ id, sets: 3, reps: LADDER_TOP, repsMin: LADDER_BOTTOM, weight: 0, mode: 'reps', bodyweight: true, prog: 'ladder' })

function TrainIt ({ ladder, rung, close }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const id = ladder.steps[rung]
  const ex = exOr(id)
  const put = rid => {
    let name = ''
    update(s => {
      let r = rid === '_new' ? null : s.routines.find(x => x.id === rid)
      if (!r) { r = { id: uid(), name: ladderName(ladder), emoji: DEFAULT_GLYPH, ex: [] }; s.routines.push(r) }
      // A rung of this ladder already in the routine moves up instead of a second one joining.
      const at = r.ex.findIndex(e => ladder.steps.includes(e.id))
      if (at >= 0) r.ex[at] = { ...r.ex[at], ...rungEntry(id), sets: r.ex[at].sets || 3 }
      else r.ex.push(rungEntry(id))
      name = r.name
    })
    close()
    useUI.getState().toast(t('{0} is in {1}, on the Skill ladder rule.', exerciseNameText(ex), name))
  }
  return <>
    <h3 className={exerciseNameClass(ex)}>{t('Train {0}', exerciseNameFor(ex))}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Three sets, from {0} up to {1} reps. Every set at {1} and the next rung is yours.', LADDER_BOTTOM, LADDER_TOP)}</div>
    <div className="list">
      {activeRoutines(S).map(r => <button type="button" key={r.id} className="item" onClick={() => put(r.id)}>
        <RoutineTile r={r} />
        <span className="grow"><span className="tt">{r.name}</span></span>
        {r.ex.some(e => ladder.steps.includes(e.id)) && <span className="tag">{t('moves up')}</span>}
        <Icon name="plus" className="chev" />
      </button>)}
      <button type="button" className="item" onClick={() => put('_new')}>
        <span className="lrow-i" style={{ background: 'var(--surface-3)' }}><Icon name="plusCircle" /></span>
        <span className="grow"><span className="tt">{t('New routine')}</span></span><Icon name="plus" className="chev" />
      </button>
    </div>
  </>
}

function LadderCard ({ S, ladder, onEdit }) {
  const top = reachedRung(S, ladder)
  const next = Math.min(ladder.steps.length - 1, top + 1)
  const ui = useUI.getState()
  return <div className="card ladder-card" data-ladder={ladder.id}>
    <div className="row between" style={{ alignItems: 'baseline', gap: 8 }}>
      <h3 style={{ margin: 0 }}>{ladderName(ladder)}</h3>
      <span className="small muted">{top < 0 ? t('Not started') : top >= ladder.steps.length - 1 ? t('Top rung reached') : t('Rung {0} of {1}', top + 1, ladder.steps.length)}</span>
    </div>
    <ol className="ladder-steps" aria-label={ladderName(ladder)}>
      {ladder.steps.map((id, i) => {
        const ex = exOr(id)
        const state = i <= top ? 'done' : i === next ? 'next' : 'todo'
        return <li key={id} className={'ladder-step is-' + state}>
          <button type="button" onClick={() => exerciseDetailSheet(ex)}>
            <span className="ladder-dot" aria-hidden="true">{state === 'done' ? <Icon name="check" /> : null}</span>
            <span className={'ladder-n ' + exerciseNameClass(ex)}>{exerciseNameFor(ex)}</span>
            {state === 'next' && <span className="ladder-tag">{top < 0 ? t('Start here') : t('Next up')}</span>}
          </button>
        </li>
      })}
    </ol>
    <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
      <Button size="sm" variant="tinted" icon="plus" aria-label={nameIn(ladderName(ladder), t('Train it'))} onClick={() => ui.openSheet(close => <TrainIt ladder={ladder} rung={next} close={close} />)}>{t('Train it')}</Button>
      {ladder.own && <Button size="sm" variant="ghost" aria-label={nameIn(ladderName(ladder), t('Edit'))} onClick={() => onEdit(ladder)}>{t('Edit')}</Button>}
    </div>
  </div>
}

/** Make or edit one of your own chains: a name and the rungs, easiest first. */
export function LadderEditor ({ ladder, close }) {
  const update = useStore(s => s.update)
  const nameRef = useRef(null)
  const [steps, setSteps] = useState(ladder?.steps || [])
  const move = (i, d) => setSteps(list => { const n = [...list]; const j = i + d; if (j < 0 || j >= n.length) return n; [n[i], n[j]] = [n[j], n[i]]; return n })
  const add = () => exercisePicker(ex => setSteps(list => (list.includes(ex.id) || list.length >= STEPS_MAX ? list : [...list, ex.id])), { title: t('Add a rung') })
  const save = () => {
    const name = (nameRef.current?.value || '').trim() || t('My ladder')
    let ok = null
    update(s => { ok = saveLadder(s, { id: ladder?.id, name, steps }) })
    if (!ok) { useUI.getState().toast(t('A ladder needs at least two rungs.')); return }
    close()
    useUI.getState().toast(t('Saved “{0}”.', name))
  }
  const remove = () => confirmSheet({
    title: t('Delete “{0}”?', ladder.name), message: t('The exercises and your history stay. Only the ladder goes.'),
    confirmText: t('Delete'), danger: true,
    onConfirm: () => { update(s => { deleteLadder(s, ladder.id) }); close() },
  })
  return <div className="ladder-edit">
    <h3>{ladder ? t('Edit ladder') : t('New ladder')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Easiest first. The Skill ladder rule moves you one rung up when every set hits the top.')}</div>
    <TextField ref={nameRef} defaultValue={ladder?.name || ''} placeholder={t('Ladder name')} maxLength={NAME_MAX} aria-label={t('Ladder name')} />
    <ol className="list ladder-edit-list" style={{ marginTop: 12 }}>
      {steps.map((id, i) => <li key={id} className="item">
        <span className="ladder-num" aria-hidden="true">{i + 1}</span>
        <span className="grow tt">{exerciseNameFor(exOr(id))}</span>
        <button type="button" className="iconbtn" aria-label={t('Move {0} up', said(exerciseNameText(exOr(id))))} disabled={i === 0} onClick={() => move(i, -1)}><Icon name="chevronUp" /></button>
        <button type="button" className="iconbtn" aria-label={t('Move {0} down', said(exerciseNameText(exOr(id))))} disabled={i === steps.length - 1} onClick={() => move(i, 1)}><Icon name="chevronDown" /></button>
        <button type="button" className="iconbtn" aria-label={t('Remove {0}', said(exerciseNameText(exOr(id))))} onClick={() => setSteps(list => list.filter(x => x !== id))}><Icon name="xmark" /></button>
      </li>)}
    </ol>
    {steps.length < STEPS_MAX && <Button variant="tinted" icon="plus" onClick={add}>{t('Add a rung')}</Button>}
    <div style={{ height: 12 }} />
    <Button variant="primary" disabled={steps.length < 2} onClick={save}>{t('Save')}</Button>
    {ladder && <><div style={{ height: 8 }} /><Button variant="ghost" className="danger" onClick={remove}>{t('Delete ladder')}</Button></>}
  </div>
}

export function LaddersSheet () {
  const S = useStore(s => s.S)
  const ui = useUI.getState()
  const edit = l => ui.openSheet(close => <LadderEditor ladder={l} close={close} />)
  return <div className="ladders">
    <h3 style={{ marginBottom: 2 }}>{t('Skill ladders')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>{t('Bodyweight moves from easier to harder. Own every set at the top of the range and the next rung is yours.')}</div>
    {allLadders(S).map(l => <LadderCard key={(l.own ? 'own:' : '') + l.id} S={S} ladder={l} onEdit={edit} />)}
    <Button variant="tinted" icon="plus" onClick={() => edit(null)}>{t('Make your own ladder')}</Button>
  </div>
}

export const laddersSheet = () => useUI.getState().openSheet(() => <LaddersSheet />)
