// #911: the watches' rest screens say what to load next, read from the set rows the snapshot
// already carries (docs/WATCH_SYNC.md), so nothing new goes over the wire and an older phone works.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8')

describe('next set weight on the watch rest screen (#911)', () => {
  it('Apple Watch: RestView shows SessionStore.nextSetNumbers under "Up next"', () => {
    const store = read('../../ios/App/Watch/SessionStore.swift')
    const app = read('../../ios/App/Watch/RestHold.swift')
    expect(store).toMatch(/var nextSetNumbers: String\? \{[\s\S]*?sides\[side\]\.w[\s\S]*?e\.weightUnit\(w\.unit\)/)
    const rest = app.slice(app.indexOf('struct RestView'), app.indexOf('struct EffortChips'))
    expect(rest).toMatch(/Text\("Up next"\)[\s\S]*?store\.nextSetNumbers/)
  })
  it('Wear OS: the rest screen shows nextSetNumbers under "Up next", tested in NextSetNumbersTest.kt', () => {
    const screens = read('../../android/wear/src/main/java/ch/duartesantos/opengym/wear/ui/Screens.kt')
    // 1.4.5 redesign: RestView's UpNext, as on the Apple Watch
    const upNext = screens.slice(screens.indexOf('private fun UpNext'), screens.indexOf('private fun EffortChips'))
    expect(upNext).toMatch(/R\.string\.up_next[\s\S]*?nextSetNumbers\(e, si, w\.unit\)/)
    expect(screens).toMatch(/fun RestView[\s\S]*?UpNext\(/)
    expect(read('../../android/wear/src/test/java/ch/duartesantos/opengym/wear/NextSetNumbersTest.kt')).toContain('"22 kg × 7"')
  })
})
