import ActivityKit
import SwiftUI
import WidgetKit

/*
 * The running workout on the Lock Screen and in the Dynamic Island (and, through the compact
 * views, in an Apple Watch's Smart Stack). The app starts and updates it (LiveActivityPlugin.swift);
 * its buttons are WorkoutActivity.swift's intents. The views are App/WidgetViews.swift's.
 *
 * With the live widget builder's layout in the state (`lay`, LIVE_VERSION 3) each surface draws
 * the tiles and buttons picked for it; without one (an activity a build before that started, or a
 * state trimmed to fit 4 KB) the classic card.
 */
struct WorkoutLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: WorkoutActivityAttributes.self) { context in
            Group {
                if let lock = context.state.lay?.lock {
                    LiveLayoutLockView(attributes: context.attributes, state: context.state, surface: lock)
                } else {
                    LiveLockView(attributes: context.attributes, state: context.state)
                }
            }
            .activitySystemActionForegroundColor(Color(hex: context.attributes.accent) ?? .green)
        } dynamicIsland: { context in
            let accent = Color(hex: context.attributes.accent) ?? .green
            if let island = context.state.lay?.island {
                return customIsland(context: context, island: island, compact: context.state.lay?.compact?.t ?? [], accent: accent)
            }
            return classicIsland(context: context, accent: accent)
        }
    }

    private func customIsland(context: ActivityViewContext<WorkoutActivityAttributes>, island: WorkoutActivityAttributes.Surface,
                              compact: [WorkoutActivityAttributes.Tile], accent: Color) -> DynamicIsland {
        let tiles = Array((island.t ?? []).prefix(4))
        let rest = Array(tiles.dropFirst(2))
        let a = context.attributes
        let st = context.state
        return DynamicIsland {
            DynamicIslandExpandedRegion(.leading) {
                if let t0 = tiles.first { LiveTileView(attributes: a, state: st, tile: t0).padding(.leading, 4) }
            }
            DynamicIslandExpandedRegion(.trailing) {
                if tiles.count > 1 { LiveTileView(attributes: a, state: st, tile: tiles[1]).padding(.trailing, 4) }
            }
            DynamicIslandExpandedRegion(.bottom) {
                VStack(alignment: .leading, spacing: 6) {
                    if !rest.isEmpty {
                        LiveSpanRow(spans: rest.map { _ in 2 }) {
                            ForEach(rest, id: \.self) { tile in LiveTileView(attributes: a, state: st, tile: tile) }
                        }
                    }
                    HStack {
                        Spacer(minLength: 0)
                        LiveButtonsView(attributes: a, state: st, acts: Array((island.a ?? []).prefix(3)))
                    }
                }
            }
        } compactLeading: {
            LiveCompactTileView(attributes: a, state: st, tile: compact.first)
        } compactTrailing: {
            LiveCompactTileView(attributes: a, state: st, tile: compact.count > 1 ? compact[1] : nil)
        } minimal: {
            LiveMinimal(attributes: a, state: st)
        }
        .keylineTint(accent)
    }

    private func classicIsland(context: ActivityViewContext<WorkoutActivityAttributes>, accent: Color) -> DynamicIsland {
        DynamicIsland {
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
                if context.state.holding || context.state.restRange != nil || context.state.restLeft != nil {
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
