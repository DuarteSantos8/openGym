// What the community library shows, offers to share and copies in (docs/dev/SHARED-LIBRARY-API.md).
// Pure: no React, no network. The Community screen asks it which of your own things can be shared
// (ownItems), builds what goes to the server, and merges an import into a store draft
// (applyImport), where the copy gets an `origin` that says who made it and when. A copy is yours:
// it is never changed again by the original, and stays when the original stops being shared.
//
// Idea and first version of sharing custom exercises with everyone on a server: davoloko (#441).
import { t } from './i18n.js'
import { uid } from './format.js'
import { normalizeMediaRef } from './media-refs.js'
import { soundsOf, addSound, SOUNDS_MAX } from './user-sounds.js'
import { buildPlanBundle, parsePlan, mergePlan } from './plan-share.js'
import { activeRoutines } from './routine-folders.js'
import { iconChoice } from './streak-icons.js'
import { accentValue } from './accent.js'
import { dayPhotosOf } from './day-photos.js'

/* The kinds, in the order of the Community tabs. `take` false: browse only (a profile picture is
   someone's face; a progress photo is someone's body). */
export const TYPES = [
  { id: 'exercise', label: 'Exercises', one: 'Exercise', icon: 'dumbbell', tint: 'var(--acc)', take: true },
  { id: 'plan', label: 'Plans', one: 'Plan', icon: 'calendar', tint: 'var(--orange)', take: true },
  { id: 'sound', label: 'Sounds', one: 'Sound', icon: 'speaker', tint: 'var(--blue)', take: true },
  { id: 'equipment', label: 'Gyms', one: 'Gym', icon: 'kettlebell', tint: 'var(--purple)', take: true },
  { id: 'tip', label: 'Tips', one: 'Tip', icon: 'lightbulb', tint: 'var(--yellow)', take: true },
  { id: 'look', label: 'Looks', one: 'Look', icon: 'flame', tint: 'var(--pink)', take: true },
  { id: 'measures', label: 'Measurements', one: 'Measurement set', icon: 'ruler', tint: 'var(--teal)', take: true },
  { id: 'photo', label: 'Photos', one: 'Photo', icon: 'image', tint: 'var(--indigo)', take: false, personal: true },
  { id: 'progress', label: 'Progress', one: 'Progress photo', icon: 'image', tint: 'var(--green)', take: false, personal: true },
  { id: 'formvideo', label: 'Form checks', one: 'Form check', icon: 'camera', tint: 'var(--red)', take: false, personal: true },
]
export const TYPE = Object.fromEntries(TYPES.map(x => [x.id, x]))
/** The words of each kind, inside t() so the source-strings check finds them: [tab, one]. */
export const typeWords = () => ({
  exercise: [t('Exercises'), t('Exercise')], plan: [t('Plans'), t('Plan')], sound: [t('Sounds'), t('Sound')],
  equipment: [t('Gyms'), t('Gym')], tip: [t('Tips'), t('Tip')], look: [t('Looks'), t('Look')],
  measures: [t('Measurements'), t('Measurement set')], photo: [t('Photos'), t('Photo')],
  progress: [t('Progress'), t('Progress photo')], formvideo: [t('Form checks'), t('Form check')],
})

/** The tabs this server offers (the profile picture is a switch, not a tab). */
export const browseTypes = lib => TYPES.filter(x => (lib?.types || []).includes(x.id))

const str = (v, n = 60) => (typeof v === 'string' ? v.trim().slice(0, n) : '')
const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v)

/* Of each of your own things, what the share sheet lists: `src` names it for the server (so the
   app can say "Shared" without a marker in the synced state), `title` is a starting point you can
   change, `payload` is what goes up. An imported copy is not offered again: it is not yours to
   hand on as your own. */
