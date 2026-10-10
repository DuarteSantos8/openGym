// @vitest-environment happy-dom
//
// The gym check-in screen itself. `moveGymCard` (the pure reorder helper) is already covered by
// CheckIn.reorder.test.jsx, and the shape of the stored data by store/useStore.gymcards.test.jsx
// — what was untested is the view: the rail's "reopen where you were" state machine, the remove
// confirmation, and the add/edit sheet, which is the only thing in the app that turns a photo of
// a membership card into synced profile data.
//
// These tests assert what reaches the store (and with which push flag), and what the sheet
// refuses, rather than that anything rendered.
//
// Traps this file is written around:
//   · globalThis.IS_REACT_ACT_ENVIRONMENT = true is required.
//   · el.value = x does NOT reach React — every value goes through the native prototype setter.
//   · happy-dom reports clientWidth 0 for everything, and the rail divides by it, so the tests
//     that touch scrolling install a width on HTMLElement.prototype for their duration.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  S: null,
  MOBILE: false,
  writes: [],          // { push } per update() call, in order
  sheets: [],          // every openSheet render fn, in order
  camera: null,        // the props the browser CameraScan sheet was handed
  toast: vi.fn(),
  nav: vi.fn(),
  confirmSheet: vi.fn(),
  scanCode: vi.fn(),
  importCodeFromImage: vi.fn(),
}))

const update = vi.fn((mut, push = true) => {
  const next = structuredClone(mocks.S)
  mut(next)
  mocks.S = next
  mocks.writes.push({ push })
})

vi.mock('../store/useStore.js', () => {
  const snap = () => ({ S: mocks.S, update })
  const useStore = selector => selector ? selector(snap()) : snap()
  useStore.getState = snap
  return { useStore }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({
    toast: (...a) => mocks.toast(...a),
    openSheet: render => { mocks.sheets.push(render); return { id: 's', close: () => {}, lock: () => {} } },
  })
  const useUI = selector => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.nav }))
vi.mock('../sheets.jsx', () => ({ confirmSheet: (...a) => mocks.confirmSheet(...a) }))
vi.mock('../lib/scan.js', () => ({
  scanCode: (...a) => mocks.scanCode(...a),
  importCodeFromImage: (...a) => mocks.importCodeFromImage(...a),
}))
vi.mock('../lib/mobile.js', () => ({ get MOBILE() { return mocks.MOBILE } }))
// The browser camera sheet is a device surface; capture its props so a test can answer as the
// camera would. It renders nothing.
vi.mock('../components/CameraScan.jsx', () => ({ default: props => { mocks.camera = props; return null } }))
// lean-qr loads through a dynamic import and draws to a real canvas. The value it is asked to
// draw is the part that matters here, so the stub simply reflects it back into the DOM.
vi.mock('../components/CardCode.jsx', () => ({ default: ({ value, fmt }) => <i data-qr={value} data-fmt={fmt} /> }))

import CheckIn, { openAddCard, openEditCard } from './CheckIn.jsx'

/* ------------------------------- harness ------------------------------- */

const card = (id, over = {}) => ({ id, label: id.toUpperCase(), value: 'code-' + id, fmt: 'qrcode', ...over })

let host, root, sheetHost, sheetRoot, camHost, camRoot, widthSpy

beforeEach(() => {
  mocks.S = { gymCards: [], lastGymCardId: null }
  mocks.MOBILE = false
  mocks.writes.length = 0
  mocks.sheets.length = 0
  mocks.camera = null
  mocks.toast.mockClear(); mocks.nav.mockClear(); mocks.confirmSheet.mockClear()
  mocks.scanCode.mockReset(); mocks.importCodeFromImage.mockReset()
  update.mockClear()
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  sheetHost = document.createElement('div'); document.body.appendChild(sheetHost); sheetRoot = createRoot(sheetHost)
  camHost = document.createElement('div'); document.body.appendChild(camHost); camRoot = createRoot(camHost)
})
afterEach(() => {
  act(() => camRoot.unmount()); camHost.remove()
  act(() => sheetRoot.unmount()); sheetHost.remove()
  act(() => root.unmount()); host.remove()
  if (widthSpy) { delete HTMLElement.prototype.clientWidth; widthSpy = null }
})

