import SwiftUI
import WidgetKit

/*
 * openGym's complications and Smart Stack widget on the Apple Watch: the rest counting down while
 * resting, otherwise the set up next, or today's workout to start. Read from what the watch app
 * wrote (WidgetState, App Group). Text and SF Symbols only.
 *
 * The Smart Stack: high relevance only while the watch app runs a session (a rest, a set). Without
 * one this widget is quiet, so the iPhone's Live Activity for a workout running on the phone has
 * the stack instead of two cards saying the same thing.
 */
struct Entry: TimelineEntry {
    let date: Date
    let state: WidgetState

    var relevance: TimelineEntryRelevance? {
        switch state.mode {
        case "rest": return TimelineEntryRelevance(score: 100)
        case "set": return TimelineEntryRelevance(score: 60)
        case "today": return TimelineEntryRelevance(score: 30)
        default: return TimelineEntryRelevance(score: 0)
        }
    }
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> Entry {
        Entry(date: Date(), state: WidgetState(mode: "set", title: "Bench Press", detail: "60 kg × 8", restEndsAt: nil))
    }

    func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) {
        completion(context.isPreview ? placeholder(in: context) : Entry(date: Date(), state: WidgetState.read()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
        let state = WidgetState.read()
        var entries = [Entry(date: Date(), state: state)]
        // When the rest is over the widget says so by itself; the app writes the next state then.
        if state.mode == "rest", let end = state.restEndsAt, end > Date() {
            var after = state
            after.mode = "set"
            after.restEndsAt = nil
            entries.append(Entry(date: end, state: after))
        }
        // Not touched by the watch app for 45 minutes: quiet (WidgetState.read says why).
        if state.mode == "set" || state.mode == "rest" {
            let quiet = max(Date(), state.updatedAt.addingTimeInterval(45 * 60))
            entries.append(Entry(date: quiet, state: .idle))
        }
        completion(Timeline(entries: entries, policy: .never))
    }
}

/// Work sets done of all today, as a ring (circular and corner complications).
struct ProgressRing: View {
    let done: Int
    let total: Int

    var body: some View {
        Gauge(value: Double(done), in: 0...Double(max(total, 1))) {
            Image(systemName: "dumbbell.fill")
        } currentValueLabel: {
            Text(verbatim: "\(done)")
        }
        .gaugeStyle(.accessoryCircularCapacity)
    }
}

struct WidgetView: View {
    @Environment(\.widgetFamily) var family
    let entry: Entry

    var body: some View {
        let s = entry.state
        let resting = s.mode == "rest" && (s.restEndsAt.map { $0 > entry.date } ?? false)
        switch family {
        case .accessoryCircular:
            if resting, let end = s.restEndsAt {
                ProgressView(timerInterval: entry.date...end, countsDown: true) {
                    Image(systemName: "timer")
                } currentValueLabel: {
                    Text(timerInterval: entry.date...end, countsDown: true).monospacedDigit()
                }
                .progressViewStyle(.circular)
            } else if s.mode == "today" {
                ZStack {
                    AccessoryWidgetBackground()
                    Image(systemName: "play.fill").font(.title3)
                }
            } else if s.total > 0 {
                ProgressRing(done: s.done, total: s.total)
            } else {
                ZStack {
                    AccessoryWidgetBackground()
                    OpenGymLogo().padding(10)
                }
            }
        case .accessoryInline:
            if resting, let end = s.restEndsAt {
                Text(timerInterval: entry.date...end, countsDown: true)
            } else if s.mode == "today" {
                Text("Start workout")
            } else {
                Text(verbatim: s.detail.isEmpty ? s.title : "\(s.setLabel) · \(s.detail)")
            }
        case .accessoryCorner:
            Group {
                if s.total > 0 && s.mode != "today" {
                    Text(verbatim: "\(s.done)")
                        .font(.title3.monospacedDigit())
                } else {
                    Image(systemName: s.mode == "today" ? "play.fill" : "dumbbell.fill").font(.title3)
                }
            }
            .widgetLabel {
                if resting, let end = s.restEndsAt {
                    Text(timerInterval: entry.date...end, countsDown: true)
                } else if s.total > 0 && s.mode != "today" {
                    Gauge(value: Double(s.done), in: 0...Double(max(s.total, 1))) { Text(verbatim: "") }
                } else {
                    Text(verbatim: s.title)
                }
            }
        default:
            VStack(alignment: .leading, spacing: 2) {
                if resting, let end = s.restEndsAt {
                    Label("Rest", systemImage: "timer").font(.caption2).foregroundStyle(.secondary)
                    Text(timerInterval: entry.date...end, countsDown: true)
                        .font(.system(.title2, design: .rounded).weight(.semibold).monospacedDigit())
                    Text(verbatim: s.title).font(.caption2).lineLimit(1)
                } else if s.mode == "today" {
                    Label("Start workout", systemImage: "play.fill").font(.caption2).foregroundStyle(.secondary)
                    Text(verbatim: s.title).font(.system(.headline, design: .rounded)).lineLimit(2)
                } else if s.mode == "set" {
                    Text(verbatim: s.title).font(.system(.headline, design: .rounded)).lineLimit(1)
                    if !s.detail.isEmpty {
                        Text(verbatim: s.setLabel.isEmpty ? s.detail : "\(s.setLabel) · \(s.detail)")
                            .font(.system(.body, design: .rounded).monospacedDigit()).lineLimit(1)
                    }
                    if s.total > 0 {
                        Gauge(value: Double(s.done), in: 0...Double(s.total)) { Text(verbatim: "") }
                            .gaugeStyle(.accessoryLinearCapacity)
                    }
                } else {
                    HStack(spacing: 6) {
                        OpenGymLogo().frame(width: 26, height: 16)
                        Text(verbatim: "openGym").font(.headline)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

@main
struct OpenGymWidgets: WidgetBundle {
    var body: some Widget {
        OpenGymWidget()
        OpenGymLauncher()
    }
}

struct OpenGymWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "OpenGymWorkout", provider: Provider()) { entry in
            WidgetView(entry: entry)
                .environment(\.locale, entry.state.locale)
                .containerBackground(.black, for: .widget)
                // A tap on "Start" opens the watch app and starts today's workout.
                .widgetURL(entry.state.mode == "today" ? URL(string: "opengym-watch://start") : URL(string: "opengym-watch://open"))
        }
        .configurationDisplayName("openGym")
        .description("Your rest, your next set, or today's workout.")
        .supportedFamilies([.accessoryRectangular, .accessoryCircular, .accessoryInline, .accessoryCorner])
    }
}

/*
 * The plain one: openGym's logo on the watch face, a tap opens the app. For a face that should
 * always have the way in, whatever is going on (the other widget changes with the workout).
 */
struct LauncherProvider: TimelineProvider {
    func placeholder(in context: Context) -> Entry { Entry(date: Date(), state: .idle) }
    func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) { completion(Entry(date: Date(), state: WidgetState.read())) }
    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
        completion(Timeline(entries: [Entry(date: Date(), state: WidgetState.read())], policy: .never))
    }
}

struct LauncherView: View {
    @Environment(\.widgetFamily) var family
    let entry: Entry

    var body: some View {
        switch family {
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                OpenGymLogo().padding(9)
            }
        case .accessoryCorner:
            OpenGymLogo()
                .padding(4)
                .widgetLabel { Text(verbatim: "openGym") }
        case .accessoryInline:
            Text(verbatim: "openGym")
        default:
            HStack(spacing: 8) {
                OpenGymLogo().frame(width: 30, height: 20)
                VStack(alignment: .leading, spacing: 0) {
                    Text(verbatim: "openGym").font(.headline)
                    if entry.state.mode == "today" {
                        Text(verbatim: entry.state.title).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

struct OpenGymLauncher: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "OpenGymLauncher", provider: LauncherProvider()) { entry in
            LauncherView(entry: entry)
                .environment(\.locale, entry.state.locale)
                .containerBackground(.black, for: .widget)
                .widgetURL(URL(string: "opengym-watch://open"))
        }
        .configurationDisplayName("openGym")
        .description("Opens openGym.")
        .supportedFamilies([.accessoryCircular, .accessoryCorner, .accessoryInline, .accessoryRectangular])
    }
}