export function ownItems(S, type) {
  switch (type) {
    case 'sound':
      return soundsOf(S).filter(x => !originOf((S.sounds || []).find(e => e?.id === x.id))).map(x => ({
        src: 'sound:' + x.id, title: x.name, payload: { name: x.name, m: x.m }, media: [x.m],
      }))
    case 'exercise':
      return (Array.isArray(S.customEx) ? S.customEx : []).filter(c => c && c.id && !c.deleted && !originOf(c)).map(c => {
        const { id, _ts, custom, media, origin, shared, ...ex } = c
        const m = media ? normalizeMediaRef(media) : null
        // A video that stays on the phone it was filmed with goes nowhere.
        const usable = m && !m.local ? m : null
        return { src: 'exercise:' + id, title: str(c.n), payload: { ex, ...(usable ? { media: usable } : {}) }, media: usable ? [usable] : [] }
      })
    case 'plan': {
      const out = []
      const live = activeRoutines(S)
      if (live.some(r => !originOf(r))) {
        try {
          const bundle = buildPlanBundle({ ...S, routines: live.filter(r => !originOf(r)) }, '')
          out.push({ src: 'plan:all', title: t('My plan'), payload: { bundle }, media: bundleMedia(bundle), routines: bundle.routines.length })
        } catch { /* a unit the plan file cannot carry */ }
      }
      for (const r of live.filter(r => r && r.id && !originOf(r))) {
        try {
          const bundle = buildPlanBundle({ ...S, routines: [r], week: {}, programmes: {} }, r.name)
          out.push({ src: 'plan:r:' + r.id, title: str(r.name) || t('Routine'), payload: { bundle }, media: bundleMedia(bundle), routines: 1 })
        } catch { /* as above */ }
      }
      return out
    }
    case 'equipment':
      return (Array.isArray(S.equipProfiles) ? S.equipProfiles : []).filter(p => p && p.id && !originOf(p)).map(p => {
        const { id, _ts, _f, origin, shared, ...profile } = p
        return { src: 'equipment:' + id, title: str(p.name) || t('My gym'), payload: { name: str(p.name), profile } }
      })
    case 'tip':
      return Object.entries(isMap(S.exNotes) ? S.exNotes : {}).filter(([, v]) => typeof v === 'string' && v.trim()).map(([exId, text]) => ({
        src: 'tip:' + exId, exId, title: '', payload: { exId, text: text.trim().slice(0, 500) },
      }))
    case 'look': {
      const flame = iconChoice(S, 'flame'), freeze = iconChoice(S, 'freeze')
      const accent = accentValue(S)
      const payload = { ...(flame ? { flame } : {}), ...(freeze ? { freeze } : {}), ...(accent ? { accent } : {}) }
      return Object.keys(payload).length ? [{ src: 'look:current', title: t('My look'), payload }] : []
    }
    case 'measures': {
      const fields = (Array.isArray(S.customMeasurements) ? S.customMeasurements : []).filter(c => c && c.name).map(c => ({ name: str(c.name, 40), unit: c.unit || 'cm' }))
      return fields.length ? [{ src: 'measures:all', title: t('My measurement fields'), payload: { fields: fields.slice(0, 20) } }] : []
    }
    case 'progress':
      return dayPhotosOf(S).slice(-30).reverse().map(p => ({ src: 'progress:' + p.hash, title: p.d, payload: { media: [p.m], caption: '' }, media: [p.m] }))
    case 'photo': {
      const out = []
      for (const w of (S.workouts || []).slice(-60).reverse()) for (const m of Array.isArray(w?.media) ? w.media : []) {
        const r = normalizeMediaRef(m)
        if (r && !r.local && r.kind !== 'audio') out.push({ src: 'photo:' + r.hash, title: str(w.name) || w.d, payload: { media: [r], caption: '' }, media: [r] })
      }
      return out.slice(0, 40)
    }
    case 'formvideo': {
      const out = []
      for (const w of (S.workouts || []).slice(-60).reverse()) for (const e of Array.isArray(w?.entries) ? w.entries : []) for (const st of Array.isArray(e?.sets) ? e.sets : []) {
        for (const m of Array.isArray(st?.media) ? st.media : []) {
          const r = normalizeMediaRef(m)
          if (r && !r.local && r.kind === 'video') out.push({ src: 'formvideo:' + r.hash, title: w.d, payload: { media: [r], exId: String(e.id || ''), caption: '' }, media: [r] })
        }
      }
      return out.slice(0, 40)
    }
  }
  return []
}

