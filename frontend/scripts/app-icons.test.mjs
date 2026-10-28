/* The alternate home-screen icons: every file scripts/app-icons.mjs owns is there, the size each
 * platform wants, and drawn the way the script draws it today; and the native projects list the
 * same icons as src/lib/app-icon-variants.js, or the picker would offer one the phone has not got. */
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { DENSITIES, IOS_SIZE, PREVIEW, ROOT, draw, files, pngInfo, scene } from './app-icons.mjs'
import { APP_ICON_VARIANTS } from '../src/lib/app-icon-variants.js'

const read = rel => readFileSync(join(ROOT, rel), 'utf8')
const ALT = APP_ICON_VARIANTS.filter(v => v.id !== 'default')
const RES = 'android/app/src/main/res'

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
      for (const [dpi, f] of Object.entries(DENSITIES)) {
        const png = name => pngInfo(readFileSync(join(ROOT, `${RES}/mipmap-${dpi}/${name}.png`)))
        expect(png(`ic_launcher_${v.id}`)).toMatchObject({ width: Math.round(48 * f), alpha: false })
        expect(png(`ic_launcher_${v.id}_round`)).toMatchObject({ width: Math.round(48 * f), alpha: true })
        expect(png(`ic_launcher_${v.id}_foreground`)).toMatchObject({ width: Math.round(108 * f) })
      }
      expect(read(`${RES}/mipmap-anydpi-v26/ic_launcher_${v.id}.xml`)).toContain(`@mipmap/ic_launcher_${v.id}_foreground`)
      expect(read(`${RES}/values/app_icons.xml`)).toContain(`<color name="ic_launcher_${v.id}_background">${v.bg}</color>`)
    }
  })

  it('match a fresh draw (the small ones; --check compares them all)', () => {
    for (const v of APP_ICON_VARIANTS) {
      expect(readFileSync(join(ROOT, `public/app-icons/${v.id}.png`)).equals(draw(v, PREVIEW)), v.id).toBe(true)
    }
    const sky = APP_ICON_VARIANTS.find(v => v.id === 'sky')
    expect(readFileSync(join(ROOT, `${RES}/mipmap-mdpi/ic_launcher_sky_round.png`)).equals(draw(sky, 48, { round: true }))).toBe(true)
    // The hand-made one goes through its own renderer, round cut included.
    const hw = APP_ICON_VARIANTS.find(v => v.id === 'halloween')
    expect(readFileSync(join(ROOT, `${RES}/mipmap-mdpi/ic_launcher_halloween_round.png`)).equals(draw(hw, 48, { round: true }))).toBe(true)
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

  it('keeps the web and its spider inside the safe zone Android promises', () => {
    // The round mask shows up to 256 from the centre but only guarantees 66 of 72 dp (about 234):
    // in that rim only the two thin moorings may show, not the web itself.
    const shapes = scene(read(v.art))
    let lit = 0
    for (let y = 0; y < 512; y += 2) for (let x = 0; x < 512; x += 2) {
      const d = Math.hypot(x - 256, y - 256)
      if (d >= 234 && d <= 256 && Math.max(...shapes.find(s => s.hit(x, y)).color(x, y)) > 120) lit++
    }
    expect(lit).toBeLessThan(80)
    expect(shapes.find(s => s.hit(294, 178)).color(294, 178).map(Math.round)).toEqual([236, 223, 255])   // the spider
  })
})