// happy-dom has no layout: clientWidth is 0 everywhere and the rail divides by it. Give every
// element the same slide width for the tests that care.
const withRailWidth = w => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => w })
  widthSpy = true
}

const mount = () => act(() => { root.render(<CheckIn />) })
const rerender = () => act(() => { root.render(<CheckIn />) })
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })

const rail = () => host.querySelector('.ci-rail')
const faces = () => [...host.querySelectorAll('.ci-card')]
const dots = () => [...host.querySelectorAll('.ci-dot')]
const litDots = () => dots().map(d => d.className.includes('on'))
const byLabel = (scope, label) => [...scope.querySelectorAll('[aria-label="' + label + '"]')]

const scrollTo = px => act(() => {
  rail().scrollLeft = px
  rail().dispatchEvent(new Event('scroll', { bubbles: true }))
})

// Opens the sheet the view last asked for into its own root.
const openSheet = async () => {
  expect(mocks.sheets.length).toBeGreaterThan(0)
  const close = vi.fn()
  act(() => { sheetRoot.render(mocks.sheets.at(-1)(close)) })
  await settle()
  return { close }
}
const sheetBtn = label => [...sheetHost.querySelectorAll('button')].find(b => b.textContent === label)
const labelField = () => sheetHost.querySelector('input.field')
const fileInput = () => sheetHost.querySelector('input[type="file"]')
const tap = async el => { await act(async () => { el.click(); await new Promise(r => setTimeout(r, 0)) }) }
const typeInto = (el, value) => act(() => {
  Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
})

/* ================================ tests ================================ */

describe('CheckIn — the rail reopens where you left it', () => {
  it('opens on the last-used card rather than the first', () => {
    withRailWidth(300)
    mocks.S = { gymCards: [card('a'), card('b'), card('c')], lastGymCardId: 'c' }
    mount()
    expect(rail().scrollLeft).toBe(600)
    expect(litDots()).toEqual([false, false, true, false])
  })

  it('an id whose card was removed elsewhere falls back to the first card, not to nothing', () => {
    withRailWidth(300)
    mocks.S = { gymCards: [card('a'), card('b')], lastGymCardId: 'gone' }
    mount()
    expect(rail().scrollLeft).toBe(0)
    expect(litDots()).toEqual([true, false, false])
  })

  it('settling on another card remembers it WITHOUT pushing a sync — a swipe is not a data change', () => {
    withRailWidth(300)
    mocks.S = { gymCards: [card('a'), card('b'), card('c')], lastGymCardId: 'a' }
    mount()
    mocks.writes.length = 0
    scrollTo(600)
    expect(mocks.S.lastGymCardId).toBe('c')
    expect(mocks.writes).toEqual([{ push: false }])
  })

  it('a nudge that settles back on the same card writes nothing — only a real swipe counts', () => {
    withRailWidth(300)
    mocks.S = { gymCards: [card('a'), card('b')], lastGymCardId: 'a' }
    mount()
    scrollTo(320)
    expect(mocks.S.lastGymCardId).toBe('b')
    mocks.writes.length = 0
    scrollTo(290)
    scrollTo(312)
    expect(mocks.writes).toEqual([])
  })

  it('swiping onto the trailing "+" slide lights its own dot and leaves the remembered card alone', () => {
    withRailWidth(300)
    mocks.S = { gymCards: [card('a'), card('b')], lastGymCardId: 'b' }
    mount()
    mocks.writes.length = 0
    scrollTo(600)                                     // the add slide
    expect(litDots()).toEqual([false, false, true])
    expect(mocks.S.lastGymCardId).toBe('b')
    expect(mocks.writes).toEqual([])
  })

  it('a profile saved before gym cards existed opens empty and can still be given one', async () => {
    mocks.MOBILE = true
    mocks.S = {}                                    // no gymCards key at all
    mocks.scanCode.mockResolvedValue({ value: 'FIRST-EVER', fmt: 'qrcode' })
    mount()
    expect(dots()).toHaveLength(0)
    await tap(host.querySelector('.ci-add'))
    await openSheet()
    await tap(sheetBtn('Scan'))
    await tap(sheetBtn('Save card'))
    expect(mocks.S.gymCards).toHaveLength(1)
    expect(mocks.S.gymCards[0].value).toBe('FIRST-EVER')
  })

  it('with no cards there are no dots, and the screen says how to get one', () => {
    mount()
    expect(dots()).toHaveLength(0)
    expect(faces()).toHaveLength(0)
    expect(host.textContent).toContain('Import a photo of your membership card')
    expect(host.textContent).toContain('Add your gym card')
  })

  it('the QR is regenerated from the stored value — the value is what is kept, never a picture', () => {
    mocks.S = { gymCards: [card('a', { value: 'MEMBER-9931' })], lastGymCardId: 'a' }
    mount()
    expect(host.querySelector('[data-qr]').getAttribute('data-qr')).toBe('MEMBER-9931')
    expect(host.querySelector('.ci-value').textContent).toBe('MEMBER-9931')
  })

  it('a card saved before the scan was checked, whose code cannot be drawn, says so instead of showing a blank plate', () => {
    mocks.S = { gymCards: [card('a', { value: 'MEMBER\u001d42', fmt: 'code128' })], lastGymCardId: 'a' }
    mount()
    expect(host.querySelector('[data-qr]')).toBeFalsy()
    expect(host.textContent).toContain("This code can't be drawn as a barcode. Scan the card again")
  })

  it('the back button goes home', async () => {
    mount()
    await tap(byLabel(host, 'Home')[0])
    expect(mocks.nav).toHaveBeenCalledWith('/home')
  })
})

