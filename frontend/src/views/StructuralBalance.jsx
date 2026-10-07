import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { exOr } from '../lib/exercises.js'
import { t, exerciseNameFor, exerciseNameClass } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import { Button, Segmented } from '../components/ui.jsx'
import { exercisePicker, bwSheet } from '../sheets.jsx'
import { computeBalance, overrideKey, withOverride } from '../lib/structuralBalance.js'
import { balanceStatusView } from '../lib/structuralBalance-view.js'
import { TEMPLATES, TEMPLATE_LIST, DEFAULT_TEMPLATE_ID, EVALUATION_MODES } from '../lib/structuralBalanceTemplates.js'

const STATUS_COLOR = {
  balanced: 'var(--green)',
  borderline: 'var(--yellow)',
  weak: 'var(--red)',
  'no-data': 'var(--label-3)',
}

// A role pointed at a custom exercise since deleted (on this device or another) still names
// something rather than showing a blank line.
const exerciseName = id => (id ? exerciseNameFor(exOr(id)) : null)

export default function StructuralBalance() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  // Own keys only: a synced or imported id such as "constructor" would otherwise find an
  // Object.prototype member and take the screen down.
  const templateId = Object.prototype.hasOwnProperty.call(TEMPLATES, S.balanceTemplate) ? S.balanceTemplate : DEFAULT_TEMPLATE_ID
  const template = TEMPLATES[templateId]
  const results = useMemo(() => computeBalance(S, template), [S, template])

  const setOverride = (role, exId) => update(s => {
    s.balanceOverrides = withOverride(s.balanceOverrides, overrideKey(template, role), exId)
  })
  const clearOverride = role => setOverride(role, null)
  // Headed by what a pick does here, like the routine editor's Replace (#110): the picker's own
  // heading is "Add exercise".
  const changeExercise = role => {
    const picker = exercisePicker(ex => { setOverride(role, ex.id); picker.close() }, { title: t('Change exercise') })
  }

  return <>
    <div className="hdr"><button className="iconbtn" onClick={() => nav('/stats')} aria-label={t('Stats')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginInlineStart: 12 }}><h1>{t('Structural balance')}</h1>
        <div className="sub">{t('Compare your lifts against a published ratio table to find the weak link.')}</div></div></div>

    <Segmented className="seg-range" value={templateId}
      onChange={id => update(s => { s.balanceTemplate = id })}
      options={TEMPLATE_LIST.map(tpl => ({ value: tpl.id, label: t(tpl.label) }))} />

    <div className="card">
      {results.map(r => {
        const role = template.roles.find(role => role.id === r.roleId)
        const view = balanceStatusView(r.status, r.needsAnchor)
        // The exercise the number came from when there is one, otherwise the one this role is
        // set to — a role you just pointed at an exercise should name it, logged or not.
        const exId = r.mappedExerciseId || r.configuredExerciseId
        const name = exerciseName(exId)
        const reps = role.evaluationMode === EVALUATION_MODES.REP_COUNT
        const actual = r.status === 'no-data' ? '–' : reps ? r.current.r : `${Math.round(r.actualPct)}%`
        const valueText = `${actual} / ${r.targetPct}${reps ? '' : '%'}`
        return (
          <div key={r.roleId} className="mrow" data-role-id={r.roleId} data-status={r.status}
            style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6, paddingBlock: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              {/* `.mrow .nm` keeps to one line, and its ellipsis never reaches these block lines:
                  a label is cut off mid-word instead, and what goes is its reps and "each hand" —
                  what the standard asks for. So here the name wraps. */}
              <span className="nm" style={{ minWidth: 0, whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
                <span style={{ display: 'block' }}>{t(role.label)}</span>
                <span className="small dim" style={{ display: 'block' }}>
                  <span className={exId ? exerciseNameClass(exOr(exId)) : ''} data-exercise-name>{name}</span>{r.isOverridden ? ` · ${t('Custom')}` : ''}
                </span>
                {r.needsBodyweight && <span className="small" data-needs-bodyweight style={{ display: 'block', color: 'var(--label-2)' }}>
                  {t('Log your body weight to score this lift.')}
                </span>}
                {r.needsAnchor && <span className="small" data-needs-anchor style={{ display: 'block', color: 'var(--label-2)' }}>
                  {t('Log the anchor lift to score this one.')}
                </span>}
              </span>
              <span className="v" style={{ textAlign: 'end', flexShrink: 0 }}>
                <span style={{ color: STATUS_COLOR[r.status] }}>{t(view.label)}</span>
                <span className="dim small" style={{ display: 'block' }}>{valueText}</span>
              </span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {r.needsBodyweight && <Button size="sm" variant="ghost" icon="plus" onClick={() => bwSheet()}>{t('Log body weight')}</Button>}
              <Button size="sm" variant="ghost" icon="pencil" onClick={() => changeExercise(role)}>{t('Change exercise')}</Button>
              {r.isOverridden && <Button size="sm" variant="ghost" onClick={() => clearOverride(role)}>{t('Use default exercise')}</Button>}
            </div>
          </div>
        )
      })}
    </div>
  </>
}
