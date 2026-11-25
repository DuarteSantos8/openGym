// Bodyweight skill trees (views/Skills.jsx): which skills someone has, which they can go for
// next, and how the trees are drawn. The data is lib/skill-tree-data.js.
//
// Stored per skill, the way a day note is (lib/day-notes.js):
//
//   S.skills = { 'front-lever': { at: '2026-11-04', _ts }, 'planche': { _ts }, … }
//
// An entry with `at` is a skill someone has; a bare `{ _ts }` is one taken back. Each skill keeps
// the time it was last written, so two devices that each ticked a different skill keep both
// (lib/sync-merge.js mergeStampedMap), and a skill taken back stays taken back.
//
// The rules a game's skill tree has:
//   - a skill is open once the one before it is had (the first of a family's branch always is);
//   - ticking a skill ticks everything before it too: whoever holds a front lever has the tuck;
//   - taking one back takes back everything after it, which can only have come from it.
import { SKILL_FAMILIES, SKILL_BRANCHES, SKILL_EXERCISE, SKILL_LOGGED, SKILL_NAMED } from './skill-tree-data.js'
import { MUSCLES } from './muscles.js'
import { todayISO } from './format.js'
import { isPerSide } from './history.js'
import { isWarmupRow } from './workout-model.js'

export { SKILL_FAMILIES }

export const TIER_NAME = { 1: 'Beginner', 2: 'Intermediate', 3: 'Advanced', 4: 'Elite' }
/** A tier's own key where its English name has another sense in the packs ('Advanced' is the
 *  settings word there): views/Skills.jsx shows it when the language has it, else TIER_NAME. */
export const TIER_KEY = { 3: 'Advanced (skill tier)' }
export const TIER_COLOR = { 1: 'var(--teal)', 2: 'var(--blue)', 3: 'var(--purple)', 4: 'var(--orange)' }
export const TIER_ROMAN = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV' }

export const skillId = name => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v)

/** Every skill by id: { id, name, tier, url, fam, branch, bi, req, kids, ex, muscles }. */
export const SKILLS = {}
/** The branches with their skill ids: { fam, name, from, muscles, ids }. */
export const BRANCHES = SKILL_BRANCHES.map((b, bi) => {
  let prev = b.from ? skillId(b.from) : null
  const ids = b.skills.map(([name, tier, url]) => {
    const id = skillId(name)
    SKILLS[id] = { id, name, tier, url: url || null, fam: b.fam, branch: b.name, bi, req: prev, kids: [], ex: SKILL_EXERCISE[name] || null, muscles: b.muscles }
    prev = id
    return id
  })
  return { fam: b.fam, name: b.name, from: b.from ? skillId(b.from) : null, muscles: b.muscles, ids }
})
export const SKILL_IDS = BRANCHES.flatMap(b => b.ids)
for (const id of SKILL_IDS) { const r = SKILLS[id].req; if (r && SKILLS[r]) SKILLS[r].kids.push(id) }

/** The skills had, as { id: 'YYYY-MM-DD' } (a date-less entry reads as had, on an unknown day). */
export function haveOf(S) {
  const m = isMap(S?.skills) ? S.skills : {}
  const out = {}
  for (const [id, e] of Object.entries(m)) if (SKILLS[id] && isMap(e) && e.at) out[id] = e.at
  return out
}

/** 'done' | 'open' | 'locked' for skill `id`, given `have` from haveOf. */
export function skillStatus(have, id) {
  if (have[id]) return 'done'
  const r = SKILLS[id]?.req
  return !r || have[r] ? 'open' : 'locked'
}

/** The skills before `id` that `have` lacks, nearest first. */
export function missingBefore(have, id) {
  const out = []
  for (let r = SKILLS[id]?.req; r; r = SKILLS[r].req) if (!have[r]) out.push(r)
  return out
}

/** Everything after `id`: its branch onwards and every branch growing out of those. */
export function skillsAfter(id) {
  const out = []
  const walk = x => SKILLS[x].kids.forEach(k => { out.push(k); walk(k) })
  if (SKILLS[id]) walk(id)
  return out
}

/** S.skills with `id` and the skills before it ticked on `day`, each stamped `now`. A skill before
 *  it already had keeps its day but takes the new stamp: a take-back of it from another device,
 *  older than this tick, must not leave this skill without what comes before it after the merge. */
export function withSkill(map, id, now = Date.now(), day = todayISO()) {
  if (!SKILLS[id]) return map
  const out = { ...(isMap(map) ? map : {}) }
  const have = haveOf({ skills: out })
  for (let x = id; x; x = SKILLS[x].req) out[x] = { at: have[x] || day, _ts: now }
  return out
}

/** S.skills with `id` and everything after it taken back, as stamped empty entries: every one of
 *  them, had here or not, so a tick of a later skill on another device, older than this, stays
 *  taken back after the merge. */
export function withoutSkill(map, id, now = Date.now()) {
  if (!SKILLS[id]) return map
  const out = { ...(isMap(map) ? map : {}) }
  for (const x of [id, ...skillsAfter(id)]) out[x] = { _ts: now }
  return out
}

