import XCTest
@testable import WatchCore

/// The summary's medal (#1309): the records it lists with their old and new bests, the notches and
/// diamonds on its face, its entrance haptics, its size per watch and the Crown's stops.
final class MedalTests: XCTestCase {
    func row(_ w: Double?, _ r: Double?, sec: Double? = nil) -> SetRow {
        SetRow(w: w, r: r, sec: sec, done: false, warmup: false, at: nil)
    }

    func entry(_ id: String, _ name: String, mode: String = "reps", best: BestSet, sets: [SetRow]) -> Entry {
        var e = Entry(id: id, name: name, mode: mode, restSec: nil, last: nil, sets: sets)
        e.best = best
        return e
    }

    func testEachRecordCarriesTheBestItBeat() {
        let heavier = entry("b", "Bench", best: BestSet(w: 100, r: 5, sec: nil), sets: [row(102.5, 3), row(105, 2), row(100, 6)])
        let moreReps = entry("r", "Row", best: BestSet(w: 70, r: 8, sec: nil), sets: [row(70, 9), row(70, 10), row(60, 15)])
        var assisted = entry("d", "Assisted dip", best: BestSet(w: 25, r: 8, sec: nil), sets: [row(20, 8), row(15, 6)])
        assisted.assisted = true
        let hold = entry("p", "Plank", mode: "time", best: BestSet(w: nil, r: nil, sec: 60), sets: [row(nil, nil, sec: 75), row(nil, nil, sec: 70)])
        var pounds = entry("c", "Curl", best: BestSet(w: 30, r: 10, sec: nil), sets: [row(35, 8)])
        pounds.unit = "lb"
        let none = entry("n", "Squat", best: BestSet(w: 140, r: 5, sec: nil), sets: [row(140, 5)])
        var s = SessionCore.applySnapshot(SessionState(), Snapshot(v: 1, unit: "kg", restSec: 90, active: ActiveWorkout(
            id: "w", name: "Push", unit: "kg", cur: 0, restSec: 90, rest: nil, entries: [heavier, moreReps, assisted, hold, pounds, none], start: 0),
            ready: nil, settings: nil))
        for (ei, e) in s.workout!.entries.enumerated() {
            for (si, r) in e.sets.enumerated() { s = SessionCore.tick(s, entry: ei, set: si, w: r.w, r: r.r, sec: r.sec, at: 1, id: "\(ei)\(si)").0 }
        }
        let sum = SessionCore.summary(s.workout!, end: 52 * 60_000)
        XCTAssertEqual(sum.records, [
            RecordLine(name: "Bench", kind: .weight, old: 100, new: 105, unit: "kg"),
            RecordLine(name: "Row", kind: .reps, old: 8, new: 10, unit: "kg"),
            RecordLine(name: "Assisted dip", kind: .weight, old: 25, new: 15, unit: "kg"),
            RecordLine(name: "Plank", kind: .hold, old: 60, new: 75, unit: "kg"),
            RecordLine(name: "Curl", kind: .weight, old: 30, new: 35, unit: "lb"),
        ], "the heaviest past the best, else the most reps at it; the lightest when assisted; the exercise's own unit")
        XCTAssertEqual(sum.prs, sum.records.map(\.name), "one record line per name, in the same order")
        XCTAssertEqual(sum.endedAt, 52 * 60_000)
    }

    func testRecordTexts() {
        let de = Locale(identifier: "de_DE")
        XCTAssertTrue(RecordLine(name: "B", kind: .weight, old: 60, new: 62.5, unit: "kg").texts(locale: de) == ("60", "62,5"))
        XCTAssertTrue(RecordLine(name: "P", kind: .hold, old: 45, new: 75, unit: "kg").texts(locale: de) == ("0:45", "1:15"))
        XCTAssertEqual(Medal.number(1.234, locale: Locale(identifier: "en_US")), "1.23")
    }

    func testASummaryFromAnOlderBuildStillReads() throws {
        let old = #"{"name":"Push","unit":"kg","duration":3120,"sets":16,"volume":5180,"prs":["Bench"],"hrAvg":128,"endedOnPhone":false}"#
        let s = try JSONDecoder().decode(WorkoutSummary.self, from: Data(old.utf8))
        XCTAssertEqual(s.records, [])
        XCTAssertNil(s.endedAt)
        XCTAssertNil(s.calories)
        XCTAssertEqual(s.prs, ["Bench"])
        var now = s
        now.records = [RecordLine(name: "Bench", kind: .weight, old: 100, new: 105, unit: "kg")]
        now.endedAt = 1
        XCTAssertEqual(try JSONDecoder().decode(WorkoutSummary.self, from: JSONEncoder().encode(now)), now)
    }

