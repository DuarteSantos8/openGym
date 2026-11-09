// The trainer dashboard's side of the API (docs/TRAINERS.md) and the pure helpers its screens
// render with: sorting, filtering, the flags in words, a change in words. Member data fetched here
// is held in component state only, never in the store or localStorage: it is someone else's.
import { api, apiBlob } from './api.js'
import { t } from './i18n.js'
import { todayISO, exerciseNameText, DAYN } from './format.js'
import { exOr } from './exercises.js'

const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body || {}) })
const q = o => Object.entries(o).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')

/** Whether this session sees the dashboard at all: the switch is on and it trains someone or leads a gym. */
export const trainerRoles = config => (config?.trainers?.on ? config.trainers.roles || { trainer: false, lead: false } : { trainer: false, lead: false })
export const showsDashboard = config => { const r = trainerRoles(config); return !!(r.trainer || r.lead) }

/* ---------- the trainer ---------- */
export const getOverview = () => api('/api/trainer')
export const getMembers = () => api('/api/trainer/members?' + q({ today: todayISO() }))
/** One progress photo of a member, as a Blob (the server checks the photos grant for each file). */
export const photoBlob = (memberId, hash) => apiBlob('/api/trainer/member/photo?' + q({ id: memberId, hash }), { expectSize: 25 * 1048576 })
export const getMember = (id, before) => api('/api/trainer/member?' + q({ id, before, today: todayISO() }))
export const sendOps = (memberId, ops, message) => post('/api/trainer/ops', { memberId, ops, message })
export const assignRoutine = ({ memberIds, routineId, day, message }) => post('/api/trainer/assign', { memberIds, routineId, day, message })
export const commentOn = (memberId, workoutId, text) => post('/api/trainer/comment', { memberId, workoutId, text })
export const makeCode = ({ gymId, maxUses, days }) => post('/api/trainer/codes', { gymId, maxUses, days })
export const revokeCode = id => post('/api/trainer/codes/revoke', { id })
export const answerRequest = (id, accept) => post('/api/trainer/requests/answer', { id, accept })
export const dropMember = id => post('/api/trainer/disconnect', { id })
export const leaveGymAsTrainer = gymId => post('/api/trainer/leave-gym', { gymId })

/* ---------- the gym lead ---------- */
export const getGym = id => api('/api/gym?' + q({ id, today: todayISO() }))
export const makeGymCode = gymId => post('/api/gym/code', { gymId })
export const setGymTrainer = (gymId, user, on) => post('/api/gym/staff', { gymId, user, on })

/* ---------- the member ---------- */
export const getInbox = () => api('/api/sharing/inbox')
export const answerItem = (id, accept, extra) => post('/api/sharing/inbox/answer', { id, accept, ...(extra || {}) })
export const markSeen = ids => post('/api/sharing/inbox/seen', ids ? { ids } : {})
export const undoChange = (id, force) => post('/api/sharing/undo', { id, force: !!force })
export const previewGrant = id => api('/api/sharing/preview?' + q({ grant: id, today: todayISO() }))

/* ---------- helpers ---------- */
/** An exercise's name: the member's own custom exercise from the projection, else the catalogue. */
export function exName(id, customEx) {
  const c = (customEx || []).find(x => String(x.id) === String(id))
  if (c?.name) return c.name
  const e = exOr(id)
  return e.missing ? t('Unknown exercise') : exerciseNameText(e)
}

