// Android 15 draws the app under the status bar and the navigation bar, and the WebView reports
// neither as env(safe-area-inset-*): on a Pixel with three-button navigation the tab bar sat under
// ◀ ● ■, a tap on Stats hit Recents, and on some cold starts the header sat under the clock with its
// Connect button out of reach (Android QA, v1.3.9). MainActivity passes the window's own insets to
// the page, and the stylesheet has to take them. Neither half can run here, so this reads both and
// checks they agree on the contract.
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'

const read = rel => readFileSync(new URL(rel, import.meta.url), 'utf8')
const css = read('../index.css')
const activity = read('../../android/app/src/main/java/ch/duartesantos/opengym/MainActivity.java')

describe('the system bars on Android', () => {
  it('the stylesheet takes the larger of env() and what the app passes', () => {
    expect(css).toMatch(/--sat:max\(env\(safe-area-inset-top,0px\),var\(--native-sat,0px\)\);/)
    expect(css).toMatch(/--sab:max\(env\(safe-area-inset-bottom,0px\),var\(--native-sab,0px\)\);/)
  })

  it('nothing reads env(safe-area-inset-*) around the two variables', () => {
    const dir = new URL('../', import.meta.url)
    for (const f of readdirSync(dir).filter(n => n.endsWith('.css'))) {
      const uses = read('../' + f).match(/env\(safe-area-inset-[a-z]+/g) || []
      expect({ f, uses }).toEqual({ f, uses: f === 'index.css' ? ['env(safe-area-inset-bottom', 'env(safe-area-inset-top'] : [] })
    }
  })

  it('the app passes the status and navigation bars, under the names the stylesheet reads', () => {
    expect(activity).toMatch(/WindowInsetsCompat\.Type\.systemBars\(\) \| WindowInsetsCompat\.Type\.displayCutout\(\)/)
    expect(activity).toContain("'--native-sat'")
    expect(activity).toContain("'--native-sab'")
    // In CSS pixels, not the device's.
    expect(activity).toMatch(/getDisplayMetrics\(\)\.density/)
  })

  it('passes them again to every page that loads', () => {
    expect(activity).toMatch(/addWebViewListener[\s\S]*onPageLoaded[\s\S]*applyBars\(view\)/)
  })

  // The first version set its listener on the WebView, which replaced the WebView's own: env()
  // reported 0 on every start, where it had reported the cutout on most.
  it('reads them on the WebView\'s parent, and leaves the WebView its own listener', () => {
    expect(activity).toMatch(/ViewCompat\.setOnApplyWindowInsetsListener\(holder,/)
    expect(activity).not.toMatch(/setOnApplyWindowInsetsListener\(web\b/)
    expect(activity).toMatch(/return ViewCompat\.onApplyWindowInsets\(v, insets\);/)
  })
})
