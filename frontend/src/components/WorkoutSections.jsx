import { useEffect, useId, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, exerciseNameFor } from '../lib/i18n.js'
import { exOr } from '../lib/exercises.js'
import { exLine } from '../lib/history.js'
import { uid } from '../lib/format.js'
import { SECTION_PRESETS, SECTION_COLORS, sectionColor, addSection, moveSection, removeSection, updateSection, cleanSection, sectionLabel } from '../lib/workout-sections.js'
import { Button } from './ui.jsx'
import Icon from './Icon.jsx'

export function SectionHeading({ section, previous }) {
  if (!section || section.id === previous?.id) return null
  return <h3 className="workout-section-heading" style={{ '--phase-color': sectionColor(section) }}>
    <span className="phase-color-dot" aria-hidden="true" />
    {sectionLabel(section, t)}
  </h3>
}

const PHASE_LONG_PRESS_MS = 380
const PHASE_DRAG_SLOP = 8

// One pointer path serves routine editing and the active workout list. Exercise dragging uses a
// different handle, so starting either gesture cannot accidentally start the other.
export function usePhaseReorder(listRef, sections, disabled, onDrop) {
  const [drag, setDrag] = useState(null)
  const gestureRef = useRef(null)
  const sectionsRef = useRef(sections)
  const onDropRef = useRef(onDrop)
  sectionsRef.current = sections
  onDropRef.current = onDrop

  useEffect(() => {
    const list = listRef.current
    if (!list || disabled || (sections?.length || 0) < 2) {
      setDrag(null)
      return
    }
    const snapshotMatches = gesture => sectionsRef.current.map(section => section.id).join('\0') === gesture.snapshot
    let scrollFrame = null
    const targetAt = y => {
      const zones = [...list.querySelectorAll('[data-section-zone]')]
        .map(node => ({ id: node.dataset.sectionId, rect: node.getBoundingClientRect() }))
      return zones.find(zone => y >= zone.rect.top && y <= zone.rect.bottom)?.id
        || zones.reduce((nearest, zone) => !nearest || Math.abs(y - (zone.rect.top + zone.rect.bottom) / 2) < Math.abs(y - (nearest.rect.top + nearest.rect.bottom) / 2) ? zone : nearest, null)?.id
    }
    const finish = (gesture, commit) => {
      if (gestureRef.current !== gesture) return
      if (gesture.timer) window.clearTimeout(gesture.timer)
      if (scrollFrame != null) window.cancelAnimationFrame(scrollFrame)
      scrollFrame = null
      gestureRef.current = null
      try { gesture.handle.releasePointerCapture?.(gesture.pointerId) } catch { /* unsupported */ }
      setDrag(null)
      if (commit && gesture.active && snapshotMatches(gesture) && gesture.targetId && gesture.targetId !== gesture.sourceId) {
        onDropRef.current(gesture.sourceId, gesture.targetId)
      }
    }
    const lift = gesture => {
      if (gestureRef.current !== gesture || !snapshotMatches(gesture)) return finish(gesture, false)
      gesture.active = true
      gesture.timer = null
      try { gesture.handle.setPointerCapture?.(gesture.pointerId) } catch { /* unsupported */ }
      setDrag({ sourceId: gesture.sourceId, targetId: gesture.sourceId })
    }
    const onPointerDown = event => {
      const handle = event.target.closest?.('[data-phase-drag-handle]')
      if (!handle || !list.contains(handle) || event.isPrimary === false || (event.pointerType !== 'touch' && event.button !== 0)) return
      const sourceId = handle.closest('[data-section-zone]')?.dataset.sectionId
      if (!sourceId) return
      const gesture = { pointerId: event.pointerId, pointerType: event.pointerType, handle, sourceId,
        startX: event.clientX, startY: event.clientY, active: false,
        snapshot: sectionsRef.current.map(section => section.id).join('\0') }
      gestureRef.current = gesture
      if (event.pointerType === 'touch') gesture.timer = window.setTimeout(() => lift(gesture), PHASE_LONG_PRESS_MS)
      else lift(gesture)
    }
    const onPointerMove = event => {
      const gesture = gestureRef.current
      if (!gesture || gesture.pointerId !== event.pointerId) return
      if (!gesture.active) {
        if (Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) > PHASE_DRAG_SLOP) finish(gesture, false)
        return
      }
      event.preventDefault()
      gesture.lastY = event.clientY
      const targetId = targetAt(event.clientY)
      if (targetId) {
        gesture.targetId = targetId
        setDrag(current => current?.targetId === targetId ? current : { sourceId: gesture.sourceId, targetId })
      }
      if (scrollFrame == null && (event.clientY < 56 || event.clientY > window.innerHeight - 56)) scrollFrame = window.requestAnimationFrame(function scroll() {
        scrollFrame = null
        const current = gestureRef.current
        if (!current?.active) return
        const step = current.lastY < 56 ? -10 : current.lastY > window.innerHeight - 56 ? 10 : 0
        if (!step) return
        window.scrollBy?.(0, step)
        const nextTarget = targetAt(current.lastY)
        if (nextTarget) {
          current.targetId = nextTarget
          setDrag({ sourceId: current.sourceId, targetId: nextTarget })
        }
        scrollFrame = window.requestAnimationFrame(scroll)
      })
    }
    const onPointerUp = event => {
      const gesture = gestureRef.current
      if (gesture?.pointerId === event.pointerId) {
        const rect = list.getBoundingClientRect()
        const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom
        if (gesture.active && inside) gesture.targetId = targetAt(event.clientY)
        finish(gesture, inside)
      }
    }
    const cancel = () => { if (gestureRef.current) finish(gestureRef.current, false) }
    const onKeyDown = event => { if (event.key === 'Escape') cancel() }
    const onVisibility = () => { if (document.visibilityState === 'hidden') cancel() }
    list.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('pointermove', onPointerMove, { passive: false })
    document.addEventListener('pointerup', onPointerUp)
    document.addEventListener('pointercancel', cancel)
    document.addEventListener('lostpointercapture', cancel, true)
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', cancel)
    return () => {
      cancel()
      list.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('pointermove', onPointerMove)
      document.removeEventListener('pointerup', onPointerUp)
      document.removeEventListener('pointercancel', cancel)
      document.removeEventListener('lostpointercapture', cancel, true)
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', cancel)
    }
  }, [disabled, listRef, sections?.length])

  return drag
}