describe('CheckIn — removing a card (the only destructive action on this screen)', () => {
  const remove = async (cards, id, lastGymCardId = cards[0].id) => {
    mocks.S = { gymCards: cards, lastGymCardId }
    mount()
    const i = cards.findIndex(c => c.id === id)
    await tap(byLabel(faces()[i], 'Remove')[0])
    expect(mocks.confirmSheet).toHaveBeenCalledTimes(1)
    return mocks.confirmSheet.mock.calls[0][0]
  }

  it('asks first, in red, naming the card — and writes nothing until the answer is yes', async () => {
    const dialog = await remove([card('a'), card('b')], 'b')
    expect(dialog.danger).toBe(true)
    expect(dialog.title).toBe('Remove this card?')
    expect(dialog.message).toBe('B')
    expect(dialog.confirmText).toBe('Remove')
    expect(update).not.toHaveBeenCalled()
  })

  it('on confirm it drops that card and only that card', async () => {
    const dialog = await remove([card('a'), card('b'), card('c')], 'b')
    act(() => { dialog.onConfirm() })
    expect(mocks.S.gymCards.map(c => c.id)).toEqual(['a', 'c'])
  })

  it('removing the remembered card repoints the memory at the first survivor', async () => {
    const dialog = await remove([card('a'), card('b')], 'a', 'a')
    act(() => { dialog.onConfirm() })
    expect(mocks.S.lastGymCardId).toBe('b')
  })

  it('removing some other card leaves the memory pointing where it was', async () => {
    const dialog = await remove([card('a'), card('b')], 'b', 'a')
    act(() => { dialog.onConfirm() })
    expect(mocks.S.lastGymCardId).toBe('a')
  })

  it('removing the last card clears the memory to null, not to undefined', async () => {
    const dialog = await remove([card('a')], 'a', 'a')
    act(() => { dialog.onConfirm() })
    expect(mocks.S.gymCards).toEqual([])
    expect(mocks.S.lastGymCardId).toBeNull()
    // null survives JSON; undefined would vanish on the next sync and read as "never set".
    expect(JSON.parse(JSON.stringify(mocks.S))).toHaveProperty('lastGymCardId', null)
  })

  it('a removal is pushed to the other devices, unlike a swipe', async () => {
    const dialog = await remove([card('a'), card('b')], 'b')
    mocks.writes.length = 0
    act(() => { dialog.onConfirm() })
    expect(mocks.writes).toEqual([{ push: true }])
  })
})

