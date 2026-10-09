import Foundation
var checks = 0
func check(_ condition: Bool) { precondition(condition); checks += 1 }
let first: [String: Any] = ["id": "one", "profile": "account-a", "seq": 2, "entries": [["id": "exercise", "sets": [["w": 20, "r": 8, "done": true]]]]]
let second: [String: Any] = ["id": "two", "profile": "account-a", "seq": 3]
var records = WatchOutbox.adding(first, to: [])
records = WatchOutbox.adding(second, to: records)
check(records.count == 2)
records = WatchOutbox.adding(first, to: records)
check(records.count == 2)
check(WatchOutbox.adding(["id": "invalid"], to: records).count == 2)
check(WatchOutbox.acknowledging(["one"], profile: "account-b", in: records).count == 2)
check(WatchOutbox.acknowledging(["missing"], profile: "account-a", in: records).count == 2)
let remaining = WatchOutbox.acknowledging(["one"], profile: "account-a", in: records)
check(remaining.count == 1 && remaining[0]["id"] as? String == "two")
let suite = "openGym.watch.test.\(UUID().uuidString)"
let defaults = UserDefaults(suiteName: suite)!
defer { defaults.removePersistentDomain(forName: suite) }
defaults.set(records, forKey: "outbox")
let restored = defaults.array(forKey: "outbox") as! [[String: Any]]
check(restored.count == 2)
let workout = restored.first { $0["id"] as? String == "one" }!
let entries = workout["entries"] as! [[String: Any]]
let sets = entries[0]["sets"] as! [[String: Any]]
check((sets[0]["w"] as? NSNumber)?.intValue == 20)
check(WatchOutbox.acknowledging(["one", "two"], profile: "account-a", in: restored).isEmpty)
print("\(checks) Watch outbox checks passed")