describe('the Christmas icon', () => {
  const v = APP_ICON_VARIANTS.find(x => x.id === 'christmas')

  it('is a hand-made SVG the renderer knows every piece of', () => {
    expect(v).toMatchObject({ name: 'Christmas', ios: 'AppIcon-Christmas', android: 'IconChristmas', art: 'resources/icons/christmas.svg' })
    expect(scene(read(v.art)).length).toBeGreaterThan(20)
  })

  it('a lime dumbbell in a Santa hat, wrapped with a red ribbon, on a dark winter night', () => {
    const shapes = scene(read(v.art))
    const at = (x, y) => shapes.find(s => s.hit(x, y)).color(x, y).map(Math.round)
    expect(at(256, 256)).toEqual([163, 230, 53])    // the bar, openGym lime
    expect(at(165, 140)).toEqual([230, 57, 70])     // the hat
    expect(at(357, 300)).toEqual([230, 57, 70])     // the ribbon
    expect(at(150, 164)).toEqual([248, 249, 250])   // the hat's brim
    expect(Math.max(...at(10, 500))).toBeLessThan(40)
  })

  it('keeps everything inside the safe zone Android promises', () => {
    const shapes = scene(read(v.art))
    let lit = 0
    for (let y = 0; y < 512; y += 2) for (let x = 0; x < 512; x += 2) {
      const d = Math.hypot(x - 256, y - 256)
      if (d >= 234 && d <= 256 && Math.max(...shapes.find(s => s.hit(x, y)).color(x, y)) > 120) lit++
    }
    expect(lit).toBe(0)
  })
})

describe('Android launcher aliases', () => {
  const manifest = read('android/app/src/main/AndroidManifest.xml')
  const main = manifest.match(/<activity\b[\s\S]*?android:name="\.MainActivity"[\s\S]*?(\/>|<\/activity>)/)[0]
  const aliases = [...manifest.matchAll(/<activity-alias\b([\s\S]*?)<\/activity-alias>/g)].map(m => m[1])
  const launchers = aliases.filter(a => /android\.intent\.category\.LAUNCHER/.test(a))
  const attr = (a, name) => a.match(new RegExp(`android:${name}="([^"]*)"`))?.[1]

  it('MainActivity itself is no launcher entry, so switching never disables the activity', () => {
    expect(main).not.toMatch(/LAUNCHER/)
    expect(main).not.toMatch(/android:enabled="false"/)
  })

  it('has one launcher alias per icon, only the original enabled', () => {
    expect(launchers.map(a => attr(a, 'name'))).toEqual(APP_ICON_VARIANTS.map(v => '.' + v.android))
    for (const a of launchers) {
      const v = APP_ICON_VARIANTS.find(x => '.' + x.android === attr(a, 'name'))
      expect(attr(a, 'targetActivity')).toBe('.MainActivity')
      expect(attr(a, 'exported')).toBe('true')
      expect(a).toMatch(/android\.intent\.action\.MAIN/)
      expect(attr(a, 'enabled')).toBe(v.id === 'default' ? 'true' : 'false')
      const icon = v.id === 'default' ? 'ic_launcher' : `ic_launcher_${v.id}`
      expect(attr(a, 'icon')).toBe(`@mipmap/${icon}`)
      expect(attr(a, 'roundIcon')).toBe(`@mipmap/${icon}_round`)
    }
  })

  it('the plugin knows the same aliases and is registered', () => {
    const java = read('android/app/src/main/java/ch/duartesantos/opengym/AppIcons.java')
    const list = name => JSON.parse('[' + java.match(new RegExp(`${name} = \\{([^}]*)\\}`))[1] + ']')
    expect(list('IDS')).toEqual(APP_ICON_VARIANTS.map(v => v.id))
    expect(list('ALIASES')).toEqual(APP_ICON_VARIANTS.map(v => v.android))
    // In main, not in FlavorPlugins: the sideload and the Play build both have it.
    expect(read('android/app/src/main/java/ch/duartesantos/opengym/MainActivity.java')).toContain('registerPlugin(AppIconPlugin.class);')
  })
})

describe('iOS alternate icons', () => {
  const pbx = read('ios/App/App.xcodeproj/project.pbxproj')

  it('every App build configuration names all alternate icon sets', () => {
    const names = [...pbx.matchAll(/ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES = "([^"]*)";/g)].map(m => m[1].split(' '))
    expect(names.length).toBe((pbx.match(/ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;/g) || []).length)
    for (const n of names) expect(n).toEqual(ALT.map(v => v.ios))
    expect(names[0]).toContain('AppIcon-Halloween')
    expect(names[0]).toContain('AppIcon-Christmas')
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
