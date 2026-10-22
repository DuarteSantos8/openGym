import SwiftUI

struct IdleView: View {
    @EnvironmentObject private var store: SessionStore

    var body: some View {
        ScrollView {
            VStack(spacing: 10) {
                Image(systemName: "dumbbell.fill")
                    .font(.title2)
                    .foregroundStyle(.tint)
                Text("Start a workout on your iPhone")
                    .font(.headline)
                    .multilineTextAlignment(.center)
                if case let .failed(message) = store.phase {
                    Text(message)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
                if store.needsHealthAccess {
                    HealthAccessNote()
                }
            }
            .frame(maxWidth: .infinity)
        }
    }
}

private struct HealthAccessNote: View {
    @EnvironmentObject private var store: SessionStore

    var body: some View {
        VStack(spacing: 6) {
            Text("openGym needs Health access to record heart rate.")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button("Allow") {
                Task { await store.requestHealthAccess() }
            }
        }
        .padding(.top, 4)
    }
}
