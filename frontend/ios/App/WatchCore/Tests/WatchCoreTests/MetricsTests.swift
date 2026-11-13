import XCTest
@testable import WatchCore

/// The Pulse page's average and sparkline points, and the Effort page's rows.
final class MetricsTests: XCTestCase {
    let t0 = Date(timeIntervalSince1970: 1_000_000)
    func at(_ s: Double) -> Date { t0.addingTimeInterval(s) }

    func testAverageIsWholeBpmAndIgnoresZeros() {
        XCTAssertEqual(Metrics.average([(at(0), 100), (at(1), 0), (at(2), 111)]), 106, "105.5 rounds up, the zero is no reading")
        XCTAssertNil(Metrics.average([]))
        XCTAssertNil(Metrics.average([(at(0), 0)]))
    }

    func testRangeIsWholeBpmAndIgnoresZeros() {
        XCTAssertEqual(Metrics.range([(at(0), 120.4), (at(1), 0), (at(2), 98.6), (at(3), 152)]), 99...152)
        XCTAssertNil(Metrics.range([]))
        XCTAssertNil(Metrics.range([(at(0), 0)]))
    }

    func testZonesByPercentOfTanakaMax() {
        XCTAssertEqual(Metrics.maxHeartRate(age: 40), 180)
        XCTAssertEqual(Metrics.zone(68, max: 180), 1, "zone 1 is everything under 60 %")
        XCTAssertEqual(Metrics.zone(107, max: 180), 1)
        XCTAssertEqual(Metrics.zone(108, max: 180), 2, "60 % opens zone 2")
        XCTAssertEqual(Metrics.zone(126, max: 180), 3, "70 % opens zone 3")
        XCTAssertEqual(Metrics.zone(161, max: 180), 4)
        XCTAssertEqual(Metrics.zone(200, max: 180), 5, "over max stays in 5")
        XCTAssertNil(Metrics.zone(0, max: 180))
    }

    func testZoneBandsMatchZone() {
        let b = Metrics.zoneBands(max: 180)
        XCTAssertEqual(b.map { $0.lo }, [nil, 108, 126, 144, 162])
        XCTAssertEqual(b.map { $0.hi }, [107, 125, 143, 161, nil])
        let max = Metrics.maxHeartRate(age: 37) // 182.1: bands on a fraction still agree with zone()
        for (i, band) in Metrics.zoneBands(max: max).enumerated() {
            if let lo = band.lo { XCTAssertEqual(Metrics.zone(Double(lo), max: max), i + 1); XCTAssertEqual(Metrics.zone(Double(lo - 1), max: max), i) }
        }
    }

    func testTimeInZonesCountsEachReadingUntilTheNextCappedAt30s() {
        let hr: [Metrics.Sample] = [(at(0), 100), (at(10), 130), (at(20), 170), (at(120), 170)]
        XCTAssertEqual(Metrics.timeInZones(hr, max: 180), [10, 0, 10, 0, 30], "the last reading counts nothing; the 100 s gap counts 30")
        XCTAssertEqual(Metrics.timeInZones([], max: 180), [0, 0, 0, 0, 0])
    }

    func testMusclesCountWorkingSetsDoneByThePhonesWeights() throws {
        let json = #"""
        {"name":"Push","unit":"kg","cur":0,"restSec":90,"muscleNames":{"chest":"Pecho","triceps":"Tríceps"},"entries":[
          {"id":"1","name":"Bench","mode":"reps","muscles":{"chest":1,"triceps":0.4},"sets":[
            {"done":true,"warmup":true},{"done":true,"warmup":false},{"done":true,"warmup":false},{"done":false,"warmup":false}]},
          {"id":"2","name":"Pushdown","mode":"reps","muscles":{"triceps":1},"sets":[{"done":true,"warmup":false}]},
          {"id":"3","name":"Old phone","mode":"reps","sets":[{"done":true,"warmup":false}]}]}
        """#
        let w = try JSONDecoder().decode(ActiveWorkout.self, from: Data(json.utf8))
        let m = Metrics.muscles(w)
        XCTAssertEqual(m.map(\.name), ["Pecho", "Tríceps"])
        XCTAssertEqual(m[0].sets, 2, accuracy: 0.001, "the warm-up and the set not done count nothing")
        XCTAssertEqual(m[1].sets, 1.8, accuracy: 0.001, "2 × 0.4 from the bench, 1 from the pushdown")
        XCTAssertTrue(Metrics.muscles(nil).isEmpty)
    }

    func testAWorkoutStartedOnTheWatchKeepsTheMuscleNames() {
        let ready = ReadySession(routineIds: ["r"], name: "Push", entries: [], muscleNames: ["chest": "Pecho"])
        let (s, _) = SessionCore.start(SessionState(), ready, wid: "watch-1", at: 5, id: "s")
        XCTAssertEqual(s.workout?.muscleNames, ["chest": "Pecho"])
    }

    func testDownsampleKeepsOrderAndCapsTheCount() {
        let hr: [Metrics.Sample] = (0..<100).map { (at(Double($0)), Double(100 + $0)) }
        let d = Metrics.downsample(hr, to: 10)
        XCTAssertEqual(d.count, 10)
        XCTAssertEqual(d[0].1, 104.5, accuracy: 0.001)
        XCTAssertTrue(zip(d, d.dropFirst()).allSatisfy { $0.0 < $1.0 })
        XCTAssertEqual(Metrics.downsample(Array(hr.prefix(5)), to: 10).count, 5)
        XCTAssertTrue(Metrics.downsample(hr, to: 0).isEmpty)
    }

    func testEffortPerExerciseSkipsTheUnrated() {
        let set = SetRow(w: 60, r: 8, sec: nil, done: false, warmup: false, at: nil)
        func entry(_ id: String, _ name: String) -> Entry {
            Entry(id: id, name: name, mode: "reps", restSec: nil, last: nil, sets: [set, set])
        }
        var s = SessionState()
        XCTAssertTrue(Metrics.effort(s).isEmpty)
        s.workout = ActiveWorkout(id: "w", name: "Push", unit: "kg", cur: 0, restSec: 90, rest: nil,
                                  entries: [entry("a", "Bench"), entry("b", "Row"), entry("c", "Fly")])
        s = SessionCore.tick(s, entry: 0, set: 0, w: 60, r: 8, at: 1, id: "1", effort: Effort.Rating(kind: "rpe", value: 8)).0
        s = SessionCore.tick(s, entry: 0, set: 1, w: 60, r: 8, at: 2, id: "2", effort: Effort.Rating(kind: "rpe", value: 9)).0
        s = SessionCore.tick(s, entry: 1, set: 0, w: 60, r: 8, at: 3, id: "3").0
        s = SessionCore.tick(s, entry: 2, set: 0, w: 60, r: 8, at: 4, id: "4", effort: Effort.Rating(kind: "rpe", value: 7)).0
        let rows = Metrics.effort(s)
        XCTAssertEqual(rows.map(\.name), ["Bench", "Fly"])
        XCTAssertEqual(rows[0].value, 8.5)
        XCTAssertNil(SessionCore.finish(s, at: 5, id: "f").0.efforts, "a finished workout leaves no ratings")
    }
}