describe('CheckIn — reordering the rail', () => {
  it('a single card carries no reorder row — there is nowhere to move it', () => {
    mocks.S = { gymCards: [card('a')], lastGymCardId: 'a' }
    mount()
    expect(host.querySelector('.ci-reorder')).toBeFalsy()
  })

  it('the ends are inert: ◀ on the first card and ▶ on the last are disabled', () => {
    mocks.S = { gymCards: [card('a'), card('b'), card('c')], lastGymCardId: 'a' }
    mount()
    expect(byLabel(faces()[0], 'Move left')[0].disabled).toBe(true)
    expect(byLabel(faces()[0], 'Move right')[0].disabled).toBe(false)
    expect(byLabel(faces()[2], 'Move left')[0].disabled).toBe(false)
    expect(byLabel(faces()[2], 'Move right')[0].disabled).toBe(true)
    expect(faces().map(f => f.querySelector('.ci-pos').textContent)).toEqual(['1 / 3', '2 / 3', '3 / 3'])
  })

  it('▶ writes the new order and keeps every card', async () => {
    mocks.S = { gymCards: [card('a'), card('b'), card('c')], lastGymCardId: 'a' }
    mount()
    await tap(byLabel(faces()[0], 'Move right')[0])
    expect(mocks.S.gymCards.map(c => c.id)).toEqual(['b', 'a', 'c'])
    rerender()
    expect(faces().map(f => f.querySelector('.ci-label').textContent)).toEqual(['B', 'A', 'C'])
  })

  it('◀ moves a card back one slot', async () => {
    mocks.S = { gymCards: [card('a'), card('b'), card('c')], lastGymCardId: 'a' }
    mount()
    await tap(byLabel(faces()[2], 'Move left')[0])
    expect(mocks.S.gymCards.map(c => c.id)).toEqual(['a', 'c', 'b'])
  })
})