export const initials = name => {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] || '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}
// A stable tint per person, from the app's own palette, so a face is easy to find again.
const TINTS = ['var(--blue)', 'var(--green)', 'var(--orange)', 'var(--teal)', 'var(--indigo)', 'var(--pink)', 'var(--purple)', 'var(--mint)']
export const tintOf = id => { let h = 0; for (const c of String(id || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return TINTS[h % TINTS.length] }

// Flags that ask for the trainer's attention, most urgent first; a PR is good news, not a worry.
const ATTENTION = { missed: 3, inactive: 4, pending: 1, weight: 1, pr: 0 }
export const attentionOf = m => (m.paused ? -1 : (m.summary?.flags || []).reduce((n, f) => n + (ATTENTION[f.kind] || 0), 0))

/** The list as the search field and the sort menu say. Paused connections always sink. */
export function sortMembers(list, sort = 'attention', query = '', filter = 'all') {
  const needle = String(query || '').trim().toLowerCase()
  const hit = m => !needle || String(m.member?.name || '').toLowerCase().includes(needle)
  const has = (m, k) => (m.summary?.flags || []).some(f => f.kind === k)
  const keep = m => filter === 'all' ? true
    : filter === 'attention' ? attentionOf(m) > 0
    : filter === 'pr' ? has(m, 'pr')
    : filter === 'inactive' ? has(m, 'inactive') || (m.summary?.lastWorkout === null)
    : true
  const last = m => m.summary?.lastWorkout || ''
  const by = {
    name: (a, b) => String(a.member?.name || '').localeCompare(String(b.member?.name || '')),
    last: (a, b) => (last(a) < last(b) ? 1 : last(a) > last(b) ? -1 : 0),
    streak: (a, b) => (b.summary?.streak ?? -1) - (a.summary?.streak ?? -1),
    attention: (a, b) => attentionOf(b) - attentionOf(a) || (last(a) < last(b) ? -1 : last(a) > last(b) ? 1 : 0),
  }[sort] || (() => 0)
  return list.filter(m => hit(m) && keep(m)).sort((a, b) => (!!a.paused - !!b.paused) || by(a, b) || by.name(a, b))
}

/** One flag as a short pill: { kind, text, tone }. */
export function flagText(f, exNames) {
  switch (f.kind) {
    case 'missed': return { kind: f.kind, tone: 'warn', icon: 'calendar', text: t('Missed {0} planned', f.n) }
    case 'inactive': return { kind: f.kind, tone: 'warn', icon: 'moon', text: t('Quiet for {0} days', f.days) }
    case 'pr': {
      const one = f.n === 1 && f.ex?.[0] ? exName(f.ex[0], exNames) : null
      return { kind: f.kind, tone: 'good', icon: 'trophy', text: one ? t('PR: {0}', one) : t('{0} new PRs', f.n) }
    }
    case 'weight': return { kind: f.kind, tone: 'info', icon: 'scale', text: t('{0} kg in 2 weeks', (f.delta > 0 ? '+' : '') + f.delta) }
    case 'pending': return { kind: f.kind, tone: 'info', icon: 'envelope', text: t('{0} waiting for an answer', f.n) }
    default: return { kind: f.kind, tone: 'info', icon: 'info', text: f.kind }
  }
}

export const weekdayName = d => t(DAYN[d] || '')

/** A change or suggestion in words: "New routine: Full body", "Weigh-in: 68.1 on 5 Nov". */
export function changeText(s, unit = 'kg') {
  switch (s?.kind) {
    case 'routine.put': return s.isNew ? t('New routine: {0}', s.name) : t('Routine updated: {0}', s.name)
    case 'routine.remove': return t('Routine removed: {0}', s.name)
    case 'week.set': return s.name ? t('{0}: {1}', weekdayName(s.day), s.name) : t('{0}: rest day', weekdayName(s.day))
    case 'week.add': return t('On {0}s: {1}', weekdayName(s.day), s.name)
    case 'custom.put': return s.kept ? null : t('Exercise added: {0}', s.name)
    case 'bodyweight.put': return t('Weigh-in: {0} {1} on {2}', s.w, unit, s.d)
    case 'measurement.put': return t('Check-in on {0}', s.d)
    case 'workout.add': return t('Workout logged: {0}', s.name)
    case 'workout.edit': return t('Workout corrected: {0}', s.name)
    default: return s?.kind || ''
  }
}
export const changeLines = (summary, unit) => (summary || []).map(s => changeText(s, unit)).filter(Boolean)

/** What came back from an assignment, as one toast. */
export function assignResult(r) {
  const parts = []
  if (r.applied) parts.push(t('{0} added directly', r.applied))
  if (r.suggested) parts.push(t('{0} sent as a suggestion', r.suggested))
  if (r.skipped) parts.push(t('{0} skipped', r.skipped))
  return parts.join(', ') || t('Nothing to do.')
}

/** How an assignment will land for one member, from what they share: before anything is sent. */
export const assignOutcome = levels => (levels?.plans === 'apply' ? 'applied' : levels?.plans === 'suggest' ? 'suggested' : 'skipped')

/** Why a trainer request came back refused, in the app's words. */
export function trainerError(e) {
  const code = e?.data?.code
  if (code === 'not-shared') return t('They do not share that with you any more.')
  if (code === 'level') return t('They did not let you change that.')
  if (code === 'not-synced') return t('They have not synced with the server yet.')
  if (code === 'rate-limited') return t('Too many tries. Give it a few minutes.')
  if (code === 'changed-since') return t('You changed it since. Undo anyway?')
  if (code === 'expired' || code === 'not-open') return t('That one is not open any more.')
  if (code === 'no-user') return t('No account with that id.')
  if (code === 'not-free') return t('They can’t train people privately on this server, so there’s nothing to keep.')
  return e?.message || t('Something went wrong.')
}
