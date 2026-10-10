import SwiftUI
import WatchKit

struct ContentView: View {
    @EnvironmentObject var link: PhoneLink

    var body: some View {
        if let snap = link.snapshot, snap.active {
            if let rest = snap.rest {
                RestView(snap: snap, rest: rest)
            } else if let row = snap.current {
                if row.loggable {
                    SetView(snap: snap, row: row)
                } else {
                    Message(title: row.exercise, text: snap.text("onPhone", "Log this set on your iPhone"))
                }
            } else {
                Message(title: snap.workout ?? "", text: snap.text("complete", "Workout complete!"))
            }
        } else {
            Message(title: "openGym", text: link.snapshot?.text("noWorkout", "Start a workout on your iPhone") ?? "Start a workout on your iPhone")
        }
    }
}

private struct Message: View {
    let title: String
    let text: String

    var body: some View {
        VStack(spacing: 8) {
            Text(title).font(.headline).multilineTextAlignment(.center)
            Text(text).font(.footnote).foregroundColor(.secondary).multilineTextAlignment(.center)
        }
        .padding()
    }
}

// The set to do next: reps on the Digital Crown, the weight with − and +, and Done.
struct SetView: View {
    @EnvironmentObject var link: PhoneLink
    let snap: Snapshot
    let row: Snapshot.SetInfo

    @State private var crown: Double = 0
    @State private var weight: Double = 0

    private var reps: Int { max(0, Int(crown.rounded())) }
    private var step: Double { snap.unit == "lb" ? 5 : 2.5 }

    var body: some View {
        ScrollView {
            VStack(spacing: 6) {
                Text(row.exercise).font(.headline).lineLimit(2).multilineTextAlignment(.center)
                Text(row.warmup ? "\(row.label ?? "") · \(snap.text("warmup", "Warm-up"))" : (row.label ?? ""))
                    .font(.footnote).foregroundColor(.secondary)
                VStack(spacing: 0) {
                    Text("\(reps)").font(.system(size: 40, weight: .semibold, design: .rounded))
                    Text(snap.text("reps", "Reps")).font(.footnote).foregroundColor(.secondary)
                }
                .focusable(true)
                .digitalCrownRotation($crown, from: 0, through: 200, by: 1, sensitivity: .low, isContinuous: false, isHapticFeedbackEnabled: true)
                HStack {
                    Button("−") { weight = max(0, weight - step) }.frame(width: 40)
                    VStack(spacing: 0) {
                        Text(format(weight)).font(.title3)
                        Text(snap.text("weight", "Weight")).font(.footnote).foregroundColor(.secondary)
                    }
                    .frame(maxWidth: .infinity)
                    Button("+") { weight += step }.frame(width: 40)
                }
                Button(snap.text("done", "Done")) {
                    link.send(["type": "done", "entryIdx": row.entryIdx, "setIdx": row.setIdx, "reps": reps, "weight": weight])
                    WKInterfaceDevice.current().play(.click)
                }
                .tint(.green)
                .disabled(link.waiting)
                if link.waiting {
                    Text(snap.text("waiting", "Waiting for iPhone")).font(.footnote).foregroundColor(.secondary)
                }
            }
        }
        .onAppear(perform: reset)
        .onChange(of: row) { _ in reset() }
    }

    private func reset() {
        crown = Double(row.reps)
        weight = row.weight
    }

    private func format(_ w: Double) -> String {
        w.rounded() == w ? String(Int(w)) : String(format: "%.2f", w).replacingOccurrences(of: #"0+$"#, with: "", options: .regularExpression)
    }
}

// The rest: counting down to its end on its own, with +15 s, pause and skip sent to the phone.
// The wrist is tapped at the end while this screen is up; with the phone locked, the phone's own
// end-of-rest notification reaches the watch as well.
struct RestView: View {
    @EnvironmentObject var link: PhoneLink
    let snap: Snapshot
    let rest: Snapshot.Rest

    @State private var buzz: DispatchWorkItem?

    var body: some View {
        VStack(spacing: 8) {
            Text(rest.switching == true ? snap.text("switching", "Switch sides") : snap.text("rest", "Rest"))
                .font(.headline)
            if rest.ready == true {
                Text(snap.text("ready", "Rest’s over. Next set!")).multilineTextAlignment(.center)
            } else if rest.paused == true {
                Text(clock(rest.left ?? 0)).font(.system(size: 40, weight: .semibold, design: .rounded))
                Text(snap.text("paused", "Paused")).font(.footnote).foregroundColor(.secondary)
            } else if let end = rest.endDate, end > Date() {
                Text(timerInterval: Date()...end, countsDown: true)
                    .font(.system(size: 40, weight: .semibold, design: .rounded))
                    .monospacedDigit()
            }
            HStack {
                if rest.ready != true {
                    Button("+15") { link.send(["type": "addRest", "sec": 15]) }
                    if rest.paused == true {
                        Button(snap.text("resume", "Resume")) { link.send(["type": "resumeRest"]) }
                    } else {
                        Button(snap.text("pause", "Pause")) { link.send(["type": "pauseRest"]) }
                    }
                }
                Button(snap.text("skip", "Skip")) { link.send(["type": "skipRest"]) }
            }
            .font(.footnote)
        }
        .onAppear(perform: schedule)
        .onChange(of: rest) { _ in schedule() }
        .onDisappear { buzz?.cancel() }
    }

    private func schedule() {
        buzz?.cancel()
        guard rest.isRunning, let end = rest.endDate, end > Date() else { return }
        let item = DispatchWorkItem { WKInterfaceDevice.current().play(.notification) }
        buzz = item
        DispatchQueue.main.asyncAfter(deadline: .now() + end.timeIntervalSinceNow, execute: item)
    }

    private func clock(_ sec: Double) -> String {
        let s = max(0, Int(sec))
        return String(format: "%d:%02d", s / 60, s % 60)
    }
}
