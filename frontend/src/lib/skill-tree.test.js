import { describe, it, expect } from 'vitest'
import { SKILLS, SKILL_IDS, BRANCHES, SKILL_FAMILIES, haveOf, skillStatus, missingBefore, skillsAfter, withSkill, withoutSkill, countOf, familyIds, openSkills, muscleLevels, muscleIds, treeItems, treeGrid, skillOfExercise, earnedSkills, withEarned, newlyHad } from './skill-tree.js'
import { SKILL_LOGGED } from './skill-tree-data.js'
import { mergeStampedMap } from './sync-merge.js'
import { MUSCLES } from './muscles.js'
import { EXIDX } from './exercises.js'

const have = (...ids) => Object.fromEntries(ids.map(id => [id, '2026-11-01']))

describe('the data', () => {
  it('has every skill once, every branch rooted, every tier 1 to 4', () => {
    expect(SKILL_IDS.length).toBe(244)
    expect(new Set(SKILL_IDS).size).toBe(SKILL_IDS.length)
    for (const b of BRANCHES) if (b.from) expect(SKILLS[b.from], b.name).toBeTruthy()
    for (const id of SKILL_IDS) expect([1, 2, 3, 4]).toContain(SKILLS[id].tier)
    for (const f of SKILL_FAMILIES) expect(familyIds(f.id).length).toBeGreaterThan(0)
  })
  it('names only muscles the body map draws, and catalogue exercises that exist', () => {
    for (const b of BRANCHES) for (const m of b.muscles) expect(MUSCLES, b.name).toContain(m)
    for (const id of SKILL_IDS) if (SKILLS[id].ex) expect(EXIDX[SKILLS[id].ex], id).toBeTruthy()
  })
})

describe('status', () => {
  it('opens the first skill of a family branch, and each skill once the one before is had', () => {
    expect(skillStatus({}, 'push-up')).toBe('locked')
    expect(skillStatus({}, 'incline-push-up')).toBe('open')
    expect(skillStatus(have('incline-push-up'), 'push-up')).toBe('open')
    expect(skillStatus(have('incline-push-up'), 'incline-push-up')).toBe('done')
  })
  it('opens a side branch from the skill it grows out of', () => {
    expect(SKILLS['l-hang'].req).toBe('row')
    expect(skillStatus(have('row'), 'l-hang')).toBe('open')
  })
  it('reads S.skills, a taken-back entry and an unknown id as not had', () => {
    const h = haveOf({ skills: { row: { at: '2026-11-01', _ts: 1 }, dip: { _ts: 2 }, nope: { at: '2026-11-01' } } })
    expect(h).toEqual({ row: '2026-11-01' })
  })
})

describe('ticking and taking back', () => {
  it('ticks the skills before it, on that day, and leaves the ones already had alone', () => {
    const map = withSkill({ 'incline-push-up': { at: '2026-10-01', _ts: 1 } }, 'diamond-push-up', 5, '2026-11-04')
    expect(map['diamond-push-up']).toEqual({ at: '2026-11-04', _ts: 5 })
    expect(map['push-up']).toEqual({ at: '2026-11-04', _ts: 5 })
    expect(map['incline-push-up']).toEqual({ at: '2026-10-01', _ts: 1 })
    expect(missingBefore(haveOf({ skills: map }), 'diamond-push-up')).toEqual([])
  })
  it('ticks across branches: a front lever brings the rows before it', () => {
    const h = haveOf({ skills: withSkill({}, 'front-lever', 1, '2026-11-04') })
    expect(h.row && h['incline-row'] && h['vertical-row'] && h['tuck-front-lever']).toBeTruthy()
  })
  it('takes back what comes after, side branches included, as stamped empty entries', () => {
    const map = withSkill({}, 'one-arm-push-up', 1, '2026-11-01')
    const out = withoutSkill(map, 'push-up', 9)
    expect(out['push-up']).toEqual({ _ts: 9 })
    expect(out['one-arm-push-up']).toEqual({ _ts: 9 })
    expect(out['incline-push-up'].at).toBe('2026-11-01')
    expect(skillsAfter('push-up')).toContain('ring-push-up')
  })
  it('keeps both devices’ skills and a later take-back through the sync merge', () => {
    const phone = withSkill({}, 'row', 10, '2026-11-01')
    const laptop = withSkill({}, 'push-up', 20, '2026-11-02')
    const merged = mergeStampedMap(laptop, phone)
    expect(Object.keys(haveOf({ skills: merged }))).toEqual(expect.arrayContaining(['row', 'push-up', 'incline-push-up']))
    const back = withoutSkill(merged, 'row', 30)
    expect(haveOf({ skills: mergeStampedMap(phone, back) }).row).toBeUndefined()
  })
})

describe('counts and the body', () => {
  it('counts done and open over a family', () => {
    const c = countOf(have('incline-push-up', 'push-up'), familyIds('hpush'))
    expect(c.done).toBe(2)
    expect(c.total).toBe(familyIds('hpush').length)
    expect(openSkills(have('incline-push-up', 'push-up'), familyIds('hpush'))[0]).toBe('diamond-push-up')
  })
  it('shades a muscle by the share of its skills had, and only the family asked for', () => {
    expect(muscleLevels({}).quadriceps).toBe(1)
    const ids = muscleIds('quadriceps')
    expect(muscleLevels(have(...ids)).quadriceps).toBe(4)
    expect(muscleLevels({}, 'legs').chest).toBeUndefined()
  })
})

