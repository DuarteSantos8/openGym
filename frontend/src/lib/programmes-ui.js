import { t } from './i18n-core.js'

const COLOURS = Object.freeze({
  lime: 'var(--green)',
  sky: 'var(--blue)',
  orange: 'var(--orange)',
  gold: 'var(--yellow)',
  violet: 'var(--purple)',
  pink: 'var(--pink)',
  teal: 'var(--teal)',
})

const sourceOf = state => state?.S && typeof state.S === 'object' ? state.S : (state || {})
const namespaceOf = state => {
  const source = sourceOf(state)
  return source.programmes && !Array.isArray(source.programmes) && typeof source.programmes === 'object'
    ? source.programmes
    : source.version === 1 && (Array.isArray(source.cycles) || Array.isArray(source.definitions))
      ? source
      : {}
}
const idOf = value => value?.id ?? value?.programmeId ?? null
const cycleProgrammeId = cycle => cycle?.programmeId ?? cycle?.definitionId ?? cycle?.programme?.id ?? null
const cycleId = cycle => cycle?.id ?? cycle?.cycleId ?? null
const pad = value => String(value).padStart(2, '0')
const validISO = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
const dateNumber = value => {
  const iso = validISO(value)
  return iso ? Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) : NaN
}
const addDays = (value, amount) => {
  const at = dateNumber(value)
  return Number.isFinite(at) ? new Date(at + Number(amount || 0) * 86400000).toISOString().slice(0, 10) : null
}
const isoAt = (now, timeZone) => {
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date(now)).filter(part => part.type !== 'literal').map(part => [part.type, part.value]))
    return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`
  } catch {
    const date = new Date(now)
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  }
}
const mondayOnOrAfter = (value) => {
  const at = dateNumber(value)
  if (!Number.isFinite(at)) return null
  const weekday = new Date(at).getUTCDay() || 7
  return addDays(value, weekday === 1 ? 0 : 8 - weekday)
}
const weeksOf = cycle => {
  if (Array.isArray(cycle?.programmeSnapshot?.weeks)) return cycle.programmeSnapshot.weeks
  if (Array.isArray(cycle?.snapshot?.weeks)) return cycle.snapshot.weeks
  if (Array.isArray(cycle?.snapshot)) return cycle.snapshot
  return Array.isArray(cycle?.weeks) ? cycle.weeks : []
}
const daysOf = week => Array.isArray(week?.days)
  ? week.days.map((day, index) => [day, Number(day?.weekday ?? day?.day ?? index + 1) || index + 1])
  : Object.entries(week?.days || {}).map(([weekday, day], index) => [day, Number(day?.weekday ?? weekday) || index + 1])
const sessionsOf = day => day?.rest === true || day?.mode === 'rest' || !Array.isArray(day?.sessions) ? [] : day.sessions
const markerOf = workout => workout?.programmeInstance?.instanceId || workout?.instanceId || workout?.programme?.instanceId || null
const routineName = value => value?.name || value?.title || null
const usableRoutine = value => value && (routineName(value) || Array.isArray(value.ex)) ? value : null

function definitions(state) {
  const namespace = namespaceOf(state)
  for (const key of ['definitions', 'programmes', 'templates']) {
    if (Array.isArray(namespace[key])) return namespace[key]
  }
  return []
}

function definitionFor(state, programmeId) {
  return definitions(state).find(definition => String(idOf(definition)) === String(programmeId)) || null
}

function cycleFor(state, wantedId) {
  return (namespaceOf(state).cycles || []).find(cycle => String(cycleId(cycle)) === String(wantedId)) || null
}

export function programmeNameForItem(state, item) {
  const cycle = cycleFor(state, item?.cycleId)
  const definition = definitionFor(state, item?.programmeId)
  return cycle?.programmeSnapshot?.name || cycle?.programme?.name || definition?.name || definition?.title || item?.programmeId || t('Programme')
}

export function programmeLabelForItem(state, item) {
  const source = sourceOf(state)
  const snapshot = usableRoutine(item?.routineSnapshot)
  const live = (source.routines || []).find(candidate => String(candidate.id) === String(item?.routineId))
  const routine = routineName(snapshot) ? snapshot : (live || snapshot)
  return `${programmeNameForItem(state, item)} · ${routineName(routine) || item?.routineId || t('Routine')}`
}

export function programmeColourForItem(state, item) {
  if (!item) return null
  const cycle = cycleFor(state, item.cycleId)
  const definition = definitionFor(state, item.programmeId)
  const raw = cycle?.programmeSnapshot?.colour ?? cycle?.programmeSnapshot?.color
    ?? cycle?.colour ?? cycle?.color ?? definition?.colour ?? definition?.color
  return COLOURS[String(raw || '').trim().toLowerCase()] || null
}

function materializeCycle(state, cycle, now) {
  const status = String(cycle?.status || '').toLowerCase()
  if (!['active', 'running', 'current', 'completed', 'complete', 'done', 'finished'].includes(status)) return []
  const currentDate = isoAt(now, cycle?.timeZone)
  const anchor = validISO(cycle?.week1StartDate)
    || mondayOnOrAfter(validISO(cycle?.calendarDate) || isoAt(cycle?.startedAt || cycle?.createdAt || now, cycle?.timeZone))
  if (!anchor) return []
  const source = sourceOf(state)
  const records = new Map((source.workouts || []).map(workout => [markerOf(workout), workout]).filter(([id]) => id))
  const skipped = new Set(namespaceOf(state).skippedInstanceIds || [])
  const items = []
  const templateCounts = new Map()
  weeksOf(cycle).forEach(week => daysOf(week).forEach(([day]) => sessionsOf(day).forEach((session, sessionIndex) => {
    const snapshot = session?.routineSnapshot || session?.routine || session?.snapshot || null
    const routineId = session?.routineId ?? snapshot?.id ?? null
    const templateId = session?.sessionTemplateId ?? session?.templateId ?? session?.id ?? `${routineId || 'session'}:${sessionIndex + 1}`
    templateCounts.set(templateId, (templateCounts.get(templateId) || 0) + 1)
  })))
  weeksOf(cycle).forEach((week, weekOffset) => {
    if (week?.rest === true || week?.mode === 'rest') return
    const weekIndex = Number(week?.weekIndex ?? week?.index ?? weekOffset + 1) || weekOffset + 1
    daysOf(week).forEach(([day, rawWeekday]) => {
      const weekday = rawWeekday === 0 ? 7 : Math.max(1, Math.min(7, rawWeekday))
      sessionsOf(day).forEach((session, sessionIndex) => {
        const snapshot = session?.routineSnapshot || session?.routine || session?.snapshot || null
        const routineId = session?.routineId ?? snapshot?.id ?? null
        const templateId = session?.sessionTemplateId ?? session?.templateId ?? session?.id ?? `${routineId || 'session'}:${sessionIndex + 1}`
        const explicitInstanceId = typeof session?.instanceId === 'string' && session.instanceId ? session.instanceId : null
        const instanceId = explicitInstanceId || (templateCounts.get(templateId) > 1
          ? `pi:${cycleId(cycle)}:w${weekIndex}:d${weekday}:o${sessionIndex + 1}:${templateId}`
          : `pi:${cycleId(cycle)}:${templateId}`)
        const record = records.get(instanceId)
        items.push({
          instanceId,
          source: 'programme',
          programmeId: cycleProgrammeId(cycle),
          cycleId: cycleId(cycle),
          routineId,
          routineSnapshot: snapshot,
          weekIndex,
          weekday,
          ordinal: Number(session?.ordinal) || sessionIndex + 1,
          nominalDate: addDays(anchor, (weekIndex - 1) * 7 + weekday - 1),
          projectedDate: null,
          status: record ? 'completed' : skipped.has(instanceId) ? 'skipped' : 'pending',
          record,
        })
      })
    })
  })
  items.sort((a, b) => a.nominalDate.localeCompare(b.nominalDate) || a.ordinal - b.ordinal || a.instanceId.localeCompare(b.instanceId))
  let previousUnsettled = null
  items.forEach(item => {
    const unsettled = item.status === 'pending'
    let projected = item.nominalDate
    if (unsettled && projected <= currentDate) projected = currentDate
    if (unsettled && previousUnsettled && item.nominalDate !== previousUnsettled.nominalDate) {
      const previousShifted = previousUnsettled.projectedDate !== previousUnsettled.nominalDate || previousUnsettled.nominalDate < currentDate
      if (previousShifted && projected <= previousUnsettled.projectedDate) projected = addDays(previousUnsettled.projectedDate, 1)
    }
    item.projectedDate = projected
    if (unsettled) previousUnsettled = item
  })
  const completedCycle = ['completed', 'complete', 'done', 'finished'].includes(status)
  return completedCycle ? items.filter(item => item.status !== 'pending') : items
}

/** Project all programme sessions needed by the weekly selector without mutating persisted state. */
export function programmeItems(state, { now = Date.now() } = {}) {
  const cycles = Array.isArray(namespaceOf(state).cycles) ? namespaceOf(state).cycles : []
  return cycles.flatMap(cycle => materializeCycle(state, cycle, now)).sort((a, b) =>
    a.projectedDate.localeCompare(b.projectedDate)
      || String(a.cycleId).localeCompare(String(b.cycleId))
      || a.ordinal - b.ordinal)
}

export function programmeItemsForDate(state, iso, options) {
  return programmeItems(state, options).filter(item => item.projectedDate === iso)
}
