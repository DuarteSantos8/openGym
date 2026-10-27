// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { autoLang, matchLocale } from './default-lang.js'
import {
  DATE_LOCALES, EXERCISE_NAME_LANGS, INSTR_LANGS, LANGS, RTL_LANGS,
  dateLocale, descFor, exerciseNameFor, exerciseNameSearchText, getLang,
  instrFor, instrTranslated, setLang, t, tn,
} from './i18n.js'
import { _setDetails } from './i18n-core.js'
import { EXDB } from './exercises-data.js'
import { printShell } from './print-doc.js'
import fa from '../locales/fa.js'
import persianCatalogue from '../../../catalogue/i18n/fa.json'
import arabicCatalogue from '../../../catalogue/i18n/ar.json'
import names from '../exercise-names/fa.js'
import steps from '../instr/fa.js'
import englishSteps from '../instr/en.js'
import englishDescriptions from '../exercise-desc/en.js'

const idsWith = (rows, field) => Object.keys(rows).filter(id => rows[id][field]).sort()

afterEach(async () => { await setLang('en') })

describe('Persian language selection', () => {
  it('offers Persian and recognizes browser and instance language tags', () => {
    expect(LANGS.fa).toBe('فارسی')
    expect(RTL_LANGS.has('fa')).toBe(true)
    for (const tag of ['fa', 'fa-IR', 'fa_IR', 'FA-ir', 'fa-AF']) expect(matchLocale(tag)).toBe('fa')
    expect(autoLang({ langAuto: true }, {}, ['fa-IR', 'en-US'])).toBe('fa')
    expect(autoLang({ langAuto: true }, { default_lang: 'fa-IR' }, ['en-US'])).toBe('fa')
  })

  it('loads real Persian strings, sets RTL, and restores English and LTR', async () => {
    await setLang('fa')
    expect(getLang()).toBe('fa')
    expect(document.documentElement.lang).toBe('fa')
    expect(document.documentElement.dir).toBe('rtl')
    expect(t('Settings')).toBe('تنظیمات')
    expect(t('Save')).toBe('ذخیره')
    for (const n of [0, 1, 2, 5, 21]) expect(tn('{0} set', '{0} sets', n)).toBe(`${n} ست`)
    expect(t('Page {0} of {1}', 2, 3)).toBe('صفحه 2 از 3')
    await setLang('en')
    expect(document.documentElement.lang).toBe('en')
    expect(document.documentElement.dir).toBe('ltr')
    expect(t('Settings')).toBe('Settings')
  })

  it('uses Gregorian months and Latin digits in dates and numbers', async () => {
    await setLang('fa')
    expect(dateLocale()).toBe(DATE_LOCALES.fa)
    const formatter = new Intl.DateTimeFormat(dateLocale(), { year: 'numeric', month: 'long', day: 'numeric' })
    expect(formatter.resolvedOptions().calendar).toBe('gregory')
    expect(formatter.resolvedOptions().numberingSystem).toBe('latn')
    const parts = formatter.formatToParts(new Date(2026, 9, 27, 12))
    expect(parts.find(p => p.type === 'year').value).toBe('2026')
    expect(parts.find(p => p.type === 'month').value).toBe('اکتبر')
    expect(parts.find(p => p.type === 'day').value).toBe('27')
    expect(new Intl.NumberFormat(dateLocale()).format(62.5)).toBe('62.5')
  })

  it('prints Persian with RTL layout and Gregorian dates', async () => {
    await setLang('fa')
    const html = printShell({ title: t('Training plan'), date: '2026-10-27', body: '<p>62.5 kg</p>' })
    expect(html).toContain('lang="fa" dir="rtl"')
    expect(html).toContain('برنامه تمرینی')
    expect(html).toContain('2026')
    expect(html).not.toContain('1405')
    expect(html).toContain('62.5 kg')
  })

  it('keeps small and coach separate when reviewing Persian terminology', async () => {
    await setLang('fa')
    expect(t('Small')).toBe('کوچک')
    expect(t('Coach')).toBe('مربی')
    expect(t('Make the box smaller')).toContain('کوچک')
    const strings = [
      ...Object.values(fa),
      ...Object.values(persianCatalogue).flatMap(row => [row.name, ...(row.instructions || [])]),
    ]
    // Replacing کوچ inside کوچک silently corrupted UI text and instructions alike.
    for (const text of strings) expect(text).not.toContain('مربیک')
    expect(steps['1001'][1]).toContain('کوچک')
  })
})

