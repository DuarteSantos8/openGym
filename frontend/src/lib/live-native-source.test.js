// The phone's own widget code follows the same rules as the preview (lib/live-glance.js
// glanceView). Swift cannot run here, so its source is read for the rules from the 1.4.5
// TestFlight 67 fixes: steppers for a plain lift, Log set in words only alone, the time since the
// start under a rest, the record line giving way, "Try it" previews that log nothing, the Dynamic
// Island only where there is one, and every tap drawn at once on the phone.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = p => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')
const views = read('../../ios/App/App/WidgetViews.swift')
const activity = read('../../ios/App/App/WorkoutActivity.swift')
const plugin = read('../../ios/App/App/LiveActivityPlugin.swift')
const receiver = read('../../android/app/src/main/java/ch/duartesantos/opengym/WorkoutCardReceiver.java')
const card = read('../../android/app/src/main/java/ch/duartesantos/opengym/WorkoutCard.java')
const glance = read('./live-glance.js')
const between = (src, a, b) => src.slice(src.indexOf(a), src.indexOf(b, src.indexOf(a)))

describe('iOS glance (WidgetViews.swift)', () => {
  const model = between(views, 'struct GlanceModel', '/// The details in one line')
  it('works out steppers, Log set words and the time under a rest like glanceView', () => {
    expect(model).toMatch(/var steps: \[GlanceStep\]/)
    expect(model).toMatch(/found\.count == 2/)
    expect(model).toMatch(/logWords = buttons\.count == 1 && steps\.isEmpty/)
    expect(model).toMatch(/if still != nil \|\| !steps\.isEmpty \{ note = nil \}/)
    expect(model.match(/since = g\.el == true/g)).toHaveLength(2)
  })
  it('draws the steppers on the Lock Screen and in the island, with the adjust intent', () => {
    expect(between(views, 'struct GlanceSteps', 'struct GlanceLockView')).toMatch(/AdjustSetIntent\(wid: attributes\.wid, entryIdx: c\.entryIdx, setIdx: c\.setIdx, field: f, dir: dir\)/)
    expect(between(views, 'struct GlanceLockView', 'struct GlanceCompactLeading')).toMatch(/GlanceSteps\(/)
    expect(between(views, 'struct GlanceIslandBottom', '// MARK: - the logo')).toMatch(/GlanceSteps\(/)
    // The numbers are never cut on the steppers.
    expect(between(views, 'struct GlanceSteps', 'struct GlanceLockView')).toMatch(/Text\(s\.t\)[^\n]*\n[^\n]*fixedSize\(\)/)
  })
  it('Log set is the check mark alone beside other buttons, still named for VoiceOver', () => {
    const done = between(views, 'struct LiveDoneButton', 'struct LiveSecondaryButton')
    expect(done).toMatch(/var words: Bool = true/)
    expect(done).toMatch(/Image\(systemName: "checkmark"\)/)
    expect(done).toMatch(/accessibilityLabel\(Text\(attributes\.labels\.done\)\)/)
    expect(views).toMatch(/LiveDoneButton\(attributes: attributes, cur: c, words: logWords\)/)
    expect(views.match(/acts: g\.shown, logWords: g\.logWords/g)).toHaveLength(2)
  })
  it('keeps the same button priority as the page and Android', () => {
    const js = glance.match(/const PRIORITY = (\[[^\]]+\])/)[1].replace(/'/g, '"')
    const swift = views.match(/static let priority = (\[[^\]]+\])/)[1]
    const java = card.match(/PRIORITY = \{([^}]+)\}/)[1]
    expect(JSON.parse(swift)).toEqual(JSON.parse(js))
    expect(JSON.parse('[' + java + ']')).toEqual(JSON.parse(js))
  })
})

