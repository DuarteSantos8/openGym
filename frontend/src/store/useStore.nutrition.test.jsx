// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, expect, test, vi } from 'vitest'
vi.mock('../lib/api.js', () => ({ api: vi.fn(), setRemoteAuth: vi.fn() }))
import { api } from '../lib/api.js'
import { DEF, hasData, useStore } from './useStore.js'
import { useUI } from './useUI.js'
import { askAddDeviceData } from '../sheets.jsx'
import { localExtras, visibleOptionalEntries, mergeStates } from '../lib/sync-merge.js'
import fixture from '../lib/__fixtures__/contracts/nutrition-entry.json'
import { createEntry } from '../lib/nutrition/entry.js'
import { addEntry, changeEntry, deleteEntry, undoEntry } from '../lib/nutrition/diary.js'
import { exportBackupZip, readBackupFile } from '../lib/backup-media.js'
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = structuredClone
const visible = S => visibleOptionalEntries(S, 'nutritionEntries')
const base = () => ({ ...clone(DEF), nutritionEntries: [clone(fixture)] })
const snapshot = () => clone(useStore.getState().S)
const mutate = (S, fn) => { useStore.setState({ S: clone(S), user: null }); useStore.getState().update(fn, false); return snapshot() }
beforeEach(() => { localStorage.clear(); api.mockReset(); useUI.setState({ sheets: [] }); useStore.setState({ S: clone(DEF), user: null, ready: true }) })
afterEach(() => { useStore.setState({ user: null, ready: false }); useUI.setState({ sheets: [] }); localStorage.clear() })
test('diary-only guests are data, and only visible guest-only rows are adoption extras', () => {
  expect(localExtras(base(), {})).toMatchObject({ nutritionEntries: 1 })
  expect(localExtras(base(), base()).nutritionEntries || 0).toBe(0)
  expect(localExtras({ ...base(), deleted: { nutritionEntries: { [fixture.id]: 10 } } }, {}).nutritionEntries || 0).toBe(0)
})
test('diary-only profiles count as data for initial sync and kept copies', () => expect(hasData(base())).toBe(true))
test('deletion-only diary state remains data even with no visible or retained rows', () => {
  expect(hasData({ ...clone(DEF), deleted: { nutritionEntries: { [fixture.id]: 123 } } })).toBe(true)
})
test('Keep profile as is preserves a food logged for the account while adoption was pending', async () => {
  let stored = { ...clone(DEF), _ts: 5 }
  api.mockImplementation(async (path, opt) => {
    if (opt?.method === 'PUT') { stored = JSON.parse(opt.body).state; return { ok: true, rev: 2 } }
    return { state: clone(stored), rev: 1 }
  })
  useStore.setState({ S: base(), user: null })
  useStore.getState().setUser({ id: 'pending-account' }, { adopt: true })
  let answer
  const pending = useStore.getState().adoptProfile(() => new Promise(r => { answer = r }))
  await new Promise(r => setTimeout(r, 0))
  const later = createEntry({ label: 'Account food', day: '2026-11-14', meal: 'snack' })
  useStore.getState().update(s => addEntry(s, later), false)
  answer(false); await pending
  expect(visible(stored).map(e => e.id)).toEqual([later.id])
  expect(visible(useStore.getState().S).map(e => e.id)).toEqual([later.id])
})
test('the real adoption question describes nutrition rather than a nonexistent plan', async () => {
  const pending = askAddDeviceData({ workouts: 0, bodyweight: 0, customEx: 0, nutritionEntries: 1 })
  const sheet = useUI.getState().sheets.at(-1)
  const element = sheet.render(() => {})
  expect(element.props.message).toMatch(/nutrition/i)
  element.props.onCancel(); await pending
})
for (const choice of ['Add them', 'Keep profile as is']) test(`actual adoption sheet: diary-only guest chooses ${choice}`, async () => {
  const remote = { ...clone(DEF), restSec: 77, _ts: 5 }
  let stored = clone(remote)
  api.mockImplementation(async (path, opt) => {
    if (opt?.method === 'PUT') { stored = JSON.parse(opt.body).state; return { ok: true, rev: 2 } }
    return { state: clone(stored), rev: 1 }
  })
  useStore.setState({ S: base(), user: { id: 'synthetic' } })
  const pending = useStore.getState().adoptProfile(askAddDeviceData)
  await new Promise(r => setTimeout(r, 0))
  const sheet = useUI.getState().sheets.at(-1)
  expect(sheet, 'nutrition must ask before adoption').toBeTruthy()
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  try {
    await act(async () => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
    expect(host.textContent).toMatch(/nutrition/i)
    await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === choice).click())
    await pending
    expect(useStore.getState().S.restSec).toBe(77)
    if (choice === 'Add them') {
      expect(visible(stored).map(e => e.id)).toEqual([fixture.id])
      expect(visible(useStore.getState().S)).toHaveLength(1)
    } else {
      expect(visible(stored)).toEqual([])
      expect(visible(useStore.getState().S)).toEqual([])
      expect(await useStore.getState().keptChanges()).toHaveLength(1)
    }
  } finally { act(() => root.unmount()); host.remove() }
})
test('real updates persist fields, delete and undo; both merge orders converge through the two-device matrix', () => {
  const initial = base(), id = fixture.id
  const pear = createEntry({ label: 'Pear', day: '2026-11-14', meal: 'snack' })
  const bread = createEntry({ label: 'Bread', day: '2026-11-14', meal: 'lunch' })
  const cases = [
    [mutate(initial, s => addEntry(s, pear)), mutate(initial, s => addEntry(s, bread)), 3],
    [mutate(initial, s => changeEntry(s, id, { proteinG: 9 })), mutate(initial, s => changeEntry(s, id, { fatG: 6 })), 1],
    [mutate(initial, s => changeEntry(s, id, { label: 'A' })), mutate(initial, s => changeEntry(s, id, { label: 'Z' })), 1],
    [mutate(initial, s => changeEntry(s, id, { fatG: 6 })), mutate(initial, s => deleteEntry(s, id)), 0],
  ]
  for (const [a, b, count] of cases) {
    const ab = mergeStates(a, b), ba = mergeStates(b, a)
    expect(visible(ab)).toHaveLength(count)
    expect([...visible(ab)].sort((a,b) => a.id.localeCompare(b.id))).toEqual([...visible(ba)].sort((a,b) => a.id.localeCompare(b.id)))
  }
  const edited = cases[1]
  expect(visible(mergeStates(...edited))[0]).toMatchObject({ proteinG: 9, fatG: 6 })
  const joined = mergeStates(...cases[3])
  const restored = mutate(joined, s => undoEntry(s, id))
  for (const merged of [mergeStates(restored, cases[3][0]), mergeStates(cases[3][0], restored)]) {
    expect(visible(merged)[0]).toMatchObject({ fatG: 6, _f: joined.nutritionEntries[0]._f })
  }
  expect(JSON.parse(localStorage.getItem('gym_state_v1')).nutritionEntries).toEqual(restored.nutritionEntries)
  expect(visible(mergeStates(cases[3][1], initial, { prefer: 'b' }))).toHaveLength(1)
})
test('offline update reconnects through real store 409 merge and retry', async () => {
  const mine = mutate(base(), s => changeEntry(s, fixture.id, { proteinG: 12 }))
  const remote = mutate(base(), s => changeEntry(s, fixture.id, { fatG: 8 }))
  useStore.setState({ S: mine, user: { id: 'synthetic' }, ready: true })
  localStorage.setItem('gym_sync', JSON.stringify({ rev: 1, ts: fixture._ts }))
  api.mockRejectedValueOnce(new TypeError('offline'))
  await useStore.getState().pushState()
  expect(visible(useStore.getState().S)[0].proteinG).toBe(12)
  api.mockRejectedValueOnce(Object.assign(new Error('conflict'), { status: 409, data: { state: remote, rev: 2 } }))
  api.mockResolvedValueOnce({ ok: true, rev: 3 })
  await useStore.getState().pushState()
  expect(visible(useStore.getState().S)[0]).toMatchObject({ proteinG: 12, fatG: 8 })
  expect(JSON.parse(localStorage.getItem('gym_sync')).rev).toBe(3)
})
for (const zip of [false, true]) test(`${zip ? 'ZIP' : 'JSON'} export/read/import keeps deletes and restores a live backup`, async () => {
  const live = base(), deleted = mutate(live, s => deleteEntry(s, fixture.id))
  for (const [state, count] of [[deleted, 0], [live, 1]]) {
    const blob = zip ? (await exportBackupZip(state, { media: { get: async () => null } })).blob : new Blob([JSON.stringify(state)])
    const read = await readBackupFile(new File([blob], zip ? 'diary.zip' : 'diary.json'))
    useStore.getState().importBackup(read.state)
    expect(visible(useStore.getState().S)).toHaveLength(count)
    expect(useStore.getState().S.nutritionEntries).toHaveLength(1)
  }
})
test('reset prevents a stale replay from resurrecting entries', async () => {
  useStore.setState({ S: base() })
  await useStore.getState().resetEverything()
  expect(visible(mergeStates(useStore.getState().S, base()))).toEqual([])
})
for (const action of ['add', 'edit', 'delete', 'undo']) test(`retained malformed elements do not block real-store ${action}`, () => {
  const malformed = [null, false, 17, [], { opaque: 'future payload' }]
  const S = { ...base(), nutritionEntries: [...malformed, clone(fixture)] }
  if (action === 'undo') S.deleted = { nutritionEntries: { [fixture.id]: 123 } }
  const added = createEntry({ label: 'New food', day: fixture.day, meal: 'snack' })
  const result = mutate(S, s => {
    if (action === 'add') addEntry(s, added)
    if (action === 'edit') changeEntry(s, fixture.id, { label: 'Edited food' })
    if (action === 'delete') deleteEntry(s, fixture.id)
    if (action === 'undo') undoEntry(s, fixture.id)
  })
  expect(result.nutritionEntries.slice(0, malformed.length)).toEqual(malformed)
  expect(visible(result)).toHaveLength(action === 'add' ? 2 : action === 'delete' ? 0 : 1)
  if (action === 'edit') expect(visible(result)[0].label).toBe('Edited food')
})
for (const keep of [false, true]) for (const deleted of [false, true]) for (const changedServer of [false, true]) {
  test(`empty-account delayed adoption: add guest=${keep}, later deleted=${deleted}, server changes=${changedServer}`, async () => {
    let stored = null, rev = 0, puts = 0
    api.mockImplementation(async (path, opt) => {
      if (opt?.method === 'PUT') {
        const body = JSON.parse(opt.body)
        expect(body.baseRev).toBe(rev)
        stored = body.state; puts++; rev++
        return { ok: true, rev }
      }
      return { state: clone(stored), rev }
    })
    useStore.setState({ S: base(), user: null })
    useStore.getState().setUser({ id: 'empty-account' }, { adopt: { alwaysAsk: true } })
    let answer
    const pending = useStore.getState().adoptProfile(() => new Promise(r => { answer = r }))
    await new Promise(r => setTimeout(r, 0))
    const later = createEntry({ label: 'Account food', day: fixture.day, meal: 'snack' })
    useStore.getState().update(s => { addEntry(s, later); if (deleted) deleteEntry(s, later.id) }, false)
    const remote = createEntry({ label: 'Remote food', day: fixture.day, meal: 'snack' })
    if (changedServer) { stored = { ...clone(DEF), nutritionEntries: [remote], _ts: 5 }; rev = 7 }
    answer(keep); await pending
    const ids = [keep && fixture.id, !deleted && later.id, changedServer && remote.id].filter(Boolean).sort()
    expect(visible(useStore.getState().S).map(e => e.id).sort()).toEqual(ids)
    expect(puts).toBeGreaterThan(0)
    expect(visible(stored).map(e => e.id).sort()).toEqual(ids)
    if (deleted) {
      expect(stored.nutritionEntries.some(e => e.id === later.id)).toBe(true)
      expect(stored.deleted.nutritionEntries[later.id]).toBeGreaterThan(0)
    }
  })
}
