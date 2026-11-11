// The phone's own widget code follows the same rules as the preview (lib/live-glance.js
// glanceView). Swift cannot run here, so its source is read for the rules from the 1.4.5
// TestFlight 67 fixes: steppers for a plain lift, Log set in words only alone, the time since the
// start under a rest, the record line giving way, "Try it" previews that log nothing, the Dynamic
// Island only where there is one, and every tap drawn at once on the phone.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
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
  it('iOS: the tap is queued and its alerts are booked before the redraw, and only then is the page told', () => {
    // Queued first: the page's older state is told apart by it. The alerts with it, before the
    // `await`: a page that is awake drains the tap while the redraw is on its way and books its own
    // (your sound, the chain's new timing), which ours must never land on top of.
    for (const fn of ['static func tick', 'static func skipRest', 'static func stopAuto', 'static func addRest']) {
      const body = between(tick, fn, '\n    }\n')
      const at = body.indexOf('await activity.update(')
      const queued = body.indexOf('enqueue(activity')
      expect(at, fn).toBeGreaterThan(0)
      expect(queued, fn).toBeGreaterThan(0)
      expect(queued, fn).toBeLessThan(at)
      for (const alert of ['bookRestOver(at:', 'LiveActivityQueue.autoStopped', 'LiveActivityQueue.restSkipped', 'removePendingNotificationRequests']) {
        if (!body.includes(alert)) continue
        expect(body.indexOf(alert), fn + ' ' + alert).toBeGreaterThan(queued)
        expect(body.lastIndexOf(alert), fn + ' ' + alert).toBeLessThan(at)
      }
      expect(body.indexOf('LiveActivityQueue.didChange'), fn).toBeGreaterThan(at)
      // One redraw per tap.
      expect(body.match(/await activity\.update\(/g), fn).toHaveLength(1)
    }
    // Skip rest takes the old alert down before it tells the rest alert, which books the next one.
    const skip = between(tick, 'static func skipRest', '\n    }\n')
    expect(skip.indexOf('removeDeliveredNotifications')).toBeLessThan(skip.indexOf('LiveActivityQueue.restSkipped'))
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
  it('Android: the same guard, checked and saved under the lock the buttons queue with, only for the workout the card is of', () => {
    const update = between(javaPlugin, 'public void update', 'public void end')
    const note = read('../../android/app/src/main/java/ch/duartesantos/opengym/WorkoutNotification.java')
    expect(update).toMatch(/if \(!WorkoutNotification\.saveUnlessUnseen\(ctx, attributes, state, seen\)\) \{/)
    expect(update).toMatch(/stale\.put\("stale", true\);/)
    expect(update.indexOf('saveUnlessUnseen(')).toBeLessThan(update.indexOf('WorkoutNotification.refresh('))
    // One lock for the check, the save and the buttons' queue: a tap never slips in between.
    const save = between(note, 'static boolean saveUnlessUnseen', 'static void saveState')
    expect(save).toMatch(/synchronized \(LOCK\) \{\n\s+if \(seen != null\) \{\n\s+String mine = wid\(WorkoutCard\.parse\(attributes\)\);\n\s+if \(mine\.equals\(wid\(attributes\(ctx\)\)\) && WorkoutCard\.hasUnseen\(events\(ctx\), mine, seen\)\) return false;/)
    expect(save.indexOf('return false;')).toBeLessThan(save.indexOf('putString(K_ATTRS, attributes)'))
    expect(between(note, 'static void queue', 'static JSONArray events')).toMatch(/synchronized \(LOCK\)/)
    // The page's state reaches the card by this one door.
    expect(note).not.toMatch(/static void save\(/)
    // The button queues the tap before it saves what it drew, so the guard sees it in time.
    const tap = between(receiver, 'public void onReceive', 'if (!handedOff)')
    expect(tap.indexOf('WorkoutNotification.queue(ctx, move.event)')).toBeLessThan(tap.indexOf('WorkoutNotification.saveState(ctx, move.state)'))
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
  it('iOS: the Home Screen widget\'s number dims on a tap and rolls, and every widget that can show the set is drawn again', () => {
    const row = between(views, 'struct LoggerStepRow', 'struct LoggerView')
    expect(row).toMatch(/\.contentTransition\(\.numericText\(\)\)\n\s+\.invalidatableContent\(\)/)
    expect(activity).not.toMatch(/reloadAllTimelines/)
    expect(activity.match(/WidgetLogger\.reloadWidgets\(\)/g)).toHaveLength(2)
    expect(activity).toMatch(/static func reloadWidgets\(\) \{\n\s+widgetKinds\.forEach \{ WidgetCenter\.shared\.reloadTimelines\(ofKind: \$0\) \}/)
    const kinds = JSON.parse(activity.match(/static let widgetKinds = (\[[^\]]+\])/)[1])
    // The kinds whose views draw the set (LoggerView): they share one copy of it, so one left
    // behind would show a set and log the one after it.
    const widgets = read('../../ios/App/OpenGymWidgets/OpenGymWidgets.swift')
    const viewsOf = src => [...src.matchAll(/\b([A-Z]\w*View)\(/g)].map(x => x[1])
    const bodyOf = (src, name) => (src.includes('struct ' + name + ': View') ? between(src, 'struct ' + name + ': View', '\n}\n') : '')
    const expected = []
    for (const m of widgets.matchAll(/(?:Static|AppIntent)Configuration\(kind: "([^"]+)"/g)) {
      // The views the kind's closure names, and for an entry view of the extension the views it
      // picks by size: any of them drawing the set counts.
      const closure = widgets.slice(m.index, widgets.indexOf('.configurationDisplayName', m.index))
      const names = viewsOf(closure).flatMap(n => [n, ...viewsOf(bodyOf(widgets, n))])
      expect(names.length, m[1]).toBeGreaterThan(0)
      if (names.some(n => /LoggerView\(/.test(bodyOf(views, n)))) expected.push(m[1])
    }
    expect(expected.length).toBeGreaterThan(0)
    expect(kinds.slice().sort()).toEqual(expected.sort())
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

// Where the seconds go (owner, 1.4.5): every button leaves one line for Console.app.
describe('the timing log of the Live Activity buttons (iOS)', () => {
  const tick = between(activity, 'enum LiveActivityTick', 'private static func bookRestOver')
  const log = between(activity, 'enum LiveLog', '/**\n * The Live Activity\'s Done.')
  it('every button times itself, and says so when it finds no activity', () => {
    const fns = ['tick', 'nextExercise', 'skipRest', 'stopAuto', 'adjust', 'addRest', 'queueOnly']
    for (const fn of fns) {
      const body = between(tick, 'static func ' + fn + '(', '\n    }\n')
      expect(body, fn).toMatch(/let tap = LiveTap\(/)
      expect(body, fn).toMatch(/defer \{ tap\.end\(\) \}/)
      expect(body, fn).toMatch(/activities\.first\(where: \{ \$0\.attributes\.wid == wid \}\) else \{ tap\.missing\(\); return \}/)
      // The stopwatch brackets the redraw and nothing else.
      expect(body, fn).toMatch(/tap\.willUpdate\(\)\n\s+await activity\.update\([^\n]+\n\s+tap\.didUpdate\(\)/)
    }
    // No button looks for its activity without leaving a trace.
    expect(tick.match(/activities\.first\(/g)).toHaveLength(fns.length)
    expect(tick.match(/await activity\.update\(/g).length).toBe(tick.match(/tap\.willUpdate\(\)/g).length)
  })
  it('one subsystem and category to filter by, and only numbers and fixed words in a line', () => {
    expect(log).toMatch(/Logger\(subsystem: "ch\.opengym\.app", category: "live"\)/)
    // Nothing of the workout: no id, no exercise, no state.
    expect(log).not.toMatch(/wid|exId|exName|state\./)
    // The names are literals, or the kind after it was checked against the four fixed words.
    const names = [...tick.matchAll(/LiveTap\(([^)]*)\)/g)].map(m => m[1])
    for (const n of names) expect(n).toMatch(/^("\w+"|queue \? "log" : "widgetLog"|kind)$/)
    expect(tick).toMatch(/\["prev", "warm", "addSet", "pause"\]\.contains\(kind\) else \{ return \}\n[^\n]*\n\s+let tap = LiveTap\(kind\)/)
  })
  it('the launch and the scene leave a line too', () => {
    expect(read('../../ios/App/App/SceneDelegate.swift')).toMatch(/willConnectTo[^\n]+\n[\s\S]{0,300}LiveLog\.sceneConnected\(\)/)
    expect(read('../../ios/App/App/AppDelegate.swift')).toMatch(/LiveLog\.launched\(background: application\.applicationState == \.background\)/)
  })
})

// Previous exercise, Warm-up, Add set from the Lock Screen (owner, 1.4.5): the page draws them, so
// the button's code stays open until it has, and the page answers with no timer in between.
describe('a button only the page can draw waits for its answer (iOS)', () => {
  const tick = between(activity, 'enum LiveActivityTick', 'private static func bookRestOver')
  const queueOnly = between(tick, 'static func queueOnly(', '\n    }\n')
  const wait = between(tick, 'private static func waitForPage(', '\n    }\n')
  const answer = between(activity, 'enum LiveAnswer', 'enum LiveLog')
  it('waits after the tap is queued and the page was told, never for a preview or without a page', () => {
    const order = ['LiveAnswer.takenCount(wid: wid)', 'enqueue(activity, ev)', 'NotificationCenter.default.post(name: LiveActivityQueue.didChange', 'if activity.attributes.pv == true { return }', 'guard LiveAnswer.pageRuns else { tap.answered("none"); return }', 'await waitForPage(']
    const at = order.map(x => queueOnly.indexOf(x))
    expect(at.every(i => i >= 0), JSON.stringify(at)).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
    // The buttons the phone draws itself wait for nobody.
    expect(tick.match(/await waitForPage\(/g)).toHaveLength(1)
  })
  it('the wait is bounded, sleeps between looks, and gives up when cancelled', () => {
    expect(wait).toMatch(/for _ in 0\.\.<30 \{\n\s+do \{ try await Task\.sleep\(nanoseconds: 50_000_000\) \} catch \{ return "cancelled" \}/)
    expect(wait).not.toMatch(/while |Thread\.sleep|DispatchSemaphore|\.wait\(|MainActor|DispatchQueue\.main/)
    expect(wait).toMatch(/return "timeout"$/)
    // No lock is held across a pause.
    for (const fn of answer.split('static ').slice(1).filter(f => f.includes('lock.lock()'))) expect(fn, fn).not.toMatch(/await/)
  })
  it('the plugin counts a state as the answer only once it has every queued tap, and says when it is drawn', () => {
    const update = between(plugin, '@objc func update', '@objc func end')
    const at = ['LiveActivityQueue.hasUnseen(', 'let turn = LiveAnswer.took(wid: attributes.wid)', 'await mine.update(content)\n                LiveAnswer.drew(wid: attributes.wid, turn: turn)'].map(x => update.indexOf(x))
    expect(at.every(i => i >= 0), JSON.stringify(at)).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
    expect(update.match(/LiveAnswer\.drew\(/g)).toHaveLength(2)
    expect(between(plugin, '@objc func drain', '@objc func ack')).toMatch(/LiveAnswer\.pageAsked\(\)/)
  })
  it('the page sends that answer directly', () => {
    const js = read('./live-activity.js')
    expect(js).toMatch(/if \(direct\) \{ try \{ sendNow\?\.\(\) \}/)
  })
})

// A locked iPhone (owner, 1.4.5): Settings said "The buttons work without unlocking". The intents
// ask for no authentication (the default lets them run on a locked device), but Apple's own page
// on these buttons says that on a locked device they stay inactive until the person
// authenticates. So Settings promises nothing more than that, in every language.
describe('what Settings says about a locked phone', () => {
  const page = read('../components/LiveWidgetSettings.jsx')
  const note = 'Needs iOS 17 or later. On a locked phone, iOS may ask for Face ID or your passcode first. Finish opens the app.'
  it('never promises buttons without unlocking, and names what iOS may ask for', () => {
    expect(page).not.toMatch(/without unlocking/i)
    expect(page).toContain(`ios: () => t('${note}')`)
    expect(page).toContain("t('− and + on the weight and the reps, and a tap to rate the effort.')")
  })
  it('in all 25 languages', () => {
    const dir = fileURLToPath(new URL('../locales/', import.meta.url))
    const files = readdirSync(dir).filter(f => f.endsWith('.js'))
    expect(files).toHaveLength(25)
    for (const f of files) {
      const text = readFileSync(dir + f, 'utf8')
      const line = text.split('\n').find(l => l.startsWith(`  ${JSON.stringify(note)}: `))
      expect(line, f).toMatch(/Face ID|面容 ID/)
      expect(text, f).not.toContain('"Needs iOS 17 or later. The buttons work without unlocking')
      expect(text, f).not.toContain('a tap to rate the effort, without unlocking."')
    }
  })
  it('the buttons themselves ask for no authentication and never open the app', () => {
    expect(activity).not.toMatch(/authenticationPolicy|openAppWhenRun/)
  })
})
