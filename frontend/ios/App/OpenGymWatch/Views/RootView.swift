import SwiftUI

struct RootView: View {
    @EnvironmentObject private var store: SessionStore

    var body: some View {
        switch store.phase {
        case .idle, .failed:
            IdleView()
        case .starting, .ending:
            ProgressView()
        case let .running(_, name, since):
            ActiveView(name: name, since: since)
        case let .ended(average):
            EndedView(averageBpm: average)
        }
    }
}