/* ---------------------------- skills shown by the log ---------------------------- */
// The trees fill in by themselves from what gets logged: a skill is had once one real set of
// its exercise (warm-ups aside) reaches the bar for its tier. Five clean reps or a 20 s hold
// for a beginner skill, 10 s for a harder hold, and a single rep from Advanced up, where one
// muscle-up or one-arm pull-up already is the skill.

const SKILL_OF_EXERCISE = {}
for (const [name, exIds] of Object.entries(SKILL_LOGGED)) for (const x of exIds) SKILL_OF_EXERCISE[x] = skillId(name)
// A skill's own catalogue exercise (the rung a branch trains it on, lib/skill-ladder.js) shows it
// too, unless the list above already gives that exercise to a skill.
for (const [name, x] of Object.entries(SKILL_EXERCISE)) if (!SKILL_OF_EXERCISE[x]) SKILL_OF_EXERCISE[x] = skillId(name)

export const repsToHave = tier => (tier >= 3 ? 1 : 5)
export const secondsToHave = tier => (tier === 1 ? 20 : 10)

/** The skill a logged exercise shows, if any: a catalogue id, or one of `S.customEx` by its name (`n`). */
export function skillOfExercise(S, exId) {
  if (SKILL_OF_EXERCISE[exId]) return SKILL_OF_EXERCISE[exId]
  // The custom exercise a branch made for its skill (lib/skill-ladder.js): 'sk-' and the skill's id.
  if (typeof exId === 'string' && exId.startsWith('sk-') && SKILLS[exId.slice(3)]) return exId.slice(3)
  const own = (Array.isArray(S?.customEx) ? S.customEx : []).find(c => c?.id === exId)
  if (!own) return null
  const name = String(own.n || own.name || '')
  // A skill's own name first ("Handstand", "L-Sit Pull Up"), then the patterns that also read
  // other wordings and languages, where a shorter skill's pattern could match a longer name.
  if (SKILLS[skillId(name)]) return skillId(name)
  const hit = SKILL_NAMED.find(([re]) => re.test(name))
  return hit ? skillId(hit[1]) : null
}

/** Whether one logged set reaches the bar for `id`. A per-side entry counts one side's reps. */
export function setShowsSkill(id, set, cfg) {
  if (!set?.done || isWarmupRow(set)) return false
  const tier = SKILLS[id].tier
  const reps = Number(set.r) || 0
  if (reps > 0) return (isPerSide(cfg) ? reps / 2 : reps) >= repsToHave(tier)
  return (Number(set.sec) || 0) >= secondsToHave(tier)
}

/** What the log shows: { [id]: { day: first session that did, t: last one that did (ms) } }. */
export function earnedSkills(S) {
  const out = {}
  for (const w of Array.isArray(S?.workouts) ? S.workouts : []) {
    const t = Number(w?.end) || Number(w?.start) || Date.parse(String(w?.d) + 'T12:00:00') || 0
    for (const e of Array.isArray(w?.entries) ? w.entries : []) {
      const id = skillOfExercise(S, e?.id)
      if (!id || !SKILLS[id] || !(Array.isArray(e.sets) ? e.sets : []).some(s => setShowsSkill(id, s, e.target))) continue
      const o = out[id]
      if (!o) out[id] = { day: w.d, t }
      else {
        if (String(w.d) < String(o.day)) o.day = w.d
        if (t > o.t) o.t = t
      }
    }
  }
  return out
}

/**
 * S.skills with what the log shows ticked, on the day it first showed (the skills before it
 * too). A skill someone took back stays taken back unless a session after that shows it again.
 * A skill already had keeps its day, but a newer session showing it moves its stamp (and its
 * prerequisites') up to that session's time, so a take-back older than the session cannot win
 * the merge on another device. Returns `map` itself when there is nothing new.
 */
export function withEarned(map, earned, now = Date.now()) {
  let out = isMap(map) ? map : {}
  // By tier, then by the day each first showed: a skill before another in the same tier takes its
  // own first day, never the day of a later skill that ticked it on the way.
  const ids = Object.keys(earned || {}).filter(id => SKILLS[id])
    .sort((a, b) => SKILLS[a].tier - SKILLS[b].tier || String(earned[a].day).localeCompare(String(earned[b].day)))
  for (const id of ids) {
    const e = out[id], t = earned[id].t
    if (isMap(e) && e.at) {
      if ((Number(e._ts) || 0) < t) out = restamped(out, id, t, earned[id].day)
      continue
    }
    if (isMap(e) && (Number(e._ts) || 0) >= t) continue
    out = withSkill(out, id, now, earned[id].day)
  }
  return out === map ? map : out
}

// `id` and the skills before it stamped at `t` (a session's time) where their stamp is older,
// their day kept; one taken back before `t` is had again from `day`.
function restamped(map, id, t, day) {
  const out = { ...map }
  for (let x = id; x; x = SKILLS[x].req) {
    const cur = out[x]
    if ((Number(cur?._ts) || 0) >= t) continue
    out[x] = isMap(cur) && cur.at ? { ...cur, _ts: t } : { at: day, _ts: t }
  }
  return out
}