describe('CheckIn — adding a card', () => {
  const openAdd = async () => {
    mount()
    await tap(host.querySelector('.ci-add'))
    return openSheet()
  }

  it('a label alone cannot create a card — Save stays refused until a code has been captured', async () => {
    await openAdd()
    typeInto(labelField(), 'FitZone downtown')
    expect(sheetBtn('Save card').disabled).toBe(true)
    await tap(sheetBtn('Save card'))
    expect(update).not.toHaveBeenCalled()
    expect(mocks.S.gymCards).toEqual([])
  })

  it('a scanned code plus Save writes the card, points the memory at it, and pushes', async () => {
    mocks.MOBILE = true
    mocks.scanCode.mockResolvedValue({ value: 'MEMBER-9931', fmt: 'qrcode' })
    const { close } = await openAdd()
    typeInto(labelField(), 'FitZone downtown')
    await tap(sheetBtn('Scan'))
    await tap(sheetBtn('Save card'))

    expect(mocks.S.gymCards).toHaveLength(1)
    const saved = mocks.S.gymCards[0]
    expect(saved).toMatchObject({ label: 'FitZone downtown', value: 'MEMBER-9931', fmt: 'qrcode' })
    expect(saved.id).toBeTruthy()
    expect(mocks.S.lastGymCardId).toBe(saved.id)
    expect(mocks.writes).toEqual([{ push: true }])
    expect(mocks.toast).toHaveBeenCalledWith('Card added')
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('an unnamed card gets a name, and a code with stray whitespace is stored trimmed', async () => {
    mocks.MOBILE = true
    mocks.scanCode.mockResolvedValue({ value: '  MEMBER-9931  ', fmt: 'qrcode' })
    await openAdd()
    typeInto(labelField(), '   ')
    await tap(sheetBtn('Scan'))
    await tap(sheetBtn('Save card'))
    expect(mocks.S.gymCards[0]).toMatchObject({ label: 'Gym card', value: 'MEMBER-9931' })
  })

  it('a second card is appended and takes over the memory', async () => {
    mocks.MOBILE = true
    mocks.S = { gymCards: [card('a')], lastGymCardId: 'a' }
    mocks.scanCode.mockResolvedValue({ value: 'SECOND', fmt: 'qrcode' })
    await openAdd()
    await tap(sheetBtn('Scan'))
    await tap(sheetBtn('Save card'))
    expect(mocks.S.gymCards.map(c => c.value)).toEqual(['code-a', 'SECOND'])
    expect(mocks.S.lastGymCardId).toBe(mocks.S.gymCards[1].id)
  })

  it('a barcode we could read but could not redraw is refused, and never reaches the form', async () => {
    mocks.MOBILE = true
    mocks.scanCode.mockResolvedValue({ value: '5901234123457', fmt: 'EAN_13' })
    await openAdd()
    await tap(sheetBtn('Scan'))
    expect(mocks.toast).toHaveBeenCalledWith("That code type can't be shown here. Only QR codes and Code 128 barcodes work")
    expect(sheetBtn('Save card').disabled).toBe(true)
    expect(sheetHost.querySelector('[data-qr]')).toBeFalsy()
  })

  it('a scanned Code 128 barcode is saved as one, so the card face draws bars a laser reader can read', async () => {
    mocks.MOBILE = true
    mocks.scanCode.mockResolvedValue({ value: '1000009779', fmt: 'CODE_128' })
    await openAdd()
    await tap(sheetBtn('Scan'))
    await tap(sheetBtn('Save card'))
    expect(mocks.S.gymCards[0]).toMatchObject({ value: '1000009779', fmt: 'code128' })
    expect(mocks.toast).toHaveBeenCalledWith('Card added')
  })

  // Reported on #495: a decoder can hand back a Code 128 value with a control character in it
  // (an FNC1 / GS1 separator comes out as \u001d). Code set B can't carry it, so the card would
  // save and then draw nothing at the turnstile.
  it('a Code 128 value the barcode cannot carry is refused at the scan, not saved as an invisible card', async () => {
    mocks.MOBILE = true
    mocks.scanCode.mockResolvedValue({ value: 'MEMBER\u001d42', fmt: 'CODE_128' })
    await openAdd()
    await tap(sheetBtn('Scan'))
    expect(mocks.toast).toHaveBeenCalledWith("This code can't be drawn as a barcode. Scan the card again")
    expect(sheetBtn('Save card').disabled).toBe(true)
    expect(sheetHost.querySelector('[data-qr]')).toBeFalsy()
  })

  it('a Code 128 value keeps its edge spaces: the bars carry every byte, so trimming would change the code', async () => {
    mocks.MOBILE = true
    mocks.scanCode.mockResolvedValue({ value: ' 42 ', fmt: 'CODE_128' })
    await openAdd()
    await tap(sheetBtn('Scan'))
    expect(sheetHost.querySelector('[data-qr]').getAttribute('data-qr')).toBe(' 42 ')
    await tap(sheetBtn('Save card'))
    expect(mocks.S.gymCards[0]).toMatchObject({ value: ' 42 ', fmt: 'code128' })
  })

  it('backing out of the native scanner leaves the form as it was and re-enables the buttons', async () => {
    mocks.MOBILE = true
    mocks.scanCode.mockResolvedValue(null)
    await openAdd()
    typeInto(labelField(), 'FitZone')
    await tap(sheetBtn('Scan'))
    expect(mocks.toast).not.toHaveBeenCalled()
    expect(labelField().value).toBe('FitZone')
    expect(sheetBtn('Scan').disabled).toBe(false)     // busy was cleared
    expect(sheetBtn('Save card').disabled).toBe(true)
  })

  it.each([
    ['permission-denied', 'Camera permission is needed to scan. Enable it in Settings.'],
    ['unsupported', 'Scanning is not available on this device.'],
    ['ENOENT something else', 'Could not start the scanner'],
  ])('a %s scanner failure is explained as something the user can act on', async (thrown, message) => {
    mocks.MOBILE = true
    mocks.scanCode.mockRejectedValue(new Error(thrown))
    await openAdd()
    await tap(sheetBtn('Scan'))
    expect(mocks.toast).toHaveBeenCalledWith(message)
    expect(sheetBtn('Scan').disabled).toBe(false)
  })

  it('in a browser the scan opens our own camera sheet instead of the native one', async () => {
    mocks.MOBILE = false
    await openAdd()
    await tap(sheetBtn('Scan'))
    expect(mocks.scanCode).not.toHaveBeenCalled()
    expect(mocks.sheets).toHaveLength(2)

    const closeCam = vi.fn()
    act(() => { camRoot.render(mocks.sheets.at(-1)(closeCam)) })
    await act(async () => { mocks.camera.onFound({ value: 'WEB-CODE', fmt: 'QR_CODE' }) })
    expect(closeCam).toHaveBeenCalledTimes(1)
    expect(sheetHost.querySelector('[data-qr]').getAttribute('data-qr')).toBe('WEB-CODE')

    await tap(sheetBtn('Save card'))
    expect(mocks.S.gymCards[0].value).toBe('WEB-CODE')
  })

  it('the browser camera closes even when what it found cannot be used', async () => {
    mocks.MOBILE = false
    await openAdd()
    await tap(sheetBtn('Scan'))
    const closeCam = vi.fn()
    act(() => { camRoot.render(mocks.sheets.at(-1)(closeCam)) })
    await act(async () => { mocks.camera.onFound({ value: '5901234123457', fmt: 'EAN_13' }) })
    expect(closeCam).toHaveBeenCalledTimes(1)
    expect(mocks.toast).toHaveBeenCalledWith("That code type can't be shown here. Only QR codes and Code 128 barcodes work")
    expect(sheetBtn('Save card').disabled).toBe(true)
  })
})

describe('CheckIn — importing a photo', () => {
  const pickFile = async (name = 'card.jpg') => {
    const input = fileInput()
    const file = new File(['bytes'], name, { type: 'image/jpeg' })
    Object.defineProperty(input, 'files', { configurable: true, value: [file] })
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
      await new Promise(r => setTimeout(r, 0))
    })
    return file
  }
  const openAdd = async () => { mount(); await tap(host.querySelector('.ci-add')); return openSheet() }

  it('"Import photo" opens the hidden file picker rather than a second sheet', async () => {
    await openAdd()
    const opened = vi.fn()
    fileInput().click = opened
    await tap(sheetBtn('Import photo'))
    expect(opened).toHaveBeenCalledTimes(1)
    expect(mocks.sheets).toHaveLength(1)
  })

  it('a photo with a QR in it fills the form and can then be saved', async () => {
    mocks.importCodeFromImage.mockResolvedValue({ value: 'FROM-PHOTO', fmt: 'QR_CODE' })
    await openAdd()
    await pickFile()
    expect(sheetHost.querySelector('[data-qr]').getAttribute('data-qr')).toBe('FROM-PHOTO')
    await tap(sheetBtn('Save card'))
    expect(mocks.S.gymCards[0]).toMatchObject({ value: 'FROM-PHOTO', fmt: 'qrcode' })
  })

  it('dismissing the picker without choosing a photo does nothing at all', async () => {
    await openAdd()
    const input = fileInput()
    Object.defineProperty(input, 'files', { configurable: true, value: [] })
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
      await new Promise(r => setTimeout(r, 0))
    })
    expect(mocks.importCodeFromImage).not.toHaveBeenCalled()
    expect(mocks.toast).not.toHaveBeenCalled()
    expect(sheetBtn('Import photo').disabled).toBe(false)
  })

  it('a photo with nothing in it says so and leaves the form empty', async () => {
    mocks.importCodeFromImage.mockResolvedValue(null)
    await openAdd()
    await pickFile()
    expect(mocks.toast).toHaveBeenCalledWith('No QR code or barcode found in that image')
    expect(sheetBtn('Save card').disabled).toBe(true)
  })

  it('a photo of a barcode we cannot redraw is refused for the same reason a scan of one is', async () => {
    mocks.importCodeFromImage.mockResolvedValue({ value: '5901234123457', fmt: 'EAN_13' })
    await openAdd()
    await pickFile()
    expect(mocks.toast).toHaveBeenCalledWith("That code type can't be shown here. Only QR codes and Code 128 barcodes work")
    expect(sheetBtn('Save card').disabled).toBe(true)
  })

  it('a photo of a Code 128 card is kept as a barcode, not turned into a QR', async () => {
    mocks.importCodeFromImage.mockResolvedValue({ value: '1000009779', fmt: 'code_128' })
    await openAdd()
    await pickFile()
    expect(mocks.toast).not.toHaveBeenCalled()
    expect(sheetHost.querySelector('[data-qr]').getAttribute('data-fmt')).toBe('code128')
    await tap(sheetBtn('Save card'))
    expect(mocks.S.gymCards[0]).toMatchObject({ value: '1000009779', fmt: 'code128' })
  })

  it('a decoder that throws is reported, not swallowed, and the buttons come back', async () => {
    mocks.importCodeFromImage.mockRejectedValue(new Error('unsupported image'))
    await openAdd()
    await pickFile()
    expect(mocks.toast).toHaveBeenCalledWith('Could not read that image')
    expect(sheetBtn('Import photo').disabled).toBe(false)
  })

  it('the file input is cleared, so the same photo can be tried again after a failure', async () => {
    mocks.importCodeFromImage.mockResolvedValue(null)
    await openAdd()
    await pickFile()
    expect(fileInput().value).toBe('')
    mocks.importCodeFromImage.mockResolvedValue({ value: 'SECOND-TRY', fmt: 'qrcode' })
    await pickFile()
    expect(mocks.importCodeFromImage).toHaveBeenCalledTimes(2)
    expect(sheetHost.querySelector('[data-qr]').getAttribute('data-qr')).toBe('SECOND-TRY')
  })
})