    func testOneNotchPerSetUpTo48() {
        let a = Medal.notchAngles(sets: 16)
        XCTAssertEqual(a.count, 16)
        XCTAssertEqual(a.first, -90, "the first at 12 o'clock")
        XCTAssertEqual(a[1] - a[0], 22.5)
        XCTAssertEqual(Medal.notchAngles(sets: 0), [])
        XCTAssertEqual(Medal.notchAngles(sets: -3), [])
        XCTAssertEqual(Medal.notchAngles(sets: 120).count, 48)
    }

    func testDiamondsSitUnderTheTime() {
        let two = Medal.gems(records: 2)
        XCTAssertEqual(two.angles, [76.5, 103.5])
        XCTAssertEqual(two.size, 8.6)
        XCTAssertEqual(Medal.gems(records: 1).angles, [90], "one diamond straight under the time")
        let six = Medal.gems(records: 6)
        XCTAssertEqual(six.size, 7)
        XCTAssertEqual(six.angles[1] - six.angles[0], 21)
        XCTAssertEqual(Medal.gems(records: 12).angles.count, 7)
        XCTAssertEqual(Medal.gems(records: 0).angles, [])
    }

    func testTheTimeOnTheFace() {
        XCTAssertTrue(Medal.time(52 * 60 + 13) == ("52", false))
        XCTAssertTrue(Medal.time(65 * 60) == ("1:05", true))
        XCTAssertTrue(Medal.time(59 * 60 + 40) == ("1:00", true), "59:40 rounds to the hour")
        XCTAssertTrue(Medal.time(.nan) == ("0", false))
        XCTAssertEqual(Medal.clock(75), "1:15")
    }

    func testOnlyLettersThatStandAloneGoRoundTheRim() {
        XCTAssertTrue(Medal.arcable("Push day"))
        XCTAssertTrue(Medal.arcable("Upper body: push, pull & core 💪"))
        XCTAssertTrue(Medal.arcable("Oberkörper Ü"))
        XCTAssertTrue(Medal.arcable("Тяга"))
        XCTAssertTrue(Medal.arcable("Ngày đẩy"))
        XCTAssertTrue(Medal.arcable("胸の日"))
        XCTAssertTrue(Medal.arcable("가슴 날"))
        XCTAssertFalse(Medal.arcable("يوم الصدر"))
        XCTAssertFalse(Medal.arcable("פוש"))
        XCTAssertFalse(Medal.arcable("पुश डे"))
        XCTAssertFalse(Medal.arcable("วันอก"))
    }

    func testTheEntranceHaptics() {
        let plain = Medal.beats(records: 0)
        XCTAssertEqual(plain.map(\.beat), [.strike, .settled])
        XCTAssertEqual(plain.map(\.at), [0.3, 1.15])
        for n in 1...9 {
            let b = Medal.beats(records: n)
            XCTAssertEqual(b.first?.beat, .strike)
            XCTAssertEqual(b.count, 1 + min(n, 3), "4 taps at most")
            for (x, y) in zip(b, b.dropFirst()) { XCTAssertGreaterThanOrEqual(y.at - x.at, 0.35 - 1e-9) }
        }
        XCTAssertEqual(Medal.gemTimes(records: 9).count, 7)
        XCTAssertGreaterThan(Medal.entranceEnds(records: 2), Medal.gemTimes(records: 7).last! + 0.5)
    }

    func testTheMedalSizePerWatch() {
        XCTAssertEqual(Medal.diameter(width: 176, height: 215), 140)
        XCTAssertEqual(Medal.diameter(width: 187, height: 223), 150)
        XCTAssertEqual(Medal.diameter(width: 208, height: 248), 160)
        XCTAssertEqual(Medal.diameter(width: 205, height: 251), 168)
        XCTAssertEqual(Medal.diameter(width: 162, height: 197), 128.28, accuracy: 0.01, "40 mm, in scale")
        XCTAssertEqual(Medal.diameter(width: 120, height: 251), 96, "never wider than the screen less its margins")
    }

    func testTheCrownStops() {
        XCTAssertEqual(Medal.endStops(overflow: 0), 0)
        XCTAssertEqual(Medal.endStops(overflow: 87), 2)
        XCTAssertEqual(Medal.scroll(c: 1.5, overflow: 87), 0)
        XCTAssertEqual(Medal.scroll(c: 3, overflow: 87), 43.5)
        XCTAssertEqual(Medal.scroll(c: 4, overflow: 87), 87)
        XCTAssertEqual(Medal.scroll(c: 9, overflow: 87), 87)
        XCTAssertEqual(Medal.scroll(c: 3, overflow: 0), 0)
        XCTAssertEqual([0, 0.4, 0.6, 1.4, 1.6, 3].map(Medal.mark), [0, 0, 1, 1, 2, 2])
        XCTAssertEqual([0, 0.3, 1, 1.5, 2, 3.5].map(Medal.nextStop), [1, 1, 2, 2, 0, 0])
    }
}
