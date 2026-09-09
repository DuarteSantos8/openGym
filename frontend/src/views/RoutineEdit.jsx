import { useNavigate, useParams } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { exOr } from '../lib/exercises.js'
import { activeProfile, exAvailable } from '../lib/equipment.js'
import { uid } from '../lib/format.js'
import { t, exerciseNameFor } from '../lib/i18n.js'
import { supersetUnits, moveSupersetUnit, cleanupSg, exLine, defaultConfig } from '../lib/history.js'
import { Thumb } from '../components/Media.jsx'
import { glyphPicker, exercisePicker, exConfigSheet, confirmSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { glyphOf } from '../lib/glyphs.js'
import { Button, Row, SelectRow, Switch } from '../components/ui.jsx'
import SwipeToDelete from '../components/SwipeToDelete.jsx'
import { copyRoutine } from '../lib/routines.js'
import { POLICIES_FOR, POLICY_NAME, POLICY_DESC } from '../lib/progression.js'
import BodyMap from '../components/BodyMap.jsx'
import { loadOfRoutine, rankOf, MUSCLE_NAME } from '../lib/muscles.js'

export const ROUTINE_LONG_PRESS_MS = 380
export const ROUTINE_DRAG_SLOP = 8

const clamp = (value, low, high) => Math.max(low, Math.min(high, value))

// Slots are defined after removing the source unit, so a grouped run can never be split.
export function reorderRoutineUnit(exercises, sourceIndex, targetSlot) {
  if (!Array.isArray(exercises) || !exercises.length) return false
  const units = supersetUnits(exercises)
  const sourcePosition = units.findIndex(unit => unit.includes(sourceIndex))
  if (sourcePosition < 0) return false
  const remaining = units.filter((_, position) => position !== sourcePosition)
  const slot = clamp(Number.isFinite(targetSlot) ? Math.trunc(targetSlot) : sourcePosition, 0, remaining.length)
  if (slot === sourcePosition) return false
  const source = units[sourcePosition]
  const moved = exercises.splice(source[0], source.length)
  const insertAt = remaining.slice(0, slot).reduce((count, unit) => count + unit.length, 0)
  exercises.splice(insertAt, 0, ...moved)
  cleanupSg(exercises)
  return true
}

function unitGeometry(list, exercises) {
  const rows = new Map([...list.querySelectorAll('[data-routine-row]')]
    .map(row => [Number(row.dataset.exIndex), row]))
  const units = supersetUnits(exercises)
  const geometry = units.map((unit, position) => {
    const rects = unit.map(index => rows.get(index)?.getBoundingClientRect()).filter(Boolean)
    if (rects.length !== unit.length) return null
    const top = Math.min(...rects.map(rect => rect.top))
    const bottom = Math.max(...rects.map(rect => rect.bottom))
    return { unit, position, top, bottom, center: top + (bottom - top) / 2 }
  })
  return geometry.every(Boolean) ? geometry : null
}

function scrollHostFor(node) {
  for (let parent = node.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
    const overflowY = window.getComputedStyle(parent).overflowY
    if (/(auto|scroll)/.test(overflowY) && parent.scrollHeight > parent.clientHeight) return parent
  }
  return window
}

function autoScrollStep(host, clientY) {
  const edge = 64
  const maxStep = 14
  let top, bottom, scrollTop, maxScroll
  if (host === window) {
    const root = document.scrollingElement || document.documentElement
    top = window.visualViewport?.offsetTop || 0
    bottom = top + (window.visualViewport?.height || window.innerHeight || root.clientHeight)
    scrollTop = window.scrollY || root.scrollTop || 0
    maxScroll = Math.max(root.scrollHeight, document.body?.scrollHeight || 0) - (bottom - top)
  } else {
    const rect = host.getBoundingClientRect()
    top = rect.top; bottom = rect.bottom
    scrollTop = host.scrollTop; maxScroll = host.scrollHeight - host.clientHeight
  }
  if (clientY < top + edge && scrollTop > 0) return -Math.ceil(maxStep * clamp((top + edge - clientY) / edge, 0, 1))
  if (clientY > bottom - edge && scrollTop < maxScroll) return Math.ceil(maxStep * clamp((clientY - bottom + edge) / edge, 0, 1))
  return 0
}

function useRoutineReorder(routineIdentity, exercises, onDrop) {
  const listRef = useRef(null)
  const gestureRef = useRef(null)
  const exercisesRef = useRef(exercises)
  const routineIdentityRef = useRef(routineIdentity)
  const onDropRef = useRef(onDrop)
  const suppressClickRef = useRef(false)
  const suppressTimerRef = useRef(null)
  const [drag, setDrag] = useState(null)
  exercisesRef.current = exercises
  routineIdentityRef.current = routineIdentity
  onDropRef.current = onDrop
  const hasRows = exercises.length > 0

  useEffect(() => () => {
    suppressClickRef.current = false
    window.clearTimeout(suppressTimerRef.current)
  }, [])

  useEffect(() => {
    const list = listRef.current
    if (!list) return undefined
    let frame = null
    setDrag(current => current ? null : current)

    const clearFrame = () => {
      if (frame != null) window.cancelAnimationFrame(frame)
      frame = null
    }
    const clearTimer = gesture => {
      if (gesture?.timer != null) window.clearTimeout(gesture.timer)
      if (gesture) gesture.timer = null
    }
    const matchesSnapshot = gesture => routineIdentityRef.current === gesture.routineIdentity
      && exercisesRef.current === gesture.listIdentity
      && JSON.stringify(exercisesRef.current) === gesture.snapshot
    const releaseCapture = gesture => {
      const target = gesture?.captureTarget
      if (!target?.releasePointerCapture) return
      try { target.releasePointerCapture(gesture.pointerId) } catch { /* already released */ }
    }
    const finish = (gesture, commit, x = gesture?.lastX, y = gesture?.lastY) => {
      if (!gesture || gestureRef.current !== gesture) return
      clearTimer(gesture)
      clearFrame()
      gestureRef.current = null
      if (!gesture.active) return
      releaseCapture(gesture)
      suppressClickRef.current = true
      window.clearTimeout(suppressTimerRef.current)
      // The compatibility click lands synchronously after pointerup; anything
      // later is a real tap, so the guard only needs to outlive that one event.
      suppressTimerRef.current = window.setTimeout(() => { suppressClickRef.current = false }, 150)
      setDrag(null)
      const rect = list.getBoundingClientRect()
      const inside = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
      const geometry = unitGeometry(list, exercisesRef.current)
      if (commit && inside && geometry && matchesSnapshot(gesture) && gesture.targetSlot !== gesture.sourcePosition) {
        onDropRef.current(gesture.sourceIndex, gesture.targetSlot)
      }
    }
    const indicatorTop = (geometry, gesture, slot, listRect) => {
      if (slot === gesture.sourcePosition) return clamp(gesture.sourceTop - listRect.top, 0, listRect.height)
      const remaining = geometry.filter(unit => unit.position !== gesture.sourcePosition)
      let top
      if (slot <= 0) top = remaining[0]?.top ?? gesture.sourceTop
      else if (slot >= remaining.length) top = remaining.at(-1)?.bottom ?? gesture.sourceBottom
      else top = (remaining[slot - 1].bottom + remaining[slot].top) / 2
      return clamp(top - listRect.top, 0, listRect.height)
    }
    const updateDrag = (gesture, x, y, schedule = true) => {
      if (gestureRef.current !== gesture || !gesture.active || !matchesSnapshot(gesture)) {
        if (gestureRef.current === gesture) finish(gesture, false)
        return
      }
      const geometry = unitGeometry(list, exercisesRef.current)
      if (!geometry) { finish(gesture, false); return }
      const listRect = list.getBoundingClientRect()
      const remaining = geometry.filter(unit => unit.position !== gesture.sourcePosition)
      const probeY = clamp(y, listRect.top, listRect.bottom)
      const moved = Math.hypot(x - gesture.startX, y - gesture.startY) > ROUTINE_DRAG_SLOP
      const slot = moved ? remaining.reduce((count, unit) => count + (probeY > unit.center ? 1 : 0), 0) : gesture.sourcePosition
      const rawDelta = y - gesture.grabOffset - gesture.sourceTop
      const deltaY = clamp(rawDelta, listRect.top - gesture.sourceTop, listRect.bottom - gesture.sourceBottom)
      gesture.lastX = x; gesture.lastY = y; gesture.targetSlot = slot
      setDrag({ first: gesture.sourceUnit[0], last: gesture.sourceUnit.at(-1), deltaY, indicatorTop: indicatorTop(geometry, gesture, slot, listRect) })
      if (schedule && frame == null) frame = window.requestAnimationFrame(runAutoScroll)
    }
    function runAutoScroll() {
      frame = null
      const gesture = gestureRef.current
      if (!gesture?.active) return
      const step = autoScrollStep(gesture.scrollHost, gesture.lastY)
      if (!step) return
      if (gesture.scrollHost === window) window.scrollBy(0, step)
      else gesture.scrollHost.scrollTop += step
      updateDrag(gesture, gesture.lastX, gesture.lastY, false)
      if (gestureRef.current === gesture) frame = window.requestAnimationFrame(runAutoScroll)
    }
    const lift = gesture => {
      if (gestureRef.current !== gesture) return
      if (!matchesSnapshot(gesture)) { finish(gesture, false); return }
      const geometry = unitGeometry(list, exercisesRef.current)
      const source = geometry?.find(unit => unit.unit.includes(gesture.sourceIndex))
      if (!source) { finish(gesture, false); return }
      gesture.active = true; gesture.timer = null
      gesture.sourcePosition = source.position; gesture.sourceUnit = source.unit
      gesture.sourceTop = source.top; gesture.sourceBottom = source.bottom
      gesture.grabOffset = gesture.lastY - source.top; gesture.targetSlot = source.position
      gesture.scrollHost = scrollHostFor(list)
      gesture.captureTarget = gesture.downTarget
      try { gesture.captureTarget.setPointerCapture?.(gesture.pointerId) } catch { /* unsupported */ }
      suppressClickRef.current = true
      window.clearTimeout(suppressTimerRef.current)
      updateDrag(gesture, gesture.lastX, gesture.lastY)
    }
    const onPointerDown = event => {
      // a new touch is intentional — never let the post-drop guard eat its click
      suppressClickRef.current = false
      window.clearTimeout(suppressTimerRef.current)
      const current = gestureRef.current
      if (current) {
        if (event.pointerId !== current.pointerId) finish(current, false)
        return
      }
      if (event.isPrimary === false || (event.pointerType === 'mouse' && event.button !== 0)) return
      const target = event.target
      if (!target?.closest || target.closest('button,a,input,textarea,select,[data-nodrag]')) return
      const row = target.closest('[data-routine-row]')
      if (!row || !list.contains(row)) return
      const sourceIndex = Number(row.dataset.exIndex)
      if (!Number.isInteger(sourceIndex)) return
      const gesture = {
        pointerId: event.pointerId, sourceIndex, downTarget: target,
        startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastY: event.clientY,
        routineIdentity: routineIdentityRef.current,
        listIdentity: exercisesRef.current,
        snapshot: JSON.stringify(exercisesRef.current), active: false, timer: null,
      }
      gesture.timer = window.setTimeout(() => lift(gesture), ROUTINE_LONG_PRESS_MS)
      gestureRef.current = gesture
    }
    const onPointerMove = event => {
      const gesture = gestureRef.current
      if (!gesture || event.pointerId !== gesture.pointerId) return
      if (!gesture.active) {
        if (Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) > ROUTINE_DRAG_SLOP) {
          clearTimer(gesture); gestureRef.current = null
        } else { gesture.lastX = event.clientX; gesture.lastY = event.clientY }
        return
      }
      event.preventDefault()
      updateDrag(gesture, event.clientX, event.clientY)
    }
    const onPointerUp = event => {
      const gesture = gestureRef.current
      if (!gesture || event.pointerId !== gesture.pointerId) return
      if (gesture.active) event.preventDefault()
      finish(gesture, gesture.active, event.clientX, event.clientY)
    }
    const onPointerCancel = event => {
      const gesture = gestureRef.current
      if (gesture && event.pointerId === gesture.pointerId) finish(gesture, false)
    }
    const onLostCapture = event => {
      const gesture = gestureRef.current
      if (gesture && event.pointerId === gesture.pointerId) finish(gesture, false)
    }
    const cancelActive = () => finish(gestureRef.current, false)
    const onKeyDown = event => {
      if (event.key !== 'Escape' || !gestureRef.current) return
      event.preventDefault(); cancelActive()
    }
    const onVisibility = () => { if (document.visibilityState === 'hidden') cancelActive() }
    const onContextMenu = event => { if (gestureRef.current?.active && event.target.closest?.('[data-routine-row]')) event.preventDefault() }
    const onDragStart = event => { if (event.target.closest?.('[data-routine-row]')) event.preventDefault() }

    // Touch: the rows keep `touch-action: pan-y` so the list still scrolls with a finger, but once
    // a long-press has lifted a row the browser must not claim the vertical drag as a pan — it
    // would fire pointercancel and scroll instead. preventDefault on a pointer event cannot stop
    // that; only a non-passive touchmove listener can, and only while a drag is actually active.
    const onTouchMove = event => { if (gestureRef.current?.active) event.preventDefault() }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('touchmove', onTouchMove, { passive: false })
    document.addEventListener('pointermove', onPointerMove, { passive: false })
    document.addEventListener('pointerup', onPointerUp, { passive: false })
    document.addEventListener('pointercancel', onPointerCancel)
    document.addEventListener('lostpointercapture', onLostCapture)
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('visibilitychange', onVisibility)
    list.addEventListener('contextmenu', onContextMenu)
    list.addEventListener('dragstart', onDragStart)
    window.addEventListener('blur', cancelActive)
    return () => {
      const gesture = gestureRef.current
      clearTimer(gesture); clearFrame(); gestureRef.current = null
      releaseCapture(gesture)
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('pointermove', onPointerMove)
      document.removeEventListener('pointerup', onPointerUp)
      document.removeEventListener('pointercancel', onPointerCancel)
      document.removeEventListener('lostpointercapture', onLostCapture)
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('visibilitychange', onVisibility)
      list.removeEventListener('contextmenu', onContextMenu)
      list.removeEventListener('dragstart', onDragStart)
      window.removeEventListener('blur', cancelActive)
    }
  }, [hasRows, routineIdentity, exercises])

  const onClickCapture = event => {
    if (!suppressClickRef.current) return
    suppressClickRef.current = false
    window.clearTimeout(suppressTimerRef.current)
    event.preventDefault(); event.stopPropagation()
  }
  return { listRef, drag, onClickCapture }
}