describe('Try it: a preview logs nothing', () => {
  it('iOS: the preview flag decodes optionally and every tap goes through the guarded queue', () => {
    expect(activity).toMatch(/var pv: Bool\?/)
    const tick = between(activity, 'enum LiveActivityTick', 'private static func bookRestOver')
    expect(tick).toMatch(/if activity\.attributes\.pv == true \{ return \}\n\s+LiveActivityQueue\.append\(event\)/)
    expect(tick.match(/LiveActivityQueue\.append\(/g)).toHaveLength(1)
    expect(tick.match(/bookRestOver\(at:/g).length).toBe(tick.match(/pv != true \{ bookRestOver\(at:/g).length)
  })
  it('iOS: the taps still move the activity on at once, before the page hears of them (point 10)', () => {
    for (const fn of ['static func tick', 'static func nextExercise', 'static func skipRest', 'static func adjust', 'static func addRest']) {
      const body = between(activity, fn, '\n    }\n')
      expect(body, fn).toMatch(/await activity\.update\(ActivityContent\(state: next/)
    }
  })
  it('Android: nothing queued and no rest alarm from a preview card', () => {
    expect(receiver).toMatch(/boolean preview = attrs\.optBoolean\("pv", false\);/)
    expect(receiver).toMatch(/if \(!preview\) WorkoutNotification\.queue\(ctx, move\.event\);/)
    expect(receiver).toMatch(/if \(preview\) \{[\s\S]*?\} else if \(ADD_REST/)
    // The card itself is still redrawn at once.
    expect(receiver).toMatch(/if \(!handedOff\) WorkoutNotification\.refresh\(ctx\);/)
  })
})

// The slow Lock Screen (owner, 1.4.5): a tap has to show at once and stay shown.
describe('a tap answers at once and is not drawn over', () => {
  const javaPlugin = read('../../android/app/src/main/java/ch/duartesantos/opengym/LiveActivityPlugin.java')
  const tick = between(activity, 'enum LiveActivityTick', 'private static func bookRestOver')
  it('iOS: the tap is queued before the redraw (the page\'s older state is told apart by it), the alerts come after', () => {
    for (const fn of ['static func tick', 'static func skipRest', 'static func stopAuto', 'static func addRest']) {
      const body = between(tick, fn, '\n    }\n')
      const at = body.indexOf('await activity.update(')
      expect(at, fn).toBeGreaterThan(0)
      expect(body.indexOf('enqueue(activity'), fn).toBeLessThan(at)
      expect(body.indexOf('enqueue(activity'), fn).toBeGreaterThan(0)
      for (const later of ['bookRestOver(at:', 'LiveActivityQueue.autoStopped', 'LiveActivityQueue.restSkipped', 'removePendingNotificationRequests', 'LiveActivityQueue.didChange']) {
        if (body.includes(later)) expect(body.indexOf(later), fn + ' ' + later).toBeGreaterThan(at)
      }
    }
  })
  it('iOS: the page\'s state is left out while a tap it has not drained waits, and when it changes nothing', () => {
    expect(activity).toMatch(/static func hasUnseen\(wid: String, seen: Set<String>\) -> Bool \{\n\s+all\(\)\.contains \{ \(\$0\["wid"\] as\? String\) == wid && !seen\.contains\(\(\$0\["id"\] as\? String\) \?\? ""\) \}/)
    const update = between(plugin, '@objc func update', '@objc func end')
    const stale = update.indexOf('LiveActivityQueue.hasUnseen(wid: attributes.wid, seen: seen)')
    const same = update.indexOf('if mine.content.state == state {')
    const draw = update.indexOf('await mine.update(content)')
    expect(stale).toBeGreaterThan(0)
    expect(same).toBeGreaterThan(stale)
    expect(draw).toBeGreaterThan(same)
    expect(update).toMatch(/call\.resolve\(\["shown": true, "stale": true\]\)/)
    // Without `seen` (Settings' "Try it") nothing is checked.
    expect(update).toMatch(/let seen = \(call\.getArray\("seen"\) as\? \[String\]\)\.map \{ Set\(\$0\) \}/)
    expect(update).toMatch(/if let seen = seen, LiveActivityQueue\.hasUnseen/)
  })
  it('Android: the same guard before the card is saved, only for the workout the card is of', () => {
    const update = between(javaPlugin, 'public void update', 'public void end')
    expect(update.indexOf('WorkoutCard.hasUnseen(WorkoutNotification.events(ctx), wid, seen)')).toBeGreaterThan(0)
    expect(update.indexOf('WorkoutCard.hasUnseen(')).toBeLessThan(update.indexOf('WorkoutNotification.save(ctx, attributes, state);'))
    expect(update).toMatch(/wid\.equals\(WorkoutNotification\.wid\(WorkoutNotification\.attributes\(ctx\)\)\)/)
    expect(update).toMatch(/stale\.put\("stale", true\);/)
    expect(card).toMatch(/static boolean hasUnseen\(JSONArray events, String wid, java\.util\.Collection<String> seen\)/)
  })
  it('iOS: the glance swaps its layout at once and only the numbers roll; the clocks are left alone', () => {
    const lock = between(views, 'struct GlanceLockView', 'struct GlanceCompactLeading')
    expect(lock.match(/\.transition\(\.identity\)/g).length).toBeGreaterThanOrEqual(6)
    expect(lock.match(/\.contentTransition\(\.numericText\(\)\)/g)).toHaveLength(2)
    expect(between(views, 'struct GlanceSteps', 'struct GlanceLockView')).toMatch(/fixedSize\(\)\n\s+\.contentTransition\(\.numericText\(\)\)/)
    expect(between(views, 'struct LiveButtonsView', '// MARK: - the glance')).toMatch(/button\(k, accent: accent\)\.transition\(\.identity\)/)
    // No transition of ours on a clock: Text(timerInterval:) ticks as iOS draws it.
    for (const clock of ['struct LiveRest', 'struct GlanceElapsed']) {
      expect(between(views, clock, '\n}\n'), clock).not.toMatch(/contentTransition/)
    }
    // Nothing that needs more than the iOS 17 the widgets are built for, and no animation modifier
    // (a Live Activity ignores the timing of one anyway).
    expect(views).not.toMatch(/numericText\(value:|\.animation\(|withAnimation/)
  })
  it('iOS: the Home Screen widget\'s number dims on a tap and rolls, and only its own widget is reloaded', () => {
    const row = between(views, 'struct LoggerStepRow', 'struct LoggerView')
    expect(row).toMatch(/\.contentTransition\(\.numericText\(\)\)\n\s+\.invalidatableContent\(\)/)
    expect(activity).not.toMatch(/reloadAllTimelines/)
    expect(activity.match(/reloadTimelines\(ofKind: WidgetLogger\.widgetKind\)/g)).toHaveLength(2)
    const widgets = read('../../ios/App/OpenGymWidgets/OpenGymWidgets.swift')
    const kind = activity.match(/static let widgetKind = "([^"]+)"/)[1]
    expect(between(widgets, 'struct TodayWidget', 'struct StreakWidget')).toContain(`StaticConfiguration(kind: "${kind}"`)
  })
})

describe('the Dynamic Island only where there is one', () => {
  it('the plugin says so, by model or by the top safe area, and no when unknown', () => {
    expect(plugin).toMatch(/"island": island/)
    expect(plugin).toMatch(/"iPhone17,5"/)
    expect(plugin).toMatch(/safeAreaInsets\.top >= 59/)
    expect(plugin).toMatch(/userInterfaceIdiom == \.phone else \{ return false \}/)
  })
  it('the Lock Screen view needs no island (a phone without one shows it there and as a banner)', () => {
    expect(between(views, 'struct GlanceLockView', 'struct GlanceCompactLeading')).not.toMatch(/DynamicIsland/)
  })
})
