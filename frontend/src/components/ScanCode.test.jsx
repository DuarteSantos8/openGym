// @vitest-environment happy-dom
// Plan > Scan a QR code and links into the routines library: a scan goes where a tap on the same
// link would go, a library routine is fetched into the plan import sheet (with its author), and
// one that cannot be fetched offers the website instead, at an address no app filter claims.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ toasts: [], imports: [], confirms: [], routine: [], tags: [], opened: [], web: true, scanned: null, sheets: [], details: [], machineSheets: [], which: [], unlinked: [], nfc: false }))

vi.mock('../store/useStore.js', () => {
  const useStore = sel => sel({ S: { unit: 'kg' } })
  useStore.getState = () => ({ S: { unit: 'kg' }, config: {} })
  return { useStore }
})
vi.mock('../store/useUI.js', () => {
  const ui = { toast: msg => m.toasts.push(msg), openSheet: r => { m.sheets.push(r); return { close: () => {} } } }
  const useUI = sel => (sel ? sel(ui) : ui)
  useUI.getState = () => ui
  return { useUI }
})
vi.mock('../sheets.jsx', () => ({ planImportSheet: b => m.imports.push(b), confirmSheet: o => m.confirms.push(o), exerciseDetailSheet: ex => m.details.push(ex?.id) }))
vi.mock('../lib/nfc.js', () => ({ nfcReadSupport: async () => ({ supported: m.nfc, enabled: true, mode: 'hold' }) }))
vi.mock('./ScanMachine.jsx', () => ({ scanMachineSheet: o => m.machineSheets.push(o), whichExerciseSheet: o => m.which.push(o), unlinkedCodeSheet: o => m.unlinked.push(o) }))
vi.mock('../lib/scan-route.js', async orig => {
  const real = await orig()
  return { ...real, routeScannedText: (raw, o) => /^MACHINE/.test(raw) ? { kind: 'machine', code: raw, ids: raw === 'MACHINE2' ? ['0025', '0027'] : ['0025'] } : real.routeScannedText(raw, o) }
})
vi.mock('./RoutineShare.jsx', () => ({ openRoutinePayload: async p => { m.routine.push(p); return true } }))
vi.mock('./Nfc.jsx', () => ({ handleTagLink: u => { m.tags.push(u); return true } }))
vi.mock('../lib/scan.js', () => ({ MODULE_MISSING: 'module-missing', webScanner: async () => m.web, scanCode: async () => { if (m.scanned instanceof Error) throw m.scanned; return m.scanned } }))
vi.mock('../lib/routine-library.js', () => ({ indexUrl: () => 'https://opengym.ch/routines/index.json', communityEntries: async () => [{ url: 'https://opengym.ch/routines/bar-and-floor/', author: 'Ana' }] }))

import { handleScannedText, scanQrCode, scanFromPlan } from './ScanCode.jsx'
import { openLibraryLink, _resetLibraryLinksForTests } from './LibraryLink.jsx'
import { libraryLinkFromUrl } from '../lib/library-link.js'

const plan = { opengym_plan: 1, name: 'Bar and floor', unit: 'kg', week: { 1: ['r0'] }, routines: [{ id: 'r0', name: 'Day A', ex: [{ id: '0025', sets: 3, reps: 8 }] }], customEx: [] }
const ok = body => async () => ({ ok: true, status: 200, text: async () => JSON.stringify(body) })

