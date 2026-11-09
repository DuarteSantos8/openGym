import { describe, expect, it } from 'vitest'
import { LANGS, DATE_LOCALES, DERIVED_LOCALES, EXERCISE_NAME_LANGS, INSTR_LANGS, _setLangState, exerciseNameFor, t } from './i18n-core.js'
import { matchLocale } from './default-lang.js'
import id from '../locales/id.js'

describe('Bahasa Indonesia locale integration', () => {
  it('is registered in LANGS and DATE_LOCALES', () => {
    expect(LANGS.id).toBe('Bahasa Indonesia')
    expect(DATE_LOCALES.id).toBe('id-ID')
    expect(DERIVED_LOCALES.id).toBeUndefined()
  })

  it('matches Indonesian browser locales', () => {
    expect(matchLocale('id')).toBe('id')
    expect(matchLocale('id-ID')).toBe('id')
    expect(matchLocale('id_ID')).toBe('id')
  })

  it('formats dates in Indonesian', () => {
    const formatted = new Intl.DateTimeFormat(DATE_LOCALES.id, { month: 'long' }).format(new Date(2026, 9, 23))
    expect(formatted.toLowerCase()).toBe('oktober')
  })

  it('translates core navigation, buttons, and menus', () => {
    expect(id['Home']).toBe('Beranda')
    expect(id['Today']).toBe('Hari Ini')
    expect(id['Workout']).toBe('Latihan')
    expect(id['Stats']).toBe('Statistik')
    expect(id['History']).toBe('Riwayat')
    expect(id['Settings']).toBe('Pengaturan')
    expect(id['Exercises']).toBe('Latihan')
    expect(id['Plan']).toBe('Rencana')
    expect(id['Start']).toBe('Mulai')
    expect(id['Resume']).toBe('Lanjutkan')
    expect(id['Finish']).toBe('Selesai')
    expect(id['Rest']).toBe('Istirahat')
    expect(id['Cancel']).toBe('Batal')
    expect(id['Confirm']).toBe('Konfirmasi')
    expect(id['Language']).toBe('Bahasa')
    expect(id['Start workout']).toBe('Mulai latihan')
    expect(id['Start {0}']).toBe('Mulai {0}')
  })

  it('keeps exercise names and instructions in English', () => {
    expect(EXERCISE_NAME_LANGS).not.toContain('id')
    expect(INSTR_LANGS).not.toContain('id')

    // Simulate switching language state to Indonesian
    _setLangState('id', id, null, null, true, false)
    const ex = { id: '0001', n: 'Bench Press', st: ['Lie on bench', 'Press bar'] }
    expect(exerciseNameFor(ex)).toBe('Bench Press')
    expect(t('Home')).toBe('Beranda')
    expect(t('Settings')).toBe('Pengaturan')
  })
})