export function SectionActions({ section, count, onAdd, onRemove, disabled }) {
  return <div className="section-exercise-actions">
    <Button size="sm" icon="plus" disabled={disabled} aria-label={t('Add exercise to {0}', sectionLabel(section, t))} onClick={onAdd}>{t('Add exercise')}</Button>
    <Button size="sm" icon="minus" disabled={disabled || !count} aria-label={t('Remove exercise from {0}', sectionLabel(section, t))} onClick={onRemove}>{t('Remove exercise')}</Button>
  </div>
}

export function WorkoutPhase({ section, count, onAdd, onRemove, editor, disabled, dropTarget, reorderable, phaseDrag, children }) {
  const [editing, setEditing] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const editButton = useRef(null)
  const bodyId = useId()
  const label = sectionLabel(section, t)
  const closeEditor = () => {
    setEditing(false)
    requestAnimationFrame(() => {
      editButton.current?.focus({ preventScroll: true })
      editButton.current?.scrollIntoView?.({ block: 'nearest' })
    })
  }
  return <section className={'workout-phase' + (collapsed ? ' is-collapsed' : '') + (dropTarget ? ' is-drop-target' : '') + (phaseDrag?.sourceId === section.id ? ' is-phase-dragging' : '') + (phaseDrag?.targetId === section.id && phaseDrag.sourceId !== section.id ? ' is-phase-drop-target' : '')} style={{ '--phase-color': sectionColor(section) }} data-section-zone data-section-id={section.id} aria-label={label}>
    <div className="workout-phase-header">
      {reorderable && <button type="button" className="phase-drag-handle" data-phase-drag-handle data-nodrag disabled={disabled} aria-label={`${t('Drag to reorder')}: ${label}`} title={t('Drag to reorder')}><Icon name="grip" /></button>}
      <button type="button" className="workout-phase-toggle" aria-expanded={!collapsed} aria-controls={bodyId}
        aria-label={`${t(collapsed ? 'Expand' : 'Minimize')}: ${label}`} title={t(collapsed ? 'Expand' : 'Minimize')}
        onClick={() => { if (!collapsed) setEditing(false); setCollapsed(value => !value) }}>
        <span className="workout-section-heading"><span className="phase-color-dot" aria-hidden="true" />{label}</span>
        <span className="phase-count">{count}</span><Icon name={collapsed ? 'chevronDown' : 'chevronUp'} />
      </button>
      {editor && <button ref={editButton} className="iconbtn" disabled={disabled} aria-expanded={editing} aria-label={t('Edit phase: {0}', sectionLabel(section, t))} onClick={() => { if (collapsed) setCollapsed(false); setEditing(!editing) }}><Icon name={editing ? 'xmark' : 'more'} /></button>}
    </div>
    <div id={bodyId} className="workout-phase-body" hidden={collapsed}>
      {editing && <div className="phase-inline-settings"><SectionManager {...editor} initialEditing={section.id} inline close={closeEditor} /></div>}
      {children}
      {!count && <p className="section-empty muted small">{t('Add an exercise or drag one here.')}</p>}
      <SectionActions section={section} count={count} onAdd={onAdd} onRemove={onRemove} disabled={disabled} />
    </div>
  </section>
}

