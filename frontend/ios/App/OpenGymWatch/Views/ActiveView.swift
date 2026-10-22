import SwiftUI

struct ActiveView: View {
    @EnvironmentObject private var store: SessionStore
    let name: String
    let since: Date

    var body: some View {
        if store.restRunning {
            RestView()
        } else {
            VStack(spacing: 4) {
                HeartRateLabel(bpm: store.bpm)
                Text(since, style: .timer)
                    .font(.title3.monospacedDigit())
                Text(name)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
            }
        }
    }
}

struct HeartRateLabel: View {
    let bpm: Int?

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            Image(systemName: "heart.fill")
                .foregroundStyle(.red)
                .font(.title3)
            Text(bpm.map(String.init) ?? "--")
                .font(.system(size: 44, weight: .semibold, design: .rounded).monospacedDigit())
            Text("BPM")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
    }
}
