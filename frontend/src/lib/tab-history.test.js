// Per-tab back stacks over one linear history. The property that matters: history only ever holds
// the tab on screen, so walking back never lands in another tab.
import { describe, expect, it } from 'vitest'
import { deadSteps, emptyNav, onVisitPage, planSwitch, record, settle } from './tab-history.js'

const at = (nav, navType, path, idx) => record(nav, { idx, path, navType })
const push = (nav, path) => at(nav, 'PUSH', path, nav.idx + 1)
// What back presses can reach: the entries up to the current one.
const behind = nav => nav.entries.slice(0, nav.idx + 1)

// What the shell does with a plan: walk back to 0, replace, push the rest, settle.
function carryOut(plan) {
  let next = at(plan.nav, 'POP', plan.nav.entries[0], 0)
  const [first, ...rest] = plan.stack
  next = at(next, 'REPLACE', first, 0)
  for (const p of rest) next = push(next, p)
  return settle(next)
}
const go = (nav, tab, opts) => carryOut(planSwitch(nav, tab, opts))
const start = (path = '/home') => at(emptyNav(), 'POP', path, 0)

describe('mirroring the history', () => {
  it('follows pushes, replaces and pops by position', () => {
    let nav = push(push(start('/train'), '/train/routines'), '/train/routines/a')
    expect(nav.entries).toEqual(['/train', '/train/routines', '/train/routines/a'])
    nav = at(nav, 'POP', '/train', 0)
    expect(nav.idx).toBe(0)
    expect(nav.entries).toHaveLength(3)   // forward is still there…
    nav = push(nav, '/train/history')
    expect(nav.entries).toEqual(['/train', '/train/history'])   // …until a push
  })

  it('a page any tab opens keeps the tab under it', () => {
    expect(push(start('/progress'), '/me').tab).toBe('progress')
    expect(push(start('/food'), '/train/workout').tab).toBe('food')
  })

  it('a new document starts the live history where it is', () => {
    const nav = at(emptyNav(), 'POP', '/progress/body', 0)
    expect(nav.tab).toBe('progress')
    expect(nav.top).toBe(0)
  })

  it('an entry with no position counts as the start', () => {
    expect(at(emptyNav(), 'POP', '/home', undefined).idx).toBe(0)
  })
})

describe('switching tabs', () => {
  it('walks back to the first entry and rebuilds the other tab there', () => {
    const nav = push(push(start('/train'), '/train/routines'), '/train/routines/a')
    const plan = planSwitch(nav, 'food')
    expect(plan.back).toBe(2)
    expect(plan.stack).toEqual(['/food'])
    const after = carryOut(plan)
    // Back reaches Nutrition only: one back press from here leaves the app.
    expect(behind(after)).toEqual(['/food'])
    expect(after.tab).toBe('food')
  })

  it('each of the four tabs comes back where it was left, its back stack intact', () => {
    let nav = push(start('/home'), '/me')
    nav = go(nav, 'train')
    nav = push(push(nav, '/train/history'), '/train/exercises')
    nav = go(nav, 'progress')
    nav = push(nav, '/progress/body')
    nav = go(nav, 'food')
    nav = go(nav, 'train')
    expect(behind(nav)).toEqual(['/train', '/train/history', '/train/exercises'])
    nav = go(nav, 'progress')
    expect(behind(nav)).toEqual(['/progress', '/progress/body'])
    nav = go(nav, 'home')
    expect(behind(nav)).toEqual(['/home', '/me'])
  })

  it('takes a page to land on, on top of the tab\'s stack', () => {
    const nav = go(start('/home'), 'train')
    const back = go(nav, 'home')
    expect(planSwitch(back, 'train', { path: '/train/checkin' }).stack).toEqual(['/train', '/train/checkin'])
  })

  it('puts the leaving tab\'s stack aside without the page that was pushed into the other one', () => {
    // A Profile row opened Routines: the push landed at 2 and is handed to Training.
    const nav = push(start('/home'), '/me')
    const plan = planSwitch({ ...nav, idx: 2 }, 'train', { path: '/train/routines', leaving: nav.entries.slice(0, 2) })
    expect(plan.nav.stacks.home).toEqual(['/home', '/me'])
    expect(plan.stack).toEqual(['/train', '/train/routines'])
  })

  it('keeps one entry for a page that sat on two positions', () => {
    let nav = push(start('/train'), '/train/history')
    nav = at(nav, 'REPLACE', '/train/history', 2)   // a sheet's entry the router replaced
    expect(planSwitch(nav, 'home').nav.stacks.train).toEqual(['/train', '/train/history'])
  })

  it('drops the workout from a stack saved by an older build, too', () => {
    const nav = { ...start('/home'), stacks: { train: ['/train', '/train/workout'], food: ['/food', '/train/workout', '/me'] } }
    expect(planSwitch(nav, 'train').stack).toEqual(['/train'])
    expect(planSwitch(nav, 'food').stack).toEqual(['/food', '/me'])
  })

  it('never keeps the workout in a stack: an ended one would come back as the Start screen', () => {
    const nav = push(push(start('/food'), '/train/workout'), '/me')
    expect(planSwitch(nav, 'home').nav.stacks.food).toEqual(['/food', '/me'])
  })

  it('opening a page the arriving stack already holds goes back to it instead of stacking it twice', () => {
    let nav = go(start('/home'), 'progress')
    nav = at(nav, 'REPLACE', '/progress?range=90', 0)
    nav = push(nav, '/progress/body?range=90')
    nav = go(nav, 'train')
    expect(planSwitch(nav, 'progress', { path: '/progress?range=30' }).stack).toEqual(['/progress?range=30'])
    expect(planSwitch(nav, 'progress', { path: '/progress/load' }).stack).toEqual(['/progress?range=90', '/progress/body?range=90', '/progress/load'])
  })

  it('from the first entry there is nothing to walk back', () => {
    expect(planSwitch(start('/home'), 'food').back).toBe(0)
  })

  it('is nothing to do for the tab on screen, or for no tab', () => {
    expect(planSwitch(start('/home'), 'home')).toBeNull()
    expect(planSwitch(start('/home'), 'me')).toBeNull()
  })
})

