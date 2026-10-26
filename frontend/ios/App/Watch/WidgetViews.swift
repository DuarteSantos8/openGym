import SwiftUI
import WidgetKit

/*
 * The complications' faces (WidgetState → views), in a file of their own so both the widget
 * extension and the watch app compile them: the watch app shows them in CI's screenshots
 * (-OpenGymWatchScreen complication-…), the extension has the @main. Text and SF Symbols only.
 *
 * Sets logged here that the phone has not got yet (state.unsent) show as a small number with the
 * "no phone" glyph and the phone's own words. Live content (a rest, the set up next) is left as it
 * is: a phone-free workout always has unsent sets, which says nothing the user can act on.
 */

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
    @Environment(\.widgetFamily) private var systemFamily
    let state: WidgetState
    let date: Date
    /// CI's screenshots draw every family in the watch app, where the environment has none to give.
    var demoFamily: WidgetFamily?
    private var family: WidgetFamily { demoFamily ?? systemFamily }

    /// "99+" past two digits, so the number never outgrows its place.
    private var count: String { state.unsent > 99 ? "99+" : "\(state.unsent)" }

    var body: some View {
        let s = state
        let resting = s.mode == "rest" && (s.restEndsAt.map { $0 > date } ?? false)
        let unsentFace = s.unsent > 0 && !(resting || s.mode == "set")
        switch family {
        case .accessoryCircular:
            if resting, let end = s.restEndsAt {
                ProgressView(timerInterval: date...end, countsDown: true) {
                    Image(systemName: "timer")
                } currentValueLabel: {
                    Text(timerInterval: date...end, countsDown: true).monospacedDigit()
                }
                .progressViewStyle(.circular)
            } else if unsentFace {
                ZStack {
                    AccessoryWidgetBackground()
                    VStack(spacing: 0) {
                        Image(systemName: "iphone.slash").font(.caption2).accessibilityHidden(true)
                        Text(verbatim: count)
                            .font(.system(.title3, design: .rounded).weight(.semibold).monospacedDigit())
                            .lineLimit(1)
                            .minimumScaleFactor(0.6)
                    }
                }
                .unsentSpoken(s.unsent)
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
                Text(timerInterval: date...end, countsDown: true)
            } else if unsentFace {
                // The number first: it is what survives a truncated line.
                Label { Text(verbatim: "\(count) ") + Text("Waiting to sync") } icon: { Image(systemName: "iphone.slash") }
                    .lineLimit(1)
                    .unsentSpoken(s.unsent)
            } else if s.mode == "today" {
                Text("Start workout")
            } else {
                Text(verbatim: s.detail.isEmpty ? s.title : "\(s.setLabel) · \(s.detail)")
            }
        case .accessoryCorner:
            if unsentFace {
                Text(verbatim: count)
                    .font(.title3.monospacedDigit())
                    .widgetLabel { Text("Waiting to sync") }
                    .unsentSpoken(s.unsent)
            } else {
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
                        Text(timerInterval: date...end, countsDown: true)
                    } else if s.total > 0 && s.mode != "today" {
                        Gauge(value: Double(s.done), in: 0...Double(max(s.total, 1))) { Text(verbatim: "") }
                    } else {
                        Text(verbatim: s.title)
                    }
                }
            }
        default:
            // Three lines fill the card at 41 mm: today's title shortens to one line for the unsent row.
            VStack(alignment: .leading, spacing: 2) {
                if resting, let end = s.restEndsAt {
                    Label("Rest", systemImage: "timer").font(.caption2).foregroundStyle(.secondary)
                    Text(timerInterval: date...end, countsDown: true)
                        .font(.system(.title2, design: .rounded).weight(.semibold).monospacedDigit())
                    Text(verbatim: s.title).font(.caption2).lineLimit(1)
                } else if s.mode == "today" {
                    Label("Start workout", systemImage: "play.fill").font(.caption2).foregroundStyle(.secondary)
                    Text(verbatim: s.title).font(.system(.headline, design: .rounded)).lineLimit(unsentFace ? 1 : 2)
                    if unsentFace { unsentRow }
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
                    if unsentFace { unsentRow }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            // The card is sized for three lines: past xLarge the last one would be clipped.
            .dynamicTypeSize(...DynamicTypeSize.xLarge)
        }
    }

    /// Glyph, number and words; a language whose words do not fit at this size keeps glyph and number.
    private var unsentRow: some View {
        ViewThatFits(in: .horizontal) {
            unsentLine(words: true)
            unsentLine(words: false)
        }
        .font(.system(.caption2, design: .rounded))
        .unsentSpoken(state.unsent)
    }

    private func unsentLine(words: Bool) -> some View {
        HStack(spacing: 4) {
            Image(systemName: "iphone.slash").accessibilityHidden(true)
            Text(verbatim: count).fontWeight(.semibold).monospacedDigit()
            if words { Text("Waiting to sync").lineLimit(1) }
        }
    }
}

private extension View {
    /// VoiceOver: "Waiting to sync, 3". The glyph and the number are one thing, not two.
    func unsentSpoken(_ n: Int) -> some View {
        accessibilityElement(children: .ignore)
            .accessibilityLabel(Text("Waiting to sync"))
            .accessibilityValue(Text(verbatim: "\(n)"))
    }
}
