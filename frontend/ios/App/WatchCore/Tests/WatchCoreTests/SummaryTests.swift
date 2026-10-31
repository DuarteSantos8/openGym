import XCTest
@testable import WatchCore

/// The summary's time and volume, in the app's language (the watch's own may differ).
final class SummaryTests: XCTestCase {
    private func summary(duration: Double? = nil, volume: Double = 0, unit: String = "kg") -> WorkoutSummary {
        WorkoutSummary(name: "Push day", unit: unit, duration: duration, sets: 17, volume: volume,
                       prs: [], hrAvg: nil, hrMax: nil, calories: nil, endedOnPhone: false)
    }
    private let en = Locale(identifier: "en_US")
    private let de = Locale(identifier: "de")

    func testDurationIsMinutesAndNeverUnderOne() {
        XCTAssertEqual(summary(duration: 52 * 60 + 13).durationText(locale: en), "52 min")
        XCTAssertEqual(summary(duration: 20).durationText(locale: en), "1 min")
        XCTAssertNil(summary(duration: nil).durationText(locale: en))
    }

    func testDurationFromAnHourAddsHours() {
        let hour = summary(duration: 3600 + 300).durationText(locale: en) ?? ""
        XCTAssertTrue(hour.contains("1") && hour.contains("5"), hour)   // "1 hr, 5 min"; digits only, the OS owns the wording
        XCTAssertEqual(summary(duration: 3599).durationText(locale: en), "59 min")
        XCTAssertFalse((summary(duration: 3600).durationText(locale: en) ?? "0").contains("0"), "a whole hour drops its zero minutes")
        let german = summary(duration: 3600 + 300).durationText(locale: de) ?? ""
        XCTAssertTrue(german.contains("Std") && german != hour, german)   // the app's language, not the watch's
    }

    func testVolumeUsesTheWorkoutsUnitAndTheAppsLanguage() {
        XCTAssertEqual(summary(volume: 4320, unit: "kg").volumeText(locale: en), "4,320 kg")
        XCTAssertEqual(summary(volume: 4320.4, unit: "lb").volumeText(locale: de), "4.320 lb")
        XCTAssertNil(summary(volume: 0).volumeText(locale: en), "bodyweight and timed sets: no row of zeros")
        XCTAssertEqual(summary(volume: 4320.6).volumeText(locale: en), "4,321 kg")
        XCTAssertEqual(summary(volume: 312.5).volumeText(locale: en), "312 kg", "ICU rounds half to even (as before this moved here)")
    }
}
