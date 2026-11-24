// 1.4.6 watch round: fixes in native code (Kotlin, Java, Swift) that cannot be compiled or run
// here. Their source is read for the rule each fix puts in place, so a later edit that drops one
// fails here instead of on a wrist.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = p => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')
// The code alone, comments dropped (they often name what the code no longer does).
const code = p => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map(l => l.replace(/(^|[^:"])\/\/.*$/, '$1')).join('\n')
const between = (src, a, b) => {
  const from = src.indexOf(a)
  if (from < 0) return ''
  const to = src.indexOf(b, from + a.length)
  return src.slice(from, to < 0 ? src.length : to)
}

const ANDROID = '../../android/app/src/main/java/ch/duartesantos/opengym/'

describe('Android rest countdown (RestTimerService.java, #1453 / #1454)', () => {
  const src = code(ANDROID + 'RestTimerService.java')
  const start = between(src, 'public int onStartCommand', '\n    @Override')
  it('posts its card before stopping when the rest is already over', () => {
    const past = between(start, 'if (nextEnd <= System.currentTimeMillis())', 'return START_NOT_STICKY')
    expect(past).toMatch(/show\(\);\s*stopForegroundCompat\(\);/)
  })
  it('posts its card on every start, screen on or off, before the first tick', () => {
    const tail = start.slice(start.indexOf('handler.removeCallbacks(tick);'))
    expect(tail).toMatch(/show\(\);\s*tick\.run\(\);/)
    expect(tail).not.toMatch(/!interactive\(\)\) show\(\)/)
  })
})

const WATCH = '../../ios/App/Watch/'
const CORE = '../../ios/App/WatchCore/Sources/WatchCore/'

describe('Apple Watch hold the phone logged first (SessionStore.swift, #1409 / #1410)', () => {
  const store = code(WATCH + 'SessionStore.swift')
  const core = code(CORE + 'SessionCore.swift')
  it('remembers the set a hold or its 3-2-1 runs for', () => {
    expect(between(store, 'func autoHoldIfDue', '\n    func ')).toMatch(/holdFor = \(entryIndex, si,/)
    expect(core).toMatch(/static func holdOpen\(/)
    expect(core).toMatch(/static func holdPlace\(/)
  })
  it('ends a hold unlogged once a snapshot shows its set done', () => {
    expect(store).toMatch(/if let h = self\.holdFor, !SessionCore\.holdOpen\(self\.state,[^\n]*\{\s*self\.stopHold\(\)/)
  })
  it('logs the hold on its own set, not on the first open one', () => {
    const end = between(store, 'func endHold(early: Bool)', 'func stopHold()')
    expect(end).toMatch(/SessionCore\.holdPlace\(state,/)
    expect(end).toMatch(/state\.entryIndex = own\.entry/)
  })
  it('a hold that stops also stops its count-in', () => {
    expect(between(store, 'func stopHold()', '\n    }')).toMatch(/stopHoldCount\(\)/)
  })
})

const WEAR = '../../android/wear/src/main/java/ch/duartesantos/opengym/wear/'

describe('Wear OS hold the phone logged first (WearStore.kt, #1427 / #1428)', () => {
  const store = code(WEAR + 'WearStore.kt')
  it('remembers the set a hold or its 3-2-1 runs for', () => {
    expect(code(WEAR + 'WatchLogic.kt')).toMatch(/data class HoldSet\(/)
    expect(between(store, 'fun autoHoldIfDue()', '\n    fun ')).toMatch(/holdFor = HoldSet\(/)
  })
  it('ends a hold unlogged once a snapshot shows its set done', () => {
    expect(store).toMatch(/if \(holdFor\?\.openIn\(after\) == false\) \{ stopHold\(\)/)
  })
  it('logs the hold on its own set and skips it when that set is gone', () => {
    const end = between(store, 'fun endHold(early: Boolean)', 'fun stopHold()')
    expect(end).toMatch(/holdFor\?\.placeIn\(_state\.value\)/)
    expect(end).toMatch(/!gone\) completeSet\(heldFor = lasted, held = held/)
  })
})

describe('Watch keypad check with nothing typed (#1282 / #1283)', () => {
  it('Apple Watch: ✓ answers with nothing typed and keeps the number shown', () => {
    expect(code(CORE + 'SetNav.swift')).toMatch(/func confirms\(_ range: ClosedRange<Double>\) -> Bool \{\s*text\.isEmpty \|\| fits\(range\)/)
    const pad = between(code(WATCH + 'SetPage.swift'), 'struct KeypadView', '/// The number typed')
    expect(pad).toMatch(/let ok = pad\.confirms\(range\)/)
    expect(pad).toMatch(/\.disabled\(!ok\)/)
    expect(pad).toMatch(/if let v = pad\.value \{ save\(v\) \}\s*dismiss\(\)/)
  })
  it('Wear OS: the same', () => {
    expect(code(WEAR + 'WatchLogic.kt')).toMatch(/fun confirms\(range: ClosedFloatingPointRange<Double>\) = text\.isEmpty\(\) \|\| fits\(range\)/)
    const pad = between(code(WEAR + 'ui/Screens.kt'), 'fun KeypadView(', '\n}\n')
    expect(pad).toMatch(/val ok = pad\.confirms\(range\)/)
    expect(pad).toMatch(/pad\.value\?\.let\(onSave\) \?: onClose\(\)/)
  })
})

describe('iPhone rest alarm follows the watch while locked (RestAlertPlugin.swift, #1405 / #1406)', () => {
  const plugin = code('../../ios/App/App/RestAlertPlugin.swift')
  const link = code('../../ios/App/App/WatchBridgePlugin.swift')
  it('the watch link announces each newly stored event', () => {
    expect(link).toMatch(/if added \{ NotificationCenter\.default\.post\(name: WatchLink\.eventStored/)
  })
  it('the rest alert listens and moves its alarm by PhoneRestAlarm, only with the page asleep', () => {
    expect(plugin).toMatch(/selector: #selector\(watchRest\(_:\)\), name: WatchLink\.eventStored/)
    const body = between(plugin, '@objc private func watchRest', '\n    }\n')
    expect(body).toMatch(/applicationState != \.active/)
    expect(body).toMatch(/PhoneRestAlarm\.change\(ev,/)
  })
  it('PhoneRestAlarm is compiled into the iPhone app', () => {
    expect(read('../../ios/App/App.xcodeproj/project.pbxproj')).toMatch(/PhoneRestAlarm\.swift in Sources/)
  })
})

describe('Apple Watch summary takes the crown (SideScreens.swift, #1308 / #1310)', () => {
  const summary = between(code(WATCH + 'SideScreens.swift'), 'struct SummaryView', '\nstruct ')
  it('focuses its scroll view when it opens', () => {
    expect(summary).toMatch(/@FocusState private var crown: Bool/)
    expect(summary).toMatch(/\.focused\(\$crown\)/)
    expect(summary).toMatch(/crown = true/)
  })
})

describe('Wear OS metrics pages turn at a quarter swipe (Screens.kt, #1288 / #1289)', () => {
  it('the metrics pager snaps at 0.25', () => {
    const stack = between(code(WEAR + 'ui/Screens.kt'), 'fun MetricsStack(', '\n}\n')
    expect(stack).toMatch(/flingBehavior = PagerDefaults\.snapFlingBehavior\(state = pager, snapPositionalThreshold = 0\.25f\)/)
  })
})

describe('Watch rest: a tap at 3, 2 and 1 s left (#1287)', () => {
  it('Apple Watch: each tap belongs to the rest that armed it', () => {
    const store = code(WATCH + 'SessionStore.swift')
    expect(store).toMatch(/for s in \[3\.0, 2\.0, 1\.0\] where left > s \+ 1/)
    expect(store).toMatch(/self\.restArm == arm, self\.restEndsAt == end, self\.restPausedAt == nil/)
  })
  it('Wear OS: inside the rest job, so a rest moved or skipped cancels them', () => {
    expect(code(WEAR + 'WearStore.kt')).toMatch(/for \(left in listOf\(3, 2, 1\)\)[\s\S]{0,200}Haptics\.restCount\(app\)/)
  })
})

describe('Apple Watch corners and the set count (#1414)', () => {
  it('the rest page\'s back button sits in from the rounded corner', () => {
    const top = between(code(WATCH + 'RestHold.swift'), 'Image(systemName: "chevron.left")', 'Spacer(minLength: 0)')
    expect(top).toMatch(/\.padding\(\.leading, roomy \? 12 : 8\)/)
  })
  it('the keypad keeps its cross and its check inside the rounded corners', () => {
    const pad = between(code(WATCH + 'SetPage.swift'), 'struct KeypadView', '/// The number typed')
    expect(pad).toMatch(/- 5 \* 4 - 18\) \/ 4/)
    expect(pad).toMatch(/accessibilityLabel\(Text\("Cancel"\)\)\s*\.padding\(\.leading, 8\)/)
    expect(pad).toMatch(/\.disabled\(!ok\)\s*\.padding\(\.horizontal, 10\)/)
  })
  it('the set count beside the heart rate takes its own size, never "..."', () => {
    const pill = between(code(WATCH + 'SessionView.swift'), 'struct SetPill', '\n}\n')
    expect(pill).toMatch(/\.lineLimit\(1\)/)
    expect(pill).toMatch(/\.fixedSize\(\)/)
  })
})

describe('the Wear OS APK on a phone (#1359)', () => {
  const main = code(WEAR + 'MainActivity.kt')
  it('shows "this is the watch app" and runs nothing else when the device is not a watch', () => {
    expect(main).toMatch(/private val onPhone by lazy \{ !packageManager\.hasSystemFeature\(PackageManager\.FEATURE_WATCH\) \}/)
    expect(between(main, 'override fun onCreate', 'lifecycle.addObserver(ambient)')).toMatch(/if \(onPhone\) \{\s*setContentView\(notAWatch\(\)\)\s*return/)
    expect(between(main, 'override fun onResume()', '\n    }')).toMatch(/if \(onPhone\) return/)
  })
  it('says so in every language the watch speaks', () => {
    for (const lang of ['values', 'values-de', 'values-pt-rBR', 'values-zh-rTW', 'values-in', 'values-da']) {
      const xml = read(`../../android/wear/src/main/res/${lang}/strings.xml`)
      expect(xml, lang).toMatch(/name="not_a_watch_title"/)
      expect(xml, lang).toMatch(/name="not_a_watch_body">[^<]*issues\/1359</)
    }
  })
  it('the release names the APK for the watch only', () => {
    const sh = read('../../../scripts/android/build-wear.sh')
    expect(sh).toMatch(/APK="openGym-WearOS-watch-only-\$VER\.apk"/)
    expect(sh).not.toMatch(/openGym-Wear-\$VER\.apk/)
  })
})
