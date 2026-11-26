import ActivityKit
import SwiftUI
import WidgetKit

/*
 * The running workout on the Lock Screen and in the Dynamic Island (and, through the compact
 * views, in an Apple Watch's Smart Stack). The app starts and updates it (LiveActivityPlugin.swift);
 * its buttons are WorkoutActivity.swift's intents. The views are App/WidgetViews.swift's.
 *
 * With the glance in the state (`g`, LIVE_VERSION 4, lib/live-glance.js) each surface draws what
 * the set it shows and the moment call for (a set to do, a hold, a rest, the rest before a new
 * exercise, all done); without it (an activity a build before that started, or a state trimmed to
 * fit 4 KB) the classic card.
 */
struct WorkoutLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: WorkoutActivityAttributes.self) { context in
            Group {
                if context.state.g != nil {
                    GlanceLockView(attributes: context.attributes, state: context.state, isStale: context.isStale)
                } else {
                    LiveLockView(attributes: context.attributes, state: context.state, isStale: context.isStale)
                }
            }
            .activitySystemActionForegroundColor(Color(hex: context.attributes.accent) ?? .openGymGreen)
        } dynamicIsland: { context in
            let accent = Color(hex: context.attributes.accent) ?? .openGymGreen
            if context.state.g != nil {
                return glanceIsland(context: context, accent: accent)
            }
            return classicIsland(context: context, accent: accent)
        }
    }

    // The island is always black, whatever the phone's mode: its marks and grey text stay the dark ones.
    private func glanceIsland(context: ActivityViewContext<WorkoutActivityAttributes>, accent: Color) -> DynamicIsland {
        let a = context.attributes
        let st = context.state
        return DynamicIsland {
            DynamicIslandExpandedRegion(.leading) {
                GlanceIslandLeading(attributes: a, state: st).environment(\.colorScheme, .dark)
            }
            DynamicIslandExpandedRegion(.trailing) {
                GlanceIslandTrailing(attributes: a, state: st).environment(\.colorScheme, .dark)
            }
            DynamicIslandExpandedRegion(.bottom) {
                GlanceIslandBottom(attributes: a, state: st).environment(\.colorScheme, .dark)
            }
        } compactLeading: {
            GlanceCompactLeading(attributes: a, state: st).environment(\.colorScheme, .dark)
        } compactTrailing: {
            GlanceCompactTrailing(attributes: a, state: st).environment(\.colorScheme, .dark)
        } minimal: {
            LiveMinimal(attributes: a, state: st).environment(\.colorScheme, .dark)
        }
        .keylineTint(accent)
    }

    private func classicIsland(context: ActivityViewContext<WorkoutActivityAttributes>, accent: Color) -> DynamicIsland {
        DynamicIsland {
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
                    LiveCount(attributes: context.attributes, state: context.state).font(.caption.weight(.semibold))
                    LiveSecondaryButton(attributes: context.attributes, state: context.state)
                    if let c = context.state.cur { LiveDoneButton(attributes: context.attributes, cur: c) }
                }
                .environment(\.colorScheme, .dark)
            }
        } compactLeading: {
            OpenGymMark()
        } compactTrailing: {
            LiveCompactTrailing(attributes: context.attributes, state: context.state).environment(\.colorScheme, .dark)
        } minimal: {
            LiveMinimal(attributes: context.attributes, state: context.state).environment(\.colorScheme, .dark)
        }
        .keylineTint(accent)
    }
}
