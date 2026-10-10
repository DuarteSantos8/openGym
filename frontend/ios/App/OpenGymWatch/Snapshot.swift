import Foundation

// The running workout as the iPhone app sends it (lib/watch-model.js watchSnapshot, protocol 1).
// The words to print come along in `labels`, in the phone's language.
struct Snapshot: Decodable, Equatable {
    let v: Int
    let active: Bool
    let workout: String?
    let unit: String?
    let progress: Progress?
    let rest: Rest?
    let current: SetInfo?
    let labels: [String: String]

    enum CodingKeys: String, CodingKey {
        case v, active, workout, unit, progress, rest, labels
        case current = "set"
    }

    struct Progress: Decodable, Equatable {
        let done: Int
        let total: Int
    }

    // Running: `endsAt` (epoch ms). Held: `paused` and `left` (s). Over: `ready`.
    struct Rest: Decodable, Equatable {
        let endsAt: Double?
        let total: Double?
        let left: Double?
        let paused: Bool?
        let ready: Bool?
        let switching: Bool?

        var endDate: Date? { endsAt.map { Date(timeIntervalSince1970: $0 / 1000) } }
        var isRunning: Bool { paused != true && ready != true && endsAt != nil }
    }

    struct SetInfo: Decodable, Equatable {
        let entryIdx: Int
        let setIdx: Int
        let exercise: String
        let label: String?
        let warmup: Bool
        let mode: String
        let reps: Int
        let weight: Double
        let loggable: Bool
    }

    func text(_ key: String, _ fallback: String) -> String { labels[key] ?? fallback }
}
