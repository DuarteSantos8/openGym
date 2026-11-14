import Foundation

/**
 * The gym reminder's no-nag rule (#614), decided on the phone when a gym is entered, since the
 * page is not running then. The same rule as frontend lib/gym-reminder.js skipReason and
 * android/.../GymReminderRules.java, in the same order.
 */
public enum GymReminderRules {
    /// A running session older than this was never finished; it does not keep the reminder quiet.
    public static let activeFreshMs: Double = 12 * 3600 * 1000

    /// "HH:MM" as minutes after midnight, or nil.
    public static func minuteOf(_ hhmm: String?) -> Int? {
        guard let s = hhmm, s.count == 5, s[s.index(s.startIndex, offsetBy: 2)] == ":" else { return nil }
        let parts = s.split(separator: ":")
        guard parts.count == 2, parts[0].count == 2, parts[1].count == 2,
              parts[0].allSatisfy({ $0.isASCII && $0.isNumber }), parts[1].allSatisfy({ $0.isASCII && $0.isNumber }),
              let h = Int(parts[0]), let m = Int(parts[1]), h < 24, m < 60 else { return nil }
        return h * 60 + m
    }

    /// No window (either end missing or invalid, or both the same) means any time; overnight wraps.
    public static func inWindow(from: String?, to: String?, minute: Int) -> Bool {
        guard let f = minuteOf(from), let t = minuteOf(to), f != t else { return true }
        return f < t ? (minute >= f && minute < t) : (minute >= f || minute < t)
    }

    public static func isoOf(_ date: Date, calendar: Calendar = .current) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    /**
     * Why entering a gym now would not notify, or nil when it should: off, fired (already today),
     * trained (a workout logged today), quiet (a day note excuses today), active (a session
     * started less than 12 hours ago), window (outside the time window).
     */
    public static func skipReason(on: Bool, gyms: Int, windowFrom: String?, windowTo: String?,
                                  trainedOn: String, quietOn: String, activeSince: Double, lastFired: String,
                                  now: Date, calendar: Calendar = .current) -> String? {
        if !on || gyms <= 0 { return "off" }
        let today = isoOf(now, calendar: calendar)
        if lastFired == today { return "fired" }
        if trainedOn == today { return "trained" }
        if quietOn == today { return "quiet" }
        if activeSince > 0 && now.timeIntervalSince1970 * 1000 - activeSince < activeFreshMs { return "active" }
        let c = calendar.dateComponents([.hour, .minute], from: now)
        if !inWindow(from: windowFrom, to: windowTo, minute: (c.hour ?? 0) * 60 + (c.minute ?? 0)) { return "window" }
        return nil
    }
}
