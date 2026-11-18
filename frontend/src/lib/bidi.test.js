// Numbers in a right-to-left page (lib/bidi.js): every set, weight and volume the app writes is
// its own isolated run in Arabic and Persian, and exactly what it was in every other language.
import { afterEach, describe, expect, it } from 'vitest'
import { _setLangState } from './i18n-core.js'
import ar from '../locales/ar.js'
import fa from '../locales/fa.js'
import { LRI, FSI, PDI, isoRun, ltrRun, isoDir, balanceIso, stripBidi, rtlLang } from './bidi.js'
import { setLabel, setsRepsOf, exLine } from './history.js'
import { fmtVol, fmtWeight } from './format.js'
import { bestSetLabel, shareCardModel } from './share-card.js'
import { wrapText, drawText } from './workout-card.js'

const lri = s => LRI + s + PDI
const fsi = s => FSI + s + PDI
const press = { id: '0025', target: { mode: 'reps', reps: 10, weight: 25 } }

afterEach(() => _setLangState('en', null, null, null))

describe('left to right: nothing changes', () => {
  it('keeps every string as it was', () => {
    expect(rtlLang()).toBe(false)
    expect(setLabel('0025', { w: 22.5, r: 12, done: true }, press.target)).toBe('22.5×12')
    expect(fmtVol(8055, 'kg')).toBe('8,055 kg')
    expect(fmtWeight(78.6, 'kg')).toBe('78.6 kg')
    expect(setsRepsOf({ sets: 3, reps: 10 })).toBe('3 × 10')
    expect(exLine({ sets: 3, reps: 10, weight: 60 }, 'kg')).toBe('3 × 10 · 60 kg')
    expect(bestSetLabel({ ...press, sets: [{ w: 25, r: 10, done: true }] })).toBe('25 kg × 10')
    expect(isoRun('25 kg × 10')).toBe('25 kg × 10')
    expect(ltrRun('25×10')).toBe('25×10')
  })
})

describe.each([['ar', ar], ['fa', fa]])('right to left (%s)', (lang, pack) => {
  it('isolates a set, a weight and a volume as one left-to-right run', () => {
    _setLangState(lang, pack, null, null)
    expect(rtlLang()).toBe(true)
    // "22.5×12" read "12×22.5" in History's detail
    expect(stripBidi(setLabel('0025', { w: 22.5, r: 12, done: true }, press.target))).toBe('22.5×12')
    const label = setLabel('0025', { w: 22.5, r: 12, done: true }, press.target)
    expect(label.startsWith(LRI)).toBe(true)
    expect(label.endsWith(PDI)).toBe(true)
    // the effort stays inside the run: "65×10 (RIR 3)", never "(RIR 3) 10×65"
    const rir = setLabel('0025', { w: 65, r: 10, rir: 3, done: true }, press.target)
    expect(rir.startsWith(LRI)).toBe(true)
    expect(rir.indexOf('RIR') < rir.lastIndexOf(PDI)).toBe(true)
    expect(fmtVol(8055, 'kg')).toBe(lri('8,055 kg'))
    expect(fmtWeight(78.6, 'kg')).toBe(lri('78.6 kg'))
    expect(stripBidi(setsRepsOf({ sets: 3, reps: 10 }))).toBe('3 × 10')
    expect(setsRepsOf({ sets: 3, reps: 10 })).toBe(lri('3 × 10'))
    // the share cards' best set: "25 kg × 10", not "kg × 10 25"
    expect(bestSetLabel({ ...press, sets: [{ w: 25, r: 10, done: true }] })).toBe(lri('25 kg × 10'))
  })

  it('keeps a set with words of the page in its own direction, its numbers still in order', () => {
    _setLangState(lang, pack, null, null)
    const side = r => ({ w: 15, r, done: true })
    const label = setLabel('0025', { w: 15, r: 15, done: true, sides: { L: side(8), R: side(7) } }, { mode: 'reps', side: true, reps: 16, weight: 15 })
    // first-strong around it, and each weight×reps its own left-to-right run
    expect(label.startsWith(FSI)).toBe(true)
    expect(label).toContain(lri('15×8'))
    expect(label).toContain(lri('15×7'))
    expect(stripBidi(label)).toBe(`${pack.L} 15×8 · ${pack.R} 15×7`)
    expect(isoDir(label)).toBe('auto')
    expect(isoDir('60×8')).toBe('ltr')
  })

  it('puts the lifts list of a share card in order', () => {
    _setLangState(lang, pack, null, null)
    const w = { d: '2026-11-09', start: 0, end: 48 * 60000, entries: [{ ...press, sets: [{ w: 25, r: 10, done: true }] }] }
    const model = shareCardModel(w, { unit: 'kg', nameOf: () => 'Single-Arm Landmine Press' })
    expect(model.lifts[0].best).toBe(lri('25 kg × 10'))
    expect(model.stats.find(s => s.id === 'volume').value).toBe(lri('250 kg'))
  })
})

describe('canvas lines', () => {
  const fakeCtx = () => {
    const calls = []
    return { calls, fillText: (text, x, y) => calls.push(text) }
  }
  const item = text => ({ kind: 'text', text, x: 0, y: 0, size: 40, weight: 700, color: 'label' })

  it('paints each line as its own run on a right-to-left card, and as it is otherwise', () => {
    const ctx = fakeCtx()
    drawText(ctx, item('Single-Arm Landmine…'), {}, true, 'sans-serif')
    drawText(ctx, item('سحب علوي بالكابل…'), {}, true, 'sans-serif')
    drawText(ctx, item('Single-Arm Landmine…'), {}, false, 'sans-serif')
    // the Latin name keeps its "…" at its own end, the Arabic one is first-strong, LTR untouched
    expect(ctx.calls).toEqual([lri('Single-Arm Landmine…'), fsi('سحب علوي بالكابل…'), 'Single-Arm Landmine…'])
  })

  it('cuts a name before its English part rather than inside it', () => {
    // pack names put the English one in parentheses in its own run (i18n-core englishInParens)
    const name = `تجديف منحني بالبار ${FSI}(Barbell Bent Over Row)${PDI}`
    // was "تجديف منحني بالبار (Barbell…": an open parenthesis and a run never closed
    expect(wrapText(name, 300, s => s.length * 10, 1)[0]).toBe('تجديف منحني بالبار…')
    // a cut that keeps the whole English part keeps it
    expect(wrapText(name, 2000, s => s.length * 10, 1)[0]).toBe(name)
  })

  it('closes an isolate left open, so it does not swallow what follows', () => {
    const cut = `${LRI}25 kg × 1`
    expect(balanceIso(cut)).toBe(cut + PDI)
    expect(isoRun(cut, true)).toBe(LRI + cut + PDI + PDI)
    expect(balanceIso(lri('25 kg × 10'))).toBe(lri('25 kg × 10'))
  })
})
