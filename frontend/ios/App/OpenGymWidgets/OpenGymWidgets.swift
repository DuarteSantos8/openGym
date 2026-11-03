import SwiftUI
import UIKit
import WidgetKit

/*
 * openGym's widgets (the widget extension, ios/ci/add-widgets.rb): today's workout on the Home
 * Screen in three sizes and on the Lock Screen, the streak on the Lock Screen, and the running
 * workout's Live Activity (LiveActivityWidget.swift). What they show is the snapshot the app writes
 * to the App Group (WidgetBridgePlugin.swift, lib/widgets.js); the views are in
 * App/WidgetViews.swift, which the app compiles too for its CI pictures.
 */
@main
struct OpenGymWidgets: WidgetBundle {
    var body: some Widget {
        TodayWidget()
        StreakWidget()
        WorkoutLiveActivity()
    }
}

struct SnapshotEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot?
}

/// The snapshot as it is, with an entry for each coming midnight: the snapshot carries the next
/// week's plan, so the widget turns the page by itself while the app stays closed.
struct SnapshotProvider: TimelineProvider {
    func placeholder(in context: Context) -> SnapshotEntry {
        SnapshotEntry(date: Date(), snapshot: WidgetSnapshot.load())
    }

    func getSnapshot(in context: Context, completion: @escaping (SnapshotEntry) -> Void) {
        completion(SnapshotEntry(date: Date(), snapshot: WidgetSnapshot.load()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<SnapshotEntry>) -> Void) {
        let snap = WidgetSnapshot.load()
        var entries = [SnapshotEntry(date: Date(), snapshot: snap)]
        let cal = Calendar.current
        var day = cal.startOfDay(for: Date())
        for _ in 0..<7 {
            guard let next = cal.date(byAdding: .day, value: 1, to: day) else { break }
            day = next
            entries.append(SnapshotEntry(date: day, snapshot: snap))
        }
        completion(Timeline(entries: entries, policy: .atEnd))
    }
}

struct TodayWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: SnapshotEntry

    var body: some View {
        let model = WidgetModel(snap: entry.snapshot, date: entry.date)
        Group {
            switch family {
            case .systemMedium: MediumWidgetView(model: model)
            case .systemLarge: LargeWidgetView(model: model)
            case .accessoryRectangular: NextRectView(model: model)
            case .accessoryInline: NextInlineView(model: model)
            default: SmallWidgetView(model: model)
            }
        }
        .containerBackground(for: .widget) {
            if family == .accessoryRectangular || family == .accessoryInline {
                Color.clear
            } else {
                Color(UIColor.systemBackground)
            }
        }
    }
}

struct TodayWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "OpenGymToday", provider: SnapshotProvider()) { entry in
            TodayWidgetView(entry: entry)
        }
        .configurationDisplayName("Today’s workout")
        .description("Your plan for today, the week ahead and your streak.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryRectangular, .accessoryInline])
    }
}

struct StreakWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "OpenGymStreak", provider: SnapshotProvider()) { entry in
            StreakCircleView(model: WidgetModel(snap: entry.snapshot, date: entry.date))
                .containerBackground(for: .widget) { Color.clear }
        }
        .configurationDisplayName("Streak")
        .description("Weeks in a row with a workout.")
        .supportedFamilies([.accessoryCircular])
    }
}
