import SwiftUI

/// The running workout: heart rate and time on the first page, the set to log on the second, and
/// the rest on top of both while it runs. A rest that ends or is skipped lands on the set.
struct ActiveView: View {
    private enum Page: Hashable { case pulse, set }

    @EnvironmentObject private var store: SessionStore
    let name: String
    let since: Date
    @State private var page = Page.pulse

    var body: some View {
        Group {
            if store.restRunning {
                RestView()
            } else {
                TabView(selection: $page) {
                    pulse.tag(Page.pulse)
                    SetView().tag(Page.set)
                }
                .tabViewStyle(.verticalPage)
            }
        }
        .onChange(of: store.restRunning) { _, running in
            if !running { page = .set }
        }
    }

    private var pulse: some View {
        VStack(spacing: 4) {
            HeartRateLabel(bpm: store.bpm)
            Text(since, style: .timer)
                .font(.title3.monospacedDigit())
            Text(name)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .lineLimit(2)
                .multilineTextAlignment(.center)
            BuildStamp()
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
