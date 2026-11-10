import Foundation

/// A menu disc: on, off, locked (shown but not changeable) or not shown.
enum Disc: Equatable { case on, off, locked, hidden }

/// What the set menu offers for one set, mirroring the phone's menu (Workout.jsx, canBeWarmup,
/// applyWarmToggle).
struct MenuOffer: Equatable {
    var warmup: Disc
    var failure: Disc
    var drop: Disc
    /// The first drop's weight, for the "Drop 50" label.
    var dropWeight: Double?
    var canAdd: Bool
    var canRemove: Bool
}

enum SetMenu {
    static func offer(_ e: Entry, set si: Int) -> MenuOffer {
        guard e.sets.indices.contains(si) else {
            return MenuOffer(warmup: .hidden, failure: .hidden, drop: .hidden, dropWeight: nil, canAdd: false, canRemove: false)
        }
        let s = e.sets[si]
        let reps = e.mode == "reps"
        let isDrop = s.drop != nil
        let rp = s.rp == true

        var warmup = Disc.hidden
        if reps {
            if s.done { warmup = .locked }
            else if s.warmup { warmup = .on }
            else {
                // a straight set, and one work set must stay
                let otherWork = e.sets.indices.contains { $0 != si && !e.sets[$0].warmup }
                warmup = (isDrop || rp || !otherWork) ? .locked : .off
            }
        }

        var failure = Disc.hidden
        if !e.isCardio { failure = s.warmup ? .locked : (s.failure == true ? .on : .off) }

        var drop = Disc.hidden
        if reps && !rp {
            // with 2+ drops the phone has to edit them
            drop = s.warmup ? .locked : (!isDrop ? .off : ((s.drops ?? 1) > 1 ? .locked : .on))
        }

        return MenuOffer(warmup: warmup, failure: failure, drop: drop, dropWeight: s.drop,
                         canAdd: !e.isCardio, canRemove: e.sets.count > 1)
    }

    /// The phone says it understands the set events.
    static func available(_ s: SessionState) -> Bool { s.settings.setMenu == true }
}