describe('CheckIn — editing a card', () => {
  const openEdit = async (id, cards = [card('a'), card('b')]) => {
    mocks.S = { gymCards: cards, lastGymCardId: cards[0].id }
    mount()
    const i = cards.findIndex(c => c.id === id)
    await tap(byLabel(faces()[i], 'Edit')[0])
    return openSheet()
  }

  it('opens pre-filled with the card it was asked about', async () => {
    await openEdit('b')
    expect(labelField().value).toBe('B')
    expect(sheetHost.querySelector('[data-qr]').getAttribute('data-qr')).toBe('code-b')
    expect(sheetBtn('Re-scan')).toBeTruthy()
    expect(sheetBtn('Scan')).toBeFalsy()
  })

  it('a rename touches that card only — same id, same slot, same code, siblings untouched', async () => {
    const { close } = await openEdit('b')
    typeInto(labelField(), 'FitZone North')
    await tap(sheetBtn('Save card'))
    expect(mocks.S.gymCards.map(c => c.id)).toEqual(['a', 'b'])
    expect(mocks.S.gymCards[0]).toMatchObject({ label: 'A', value: 'code-a' })
    expect(mocks.S.gymCards[1]).toMatchObject({ id: 'b', label: 'FitZone North', value: 'code-b', fmt: 'qrcode' })
    expect(mocks.toast).toHaveBeenCalledWith('Card updated')
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('a re-scan replaces the code and keeps the name', async () => {
    mocks.MOBILE = true
    mocks.scanCode.mockResolvedValue({ value: 'RENEWED-2027', fmt: 'qrcode' })
    await openEdit('b')
    await tap(sheetBtn('Re-scan'))
    await tap(sheetBtn('Save card'))
    expect(mocks.S.gymCards[1]).toMatchObject({ id: 'b', label: 'B', value: 'RENEWED-2027' })
  })

  it('a re-scan can switch a card from QR to a Code 128 barcode', async () => {
    mocks.MOBILE = true
    mocks.scanCode.mockResolvedValue({ value: '1000009779', fmt: 'CODE_128' })
    await openEdit('b')
    await tap(sheetBtn('Re-scan'))
    await tap(sheetBtn('Save card'))
    expect(mocks.S.gymCards[1]).toMatchObject({ id: 'b', value: '1000009779', fmt: 'code128' })
  })

  it('clearing the name gives it the fallback name rather than an empty label', async () => {
    await openEdit('b')
    typeInto(labelField(), '  ')
    await tap(sheetBtn('Save card'))
    expect(mocks.S.gymCards[1].label).toBe('Gym card')
  })

  it('a re-scan we cannot redraw cannot overwrite the working code already on the card', async () => {
    mocks.MOBILE = true
    mocks.scanCode.mockResolvedValue({ value: '5901234123457', fmt: 'EAN_13' })
    await openEdit('b')
    await tap(sheetBtn('Re-scan'))
    await tap(sheetBtn('Save card'))
    expect(mocks.S.gymCards[1].value).toBe('code-b')
  })

  it('a re-scan whose Code 128 value cannot be drawn keeps the working code already on the card', async () => {
    mocks.MOBILE = true
    mocks.scanCode.mockResolvedValue({ value: 'MEMBER\u001d42', fmt: 'CODE_128' })
    await openEdit('b')
    await tap(sheetBtn('Re-scan'))
    expect(sheetHost.querySelector('[data-qr]').getAttribute('data-qr')).toBe('code-b')
    await tap(sheetBtn('Save card'))
    expect(mocks.S.gymCards[1]).toMatchObject({ value: 'code-b', fmt: 'qrcode' })
  })

  // If the card is removed on another device while this sheet is open, there is nothing to
  // edit. Until 2026-09-22 commit()'s `if (!c) return` bailed out of the MUTATOR and not out of
  // commit, so the screen still said "Card updated", still closed, and still pushed a state
  // write that changed nothing. It looks first now, says what happened, and writes nothing.
  it('editing a card that was removed elsewhere says so, writes nothing, and does not claim success', async () => {
    const { close } = await openEdit('b')
    // …the other device's removal arrives while the sheet is open.
    mocks.S = { gymCards: [card('a')], lastGymCardId: 'a' }
    const writes = update.mock.calls.length
    typeInto(labelField(), 'FitZone North')
    await tap(sheetBtn('Save card'))

    expect(mocks.S.gymCards.map(c => c.id)).toEqual(['a'])
    expect(update.mock.calls.length).toBe(writes)                             // no state write at all
    expect(mocks.toast).toHaveBeenCalledWith('That card was removed on another device')
    expect(mocks.toast).not.toHaveBeenCalledWith('Card updated')
    expect(close).toHaveBeenCalledTimes(1)
  })
})

describe('CheckIn — the sheet openers', () => {
  it('openAddCard opens an empty sheet with nothing captured yet', async () => {
    openAddCard()
    const { close } = await openSheet()
    expect(sheetHost.querySelector('h3').textContent).toBe('Add a card')
    expect(labelField().value).toBe('')
    expect(sheetHost.querySelector('[data-qr]')).toBeFalsy()
    expect(close).not.toHaveBeenCalled()
  })

  it('openEditCard opens the sheet on the card it was handed, without going through the rail', async () => {
    openEditCard(card('z', { label: 'Zenith', value: 'Z-1' }))
    await openSheet()
    expect(sheetHost.querySelector('h3').textContent).toBe('Edit card')
    expect(labelField().value).toBe('Zenith')
    expect(sheetHost.querySelector('[data-qr]').getAttribute('data-qr')).toBe('Z-1')
  })
})