describe('the active tab tapped again', () => {
  it('goes back down to its root', () => {
    const nav = push(push(start('/train'), '/train/routines'), '/train/routines/a')
    const plan = planSwitch(nav, 'train', { toRoot: true })
    expect(plan.back).toBe(2)
    expect(plan.stack).toEqual(['/train'])
    expect(behind(carryOut(plan))).toEqual(['/train'])
  })

  it('a root that was opened cold under a sub-page becomes the root again', () => {
    const plan = planSwitch(start('/progress/body'), 'progress', { toRoot: true })
    expect(plan.back).toBe(0)
    expect(plan.stack).toEqual(['/progress'])
  })

  it('is nothing to do on the root itself', () => {
    expect(planSwitch(start('/train'), 'train', { toRoot: true })).toBeNull()
  })
})

describe('the forward history a switch leaves behind', () => {
  it('is dead: a forward step onto it is stepped back off', () => {
    const nav = go(push(push(start('/train'), '/train/history'), '/train/exercises'), 'food')
    expect(deadSteps(nav)).toBe(0)
    const forward = at(nav, 'POP', '/train/history', 1)
    expect(deadSteps(forward)).toBe(1)
    expect(forward.tab).toBe('food')   // not mirrored as a Training page
  })

  it('a page the router puts on a sheet\'s entry is live, not dead forward history', () => {
    // + sheet open on Home (its entry at 1, never a router location), then Start replaces it.
    const nav = at(start('/home'), 'REPLACE', '/train/workout', 1)
    expect(deadSteps(nav)).toBe(0)
    expect(behind(nav)).toEqual(['/home', '/train/workout'])
  })

  it('a back and forward inside one tab is live', () => {
    let nav = push(push(start('/train'), '/train/history'), '/train/exercises')
    nav = at(nav, 'POP', '/train/history', 1)
    nav = at(nav, 'POP', '/train/exercises', 2)
    expect(deadSteps(nav)).toBe(0)
  })
})

describe('a search visit (lib/search/session.js)', () => {
  // Home, its search overlay's entry (pushed by hand, like a sheet's: no location of its own), and
  // another tab's page opened from it.
  const visiting = () => record(start('/home'), { idx: 2, path: '/food?date=2026-10-11&find=u1', navType: 'PUSH', keepTab: true })

  it('keeps another tab\'s page on this tab\'s stack, so back walks to the overlay and Home', () => {
    let nav = visiting()
    expect(nav.tab).toBe('home')
    expect(behind(nav)).toEqual(['/home', undefined, '/food?date=2026-10-11&find=u1'])
    nav = at(nav, 'POP', '/home', 1)
    expect(nav).toMatchObject({ tab: 'home', idx: 1 })
  })

  it('a tab tapped then never puts that page aside with this tab', () => {
    const nav = go(visiting(), 'progress')
    expect(nav.stacks.home).toEqual(['/home'])
    expect(behind(nav)).toEqual(['/progress'])
  })

  it('a link followed from the visited page, or its address replaced, stays on the visit', () => {
    let nav = visiting()
    expect(onVisitPage(nav)).toBe(true)
    nav = at(nav, 'REPLACE', '/food', 2)
    expect(nav).toMatchObject({ tab: 'home', idx: 2 })
    nav = push(nav, '/food/meals')
    expect(nav.tab).toBe('home')
    expect(behind(nav)).toEqual(['/home', undefined, '/food', '/food/meals'])
    // Back down the visit and on to Home, and forward onto it again: still Home's stack.
    nav = at(nav, 'POP', '/food', 2)
    expect(nav.tab).toBe('home')
    nav = at(nav, 'POP', '/home', 0)
    expect(nav.tab).toBe('home')
    expect(onVisitPage(nav)).toBe(false)
    nav = at(nav, 'POP', '/food', 2)
    expect(nav.tab).toBe('home')
    // A tab of its own is never a visit: another tab's page from there is the switch it always was.
    expect(onVisitPage(push(start('/home'), '/home'))).toBe(false)
  })

  it('this tab\'s own button goes back to its root; the lit one goes to that tab\'s root', () => {
    expect(planSwitch(visiting(), 'home', { toRoot: true })).toMatchObject({ stack: ['/home'] })
    let nav = start('/progress')
    nav = push(nav, '/progress/body')
    nav = go(nav, 'home')
    nav = at(nav, 'POP', '/home', 1)
    nav = record(nav, { idx: 2, path: '/progress/strength', navType: 'PUSH', keepTab: true })
    expect(planSwitch(nav, 'progress', { toRoot: true })).toMatchObject({ stack: ['/progress'] })
  })
})