/** The ids `next` has that `prev` lacked, chart order. */
export const newlyHad = (prev, next) => {
  const a = haveOf({ skills: prev }), b = haveOf({ skills: next })
  return SKILL_IDS.filter(id => b[id] && !a[id])
}

/** The names a "from your sessions" note shows: the skills the log proved, three at most, then +N. */
export function provedNames(gained, earned) {
  const proved = gained.filter(id => earned[id])
  const ids = proved.length ? proved : gained
  const names = ids.slice(0, 3).map(id => SKILLS[id].name)
  return ids.length > 3 ? names.join(', ') + ' +' + (ids.length - 3) : names.join(', ')
}

/** { done, total, open } over `ids`. */
export function countOf(have, ids) {
  let done = 0, open = 0
  for (const id of ids) { const s = skillStatus(have, id); if (s === 'done') done++; else if (s === 'open') open++ }
  return { done, total: ids.length, open }
}

export const familyIds = fam => SKILL_IDS.filter(id => SKILLS[id].fam === fam)

/** The open skills, easiest first, then in chart order. */
export function openSkills(have, ids = SKILL_IDS) {
  return ids.filter(id => skillStatus(have, id) === 'open')
    .sort((a, b) => SKILLS[a].tier - SKILLS[b].tier || SKILLS[a].bi - SKILLS[b].bi)
}

/** The skills that train `muscle` (a lib/muscles.js slug), optionally of one family. */
export const muscleIds = (muscle, fam) => SKILL_IDS.filter(id => SKILLS[id].muscles.includes(muscle) && (!fam || SKILLS[id].fam === fam))

/**
 * BodyMap `levels` (0 to 4) from the share of each muscle's skills someone has: 1 for a muscle
 * with skills but none had yet, so the map still shows which muscles the trees reach.
 */
export function muscleLevels(have, fam) {
  const out = {}
  for (const m of MUSCLES) {
    const ids = muscleIds(m, fam)
    if (!ids.length) continue
    const r = countOf(have, ids).done / ids.length
    out[m] = r === 0 ? 1 : r < 0.25 ? 2 : r < 0.6 ? 3 : 4
  }
  return out
}

/**
 * What a family's tree draws. Compact: each branch shows the skills it has as one stack (keeping
 * the last one, which later branches may grow out of), the skill it is on, the one after, and the
 * rest as one "+N". A branch growing out of a hidden skill waits until its parent is shown.
 * `all` shows everything; `open` names the branches shown in full.
 *
 * Returns the items in drawing order: { key, kind: 'skill'|'done'|'more', ids, branch, parent }.
 */
export function treeItems(fam, have, { all = false, open = {} } = {}) {
  const items = []
  const at = {}                                     // skill id → the item that shows it
  for (const b of BRANCHES) {
    if (b.fam !== fam) continue
    let parent = 'hub'
    if (b.from) { parent = at[b.from]; if (!parent) continue }
    const add = (key, kind, ids, shown = true) => {
      items.push({ key, kind, ids, branch: b.name, parent })
      if (shown) ids.forEach(id => { at[id] = key })
      parent = key
    }
    if (all || open[b.name]) { b.ids.forEach(id => add(id, 'skill', [id])); continue }
    let k = 0
    while (k < b.ids.length && have[b.ids[k]]) k++
    if (k >= 2) add('done:' + b.name, 'done', b.ids.slice(0, k - 1))
    if (k >= 1) add(b.ids[k - 1], 'skill', [b.ids[k - 1]])
    const rest = b.ids.slice(k)
    rest.slice(0, 2).forEach(id => add(id, 'skill', [id]))
    if (rest.length > 2) add('more:' + b.name, 'more', rest.slice(2), false)
  }
  return items
}

/**
 * Grid positions for treeItems: { pos: { key: { col, row } }, hub: { col, row: 0 }, cols, rows }.
 * Each branch keeps one column; a branch growing out of another takes the next free column to
 * the right, and the family's hub sits over the middle of its first skills.
 */
export function treeGrid(items) {
  const byKey = Object.fromEntries(items.map(it => [it.key, { ...it, kids: [] }]))
  for (const it of items) if (it.parent !== 'hub') byKey[it.parent].kids.push(it.key)
  const pos = {}
  let col = 0, rows = 0
  const place = (key, row) => {
    rows = Math.max(rows, row)
    const it = byKey[key]
    const same = it.kids.filter(k => byKey[k].branch === it.branch)
    const side = it.kids.filter(k => byKey[k].branch !== it.branch)
    let c
    for (const k of [...same, ...side]) { const kc = place(k, row + 1); if (c === undefined) c = kc }
    if (c === undefined) c = col++
    pos[key] = { col: c, row }
    return c
  }
  const roots = items.filter(it => it.parent === 'hub').map(it => place(it.key, 1))
  const hub = { col: roots.length ? (Math.min(...roots) + Math.max(...roots)) / 2 : 0, row: 0 }
  return { pos, hub, cols: Math.max(1, col), rows: rows + 1 }
}