function bundleMedia(bundle) {
  const out = []
  for (const c of bundle?.customEx || []) { const m = c?.media ? normalizeMediaRef(c.media) : null; if (m && !m.local) out.push(m) }
  return out
}

/** Whether this profile already holds a copy of a shared item (a tip lives in a note, so never). */
export function copyOf(S, item) {
  const id = item?.id
  if (!id || !S) return null
  const lists = { sound: S.sounds, exercise: S.customEx, plan: S.routines, equipment: S.equipProfiles, measures: S.customMeasurements }[item.type]
  return (Array.isArray(lists) && lists.find(x => x && !x.deleted && x.origin?.id === id)) || null
}
export const hasCopy = (S, item) => !!copyOf(S, item)
/** A copy of an older version than the one shared now: the card says so, and never overwrites it. */
export const newerThanCopy = (S, item) => { const c = copyOf(S, item); return !!c && (c.origin.version || 1) < (item.version || 1) }

// A copy of this very version already: a newer version comes in as another copy.
const sameCopy = (x, origin) => x?.origin?.id === origin.id && (x.origin.version || 1) >= (origin.version || 1)

/** The `origin` a copy carries, or null. */
export const originOf = x => (x && isMap(x.origin) && x.origin.kind === 'library' && typeof x.origin.id === 'string' ? x.origin : null)

/** "From Anna, taken 5 Nov" for a copy. */
export function originLine(origin, fmtDate) {
  if (!origin) return ''
  const by = origin.by || t('someone who left')
  return origin.at ? t('From {0}, taken {1}', by, fmtDate(origin.at)) : t('From {0}', by)
}

/**
 * Merges an import answer (POST /api/shared/{id}/import) into a store draft. Returns a short
 * sentence for the toast, or throws an Error with a message for the person.
 */
