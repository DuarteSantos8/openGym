import Foundation

/*
 * The watch's outbox (1.4.5, docs/WATCH_SYNC.md), as pure functions: the twin of OutboxCore in
 * android/wear SessionCore.kt, with the same cases in OutboxTests.swift.
 *
 * Every event goes in before it is sent, numbered in the order it happened (`seq`, also written
 * into the event, for the phone to sort by: a quick message can overtake a queued transfer), and
 * stays until the phone has applied it (its id in a snapshot's `acked`). Until then it is sent
 * again: soon while nothing says it got there, rarely once the phone's side stored it (the page may
 * not have run yet), and whatever is not delivered on every reconnect and at launch. Nothing is
 * thrown away because a transfer failed, the app was killed, or the phone was off for a day.
 */

/// One event on its way: its JSON (with its seq), when it last went out (ms, 0 never), and whether
/// the phone's side has it stored (a message answered, a transfer finished).
struct OutItem: Codable, Equatable {
    var id: String
    var seq: Int
    var json: String
    var sentAt: Double = 0
    var delivered: Bool = false
}

struct Outbox: Codable, Equatable {
    var items: [OutItem] = []
    var seq: Int = 0
}

enum OutboxCore {
    static let limit = 1000
    /// Not delivered yet: sent again after this long (ms).
    static let resendMs: Double = 20_000
    /// Delivered to the phone's queue but not applied by its page: once more after this long.
    static let redeliverMs: Double = 10 * 60_000

    /// The outbox with `event` added (unsent), and the event as it goes out, with its seq. Nil for
    /// an event without an id (or that is not JSON). The same id twice is one entry.
    static func add(_ o: Outbox, _ event: Event) -> (Outbox, OutItem)? {
        guard let id = event["id"] as? String, !id.isEmpty else { return nil }
        if let have = o.items.first(where: { $0.id == id }) { return (o, have) }
        let seq = o.seq + 1
        var ev = event
        ev["seq"] = seq
        guard JSONSerialization.isValidJSONObject(ev),
              let data = try? JSONSerialization.data(withJSONObject: ev),
              let json = String(data: data, encoding: .utf8) else { return nil }
        let item = OutItem(id: id, seq: seq, json: json)
        var out = o
        out.seq = seq
        // Of a kind where only the newest says anything (the watch's status, sent at every launch),
        // an older one still waiting gives way: a watch whose phone app is not opened for months
        // would otherwise fill the outbox with them, up to the limit where the oldest events,
        // sets among them, start to fall out.
        var kept = o.items
        if let type = event["type"] as? String, latestOnly.contains(type) {
            kept = kept.filter { eventType($0) != type }
        }
        out.items = Array((kept + [item]).suffix(limit))
        return (out, item)
    }

    /// Event types of which only the newest one waiting is kept.
    static let latestOnly: Set<String> = ["watchStatus"]

    /// Without the events the phone has applied.
    static func ack(_ o: Outbox, _ ids: [String]?) -> Outbox {
        guard let ids = ids, !ids.isEmpty else { return o }
        let gone = Set(ids)
        var out = o
        out.items = o.items.filter { !gone.contains($0.id) }
        return out
    }

    /// These went out now.
    static func sent(_ o: Outbox, _ ids: [String], now: Double) -> Outbox {
        let set = Set(ids)
        var out = o
        out.items = o.items.map { item in
            guard set.contains(item.id) else { return item }
            var x = item
            x.sentAt = now
            return x
        }
        return out
    }

    /// These are stored on the phone (not applied yet).
    static func delivered(_ o: Outbox, _ ids: [String]) -> Outbox {
        let set = Set(ids)
        var out = o
        out.items = o.items.map { item in
            guard set.contains(item.id) else { return item }
            var x = item
            x.delivered = true
            return x
        }
        return out
    }

    /// What to send now, oldest first: never sent, or sent and not heard of for a while (a clock
    /// that went back counts as a while).
    static func due(_ o: Outbox, now: Double) -> [OutItem] {
        o.items.filter { item in
            item.sentAt == 0 || now < item.sentAt || now - item.sentAt >= (item.delivered ? redeliverMs : resendMs)
        }.sorted { $0.seq < $1.seq }
    }

    /// The phone is back in reach: everything not delivered goes again, whenever it last went out,
    /// and what is due besides.
    static func onReconnect(_ o: Outbox, now: Double) -> [OutItem] {
        let soon = Set(due(o, now: now).map { $0.id })
        return o.items.filter { !$0.delivered || soon.contains($0.id) }.sorted { $0.seq < $1.seq }
    }

    /// Events the phone's side has not stored yet: the watch's small "syncs later" count.
    static func waiting(_ o: Outbox) -> Int { o.items.filter { !$0.delivered }.count }

    /// Sets logged here that have not reached the phone yet (setDone events not delivered): what
    /// the watch shows as "Waiting to sync", and the complication too. Other events (the watch's
    /// status, a heart rate for a set) are not sets the lifter would miss.
    static func waitingSets(_ o: Outbox) -> Int {
        o.items.filter { !$0.delivered && eventType($0) == "setDone" }.count
    }

    /// An event's type, read from its JSON.
    static func eventType(_ item: OutItem) -> String? {
        guard let ev = (try? JSONSerialization.jsonObject(with: Data(item.json.utf8))) as? [String: Any] else { return nil }
        return ev["type"] as? String
    }
}

/// What the watch says about its sets and the phone: all there, some on their way, or some
/// waiting for a phone out of reach.
enum SyncState: Equatable {
    case synced
    case waiting(Int)
    case away(Int)

    static func of(waiting n: Int, reachable: Bool) -> SyncState {
        n <= 0 ? .synced : (reachable ? .waiting(n) : .away(n))
    }

    var count: Int {
        switch self {
        case .synced: return 0
        case .waiting(let n), .away(let n): return n
        }
    }
}
