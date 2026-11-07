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
            LiveLockView(attributes: context.attributes, state: context.state, isStale: context.isStale)
                .activitySystemActionForegroundColor(Color(hex: context.attributes.accent) ?? .green)
        } dynamicIsland: { context in
            let accent = Color(hex: context.attributes.accent) ?? .green
            // The island is always black, whatever the phone's mode: its marks and grey text stay the dark ones.
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 5) {
                            LiveGlyph(attributes: context.attributes, state: context.state).font(.subheadline)
                            Text(context.state.cur?.exName ?? context.attributes.noSetText(context.state))
                                .font(.headline).lineLimit(1).minimumScaleFactor(0.75)
                        }
                        if let c = context.state.cur {
                            Text(c.setLine).font(.caption).secondaryText().lineLimit(1)
                        }
                    }
                    .padding(.leading, 4)
                    .environment(\.colorScheme, .dark)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Group {
                    if context.state.holding || context.state.restRange != nil || context.state.restLeft != nil {
                        LiveRest(attributes: context.attributes, state: context.state, font: .title3)
                            .frame(maxWidth: 80, alignment: .trailing)
                            .padding(.trailing, 4)
                    } else if let c = context.state.cur {
                        Text(c.target).font(.subheadline.weight(.semibold)).lineLimit(1).padding(.trailing, 4)
                    }
                    }
                    .environment(\.colorScheme, .dark)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack(spacing: 10) {
                        ProgressBar(value: Double(context.state.done) / Double(max(1, context.state.total)), accent: accent)
                        LiveCount(state: context.state).font(.caption.weight(.semibold))
                        LiveSecondaryButton(attributes: context.attributes, state: context.state)
                        if let c = context.state.cur { LiveDoneButton(attributes: context.attributes, cur: c) }
                    }
                    .environment(\.colorScheme, .dark)
                }
            } compactLeading: {
                LiveGlyph(attributes: context.attributes, state: context.state).environment(\.colorScheme, .dark)
            } compactTrailing: {
                LiveCompactTrailing(attributes: context.attributes, state: context.state).environment(\.colorScheme, .dark)
            } minimal: {
                LiveMinimal(attributes: context.attributes, state: context.state).environment(\.colorScheme, .dark)
            }
            .keylineTint(accent)
        }
    }
}