export function applyImport(s, res, { exId } = {}) {
  const type = res?.type
  const p = res?.payload || {}
  const origin = isMap(res?.origin) ? { ...res.origin } : null
  if (!origin) throw new Error(t('That did not work. Try again in a moment.'))
  switch (type) {
    case 'sound': {
      const m = normalizeMediaRef(p.m)
      if (!m || m.kind !== 'audio') throw new Error(t('That sound did not come through.'))
      if ((s.sounds || []).some(e => sameCopy(e, origin))) return t('You have that one already.')
      if (soundsOf(s).length >= SOUNDS_MAX) throw new Error(t('You have {0} sounds already. Remove one first.', SOUNDS_MAX))
      const id = addSound(s, { name: p.name, m })
      const e = s.sounds.find(x => x.id === id)
      if (e) e.origin = origin
      return t('Got it. It is in Settings, Sound now.')
    }
    case 'exercise': {
      if ((s.customEx || []).some(c => !c?.deleted && sameCopy(c, origin))) return t('You have that one already.')
      const ex = isMap(p.ex) ? p.ex : {}
      const m = p.media ? normalizeMediaRef(p.media) : null
      const c = { ...ex, n: str(ex.n, 100) || t('Exercise'), id: 'c' + uid(), custom: true, origin }
      if (m) c.media = m
      ;(s.customEx = s.customEx || []).push(c)
      return t('Got it. It is with your exercises now.')
    }
    case 'plan': {
      const bundle = parsePlan(p.bundle, s.unit == null ? 'kg' : s.unit)
      const before = new Set((s.routines || []).map(r => r.id))
      const beforeEx = new Set((s.customEx || []).map(c => c.id))
      mergePlan(s, bundle, { schedule: false })
      for (const r of s.routines || []) if (!before.has(r.id)) r.origin = origin
      for (const c of s.customEx || []) if (!beforeEx.has(c.id)) c.origin = origin
      return t('Got it. The routines are in your plan now.')
    }
    case 'equipment': {
      const prof = isMap(p.profile) ? p.profile : {}
      ;(s.equipProfiles = s.equipProfiles || []).push({ ...prof, id: uid(), name: str(p.name || prof.name) || t('Gym'), origin })
      return t('Got it. The gym is in Settings, Equipment now.')
    }
    case 'tip': {
      const id = exId || p.exId
      if (!id || typeof p.text !== 'string') throw new Error(t('That tip did not come through.'))
      s.exNotes = isMap(s.exNotes) ? { ...s.exNotes } : {}
      const mine = (s.exNotes[id] || '').trim()
      s.exNotes[id] = mine ? (mine.includes(p.text) ? mine : mine + '\n' + p.text) : p.text
      return t('Got it. It is in your note for this exercise.')
    }
    case 'look': {
      for (const kind of ['flame', 'freeze']) {
        const x = p[kind]
        if (!isMap(x) || typeof x.v !== 'string') continue
        const k = /^[A-Za-z][A-Za-z0-9]*$/.test(x.v) ? 'icon' : 'emoji'
        const next = { k, v: x.v, ...(typeof x.c === 'string' ? { c: x.c } : {}) }
        // Only what this app knows how to draw: anything else stays as it was.
        if (iconChoice({ [kind === 'flame' ? 'flameIcon' : 'freezeIcon']: next }, kind)) s[kind === 'flame' ? 'flameIcon' : 'freezeIcon'] = next
      }
      if (typeof p.accent === 'string') {
        if (/^#[0-9a-f]{6}$/i.test(p.accent)) { s.accent = 'custom'; s.accentCustom = p.accent.toLowerCase() }
        else if (/^[a-z]{3,12}$/.test(p.accent) && accentValue({ accent: p.accent }) === p.accent) s.accent = p.accent
      }
      return t('Got it. Wearing it now.')
    }
    case 'measures': {
      s.customMeasurements = Array.isArray(s.customMeasurements) ? s.customMeasurements : []
      let n = 0
      for (const f of Array.isArray(p.fields) ? p.fields : []) {
        const name = str(f?.name, 60)
        if (!name || s.customMeasurements.some(c => (c.name || '').toLowerCase() === name.toLowerCase())) continue
        const unit = ['cm', 'in', '%', 'kg', 'lb', 'none'].includes(f.unit) ? f.unit : 'cm'
        s.customMeasurements.push({ id: uid(), name, enabled: true, unit, origin })
        n++
      }
      return n ? t('Got it. {0} new fields in Measurements.', n) : t('You have all of these already.')
    }
  }
  throw new Error(t('This kind of item cannot be taken.'))
}

/** The media refs an import answer brings, to fetch into the device's own store. */
export function importedRefs(res) {
  const out = []
  const walk = (v, d) => {
    if (!v || typeof v !== 'object' || d > 10) return
    if (Array.isArray(v)) { v.forEach(x => walk(x, d + 1)); return }
    const r = typeof v.hash === 'string' && typeof v.mime === 'string' ? normalizeMediaRef(v) : null
    if (r) { out.push(r); if (r.poster) out.push({ ...r.poster }); return }
    Object.values(v).forEach(x => walk(x, d + 1))
  }
  walk(res?.payload, 0)
  return out
}

/** The words a list card says under its title. */
export function cardLine(item) {
  const p = item.payload || {}
  switch (item.type) {
    case 'plan': {
      const n = item.summary?.routines?.length ?? (p.bundle?.routines || []).length
      return n === 1 ? t('1 routine') : t('{0} routines', n)
    }
    case 'tip': return p.exName || ''
    case 'measures': return (p.fields || []).map(f => f.name).slice(0, 4).join(', ')
    case 'exercise': return [p.ex?.bp, p.ex?.eq].filter(Boolean).map(x => t(x)).join(' · ')
    case 'sound': return p.m?.dur ? t('{0} s', (Math.round(p.m.dur * 10) / 10).toLocaleString()) : ''
    case 'equipment': {
      const n = (p.profile?.equipment || []).length
      return n ? t('{0} pieces of kit', n) : ''
    }
  }
  return ''
}

/** "by Anna" plus the date, the line every item carries. */
export const bylineOf = (item, fmtDate) => t('by {0} · {1}', item?.by?.name || t('someone who left'), fmtDate(item?.at || item?.createdAt || 0))