export function SectionMove({ sections, entry, onMove, disabled, grouped, compact, onUp, onDown, canUp, canDown, onRemove, children }) {
  if (!sections?.length) return null
  return <details className={'section-move' + (compact ? ' compact-actions' : '')} data-nodrag
    onToggle={event => { if (compact && event.currentTarget.open) document.querySelectorAll('.compact-actions[open]').forEach(other => { if (other !== event.currentTarget) other.open = false }) }}
    onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus() } }}>
    <summary aria-label={compact ? `${t('Exercise actions')}: ${exerciseNameFor(exOr(entry.id))}` : t(grouped ? 'Move group containing {0} to a phase' : 'Move {0} to a phase', exerciseNameFor(exOr(entry.id)))} title={compact ? t('Exercise actions') : undefined}>{compact ? <Icon name="more" /> : t(grouped ? 'Move group to phase' : 'Move to phase')}</summary>
    <div className="section-move-panel">
    {compact && <>
      <div className="section-row-actions">
        <Button size="sm" icon="chevronUp" aria-label={t('Move up')} disabled={disabled || !canUp} onClick={onUp}>{t('Move up')}</Button>
        <Button size="sm" icon="chevronDown" aria-label={t('Move down')} disabled={disabled || !canDown} onClick={onDown}>{t('Move down')}</Button>
        {onRemove && <Button size="sm" icon="minus" disabled={disabled} onClick={onRemove}>{t('Remove exercise')}</Button>}
        {children}
      </div>
      <div className="small muted">{t(grouped ? 'Move group to phase' : 'Move to phase')}</div>
    </>}
    <div className="section-move-choices">{sections.map(section => <Button key={section.id} size="sm" disabled={disabled || section.id === entry.sectionId}
      onClick={event => { event.currentTarget.closest('details').open = false; onMove(section.id) }}><span className="phase-color-dot" style={{ '--phase-color': sectionColor(section) }} aria-hidden="true" />{sectionLabel(section, t)}</Button>)}</div>
    </div>
  </details>
}

export function removeSectionExerciseSheet(section, entries, onRemove) {
  const unit = useStore.getState().S.unit
  useUI.getState().openSheet(close => <div className="section-removal">
    <h3>{t('Remove exercise from {0}', sectionLabel(section, t))}</h3>
    <div className="section-remove-choices">{entries.map((entry, i) => <Button key={entry.occurrenceId || i} icon="minus" onClick={() => { close(); onRemove(entry) }}>
      <span><span className="capitalize">{exerciseNameFor(exOr(entry.id))}</span><small>{exLine(entry.target || entry, unit)}</small></span>
    </Button>)}</div>
  </div>)
}

