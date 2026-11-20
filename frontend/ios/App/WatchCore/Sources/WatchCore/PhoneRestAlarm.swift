import Foundation

/*
 * The iPhone's rest alarm while its page sleeps (the phone locked in a pocket): the watch's +15,
 * −15 or Skip (a `rest` event) moves the alarm the page booked, so the phone rings when the watch
 * does, not at the old end; the rest a set ticked at the wrist starts (a `setDone`'s `restEnd`)
 * takes it away. The page applies the same event when it wakes (lib/watch-sync.js); this only keeps the
 * alarm in step until then. Compiled into the iPhone app (App.xcodeproj, RestAlertPlugin), tested
 * in PhoneRestAlarmTests.
 */
enum PhoneRestAlarm {
    /// The watch's change: when it was made and the rest's new end (ms, the phone's clock), nil
    /// for no rest any more (Skip, −15 to nothing, a set with no rest after it, or one over already).
    /// `sameRest`: +15, −15 or Skip on the rest the alarm is for, which moves with it; false for a
    /// set ticked at the wrist, whose new rest the old alarm (named for that set) only comes down for.
    struct Change: Equatable {
        let at: Double
        let end: Double?
        var sameRest = true
    }

    /// Beyond this the watch's clock is wrong, not off: left as it is (watch-sync.js MAX_OFF_MS).
    static let maxOff: Double = 12 * 3600 * 1000

    /// What watch event `ev` (as stored, `off` not yet taken off) does to the alarm of workout
    /// `wid` that was booked or last moved at `since`: nil leaves it (another event or workout, a
    /// fixed set, or a change older than the alarm, such as an event sent again after the page
    /// applied it). The phone's own rule (docs/WATCH_SYNC.md): the newer change wins.
    static func change(_ ev: [String: Any], wid: String?, since: Double, now: Double) -> Change? {
        let type = ev["type"] as? String
        guard type == "rest" || type == "setDone" else { return nil }
        if let wid = wid, let w = ev["wid"] as? String, !w.isEmpty, w != wid { return nil }
        let given = num(ev["off"]) ?? 0
        let off = abs(given) <= maxOff ? given : 0
        guard let t = num(ev["at"]), t - off > since else { return nil }
        let end: Double?
        if type == "rest" {
            end = num(ev["endsAt"])
        } else {
            guard let e = num(ev["restEnd"]) else { return nil }
            end = e > 0 ? e : nil
        }
        let same = type == "rest"
        guard let e = end, e - off > now + 500 else { return Change(at: t - off, end: nil, sameRest: same) }
        return Change(at: t - off, end: e - off, sameRest: same)
    }

    private static func num(_ v: Any?) -> Double? {
        guard let d = (v as? Double) ?? (v as? NSNumber)?.doubleValue, d.isFinite else { return nil }
        return d
    }
}
