/* The alternate home-screen icons: every file scripts/app-icons.mjs owns is there, the size iOS
 * wants, and drawn the way the script draws it today; and the iOS project lists the same icons as
 * src/lib/app-icon-variants.js, or the picker would offer one the phone has not got. In 1.4.3 the
 * picker is iPhone only: Android keeps its one launcher icon (1.4.4 has the alias tests). */
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { IOS_SIZE, PREVIEW, ROOT, draw, files, pngInfo, scene } from './app-icons.mjs'
import { APP_ICON_VARIANTS } from '../src/lib/app-icon-variants.js'

const read = rel => readFileSync(join(ROOT, rel), 'utf8')
const ALT = APP_ICON_VARIANTS.filter(v => v.id !== 'default')

describe('generated icon files', () => {
  it('are all committed', () => {
    const missing = files().map(([rel]) => rel).filter(rel => !existsSync(join(ROOT, rel)))
    expect(missing).toEqual([])
  })

  it('have the sizes each platform wants', () => {
    for (const v of APP_ICON_VARIANTS) {
      const preview = join(ROOT, `public/app-icons/${v.id}.png`)
      expect(pngInfo(readFileSync(preview))).toMatchObject({ width: PREVIEW, height: PREVIEW })
      expect(statSync(preview).size, v.id).toBeLessThanOrEqual(30 * 1024)
    }
    for (const v of ALT) {
      // Apple turns down an app icon with an alpha channel.
      const ios = readFileSync(join(ROOT, `ios/App/App/Assets.xcassets/${v.ios}.appiconset/icon-1024.png`))
      expect(pngInfo(ios)).toEqual({ width: IOS_SIZE, height: IOS_SIZE, alpha: false })
      const set = JSON.parse(read(`ios/App/App/Assets.xcassets/${v.ios}.appiconset/Contents.json`))
      expect(set.images).toEqual([{ filename: 'icon-1024.png', idiom: 'universal', platform: 'ios', size: '1024x1024' }])
    }
  })

  it('match a fresh draw (the small ones; --check compares them all)', () => {
    for (const v of APP_ICON_VARIANTS) {
      expect(readFileSync(join(ROOT, `public/app-icons/${v.id}.png`)).equals(draw(v, PREVIEW)), v.id).toBe(true)
    }
  })
})

describe('node scripts/app-icons.mjs --check', () => {
  // Every committed icon against a fresh draw, the 1024s too (about 20 s, so it runs once, here).
  it('finds nothing out of date', () => {
    const out = execFileSync(process.execPath, [join(ROOT, 'scripts/app-icons.mjs'), '--check'], { encoding: 'utf8' })
    expect(out).toContain('app icons up to date')
  }, 120_000)
})

describe('the Halloween icon', () => {
  const v = APP_ICON_VARIANTS.find(x => x.id === 'halloween')

  it('is a hand-made SVG the renderer knows every piece of', () => {
    expect(v).toMatchObject({ name: 'Halloween', ios: 'AppIcon-Halloween', art: 'resources/icons/halloween.svg' })
    // scene() throws on any element it cannot draw.
    expect(scene(read(v.art)).length).toBeGreaterThan(10)
  })

  it('is dark at the edges, orange on the dumbbell, pale on the moon', () => {
    const shapes = scene(read(v.art))
    const at = (x, y) => shapes.find(s => s.hit(x, y)).color(x, y).map(Math.round)
    expect(at(256, 256)).toEqual([255, 122, 26])   // the bar
    expect(at(90, 110)).toEqual([247, 232, 180])   // the moon's lit side
    const corner = at(10, 500)
    expect(Math.max(...corner)).toBeLessThan(40)
  })
})

describe('Android in 1.4.3', () => {
  it('keeps MainActivity as the one launcher entry: no aliases, no icon plugin', () => {
    const manifest = read('android/app/src/main/AndroidManifest.xml')
    expect(manifest).not.toMatch(/<activity-alias\b[^>]*Icon/)
    const main = manifest.match(/<activity\b[\s\S]*?android:name="\.MainActivity"[\s\S]*?<\/activity>/)[0]
    expect(main).toMatch(/android\.intent\.category\.LAUNCHER/)
    expect(existsSync(join(ROOT, 'android/app/src/main/java/ch/duartesantos/opengym/AppIconPlugin.java'))).toBe(false)
    expect(files().map(([rel]) => rel).filter(rel => rel.startsWith('android/'))).toEqual([])
  })
})

describe('iOS alternate icons', () => {
  const pbx = read('ios/App/App.xcodeproj/project.pbxproj')

  it('every App build configuration names all alternate icon sets', () => {
    const names = [...pbx.matchAll(/ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES = "([^"]*)";/g)].map(m => m[1].split(' '))
    expect(names.length).toBe((pbx.match(/ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;/g) || []).length)
    for (const n of names) expect(n).toEqual(ALT.map(v => v.ios))
    expect(names[0]).toContain('AppIcon-Halloween')
  })

  it('the plugin is compiled, registered and knows the same sets', () => {
    expect(pbx).toMatch(/\/\* AppIconPlugin\.swift in Sources \*\/,/)
    expect(pbx).toMatch(/\/\* AppIconPlugin\.swift \*\/ = \{isa = PBXFileReference;[^}]*path = AppIconPlugin\.swift;/)
    expect(read('ios/App/App/MainViewController.swift')).toContain('bridge?.registerPluginInstance(AppIconPlugin())')
    const swift = read('ios/App/App/AppIconPlugin.swift')
    const pairs = [...swift.matchAll(/"(\w+)": "(AppIcon-\w+)"/g)].map(m => [m[1], m[2]])
    expect(pairs).toEqual(ALT.map(v => [v.id, v.ios]))
  })
})