// Shared by phase settings and direct moves: keep active focus/rest ownership attached to entries.
export function editWorkoutSections({ routineId, activeId }, fn, onChanged) {
  if (!routineId && useUI.getState().work) return false
  const state = useStore.getState().S
  if (routineId ? !state.routines.some(r => r.id === routineId) : state.active?.id !== activeId) return false
  if (!routineId) useUI.getState().stopWork()
  useStore.getState().update(s => {
    const current = routineId ? s.routines.find(r => r.id === routineId) : s.active
    const before = (current.ex || current.entries).slice()
    const rest = !routineId && useUI.getState().timer
    fn(current, s)
    if (rest?.forIdx != null) {
      const forIdx = current.entries.indexOf(before[rest.forIdx])
      if (forIdx >= 0) useUI.setState({ timer: { ...rest, forIdx } })
    }
  })
  onChanged?.()
  return true
}

function SectionForm({ value, onSave, button = 'Save' }) {
  const [label, setLabel] = useState(value.label || '')
  const [training, setTraining] = useState(value.countsAsWork !== false)
  const [color, setColor] = useState(value.color || '')
  const colorHelpId = useId()
  const automaticColor = sectionColor({ ...value, color: undefined })
  const validColor = !color || /^#[0-9a-f]{6}$/i.test(color)
  return <form className="section-form" onSubmit={e => { e.preventDefault(); if (label.trim() && validColor) onSave({ ...value, label: label.trim(), countsAsWork: training, color: color || undefined }) }}>
    <label>{t('Phase name')}<input className="input" value={label} maxLength={80} required onChange={e => setLabel(e.target.value)} /></label>
    <fieldset className="phase-color-field"><legend>{t('Phase colour')}</legend>
      <div className="phase-color-options">{SECTION_COLORS.map(([name, hex]) => <button key={hex} type="button" className="phase-color-option" title={t(name)} aria-label={t(name)} aria-pressed={(color || automaticColor).toLowerCase() === hex} onClick={() => setColor(hex)}>
        <span style={{ background: hex }}>{(color || automaticColor).toLowerCase() === hex && <Icon name="check" />}</span>
      </button>)}</div>
      <div className="phase-custom-color"><label>{t('Custom colour')}<input className="input" value={color} placeholder={automaticColor} maxLength={7} pattern="#[0-9a-fA-F]{6}" aria-invalid={!validColor} aria-describedby={colorHelpId} onChange={e => setColor(e.target.value)} /></label>
        <input type="color" aria-label={t('Choose custom colour')} value={validColor && color ? color : automaticColor} onChange={e => setColor(e.target.value)} />
        <Button size="sm" type="button" onClick={() => setColor('')}>{t('Reset')}</Button>
      </div>
      <p id={colorHelpId} role={!validColor ? 'alert' : undefined} className={'small phase-color-help' + (!validColor ? ' invalid' : ' muted')}>{validColor
        ? t('Use a hex colour, e.g. #9b7de3, or leave blank for the default.')
        : t('Use # followed by six hex digits (0–9, A–F), e.g. #9b7de3.')}</p>
    </fieldset>
    <details className="phase-training-settings"><summary>{t('Training settings')}</summary>
      <label className="section-training-option"><input type="checkbox" checked={training} onChange={e => setTraining(e.target.checked)} />{t('Counts as training work')}</label>
      <p className="small muted">{t('Training work counts toward progression, records and working volume. All completed activity still contributes to fatigue estimates.')}</p>
    </details>
    <Button variant="primary" disabled={!label.trim() || !validColor}>{t(button)}</Button>
  </form>
}

