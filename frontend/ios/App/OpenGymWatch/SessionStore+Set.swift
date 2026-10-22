import Foundation
import WatchKit

/// A set marked done on the wrist, until the phone's next current set settles it.
struct PendingSet: Sendable, Equatable {
    let set: SetState
    let at: Date
}

/// Logging the current set from the wrist. The phone keeps the record: Completed is sent to it and
/// the watch moves on at once, and the phone's next current set (application context) wins.
extension SessionStore {

    // A context still showing the logged set as open is one the phone sent before it took the
    // Completed in (asleep, or the message still on its way): the watch keeps its own view.
    private static let pendingHold: TimeInterval = 60

    /// The set of the running workout only: a context left from an earlier workout shows nothing.
    var setForWorkout: SetState? {
        guard case let .running(id, _, _) = phase, let set = currentSet, set.workoutId == id else { return nil }
        return set
    }

    /// Completed was tapped and the phone has not answered with the set after it yet.
    var waitingForPhone: Bool {
        guard let pending = pendingDone, let set = currentSet else { return false }
        return pending.set.isSameSet(as: set)
    }

    func applySet(_ state: SetState?, at: Date) {
        // Application contexts can arrive out of order across a relaunch; the newest wins.
        guard at > setAppliedAt else { return }
        setAppliedAt = at
        if let pending = pendingDone, let state, state.isSameSet(as: pending.set),
           Date().timeIntervalSince(pending.at) < Self.pendingHold {
            return
        }
        pendingDone = nil
        currentSet = state
    }

    func markDone(w: Double, r: Int) {
        guard let set = setForWorkout, !waitingForPhone else { return }
        let now = Date()
        link.sendSetDone(set, weight: w, reps: r, at: now)
        WKInterfaceDevice.current().play(.success)
        pendingDone = PendingSet(set: set, at: now)
        // The next set of the same exercise, as logged; past its last one the phone says what is next.
        if let next = set.advanced(weight: w, reps: r) { currentSet = next }
    }

    func clearSet() {
        currentSet = nil
        pendingDone = nil
    }
}

extension SetState {
    /// The row after this one with the same load and reps, while the exercise has one.
    func advanced(weight: Double, reps: Int) -> SetState? {
        guard setNo < setCount else { return nil }
        return SetState(
            workoutId: workoutId, entryId: entryId, name: name, idx: idx, i: i + 1,
            setNo: setNo + 1, setCount: setCount, warmup: warmup, mode: mode,
            weight: weight, reps: reps, unit: unit, each: each, step: step, nextName: nextName
        )
    }
}