describe('the tree', () => {
  it('shows a branch compact: the stack it has, where it is, the next one and the rest', () => {
    const h = haveOf({ skills: withSkill({}, 'archer-row', 1) })
    const rows = treeItems('hpull', h).filter(it => it.branch === 'Rows')
    expect(rows.map(it => it.kind)).toEqual(['done', 'skill', 'skill', 'skill', 'more'])
    expect(rows[0].ids).toEqual(['vertical-row', 'incline-row', 'row', 'wide-row'])
    expect(rows[1].key).toBe('archer-row')
    expect(rows[4].ids).toEqual(['one-arm-row'])
  })
  it('hides a branch that grows out of a hidden skill, and shows everything with all', () => {
    const compact = treeItems('hpull', {})
    expect(compact.some(it => it.branch === 'Iron Cross')).toBe(false)
    const all = treeItems('hpull', {}, { all: true })
    expect(all.length).toBe(familyIds('hpull').length)
    expect(treeItems('hpull', {}, { open: { Rows: true } }).filter(it => it.branch === 'Rows').length).toBe(8)
  })
  it('lays a tree out with one cell per item, a branch down one column', () => {
    const items = treeItems('hpush', {}, { all: true })
    const g = treeGrid(items)
    const cells = new Set(items.map(it => g.pos[it.key].col + ':' + g.pos[it.key].row))
    expect(cells.size).toBe(items.length)
    const pushUps = BRANCHES.find(b => b.name === 'Push Up').ids
    expect(new Set(pushUps.map(id => g.pos[id].col)).size).toBe(1)
    for (const it of items) if (it.parent !== 'hub') expect(g.pos[it.key].row).toBe(g.pos[it.parent].row + 1)
  })
})

describe('from the log', () => {
  const wk = (d, entries, end) => ({ d, end: end ?? Date.parse(d + 'T18:00:00'), entries })
  const sets = (...xs) => xs.map(x => (typeof x === 'number' ? { done: true, r: x } : { done: true, ...x }))
  it('maps only catalogue exercises that exist, onto skills that exist', () => {
    for (const [name, ids] of Object.entries(SKILL_LOGGED)) {
      expect(SKILLS[name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')], name).toBeTruthy()
      for (const x of ids) expect(EXIDX[x], name + ' ' + x).toBeTruthy()
    }
  })
  it('reads the user\u2019s own exercises by name', () => {
    const S = { customEx: [{ id: 'c1', n: 'Tuck L-Sit jambes alternées' }, { id: 'c2', n: 'Pompes en Pike' }, { id: 'c3', n: 'Rows à un bras' }] }
    expect(skillOfExercise(S, 'c1')).toBe('tuck-l-sit')
    expect(skillOfExercise(S, 'c2')).toBe('pike-push-up')
    expect(skillOfExercise(S, 'c3')).toBe('one-arm-row')
    expect(skillOfExercise(S, '0652')).toBe('pull-up')
    expect(skillOfExercise(S, 'nope')).toBe(null)
  })
  it('needs a real set at the bar: five reps, a hold long enough, one side of a per-side entry', () => {
    const S = { workouts: [
      wk('2026-10-01', [{ id: '0652', sets: sets(4, 4) }, { id: '0662', sets: sets({ r: 20, warmup: true, phase: 'warmup' }, 6) }]),
      wk('2026-10-02', [{ id: '1402', sets: sets({ sec: 7 }) }, { id: '6545', sets: sets({ sec: 30 }) }]),
      wk('2026-10-03', [{ id: '2569', target: { side: true }, sets: sets(8) }, { id: '1401', sets: [{ done: false, r: 3 }] }]),
    ] }
    const got = earnedSkills(S)
    expect(Object.keys(got).sort()).toEqual(['push-up', 'wall-handstand'])
    expect(got['push-up'].day).toBe('2026-10-01')
  })
  it('ticks what the log shows and the skills before it, and keeps a take-back made after it', () => {
    const S = { workouts: [wk('2026-10-25', [{ id: '0652', sets: sets(7) }])] }
    const earned = earnedSkills(S)
    const map = withEarned({}, earned, 1)
    expect(map['pull-up']).toEqual({ at: '2026-10-25', _ts: 1 })
    expect(map['scapular-pull'].at).toBe('2026-10-25')
    expect(newlyHad({}, map)).toContain('pull-up')
    const later = Date.parse('2026-10-26T12:00:00')
    const back = { 'pull-up': { _ts: later } }
    expect(withEarned(back, earned, 2)).toBe(back)
    const before = { 'pull-up': { _ts: 5 } }
    expect(withEarned(before, earned, 9)['pull-up'].at).toBe('2026-10-25')
    expect(withEarned(map, earned, 3)).toBe(map)
  })
})