export function SectionManager({ routineId, activeId, startAdding = false, initialEditing = null, close, onStructureChange, inline }) {
  const S = useStore(s => s.S)
  const running = useUI(s => s.work)
  const target = routineId ? S.routines.find(r => r.id === routineId) : S.active?.id === activeId ? S.active : null
  const [adding, setAdding] = useState(startAdding)
  const [editing, setEditing] = useState(initialEditing)
  const [deleting, setDeleting] = useState(null)
  const [destination, setDestination] = useState('')
  const [presetEdit, setPresetEdit] = useState(null)
  const [error, setError] = useState('')
  if (!target) return <p>{t('This workout or routine is no longer available.')}</p>
  const sections = target.sections || []
  const presets = S.sectionPresets || []
  const mutate = fn => {
    setError('')
    try {
      return editWorkoutSections({ routineId, activeId }, fn, onStructureChange)
    } catch (err) { setError(t(err.message)) }
  }
  const finishAdding = id => {
    // Sheet dismissal rewinds its browser-history entry, which restores the old scroll.
    // Reveal the new section after that restoration, not while the body is still pinned.
    const reveal = () => requestAnimationFrame(() => document.querySelector(`[data-section-id="${id}"]`)?.scrollIntoView?.({ block: 'center' }))
    if (close && window.history.state?.openGymSheet) window.addEventListener('popstate', reveal, { once: true })
    else reveal()
    setAdding(false); close?.()
  }
  const add = preset => { let id; if (mutate(current => { id = addSection(current, preset) })) finishAdding(id) }
  const section = sections.find(s => s.id === editing)
  const remove = sections.find(s => s.id === deleting)
  return <div className="section-manager">
    {!inline && <h3>{t(adding ? 'Add phase' : section ? 'Edit phase' : 'Workout phases')}</h3>}
    {!routineId && <p className="small muted">{t('Changes apply to this workout.')}</p>}
    {!routineId && running && <p role="status">{t('Finish the running set timer before changing phases.')}</p>}
    {error && <p role="alert">{error}</p>}
    <fieldset disabled={!routineId && !!running}>
      {section ? <>
        {inline && <div className="section-row-actions phase-order-actions">
          <Button size="sm" icon="chevronUp" disabled={sections[0].id === section.id} onClick={() => mutate(current => moveSection(current, section.id, -1))}>{t('Move up')}</Button>
          <Button size="sm" icon="chevronDown" disabled={sections.at(-1).id === section.id} onClick={() => mutate(current => moveSection(current, section.id, 1))}>{t('Move down')}</Button>
        </div>}
        <SectionForm key={section.id} value={section} onSave={value => { if (mutate(current => updateSection(current, section.id, value))) { setEditing(null); if (initialEditing) close?.() } }} />
        {inline && <div className="section-row-actions">
          <Button size="sm" icon="minus" onClick={() => {
            if (!(target.ex || target.entries || []).some(entry => entry.sectionId === section.id)) {
              if (mutate(current => removeSection(current, section.id, sections.find(s => s.id !== section.id)?.id))) close?.()
            } else { setDeleting(section.id); setEditing(null); setDestination('') }
          }}>{t('Remove phase')}</Button>
        </div>}
        {!inline && <Button onClick={() => setEditing(null)}>{t('Back')}</Button>}
      </> : remove ? <>
        <h4>{t('Remove phase, keep exercises')}</h4>
        <p>{t('Choose where the exercises in “{0}” should go. Their logged sets are kept.', remove.label)}</p>
        {sections.length > 1 && <label>{t('Move exercises to phase')}
          <select className="input" value={destination} onChange={e => setDestination(e.target.value)}>
            <option value="" disabled>{t('Select a phase')}</option>
            {sections.filter(s => s.id !== remove.id).map(s => <option key={s.id} value={s.id}>{sectionLabel(s, t)}</option>)}
          </select>
        </label>}
        {(sections.length === 1 || destination) && <p className="small muted">{sections.length === 1 || sections.find(s => s.id === destination)?.countsAsWork
          ? t('These exercises will count as training work.') : t('These exercises will be excluded from training statistics. Fatigue estimates still include completed activity.')}</p>}
        <Button variant="danger" disabled={sections.length > 1 && !destination} onClick={() => { if (mutate(current => removeSection(current, remove.id, destination))) { setDeleting(null); if (inline) close?.() } }}>{t('Remove phase, keep exercises')}</Button>
        <Button onClick={() => { setDeleting(null); if (inline) setEditing(initialEditing) }}>{t('Cancel')}</Button>
      </> : <>
        {sections.length > 0 && !adding && <div className="section-order">{sections.map((s, i) => <div className="section-order-row" key={s.id}>
          <button className="btn ghost section-name" onClick={() => setEditing(s.id)}>{sectionLabel(s, t)}<Icon name="pencil" /></button>
          <button className="iconbtn" disabled={i === 0} aria-label={t('Move phase up: {0}', sectionLabel(s, t))} onClick={() => mutate(current => moveSection(current, s.id, -1))}><Icon name="chevronUp" /></button>
          <button className="iconbtn" disabled={i === sections.length - 1} aria-label={t('Move phase down: {0}', sectionLabel(s, t))} onClick={() => mutate(current => moveSection(current, s.id, 1))}><Icon name="chevronDown" /></button>
          <button className="iconbtn" aria-label={t('Remove phase: {0}', sectionLabel(s, t))} onClick={() => { setDeleting(s.id); setDestination('') }}><Icon name="xmark" /></button>
        </div>)}</div>}
        {adding || !sections.length ? <>
          <p className="small muted">{t('Choose a phase. Add only the phases you need, in any order.')}</p>
          <div className="section-presets">{SECTION_PRESETS.map(p => <Button key={p.type} onClick={() => add(p)}><span className="phase-color-dot" style={{ '--phase-color': sectionColor(p) }} aria-hidden="true" />{t(p.label)}</Button>)}</div>
          {presets.map(p => <div className="section-preset-row" key={p.id}>
            <Button onClick={() => add(p)} icon="plus">{p.label}</Button>
            <button className="iconbtn" aria-label={t('Edit preset: {0}', p.label)} onClick={() => setPresetEdit(p.id)}><Icon name="pencil" /></button>
          </div>)}
          <details className="section-custom"><summary>{t('Custom phase')}</summary>
            <SectionForm value={{ type: 'custom', countsAsWork: true }} button="Save preset and add phase" onSave={value => {
              let id
              if (mutate((current, state) => {
                const preset = cleanSection({ ...value, id: uid() })
                state.sectionPresets = [...(state.sectionPresets || []), preset]
                id = addSection(current, preset)
              })) finishAdding(id)
            }} />
          </details>
          {presets.some(p => p.id === presetEdit) && <div className="section-custom">
            <h4>{t('Edit custom preset')}</h4>
            <p className="small muted">{t('Preset changes apply to future additions. Existing phases keep their settings.')}</p>
            <SectionForm key={presetEdit} value={presets.find(p => p.id === presetEdit)} onSave={value => {
              mutate((current, state) => { state.sectionPresets = state.sectionPresets.map(p => p.id === presetEdit ? cleanSection(value) : p) }); setPresetEdit(null)
            }} />
            <Button variant="danger" onClick={() => { mutate((current, state) => { state.sectionPresets = state.sectionPresets.filter(p => p.id !== presetEdit) }); setPresetEdit(null) }}>{t('Delete preset')}</Button>
          </div>}
        </> : <Button icon="plus" disabled={sections.length >= 50} onClick={() => setAdding(true)}>{t('Add phase')}</Button>}
      </>}
    </fieldset>
  </div>
}

export function WorkoutSections({ routineId, activeId, onStructureChange }) {
  const target = useStore(s => routineId ? s.S.routines.find(r => r.id === routineId) : s.S.active?.id === activeId ? s.S.active : null)
  const running = useUI(s => s.work)
  if (!target) return null
  return <div className="workout-section-toolbar"><span className="small muted">{t('Workout phases')}</span><Button size="sm" icon="plus" disabled={!routineId && !!running}
    onClick={() => useUI.getState().openSheet(close => <SectionManager routineId={routineId} activeId={activeId} close={close} onStructureChange={onStructureChange} startAdding />)}>{t('Add phase')}</Button>
  </div>
}
