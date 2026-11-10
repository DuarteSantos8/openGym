import Foundation

/// A removal waits `seconds` for Undo before it is sent. One at a time: a second removal flushes the first.
struct UndoWindow: Equatable {
    static let seconds: TimeInterval = 4
    private(set) var edit: PendingEdit?
    private(set) var started = Date.distantPast

    mutating func begin(_ e: PendingEdit, at t: Date) { edit = e; started = t }
    /// Undo pressed: nothing will be sent.
    mutating func undo() { edit = nil }
    /// The edit once its time is up, once.
    mutating func due(at t: Date) -> PendingEdit? {
        t.timeIntervalSince(started) >= UndoWindow.seconds ? flush() : nil
    }
    /// The edit now (the app left the screen), once.
    mutating func flush() -> PendingEdit? { defer { edit = nil }; return edit }
}
