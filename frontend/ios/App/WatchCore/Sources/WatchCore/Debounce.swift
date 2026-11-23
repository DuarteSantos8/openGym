import Foundation

/// Runs only the last of several calls made close together, once, `after` seconds after that last
/// one. A set ticked changes the complications' state three times within a second (the tick,
/// "waiting to sync" on, the phone's reply): one reload for all of them.
final class Debounce {
    private var pending: DispatchWorkItem?
    private let after: TimeInterval
    private let queue: DispatchQueue

    init(after: TimeInterval, queue: DispatchQueue = .main) {
        self.after = after
        self.queue = queue
    }

    func call(_ work: @escaping () -> Void) {
        pending?.cancel()
        let item = DispatchWorkItem(block: work)
        pending = item
        queue.asyncAfter(deadline: .now() + after, execute: item)
    }
}