describe('Persian exercise catalogue', () => {
  it('matches Arabic name and instruction coverage and generates the source text faithfully', () => {
    const source = persianCatalogue, arabic = arabicCatalogue
    expect(EXERCISE_NAME_LANGS).toContain('fa')
    expect(INSTR_LANGS).toContain('fa')
    expect(idsWith(source, 'name')).toEqual(idsWith(arabic, 'name'))
    expect(idsWith(source, 'instructions')).toEqual(idsWith(arabic, 'instructions'))
    expect(Object.keys(names).sort()).toEqual(idsWith(source, 'name'))
    expect(Object.keys(steps).sort()).toEqual(idsWith(source, 'instructions'))
    for (const [id, row] of Object.entries(source)) {
      expect(names[id], id).toBe(row.name)
      expect(row.description, id).toBeUndefined()
      expect(row.name, id).toMatch(/[پچژگکییء-غف-ي]/u)
      if (row.instructions) {
        expect(steps[id], id).toEqual(row.instructions)
        expect(row.instructions.length, id).toBe(englishSteps[id].length)
        for (const step of row.instructions) expect(step, id).toMatch(/[پچژگکییء-غف-ي]/u)
      }
    }
  })

  it('isolates English names in parentheses, searches both languages, and honors display preferences', async () => {
    const ex = EXDB.find(e => names[e.id] && steps[e.id])
    await setLang('fa')
    expect(exerciseNameFor(ex)).toBe(`${names[ex.id]} \u2068(${ex.n})\u2069`)
    expect(exerciseNameSearchText(ex)).toContain(names[ex.id])
    expect(exerciseNameSearchText(ex)).toContain(ex.n)
    expect(instrFor(ex)).toEqual(steps[ex.id])
    expect(instrTranslated(ex)).toBe(true)
    await setLang('fa', false)
    expect(exerciseNameFor(ex)).toBe(names[ex.id])
    await setLang('fa', true, true)
    expect(exerciseNameFor(ex)).toBe(ex.n)
  })

  it('preserves equipment and identity-changing qualifiers in translated exercise names', () => {
    const qualifiers = [
      [/\bbarbell\b/, /هالتر/], [/\bdumbbells?\b/, /دمبل/],
      [/\bcable\b/, /سیم‌کش/], [/\bkettlebell\b/, /کتل/],
      // دراز کشیده contains کش as a substring but does not name a resistance band.
      [/\b(?:band|banded)\b/, /(?:^|[\s(])کش(?:[\s)‌]|$)/u], [/^lever\b/, /دستگاه/],
      [/\bweighted\b/, /وزن|وزنه/], [/\bassisted\b/, /کمک/],
      [/\b(?:single|one) leg\b/, /(?:تک|یک)[‌ -]?(?:پا|ساق)|پای (?:واحد|یک)/],
      [/\b(?:single|one) arm\b/, /(?:تک|یک)[‌ -]?(?:دست|بازو)|بازوی (?:واحد|یک)/],
      [/\bseated\b/, /نشسته/], [/\bstanding\b/, /ایستاده/],
      [/\blying\b/, /خوابیده|دراز|دمر/],
      [/\bincline\b/, /شیب|بالاسینه/], [/\bdecline\b/, /شیب|زیرسینه/],
      [/\bsplit squats?\b/, /اسپلیت/],
      [/\bsissy\b/, /سیسی/], [/\bjerk\b/, /جرک/],
      [/\bclean\b/, /کلین/], [/\bsnatch\b/, /اسنچ/],
      [/\bdeadlift\b/, /ددلیفت/], [/\bsquat\b/, /اسکات|اسکوات/],
      [/\bpress\b/, /پرس|فشار/], [/\b(?:biceps?|arm) curl\b/, /جلو بازو/],
      [/\brow\b/, /قایقی|زیربغل|روئینگ/], [/\blunge\b/, /لانج|لانژ|لانگز/],
      [/\bplank\b/, /پلانک|تخته/], [/\bdip\b/, /دیپ|پارالل/],
      [/\bfly\b/, /فلای/], [/\bcrunch\b/, /کرانچ/],
    ]
    for (const ex of EXDB) {
      if (!names[ex.id]) continue
      for (const [source, translated] of qualifiers) {
        if (source.test(ex.n)) expect(names[ex.id], `${ex.id}: ${ex.n}`).toMatch(translated)
      }
    }
  })

  it('distinguishes different squat, press, raise and shrug movements', () => {
    const groups = [
      ['1100', '1101'],               // split squat / single-leg squat
      ['1197', '4256', '0786', '1489'], // squat / stepdown / jerk / sissy squat
      ['4349', '0099'],               // barbell single-leg squat / split squat
      ['3018', '3929'],               // calf raise / side leg raise
      ['2928', '5224', '0095'],       // overhead / wide-grip / regular shrug
      ['1438', '0553'],               // seated / standing kettlebell press
      ['0754', '0758', '0764'],       // decline / incline / regular Smith press
      ['8618', '8620'],               // chest press / decline chest press
      ['10116', '0751'],              // incline / regular close-grip press
      ['2870', '3812', '0662'],       // Pilates swimming / elevated / regular push-up
    ]
    for (const ids of groups) expect(new Set(ids.map(id => names[id])).size, ids.join(', ')).toBe(ids.length)
    expect(names['1100']).toContain('اسپلیت')
    expect(names['4256']).toContain('استپ‌داون')
    expect(names['0786']).toContain('جرک')
    expect(names['0754']).toContain('زیرسینه')
    expect(names['0758']).toContain('بالاسینه')
  })

  it('retains English instructions, descriptions, and custom names when untranslated', async () => {
    await setLang('fa')
    _setDetails(englishSteps, englishDescriptions, null)
    const untranslated = EXDB.find(e => !steps[e.id] && englishSteps[e.id])
    expect(instrFor(untranslated)).toEqual(englishSteps[untranslated.id])
    expect(instrTranslated(untranslated)).toBe(false)
    const described = EXDB.find(e => englishDescriptions[e.id])
    expect(descFor(described)).toBe(englishDescriptions[described.id])
    const custom = { id: 'custom-persian', n: 'تمرین من', st: ['راهنمای شخصی'] }
    expect(exerciseNameFor(custom)).toBe('تمرین من')
    expect(instrFor(custom)).toEqual(custom.st)
  })
})
