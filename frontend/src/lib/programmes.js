import { isoOf, todayISO, startOfWeek, weekDayOffset, weekStartOf } from './format.js'
import { POLICIES } from './progression.js'
import { normalizeProgrammeNamespace } from './programme-compat.js'

const clone = value => JSON.parse(JSON.stringify(value))
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key)
const asDate = value => value instanceof Date ? new Date(value) : new Date(value ?? Date.now())
const instant = value => asDate(value).toISOString()
const makeId = prefix => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`
export const PROGRAMME_COLOURS = ['lime', 'sky', 'orange', 'gold', 'violet', 'pink', 'teal']
export const PROGRAMME_WEEK_MODES = ['normal', 'deload', 'rest']

function localDate(value, timeZone = 'UTC') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(asDate(value))
  const get = type => parts.find(part => part.type === type)?.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

function addDays(iso, count) {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + count)).toISOString().slice(0, 10)
}

const daysBetween = (from, to) => Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000)

const compareOccurrences = (a, b) => String(a.date || '').localeCompare(String(b.date || '')) || (Number(a.ordinal) || 0) - (Number(b.ordinal) || 0) || String(a.instanceId || '').localeCompare(String(b.instanceId || ''))

function namespace(state) {
  state.programmes = normalizeProgrammeNamespace(state.programmes)
  return state.programmes
}

const progressionOf = value => String(value || 'linear').trim() || 'linear'
const routineFor = (state, session) => session?.routineSnapshot || (state.routines || []).find(routine => String(routine.id) === String(session?.routineId))

function routineSnapshot(routine, progression, weekMode = 'normal') {
  if (!routine) throw new Error('Every Programme session must reference an existing routine')
  const frozen = clone(routine)
  if (!frozen.prog) frozen.programmeProgression = progression
  if (weekMode === 'deload') frozen.excludeFromProgression = true
  else delete frozen.excludeFromProgression
  return frozen
}

export const programmeWeekMode = value => PROGRAMME_WEEK_MODES.includes(value) ? value : 'normal'

export function cycleWeekMode(week, mode) {
  return { ...clone(week || {}), mode: programmeWeekMode(mode) }
}

export function programmeProgressionOptions(weeks, state = {}) {
  // A Programme supplies a default. Each exercise resolves its supported policy.
  return [...POLICIES]
}

function identityOf(session, key, fallback) {
  if (!hasOwn(session, key)) return fallback
  const value = String(session[key]).trim()
  if (!value) throw new Error('Every Programme session needs a non-blank identity')
  return value
}

function normalizedWeeks(weeks, state, programmeId, progression) {
  if (!Array.isArray(weeks) || weeks.length < 1) throw new Error('A Programme needs at least one week')
  if (weeks.length > 52) throw new Error('A Programme cannot exceed 52 weeks')
  const occurrences = new Set()
  const templates = new Set()
  return weeks.map((sourceWeek, weekOffset) => {
    const grouped = new Map()
    const mode = programmeWeekMode(sourceWeek?.mode)
    for (const sourceDay of sourceWeek?.days || []) {
      const weekday = Number(sourceDay.weekday)
      if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) continue
      const target = grouped.get(weekday) || { ...clone(sourceDay), weekday, sessions: [] }
      for (const sourceSession of sourceDay?.sessions || []) {
        const slot = target.sessions.length + 1
        const fallback = `${programmeId}:w${weekOffset + 1}:d${weekday}:s${slot}`
        const sessionTemplateId = identityOf(sourceSession, 'sessionTemplateId', fallback)
        const id = identityOf(sourceSession, 'id', fallback)
        if (templates.has(sessionTemplateId) || occurrences.has(id)) {
          throw new Error('Every Programme session needs unique occurrence and template identity')
        }
        const routine = routineFor(state, sourceSession)
        const routineId = String(routine?.id ?? '').trim()
        if (!routineId) throw new Error('Every Programme session needs a non-blank routine identity')
        templates.add(sessionTemplateId)
        occurrences.add(id)
        target.sessions.push({
          ...clone(sourceSession), id, sessionTemplateId, routineId,
          routineSnapshot: routineSnapshot(routine, progression, mode),
        })
      }
      grouped.set(weekday, target)
    }
    return {
      ...clone(sourceWeek), weekIndex: weekOffset + 1, mode,
      days: [...grouped.values()].sort((a, b) => a.weekday - b.weekday),
    }
  })
}

const hasScheduledSession = weeks => weeks.some(week => week.mode !== 'rest' && week.days.some(day => day.sessions.length))

function freshSession(session) {
  return { ...clone(session), id: makeId('programme-session'), sessionTemplateId: makeId('programme-template') }
}

function freshWeek(sourceWeek, weekIndex) {
  return {
    ...clone(sourceWeek), weekIndex,
    days: (sourceWeek?.days || []).map(day => ({
      ...clone(day),
      sessions: (day.sessions || []).map(freshSession),
    })),
  }
}

function emptyWeek(weekIndex) {
  return { weekIndex, mode: 'normal', days: Array.from({ length: 7 }, (_, weekday) => ({ weekday, sessions: [] })) }
}

export function programmeBuilderSources(state = {}) {
  return [
    { value: 'current', label: 'My current week', kind: 'current' },
    { value: 'blank', label: 'Blank programme', kind: 'blank' },
    ...namespace(state).definitions.map(definition => ({
      value: `programme:${definition.id}`, label: definition.name, kind: 'programme', definition,
    })),
  ]
}

export function programmeWeeksFromSource(state = {}, source = 'current', length = 8) {
  const count = Math.max(1, Math.min(52, Math.round(Number(length) || 1)))
  if (source === 'blank') return Array.from({ length: count }, (_, index) => emptyWeek(index + 1))
  if (source === 'current') {
    return Array.from({ length: count }, (_, index) => {
      const week = emptyWeek(index + 1)
      week.days = week.days.map(day => {
        const routineId = state.week?.[day.weekday]
        const routine = (state.routines || []).find(item => String(item.id) === String(routineId))
        return routine ? { ...day, sessions: [freshSession({ routineId: routine.id, routineSnapshot: routine })] } : day
      })
      return week
    })
  }
  const id = String(source).startsWith('programme:') ? String(source).slice('programme:'.length) : ''
  const definition = namespace(state).definitions.find(item => String(item.id) === id)
  if (!definition) return Array.from({ length: count }, (_, index) => emptyWeek(index + 1))
  return Array.from({ length: count }, (_, index) => freshWeek(definition.weeks?.[index] || emptyWeek(index + 1), index + 1))
}

export function setProgrammeDaySessions(weeks, weekOffset, weekday, sessions) {
  return (weeks || []).map((week, index) => {
    if (index !== weekOffset) return week
    const prior = (week.days || []).find(day => Number(day.weekday) === Number(weekday))
    const day = { ...clone(prior || {}), weekday: Number(weekday), sessions: clone(sessions || []) }
    const days = (week.days || []).filter(item => Number(item.weekday) !== Number(weekday)).map(clone)
    days.push(day); days.sort((left, right) => left.weekday - right.weekday)
    return { ...clone(week), days }
  })
}

export function copyProgrammeWeekToTargets(weeks, sourceOffset, targetOffsets) {
  if (!Array.isArray(weeks) || !Number.isInteger(sourceOffset) || !weeks[sourceOffset]) return weeks
  const targets = new Set((targetOffsets || []).filter(index => Number.isInteger(index) && index >= 0 && index < weeks.length && index !== sourceOffset))
  if (!targets.size) return weeks
  return weeks.map((week, index) => targets.has(index)
    ? { ...clone(week), ...freshWeek(weeks[sourceOffset], week.weekIndex ?? index + 1), weekIndex: week.weekIndex ?? index + 1 }
    : week)
}

export function createProgrammeDefinition(input = {}, state = {}, options = {}) {
  const suppliedId = hasOwn(options, 'id') ? options.id : hasOwn(input, 'id') ? input.id : null
  const id = String(suppliedId ?? makeId('programme')).trim()
  if (!id) throw new Error('A Programme needs a non-blank identity')
  const existing = options.existing || state.programmes?.definitions?.find(definition => definition?.id === id) || {}
  const name = String(input.name || '').trim()
  if (!name) throw new Error('A Programme needs a name')
  const progression = progressionOf(input.progression)
  if (!programmeProgressionOptions(input.weeks, state).includes(progression)) {
    throw new Error('The selected Programme progression is not compatible with every session')
  }
  const weeks = normalizedWeeks(input.weeks, state, id, progression)
  if (!hasScheduledSession(weeks)) throw new Error('A Programme needs at least one session')
  const inputColour = hasOwn(input, 'colour') ? input.colour : hasOwn(input, 'color') ? input.color : undefined
  const colour = inputColour === undefined ? existing.colour
    : inputColour === null ? null
    : PROGRAMME_COLOURS.includes(inputColour) ? inputColour
      : existing.colour !== undefined && !PROGRAMME_COLOURS.includes(existing.colour) ? existing.colour : undefined
  return {
    ...clone(existing), id, name, progression, colour, emoji: input.emoji ?? existing.emoji, lengthWeeks: weeks.length, weeks,
    createdAt: input.createdAt || existing.createdAt || instant(options.now), updatedAt: instant(options.now),
  }
}

export function addProgrammeDefinitionInState(state, definition) {
  const definitions = namespace(state).definitions
  const index = definitions.findIndex(item => item.id === definition.id)
  const saved = clone(definition)
  if (index < 0) definitions.push(saved); else definitions[index] = saved
  return saved
}

export const programmeDefinitionOf = (state, id) => namespace(state).definitions.find(item => item.id === id) || null
export const activeProgrammeCycles = state => namespace(state).cycles.filter(cycle => cycle.status === 'active')
export function readyProgrammeDefinitions(state) {
  const active = new Set(activeProgrammeCycles(state).map(cycle => cycle.programmeId))
  return namespace(state).definitions.filter(definition => !active.has(definition.id))
}

function materialize(cycle) {
  const result = []
  // The deployed writer marks its cycles with programmeRevision and uses pi: identities.
  // Public foundation cycles keep their own identity contract; never relabel saved history.
  const legacy = hasOwn(cycle, 'programmeRevision')
  const weeks = cycle.snapshot?.weeks || []
  const templateOf = session => session.sessionTemplateId ?? (legacy ? session.templateId ?? session.id : undefined)
  const counts = new Map()
  if (legacy) for (const week of weeks) for (const day of week.days || []) for (const session of day.sessions || []) {
    const id = templateOf(session)
    if (!session.instanceId && id) counts.set(id, (counts.get(id) || 0) + 1)
  }
  for (const [weekOffset, week] of weeks.entries()) {
    if (programmeWeekMode(week?.mode) === 'rest') continue
    for (const day of week.days || []) {
      if (legacy && (day.rest === true || day.mode === 'rest')) continue
      for (const [sessionIndex, session] of (day.sessions || []).entries()) {
        const sessionTemplateId = templateOf(session)
        if (typeof sessionTemplateId !== 'string' || !sessionTemplateId) continue
        const weekday = Number(day.weekday)
        const ordinal = session.ordinal ?? sessionIndex + 1
        const legacyId = counts.get(sessionTemplateId) > 1
          ? `pi:${cycle.id}:w${weekOffset + 1}:d${weekday === 0 ? 7 : weekday}:o${ordinal}:${sessionTemplateId}`
          : `pi:${cycle.id}:${sessionTemplateId}`
        const routineSnapshot = session.routineSnapshot || (legacy ? session.routine || session.snapshot : null)
        result.push({
          ...clone(session), cycleId: cycle.id, programmeId: cycle.programmeId,
          sessionTemplateId,
          ...(legacy ? { routineSnapshot, routineId: session.routineId ?? routineSnapshot?.id ?? sessionTemplateId } : {}),
          programmeName: cycle.name, progression: cycle.progression, weekIndex: weekOffset + 1,
          weekday, ordinal,
          date: addDays(cycle.week1StartDate, weekOffset * 7 + weekDayOffset(weekday, legacy ? 1 : cycle.weekStart)),
          instanceId: legacy ? session.instanceId || legacyId : `${cycle.id}:${sessionTemplateId}`,
        })
      }
    }
  }
  return result
}
function completedInstances(state, cycleId) {
  return new Set((state.workouts || [])
    // Preserved partial history is not evidence that a prescribed session was completed.
    .filter(workout => workout.partial !== true && workout.complete !== false && workout.owed !== true)
    .filter(workout => (workout.programmeInstance?.cycleId || workout.cycleId) === cycleId)
    .map(workout => workout.programmeInstance?.instanceId || workout.programmeInstanceId || workout.instanceId)
    .filter(Boolean))
}

export function startProgrammeCycleInState(state, definitionOrId, options = {}) {
  const programmes = namespace(state)
  const matches = typeof definitionOrId === 'string'
    ? programmes.definitions.filter(definition => definition?.id === definitionOrId)
    : [definitionOrId]
  if (matches.length !== 1) throw new Error('Programme definition identity must be unique')
  const definition = matches[0]
  if (!definition?.id) throw new Error('Programme not found')
  if (programmes.cycles.some(cycle => cycle.programmeId === definition.id && cycle.status === 'active')) {
    throw new Error('This Programme already has an active cycle')
  }
  const progression = progressionOf(definition.progression)
  if (!programmeProgressionOptions(definition.weeks, state).includes(progression)) throw new Error('Programme progression is not compatible')
  const weeks = normalizedWeeks(definition.weeks, state, definition.id, progression)
  if (!hasScheduledSession(weeks)) throw new Error('A Programme needs at least one session')
  const now = options.now ?? Date.now()
  const timeZone = options.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const weekStart = options.weekStart ?? weekStartOf(state)
  const week1StartDate = options.week1StartDate || isoOf(startOfWeek(localDate(now, timeZone), weekStart))
  const snapshot = { ...clone(definition), progression, lengthWeeks: weeks.length, weeks }
  const cycleId = String(hasOwn(options, 'id') ? options.id : makeId('cycle')).trim()
  if (!cycleId) throw new Error('A Programme cycle needs a non-blank cycle identity')
  if (programmes.cycles.some(cycle => cycle?.id === cycleId)) throw new Error('Programme cycle identity must be unique')
  const cycle = {
    id: cycleId, programmeId: definition.id, name: definition.name, emoji: definition.emoji,
    status: 'active', progression, colour: definition.colour, lengthWeeks: weeks.length, weekStart, week1StartDate,
    timeZone, startedAt: instant(now), updatedAt: instant(now),
    snapshot: { weeks: clone(weeks) }, programmeSnapshot: snapshot,
  }
  programmes.cycles.push(cycle)
  return cycle
}

function seedFreshEditIdentities(weeks) {
  return clone(weeks).map(week => ({ ...week, days: (week.days || []).map(day => ({
    ...day,
    sessions: (day.sessions || []).map(session => {
      if (hasOwn(session, 'id') || hasOwn(session, 'sessionTemplateId')) return session
      const id = makeId('session')
      return { ...session, id, sessionTemplateId: id }
    }),
  })) }))
}

function protectedEditError(state, cycle, nextWeeks) {
  const beforeItems = materialize(cycle)
  const before = new Map(beforeItems.map(item => [item.instanceId, item]))
  const preview = { ...cycle, snapshot: { weeks: nextWeeks }, lengthWeeks: nextWeeks.length }
  const after = new Map(materialize(preview).map(item => [item.instanceId, item]))
  const completed = completedInstances(state, cycle.id)
  const activeId = state.active?.programmeInstance?.instanceId || state.active?.programmeInstanceId
  for (const [instanceId, previous] of before) {
    const kind = completed.has(instanceId) ? 'completed' : activeId === instanceId ? 'active' : null
    if (!kind) continue
    const next = after.get(instanceId)
    if (!next || next.id !== previous.id || next.sessionTemplateId !== previous.sessionTemplateId ||
        next.weekIndex !== previous.weekIndex || next.weekday !== previous.weekday || next.ordinal !== previous.ordinal || next.date !== previous.date ||
        next.routineId !== previous.routineId || JSON.stringify(next.routineSnapshot) !== JSON.stringify(previous.routineSnapshot)) {
      return `Cannot change a ${kind} occurrence`
    }
  }
  return null
}

export function updateActiveProgrammeCycleInState(state, cycleId, input = {}, options = {}) {
  const cycle = namespace(state).cycles.find(item => item.id === cycleId && item.status === 'active')
  if (!cycle) throw new Error('Active Programme cycle not found')
  const draft = createProgrammeDefinition({
    id: cycle.programmeId, name: input.name ?? cycle.name,
    progression: input.progression ?? cycle.progression,
    colour: hasOwn(input, 'colour') ? input.colour : cycle.colour,
    emoji: input.emoji ?? cycle.emoji ?? cycle.programmeSnapshot?.emoji,
    weeks: seedFreshEditIdentities(input.weeks || cycle.snapshot.weeks),
    createdAt: cycle.programmeSnapshot?.createdAt || cycle.startedAt,
  }, state, { id: cycle.programmeId, now: options.now, existing: cycle.programmeSnapshot })
  const error = protectedEditError(state, cycle, draft.weeks)
  if (error) throw new Error(error)
  cycle.name = draft.name
  cycle.progression = draft.progression
  cycle.colour = draft.colour
  cycle.emoji = draft.emoji
  cycle.lengthWeeks = draft.lengthWeeks
  cycle.snapshot = { ...clone(cycle.snapshot || {}), weeks: clone(draft.weeks) }
  cycle.programmeSnapshot = draft
  cycle.updatedAt = instant(options.now)
  settleProgrammeCycleInState(state, cycle.id, options)
  return cycle
}

export function completeProgrammeCycleInState(state, cycleId, options = {}) {
  const cycle = namespace(state).cycles.find(item => item.id === cycleId && item.status === 'active')
  if (!cycle) throw new Error('Active Programme cycle not found')
  cycle.status = 'completed'
  cycle.completedAt = instant(options.now)
  cycle.completionReason = options.reason || 'completed'
  cycle.updatedAt = cycle.completedAt
  return cycle
}

export function currentProgrammeProjection(state, options = {}) {
  const result = { cycles: {}, items: [] }
  for (const cycle of activeProgrammeCycles(state)) {
    const today = localDate(options.now ?? Date.now(), cycle.timeZone || options.timeZone || 'UTC')
    const calendarWeek = Math.floor(daysBetween(cycle.week1StartDate, today) / 7) + 1
    const currentWeek = Math.max(1, Math.min(cycle.lengthWeeks || 1, calendarWeek))
    const completed = completedInstances(state, cycle.id)
    const inCalendar = item => typeof options.calendarThrough === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(options.calendarThrough)
      && item.date >= today && item.date <= options.calendarThrough
    const sessions = materialize(cycle)
    const weekProgress = Array.from({ length: cycle.lengthWeeks || 1 }, (_, index) => {
      const week = sessions.filter(item => item.weekIndex === index + 1)
      return { total: week.length, completed: week.filter(item => completed.has(item.instanceId)).length }
    })
    const items = sessions.filter(item => item.weekIndex <= currentWeek || inCalendar(item)).flatMap(item => {
      const done = completed.has(item.instanceId)
      if (done && item.weekIndex !== currentWeek && !inCalendar(item)) return []
      return [{ ...item, status: done ? 'completed' : item.date === today ? 'due' : 'pending' }]
    }).sort(compareOccurrences)
    result.cycles[cycle.id] = { currentWeek, items, weekProgress }
    result.items.push(...items)
  }
  result.items.sort(compareOccurrences)
  return result
}

export function programmeCycleItems(state, cycle) {
  const completed = completedInstances(state, cycle.id)
  return materialize(cycle).map(item => ({ ...item, status: completed.has(item.instanceId) ? 'completed' : 'pending' }))
}

export function programmeStartDisposition(active, item) {
  if (!active) return 'start'
  const instanceId = active.programmeInstance?.instanceId || active.programmeInstanceId
  return instanceId && instanceId === item?.instanceId ? 'resume' : 'blocked'
}

// Keep duplicate routines separate when they belong to different Programme occurrences.
export function programmeSessionsForDate(state, date) {
  if (!state.programmeMode) return []
  return activeProgrammeCycles(state).flatMap(cycle => programmeCycleItems(state, cycle)
    .filter(item => item.date === date)
    .map(item => ({ ...item, programmeName: cycle.name, colour: cycle.colour })))
    .sort(compareOccurrences)
}

// Home and Start share the next overdue occurrence; the dated calendar stays unchanged.
export function programmeSessionsForStart(state, date, today = todayISO()) {
  const scheduled = programmeSessionsForDate(state, date)
  if (!state.programmeMode || date !== today) return scheduled
  const overdue = activeProgrammeCycles(state).flatMap(cycle => {
    if (scheduled.some(item => item.cycleId === cycle.id)) return []
    const item = programmeCycleItems(state, cycle)
      .filter(item => item.date < today && item.status !== 'completed')
      .sort(compareOccurrences)[0]
    return item ? [{ ...item, programmeName: cycle.name, colour: cycle.colour }] : []
  })
  return [...overdue, ...scheduled]
}

export function programmeWorkoutSource(item) {
  if (!item?.instanceId || !item?.cycleId || !item?.programmeId) throw new Error('Invalid Programme session')
  return {
    programmeId: item.programmeId, cycleId: item.cycleId, programmeInstanceId: item.instanceId,
    programmeInstance: {
      version: 1, instanceId: item.instanceId, cycleId: item.cycleId,
      programmeId: item.programmeId, sessionTemplateId: item.sessionTemplateId,
      weekIndex: item.weekIndex, weekday: item.weekday, ordinal: item.ordinal, date: item.date,
    },
  }
}

export function settleProgrammeCycleInState(state, cycleId, options = {}) {
  const cycle = namespace(state).cycles.find(item => item.id === cycleId && item.status === 'active')
  if (!cycle) return false
  const sessions = materialize(cycle)
  const completed = completedInstances(state, cycle.id)
  if (!sessions.length || new Set(sessions.map(item => item.instanceId)).size !== sessions.length) return false
  if (!sessions.every(item => completed.has(item.instanceId))) return false
  completeProgrammeCycleInState(state, cycle.id, { ...options, reason: 'completed' })
  return true
}

export function settleProgrammeWorkoutInState(state, workout, options = {}) {
  const instance = workout?.programmeInstance
  const cycleId = instance?.cycleId || workout?.cycleId
  const instanceId = instance?.instanceId || workout?.programmeInstanceId
  if (!cycleId || !instanceId) return false
  return settleProgrammeCycleInState(state, cycleId, options)
}

export const programmeEditorInputForCycle = cycle => cycle ? {
  id: cycle.programmeId, name: cycle.name, progression: cycle.progression, colour: cycle.colour, emoji: cycle.emoji ?? cycle.programmeSnapshot?.emoji,
  weeks: clone(cycle.snapshot?.weeks || []),
} : null
