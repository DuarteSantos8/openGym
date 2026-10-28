import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LPROJ, PAGE_LOCALE, PHRASES, STRINGS, ANDROID } from '../../ios/ci/voice-strings.mjs'

// Siri's words live in three places that have to agree: VoiceIntents.swift (the English keys and
// phrases), the .lproj files ios/ci/voice-strings.mjs writes, and Settings → Siri & Shortcuts,
// which shows the phrases in the page's language (src/locales).
const root = join(import.meta.dirname, '..', '..')
const swift = readFileSync(join(root, 'ios/App/App/VoiceIntents.swift'), 'utf8')
const lproj = (lang, file) => readFileSync(join(root, 'ios/App/App', `${lang}.lproj`, file), 'utf8')
const unq = s => s.replace(/\\"/g, '"')

describe('VoiceIntents.swift and its strings', () => {
  it('has every phrase in the table, and nothing more', () => {
    const inSwift = [...swift.matchAll(/^\s+"([^"\n]*\\\(\.applicationName\)[^"\n]*)",$/gm)].map(m => m[1].replace('\\(.applicationName)', '{app}'))
    expect(inSwift.length).toBeGreaterThan(0)
    expect(inSwift.sort()).toEqual(Object.keys(PHRASES).sort())
  })

  it('has every word it says in the table', () => {
    const keys = new Set([
      ...[...swift.matchAll(/say\("((?:[^"\\]|\\.)*)"/g)].map(m => unq(m[1])),
      ...[...swift.matchAll(/LocalizedStringResource = "((?:[^"\\]|\\.)*)"/g)].map(m => unq(m[1])),
      ...[...swift.matchAll(/IntentDescription\("((?:[^"\\]|\\.)*)"\)/g)].map(m => unq(m[1])),
      ...[...swift.matchAll(/IntentDialog\("((?:[^"\\]|\\.)*)"\)/g)].map(m => unq(m[1])),
      ...[...swift.matchAll(/@Parameter\(title: "((?:[^"\\]|\\.)*)"/g)].map(m => unq(m[1])),
    ])
    const missing = [...keys].filter(k => !(k in STRINGS))
    expect(missing).toEqual([])
    expect(keys.size).toBeGreaterThan(15)
  })

  it('wrote every language (run node frontend/ios/ci/voice-strings.mjs after a change)', () => {
    const app = s => s.replace(/\{app\}/g, '${applicationName}')
    for (const lang of LPROJ) {
      const phrases = lproj(lang, 'AppShortcuts.strings')
      for (const [key, t] of Object.entries(PHRASES)) {
        expect(phrases, `${lang} ${key}`).toContain(`"${app(key)}" = "${app(t[lang])}";`)
      }
      const words = lproj(lang, 'Localizable.strings')
      for (const [key, t] of Object.entries(STRINGS)) expect(words, `${lang} ${key}`).toContain(`"${key}" = "${t[lang]}";`)
    }
  })
})

describe('Settings → Siri & Shortcuts', () => {
  const rows = { '“Start my workout in openGym”': 'Start my workout in {app}', '“Log my weight in openGym”': 'Log my weight in {app}', '“What’s my workout today in openGym”': "What's my workout today in {app}", '“How’s my streak in openGym”': "How's my streak in {app}" }
  const bare = s => s.replace(/^[“„«「”]\s?|\s?[”“»」]$/g, '')

  it('shows the phrases Siri listens for, in the page’s language', async () => {
    for (const lang of LPROJ) {
      const loc = PAGE_LOCALE[lang] || lang
      const { default: pack } = await import(`../locales/${loc}.js`)
      for (const [key, phrase] of Object.entries(rows)) {
        expect(bare(pack[key]), `${loc} ${key}`).toBe(PHRASES[phrase][lang].replace('{app}', 'openGym'))
      }
    }
  })
})

describe('the Android shortcuts', () => {
  const res = join(root, 'android/app/src/main/res')
  const shortcuts = readFileSync(join(res, 'xml/shortcuts.xml'), 'utf8')
  const manifest = readFileSync(join(root, 'android/app/src/main/AndroidManifest.xml'), 'utf8')

  it('names only labels it has', () => {
    const used = [...shortcuts.matchAll(/@string\/(\w+)/g)].map(m => m[1])
    expect(used.length).toBeGreaterThan(0)
    for (const name of used) expect(Object.keys(ANDROID), name).toContain(name)
  })

  it('opens links the app follows', async () => {
    const { parseWidgetLink } = await import('./widget-links.js')
    const links = [...shortcuts.matchAll(/android:data="([^"]+)"/g)].map(m => m[1])
    expect(links).toHaveLength(3)
    for (const url of links) expect(parseWidgetLink(url), url).not.toBeNull()
    expect(parseWidgetLink('opengym://weigh-in?w=78.2')).toMatchObject({ w: 78.2 })
  })

  it('is on every launcher icon (a new alias needs it too)', () => {
    const aliases = [...manifest.matchAll(/<activity-alias[\s\S]*?<\/activity-alias>/g)].map(m => m[0]).filter(a => a.includes('category.LAUNCHER'))
    expect(aliases.length).toBeGreaterThan(1)
    for (const a of aliases) expect(a, /android:name="([^"]+)"/.exec(a)[1]).toContain('android:resource="@xml/shortcuts"')
  })
})
