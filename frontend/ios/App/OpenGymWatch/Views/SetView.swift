import SwiftUI

/// The set to log: what it is, its load and reps on two dials, and Completed.
struct SetView: View {
    @EnvironmentObject private var store: SessionStore
    // Here, not in SetLogger: Completed moves on to the next set, a new logger, and the
    // checkmark still shows for its second.
    @State private var logged = false

    var body: some View {
        if let set = store.setForWorkout {
            if set.mode != "reps" {
                Message(title: set.name, detail: "Log this one on your iPhone")
            } else {
                SetLogger(item: set, logged: $logged).id("\(set.entryId)-\(set.idx)-\(set.i)")
            }
        } else {
            Message(title: "All sets done", detail: "Finish the workout on your iPhone")
        }
    }
}

private struct SetLogger: View {
    @EnvironmentObject private var store: SessionStore
    let item: SetState
    private let weights: [Double]
    private let reps: [Double]
    @State private var weightIndex: Int
    @State private var repsIndex: Int
    @Binding var logged: Bool

    init(item: SetState, logged: Binding<Bool>) {
        self.item = item
        _logged = logged
        let weights = DialView.grid(low: 0, high: 400, step: item.step, including: item.weight)
        let reps = DialView.grid(low: 1, high: 60, step: 1, including: Double(min(max(item.reps, 1), 60)))
        self.weights = weights
        self.reps = reps
        _weightIndex = State(initialValue: DialView.nearest(item.weight, in: weights))
        _repsIndex = State(initialValue: DialView.nearest(Double(item.reps), in: reps))
    }

    var body: some View {
        VStack(spacing: 4) {
            header
            HStack(spacing: 6) {
                DialView(title: weightTitle, values: weights, decimals: decimals, index: $weightIndex)
                DialView(title: "REPS", values: reps, decimals: 0, index: $repsIndex)
            }
            .frame(maxHeight: .infinity)
            completed
        }
        // The clock's corner is free space for the name; the dials want every point below it.
        .ignoresSafeArea(edges: .bottom)
    }

    private var header: some View {
        VStack(spacing: 0) {
            Text(item.name)
                .font(.caption.weight(.semibold))
                // One line on the small watches, where a second runs into the clock.
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .multilineTextAlignment(.center)
            Text(item.warmup ? "Warm-up" : "Set \(item.setNo) of \(item.setCount)")
                .font(.caption2)
                .foregroundStyle(.secondary)
            if item.isLast, let next = item.nextName {
                Text("Next: \(next)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
    }

    private var completed: some View {
        Button(action: complete) {
            Label(buttonTitle, systemImage: logged || store.waitingForPhone ? "checkmark" : "checkmark.circle")
                .font(.headline)
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent)
        .tint(.green)
        .controlSize(.large)
        .disabled(logged || store.waitingForPhone)
    }

    private var buttonTitle: String {
        if logged { return "Logged" }
        return store.waitingForPhone ? "Sent to iPhone" : "Completed"
    }

    private var weightTitle: String {
        item.unit.uppercased() + (item.each ? " each" : "")
    }

    private var decimals: Int {
        let whole = { (v: Double) in v.rounded() == v }
        if !whole(item.step * 10) { return 2 }
        return whole(item.step) && whole(item.weight) ? 0 : 1
    }

    private func complete() {
        logged = true
        store.markDone(w: weights[weightIndex], r: Int(reps[repsIndex]))
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(1))
            logged = false
        }
    }
}

private struct Message: View {
    let title: String
    let detail: String

    var body: some View {
        VStack(spacing: 6) {
            Text(title)
                .font(.headline)
                .multilineTextAlignment(.center)
                .lineLimit(2)
            Text(detail)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal, 4)
    }
}
