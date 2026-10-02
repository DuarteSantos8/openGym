/* check-locales.mjs, run the way CI runs it.
 *
 * The script is a program, and what CI gets from it is an exit code, so it is executed rather
 * than imported: a copy of the real file is dropped into a throwaway tree laid out the way it
 * expects (scripts/ beside src/locales/) with two tiny packs in it. Copying keeps the fixture
 * from having to be one of the app's 14 real locales, and the file under test is still the file
 * that ships, byte for byte. */
import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const script = join(here, 'check-locales.mjs')

const run = packs => {
  const dir = mkdtempSync(join(tmpdir(), 'check-locales-'))
  try {
    mkdirSync(join(dir, 'scripts'))
    mkdirSync(join(dir, 'src', 'locales'), { recursive: true })
    copyFileSync(script, join(dir, 'scripts', 'check-locales.mjs'))
    for (const [lang, dict] of Object.entries(packs))
      writeFileSync(join(dir, 'src', 'locales', `${lang}.js`), `export default ${JSON.stringify(dict, null, 2)}\n`)
    const r = spawnSync(process.execPath, [join(dir, 'scripts', 'check-locales.mjs')], { encoding: 'utf8' })
    return { code: r.status, out: r.stdout + r.stderr }
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

const de = { Save: 'Speichern', 'Next pass starts {0}': 'Der nächste Durchgang beginnt {0}' }

describe('check-locales.mjs', () => {
  it('passes packs that agree', () => {
    const r = run({ de, fr: { Save: 'Enregistrer', 'Next pass starts {0}': 'Le prochain cycle commence {0}' } })
    expect(r.out).toContain('in sync')
    expect(r.code).toBe(0)
  })

  it('fails a translation that dropped the placeholder', () => {
    // {0} is substituted by index: without it the date simply never appears in the sentence.
    const r = run({ de, fr: { Save: 'Enregistrer', 'Next pass starts {0}': 'Le prochain cycle commence bientôt' } })
    expect(r.code).toBe(1)
    expect(r.out).toContain('placeholders')
    expect(r.out).toContain('Next pass starts {0}')
  })

  it('fails a translation that invented a placeholder', () => {
    const r = run({ de: { ...de, Save: 'Speichern {1}' }, fr: { Save: 'Enregistrer', 'Next pass starts {0}': 'Le prochain cycle commence {0}' } })
    expect(r.code).toBe(1)
    expect(r.out).toContain('placeholders')
  })

  it('accepts a translation that moved the placeholders around', () => {
    const src = '{0} of {1}'
    const r = run({ de: { [src]: '{1}: Nummer {0}' }, fr: { [src]: '{0} sur {1}' } })
    expect(r.code).toBe(0)
  })

  it('fails a blank translation, which the English fallback never covers', () => {
    const r = run({ de, fr: { Save: '   ', 'Next pass starts {0}': 'Le prochain cycle commence {0}' } })
    expect(r.code).toBe(1)
    expect(r.out).toContain('blank')
  })

  it('still fails a key one pack does not carry', () => {
    const r = run({ de, fr: { Save: 'Enregistrer' } })
    expect(r.code).toBe(1)
    expect(r.out).toContain('missing')
  })

  // The app's own packs, so the suite carries the same check CI does rather than only the rule.
  it('passes the locale packs this app ships', () => {
    const r = spawnSync(process.execPath, [script], { encoding: 'utf8' })
    expect(r.stdout + r.stderr).toContain('in sync')
    expect(r.status).toBe(0)
  })
})
