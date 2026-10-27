import ActivityKit
import SwiftUI
import WidgetKit

/*
 * The running workout on the Lock Screen and in the Dynamic Island (and, through the compact
 * views, in an Apple Watch's Smart Stack). The app starts and updates it (LiveActivityPlugin.swift);
 * its buttons are WorkoutActivity.swift's DoneSetIntent, NextExerciseIntent and SkipRestIntent.
 * The views are App/WidgetViews.swift's.
 */
struct WorkoutLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: WorkoutActivityAttributes.self) { context in
            LiveLockView(attributes: context.attributes, state: context.state)
                .activitySystemActionForegroundColor(Color(hex: context.attributes.accent) ?? .green)
        } dynamicIsland: { context in
            let accent = Color(hex: context.attributes.accent) ?? .green
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(context.state.cur?.exName ?? context.attributes.noSetText(context.state))
                            .font(.headline).lineLimit(1).minimumScaleFactor(0.75)
                        if let c = context.state.cur {
                            Text(c.setLine).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        }
                    }
                    .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    if context.state.restRange != nil || context.state.restLeft != nil {
                        LiveRest(attributes: context.attributes, state: context.state, font: .title3)
                            .frame(maxWidth: 80, alignment: .trailing)
                            .padding(.trailing, 4)
                    } else if let c = context.state.cur {
                        Text(c.target).font(.subheadline.weight(.semibold)).lineLimit(1).padding(.trailing, 4)
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack(spacing: 10) {
                        ProgressBar(value: Double(context.state.done) / Double(max(1, context.state.total)), accent: accent)
                        Text("\(context.state.done)/\(context.state.total)").font(.caption.weight(.semibold)).monospacedDigit()
                        LiveSecondaryButton(attributes: context.attributes, state: context.state)
                        if let c = context.state.cur { LiveDoneButton(attributes: context.attributes, cur: c) }
                    }
                }
            } compactLeading: {
                Image(systemName: "dumbbell.fill").foregroundStyle(accent)
            } compactTrailing: {
                LiveCompactTrailing(attributes: context.attributes, state: context.state)
            } minimal: {
                LiveMinimal(attributes: context.attributes, state: context.state)
            }
            .keylineTint(accent)
        }
    }
}
