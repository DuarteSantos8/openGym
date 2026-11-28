import Foundation

/// The daily check-in before a workout started here (#1535), the short version of the phone's
/// (frontend lib/daily-form.js): sleep, energy and soreness, each 1 to 5, any of them may stay
/// unanswered. Asked once a day: not when the phone says today is answered (`checkinDay`), not when
/// this watch asked today already (answered or skipped). The answers go to the phone as a
/// `dailyForm` event, stored there exactly like its own check-in.
enum DailyForm {
    /// The questions, in order (the phone's FORM_KEYS, stress left to the phone).
    static let keys = ["sleep", "energy", "sore"]

    /// The day as the phone writes it, YYYY-MM-DD in the watch's time zone. Always the Gregorian
    /// calendar: a watch set to the Buddhist one would otherwise say 2569.
    static func day(_ date: Date, timeZone: TimeZone = .current) -> String {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = timeZone
        let c = cal.dateComponents([.year, .month, .day], from: date)
        return pad(c.year ?? 0, 4) + "-" + pad(c.month ?? 0, 2) + "-" + pad(c.day ?? 0, 2)
    }

    private static func pad(_ n: Int, _ width: Int) -> String {
        let s = String(n)
        return String(repeating: "0", count: max(0, width - s.count)) + s
    }

    /// Whether a workout started now asks first: the phone says to (`on`), today is not answered
    /// there, and this watch has not asked today.
    static func due(on: Bool?, answeredDay: String?, askedDay: String?, today: String) -> Bool {
        on == true && answeredDay != today && askedDay != today
    }

    /// The event with the answers given (each 1 to 5, the rest left out), nil with none.
    static func event(_ answers: [String: Int], at: Double, id: String) -> Event? {
        var ev: Event = ["id": id, "type": "dailyForm", "at": at]
        var any = false
        for k in keys {
            if let v = answers[k], v >= 1, v <= 5 {
                ev[k] = v
                any = true
            }
        }
        return any ? ev : nil
    }
}
