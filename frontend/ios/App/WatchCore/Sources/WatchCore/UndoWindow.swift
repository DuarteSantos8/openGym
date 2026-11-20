import Foundation

/// A removal waits `seconds` for Undo before it is sent (SetMenu.release). One at a time: a second
/// removal sends the first. Meanwhile it is a held edit in the state, replayed over snapshots.
struct UndoWindow: Equatable {
    static let seconds: TimeInterval = 4
    /// The held edit's id.
    private(set) var id: String?
    private(set) var started = Date.distantPast

    mutating func begin(_ id: String, at t: Date) { self.id = id; started = t }
    /// Undo pressed: nothing will be sent.
    mutating func undo() { id = nil }
    /// The edit once its time is up, once.
    mutating func due(at t: Date) -> String? {
        t.timeIntervalSince(started) >= UndoWindow.seconds ? flush() : nil
    }
    /// The edit now (the app left the screen), once.
    mutating func flush() -> String? { defer { id = nil }; return id }
}
