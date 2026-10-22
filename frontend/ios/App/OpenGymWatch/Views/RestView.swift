import SwiftUI

/// The rest countdown with its ring, and the two buttons that change the phone's timer.
struct RestView: View {
    @EnvironmentObject private var store: SessionStore

    var body: some View {
        VStack(spacing: 6) {
            TimelineView(.periodic(from: .now, by: 1)) { context in
                RestRing(left: left(at: context.date), total: store.restTotal, paused: store.restPaused)
            }
            HStack(spacing: 8) {
                Button("+15 s") { store.addFifteen() }
                Button("Skip") { store.skipRest() }
            }
            .font(.footnote)
        }
    }

    private func left(at now: Date) -> Int {
        if store.restPaused { return store.restLeftWhenPaused }
        guard let ends = store.restEndsAt else { return 0 }
        return max(0, Int(ends.timeIntervalSince(now).rounded(.up)))
    }
}

private struct RestRing: View {
    let left: Int
    let total: Int
    let paused: Bool

    var body: some View {
        ZStack {
            Circle()
                .stroke(.quaternary, lineWidth: 6)
            Circle()
                .trim(from: 0, to: total > 0 ? CGFloat(left) / CGFloat(total) : 0)
                .stroke(.tint, style: StrokeStyle(lineWidth: 6, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .animation(.linear(duration: 1), value: left)
            VStack(spacing: 0) {
                Text(Self.format(left))
                    .font(.system(size: 34, weight: .semibold, design: .rounded).monospacedDigit())
                Text(paused ? "Paused" : "Rest")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(width: 110, height: 110)
    }

    private static func format(_ seconds: Int) -> String {
        String(format: "%d:%02d", seconds / 60, seconds % 60)
    }
}