export default function RoutineEdit() {
  const nav = useNavigate()
  const { id } = useParams()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const toast = useUI(s => s.toast)
  const r = S.routines.find(x => x.id === id)
  useEffect(() => { if (!r) nav('/plan') }, [!!r])
  // Editing here has no explicit "save" — every field change persists immediately. A single
  // auto-backup on the way out (not per keystroke) covers the whole editing session, deletion
  // included: this still unmounts after the delete button navigates away.
  useEffect(() => () => useStore.getState().autoBackupNow(), [])
  const edit = fn => update(s => { fn(s.routines.find(x => x.id === id).ex) })
  const reorder = useRoutineReorder(r, r?.ex || [], (sourceIndex, targetSlot) => {
    edit(exercises => { reorderRoutineUnit(exercises, sourceIndex, targetSlot) })
  })
  if (!r) return null
  const move = (i, dir) => {
    // Guard before update so a stale/boundary activation cannot trigger persistence or cleanup.
    if (!moveSupersetUnit(r.ex, i, dir)) return
    edit(ex => {
      const reordered = moveSupersetUnit(ex, i, dir)
      if (!reordered) return
      ex.splice(0, ex.length, ...reordered)
      cleanupSg(ex)
    })
  }
  const toggleLink = i => edit(ex => {
    if (i < 1) return
    const cur = ex[i], prev = ex[i - 1]
    if (cur.sg && prev.sg && cur.sg === prev.sg) delete cur.sg
    else { const gid = prev.sg || ('sg' + uid()); prev.sg = gid; cur.sg = gid }
    cleanupSg(ex)
  })

  const units = supersetUnits(r.ex)
  const unitIndex = new Map(units.flatMap((unit, index) => unit.map(i => [i, index])))
  const unitFirst = new Set(units.filter(u => u.length > 1).map(u => u[0]))
  const inSS = new Set(units.filter(u => u.length > 1).flat())
  const profile = activeProfile(S)
  const missingCount = profile ? r.ex.filter(e => !exAvailable(S, exOr(e.id))).length : 0

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/plan')} aria-label={t('Plan')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, margin: '0 12px' }}>
        <input className="input" defaultValue={r.name} style={{ fontWeight: 600, fontSize: 20, letterSpacing: '-.021em' }}
          onChange={e => update(s => { s.routines.find(x => x.id === id).name = e.target.value.trim() || t('Routine') })} />
      </div>
      <button className="iconbtn" aria-label={t('Pick an icon')} onClick={() => glyphPicker(r.emoji, g => update(s => { s.routines.find(x => x.id === id).emoji = g }))}><Icon name={glyphOf(r.emoji)} /></button>
    </div>

    <div className="sect-b" style={{ marginBottom: 16 }}>
      <SelectRow icon="chartLine" title={t('Progression')} sheetTitle={t('Progression')}
        value={r.prog || 'linear'} onChange={v => update(s => { s.routines.find(x => x.id === id).prog = v })}
        options={POLICIES_FOR.reps.map(p => ({ value: p, label: t(POLICY_NAME[p]), subtitle: t(POLICY_DESC[p]) }))} />
      <Row icon="pause" iconTint="var(--orange)" title={t('Exclude from automatic progression')}
        subtitle={t('Use for planned deloads. Workouts stay in history and statistics.')}>
        <Switch checked={r.excludeFromProgression === true} onChange={v => update(s => {
          const routine = s.routines.find(x => x.id === id)
          if (v) routine.excludeFromProgression = true
          else delete routine.excludeFromProgression
        })} />
      </Row>
    </div>
    <div className="small dim" style={{ margin: '-10px 2px 16px' }}>
      {r.excludeFromProgression
        ? t('The next regular target continues from the last included workout.')
        : t('Applies to every exercise in this routine that does not set its own rule.')}
    </div>

    {missingCount > 0 && <div className="card" style={{ marginBottom: 16, borderColor: 'var(--orange)' }}>
      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
        <Icon name="warning" style={{ color: 'var(--orange)' }} />
        <div className="small">{t('{0} of {1} exercises need equipment outside "{2}"', missingCount, r.ex.length, profile.name)}</div>
      </div>
    </div>}

    {r.ex.length ? <div ref={reorder.listRef} onClickCapture={reorder.onClickCapture}
      className={'list routine-list' + (reorder.drag ? ' is-reordering' : '')}>{r.ex.map((e, i) => {
      // An unresolvable id is shown rather than skipped — hiding it left an entry you
      // could neither see nor delete, but that still turned up in the workout.
      const ex = exOr(e.id)
      const noEquip = profile && !exAvailable(S, ex)
      const linkedPrev = i > 0 && e.sg && r.ex[i - 1].sg === e.sg
      const isDragging = reorder.drag && i >= reorder.drag.first && i <= reorder.drag.last
      return <div key={i} data-routine-row data-ex-index={i}
        className={'routine-drag-row' + (isDragging ? ' is-dragging' : '')}
        style={isDragging ? { transform: `translate3d(0, ${reorder.drag.deltaY}px, 0)` } : undefined}>
        {unitFirst.has(i) && <div className="ss-label"><Icon name="link" />{t('Superset')}</div>}
        <SwipeToDelete className={'item' + (inSS.has(i) ? ' in-ss' : '')}
          deleteLabel={t('Remove from routine')}
          onDelete={() => edit(x => { x.splice(i, 1); cleanupSg(x) })}
          onClick={() => {
            exConfigSheet(ex, e, cfg => edit(x => { x[i] = { id: x[i].id, sg: x[i].sg, ...cfg } }), () => edit(x => { x.splice(i, 1); cleanupSg(x) }), r)
          }}>
          <Thumb ex={ex} />
          <div className="grow"><div className="tt capitalize">{exerciseNameFor(ex)}</div><div className="ss">{exLine(e, S.unit)}</div>
            {e.note && <div className="small dim" style={{ marginTop: 2 }}>{e.note}</div>}</div>
          {noEquip && <span className="tag" style={{ color: 'var(--orange)', borderColor: 'var(--orange)' }} title={t('Needs {0} — not in your active profile', t(ex.eq))}><Icon name="warning" /></span>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 'none', alignItems: 'center' }}>
            {i > 0 && <button className={'iconbtn' + (linkedPrev ? ' on-ss' : '')} title={t('Superset with exercise above')} style={{ width: 32, height: 28, borderRadius: 8, fontSize: 15 }} onClick={ev => { ev.stopPropagation(); toggleLink(i) }}><Icon name="link" /></button>}
            <div style={{ display: 'flex', gap: 2 }}>
              <button className="iconbtn" aria-label={t('Move up')} title={t('Move up')} disabled={unitIndex.get(i) === 0} style={{ width: 28, height: 24, borderRadius: 7, fontSize: 12 }} onClick={ev => { ev.stopPropagation(); move(i, -1) }}><Icon name="chevronUp" /></button>
              <button className="iconbtn" aria-label={t('Move down')} title={t('Move down')} disabled={unitIndex.get(i) === units.length - 1} style={{ width: 28, height: 24, borderRadius: 7, fontSize: 12 }} onClick={ev => { ev.stopPropagation(); move(i, 1) }}><Icon name="chevronDown" /></button>
            </div>
          </div>
        </SwipeToDelete>
      </div>
    })}{reorder.drag && <div className="routine-drop-indicator" data-testid="routine-drop-indicator"
      aria-hidden="true" style={{ top: `${reorder.drag.indicatorTop}px` }} />}</div> : <div className="empty"><div className="ico"><Icon name="dumbbell" /></div>{t('No exercises yet — add your first one.')}</div>}

    {/* Coverage of the routine as planned, so a gap shows up while you're building it
        rather than after a month of training around it. */}
    {r.ex.length > 0 && (() => {
      const load = loadOfRoutine(r)
      const { worked } = rankOf(load)
      return <div className="card" style={{ marginTop: 12 }}>
        <h2>{t('What this session hits')}</h2>
        <BodyMap load={load} body={S.body} />
        <div className="mchips">
          {worked.slice(0, 6).map(m => <span key={m} className="mchip">{t(MUSCLE_NAME[m])}</span>)}
        </div>
      </div>
    })()}

    <div className="small dim row" style={{ margin: '10px 2px', gap: 5 }}><Icon name="link" style={{ fontSize: 13 }} />{t('Tap the link button on an exercise to superset it with the one above — you’ll do them back-to-back.')}</div>
    <Button variant="primary" onClick={() => exercisePicker((ex, quick) => {
      if (quick) {
        edit(x => x.push({ id: ex.id, ...defaultConfig(ex.id) }))
        toast(t('“{0}” added to {1}', exerciseNameFor(ex), r.name))
      } else {
        exConfigSheet(ex, null, cfg => edit(x => { x.push({ id: ex.id, ...cfg }) }), null, r)
      }
    })} icon="plus">{t('Add exercise')}</Button>
    <div style={{ height: 10 }} />
    <Button onClick={() => {
      const copy = copyRoutine(r, t('Copy'))
      update(s => { s.routines.push(copy) })
      nav('/plan/r/' + copy.id)
    }}>{t('Copy routine')}</Button>
    <div style={{ height: 10 }} />
    <Button variant="danger" onClick={() => confirmSheet({
      title: t('Delete routine?'), message: t('“{0}” and its exercises will be removed.', r.name), confirmText: t('Delete'), danger: true,
      onConfirm: () => {
        update(s => {
          s.routines = s.routines.filter(x => x.id !== id)
          // A weekday holds a routine-id list: pull the deleted id from each day, drop the
          // key when it empties (never store []). dayPlan stays scalar.
          Object.keys(s.week).forEach(k => {
            const next = [].concat(s.week[k]).filter(rid => rid !== id)
            if (next.length) s.week[k] = next; else delete s.week[k]
          })
          Object.keys(s.dayPlan).forEach(k => { if (s.dayPlan[k] === id) delete s.dayPlan[k] })
        })
        nav('/plan')
      }
    })}>{t('Delete routine')}</Button>
  </div>
}