beforeEach(() => {
  Object.assign(m, { toasts: [], imports: [], confirms: [], routine: [], tags: [], opened: [], web: true, scanned: null, sheets: [], details: [], machineSheets: [], which: [], unlinked: [], nfc: false })
  _resetLibraryLinksForTests()
  vi.spyOn(window, 'open').mockImplementation(url => { m.opened.push(url); return null })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('a machine code outside a workout', () => {
  it('one exercise opens its details', async () => {
    const r = await handleScannedText('MACHINE1', { indexAddress: null })
    expect(r.kind).toBe('machine')
    expect(m.details).toEqual(['0025'])
  })
  it('several exercises ask which first', async () => {
    await handleScannedText('MACHINE2', { indexAddress: null })
    expect(m.details).toEqual([])
    expect(m.which).toHaveLength(1)
    expect(m.which[0].ids).toEqual(['0025', '0027'])
    m.which[0].onExercise('0027')
    expect(m.details).toEqual(['0027'])
  })
  it('Plan’s scan opens the Scan a machine sheet when the device reads NFC', async () => {
    m.nfc = true
    await scanFromPlan()
    expect(m.machineSheets).toHaveLength(1)
    expect(m.machineSheets[0].live).toBe(null)
    m.machineSheets[0].onExercise('0025')
    expect(m.details).toEqual(['0025'])
    expect(m.sheets).toHaveLength(0)
  })
  it('without NFC it is the camera as before', async () => {
    await scanFromPlan()
    expect(m.machineSheets).toHaveLength(0)
    expect(m.sheets).toHaveLength(1)
  })
})

describe('a scanned code goes to its handler', () => {
  it('a friend’s routine link opens its preview', async () => {
    expect((await handleScannedText('https://opengym.ch/r#1.j.e30', { indexAddress: null })).kind).toBe('routine-link')
    expect(m.routine).toEqual(['1.j.e30'])
  })

  it('a sticker link does what the sticker does', async () => {
    await handleScannedText('https://opengym.ch/nfc?do=start', { indexAddress: null })
    expect(m.tags).toEqual(['https://opengym.ch/nfc?do=start'])
  })

  it('any other code offers to link it to an exercise, and acts on nothing', async () => {
    await handleScannedText('https://gym.example/m/leg-press', { indexAddress: null })
    expect(m.toasts).toEqual([])
    expect(m.unlinked).toHaveLength(1)
    expect(m.unlinked[0].code).toBe('t:https://gym.example/m/leg-press')
    expect(m.routine.length + m.tags.length + m.imports.length + m.details.length).toBe(0)
    m.unlinked[0].onExercise('0025')
    expect(m.details).toEqual(['0025'])
  })

  it('a read with nothing to link is shown back', async () => {
    await handleScannedText('x'.repeat(600), { indexAddress: null })
    expect(m.unlinked).toHaveLength(0)
    expect(m.toasts).toHaveLength(1)
    expect(m.toasts[0]).toMatch(/^That’s not an openGym code: /)
  })

  it('a library page fetches the routine into the import sheet', async () => {
    vi.stubGlobal('fetch', vi.fn(ok(plan)))
    await handleScannedText('https://opengym.ch/routines/bar-and-floor/#copy')
    expect(fetch).toHaveBeenCalledWith('https://opengym.ch/routines/plans/bar-and-floor.opengym-plan.json', expect.objectContaining({ method: 'GET' }))
    expect(m.imports).toHaveLength(1)
    expect(m.imports[0]).toMatchObject({ name: 'Bar and floor', routineCount: 1, from: 'Ana' })
  })

  it('the web and F-Droid way: the browser camera sheet, then the same routing', async () => {
    await scanQrCode()
    expect(m.sheets).toHaveLength(1)
    const el = m.sheets[0](() => {})
    await el.props.onFound({ value: 'https://opengym.ch/r#1.j.e30', fmt: 'qrcode' })
    await new Promise(r => setTimeout(r, 0))
    expect(m.routine).toEqual(['1.j.e30'])
  })

  it('the phone apps: ML Kit’s scanner, and a back-out does nothing', async () => {
    m.web = false
    m.scanned = { value: 'opengym.ch/nfc?ex=0025', fmt: 'qrcode' }
    await scanQrCode()
    expect(m.tags).toEqual(['https://opengym.ch/nfc?ex=0025'])
    m.scanned = null
    await scanQrCode()
    expect(m.toasts).toEqual([])
  })

  it('the phone apps without Google\'s scanner module yet: the browser camera sheet, no dead tap (QA66)', async () => {
    m.web = false
    m.scanned = new Error('module-missing')
    await scanQrCode()
    expect(m.toasts).toEqual([])
    expect(m.sheets).toHaveLength(1)
  })
})

describe('opening a library link', () => {
  const link = libraryLinkFromUrl('https://opengym.ch/routines/bar-and-floor/')

  it('offline: a friendly sheet that opens the website instead', async () => {
    expect(await openLibraryLink(link, { fetchImpl: async () => { throw new TypeError('offline') } })).toBe(false)
    expect(m.imports).toEqual([])
    expect(m.confirms).toHaveLength(1)
    expect(m.confirms[0].title).toBe('Couldn’t fetch that routine')
    expect(m.confirms[0].confirmText).toBe('Open in browser')
    m.confirms[0].onConfirm()
    expect(m.opened).toEqual(['https://opengym.ch/routines/bar-and-floor/index.html'])
  })

  it('a routine the library no longer has says so', async () => {
    await openLibraryLink(link, { fetchImpl: async () => ({ ok: false, status: 404, text: async () => '' }) })
    expect(m.confirms[0].message).toMatch(/isn’t in the library/)
  })

  it('a page that is not a routine goes straight to the website', async () => {
    await openLibraryLink(libraryLinkFromUrl('https://opengym.ch/routines/submit/'))
    expect(m.opened).toEqual(['https://opengym.ch/routines/submit/index.html'])
    expect(m.toasts).toEqual([])
  })

  it('the same link twice in a row (cold start) opens once', async () => {
    const fetchImpl = vi.fn(ok(plan))
    await openLibraryLink(link, { fetchImpl, now: 1000, authorOf: async () => '' })
    await openLibraryLink(link, { fetchImpl, now: 2000, authorOf: async () => '' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    await openLibraryLink(link, { fetchImpl, now: 9000, authorOf: async () => '' })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})
