import XCTest
@testable import WatchCore

/// A forgotten workout: asked about at 20 minutes, ended at 45, at its last set.
final class IdleTests: XCTestCase {
    let min: Double = 60 * 1000

    func workout(start: Double?, ats: [Double?]) -> ActiveWorkout {
        let sets = ats.map { SetRow(w: 60, r: 8, sec: nil, done: $0 != nil, warmup: false, at: $0) }
        return ActiveWorkout(id: "w1", name: "Push", unit: "kg", cur: 0, restSec: 90, rest: nil,
                             entries: [Entry(id: "0025", name: "Bench Press", mode: "reps", restSec: nil, last: nil, sets: sets)],
                             start: start)
    }

    func testAsksAt20MinutesAndEndsAt45() {
        XCTAssertEqual(Idle.state(since: 0, now: 19 * min), .active)
        XCTAssertEqual(Idle.state(since: 0, now: 20 * min), .ask)
        XCTAssertEqual(Idle.state(since: 0, now: 44 * min), .ask)
        XCTAssertEqual(Idle.state(since: 0, now: 45 * min), .end)
    }

    func testTheLastSetIsTheNewestTickWhereverItIs() {
        let w = workout(start: 1000, ats: [5 * min, 30 * min, nil, 12 * min])
        XCTAssertEqual(Idle.lastSet(w), 30 * min, "the newest tick, not the last row")
    }

    func testOneSideOfAPerSideSetCounts() {
        var w = workout(start: 1000, ats: [nil])
        w.entries[0].sets[0].sides = Sides(L: SideRow(w: 20, r: 8, done: true), R: SideRow(w: 20, r: 8, done: false))
        w.entries[0].sets[0].at = 7 * min
        XCTAssertEqual(Idle.lastSet(w), 7 * min)
    }

    func testNothingLoggedFallsBackToTheStart() {
        XCTAssertEqual(Idle.lastSet(workout(start: 1000, ats: [nil, nil])), 1000)
        XCTAssertNil(Idle.lastSet(workout(start: 0, ats: [nil])), "a phone that sent no start: the watch's own time then")
    }

    func testAChangeFromThePhoneCountsAsTheWorkoutGoingOn() {
        // Last set at 0, the phone edited the workout at 30 min: asked at 50, not at 20; ended at 75.
        let since = Idle.since(lastSet: 0, seen: nil, activity: 30 * min, snooze: nil)
        XCTAssertEqual(since, 30 * min)
        XCTAssertEqual(Idle.state(since: since, now: 25 * min), .active)
        XCTAssertEqual(Idle.state(since: since, now: 50 * min), .ask)
        XCTAssertEqual(Idle.state(since: since, now: 75 * min), .end)
        XCTAssertEqual(Idle.since(lastSet: 10 * min, seen: 2 * min, activity: nil, snooze: 40 * min), 40 * min, "keep going")
        XCTAssertEqual(Idle.since(lastSet: 10 * min, seen: nil, activity: nil, snooze: nil), 10 * min)
    }

    /* #904: the watch's copy had stopped at 20:28:32 while sets were ticked on the phone until
       21:13:21, and the watch ended the workout at 21:13:45 as forgotten. */

    func testThePhoneUsedInTheWorkoutCountsLikeASetLoggedHere() {
        var w = workout(start: 0, ats: [3 * min])
        w.activeAt = 40 * min
        XCTAssertEqual(Idle.lastSet(w), 40 * min, "an edit or the app opened on the phone, after the last set")
        w.activeAt = 1 * min
        XCTAssertEqual(Idle.lastSet(w), 3 * min, "an older one changes nothing")
        w.activeAt = nil
        XCTAssertEqual(Idle.lastSet(w), 3 * min)
    }

    func testActiveAtFromAnOlderPhoneIsOptional() throws {
        let json = #"{"id":"w1","name":"Push","unit":"kg","cur":0,"restSec":90,"entries":[]}"#
        let w = try JSONDecoder().decode(ActiveWorkout.self, from: Data(json.utf8))
        XCTAssertNil(w.activeAt)
        let newer = #"{"id":"w1","name":"Push","unit":"kg","cur":0,"restSec":90,"entries":[],"activeAt":1234}"#
        XCTAssertEqual(try JSONDecoder().decode(ActiveWorkout.self, from: Data(newer.utf8)).activeAt, 1234)
    }

    func testNeverEndsWithoutThePhoneHavingItsSay() {
        // 45 minutes after the last set the watch knows of, and the phone could not be asked.
        XCTAssertEqual(Idle.verdict(since: 0, now: 45 * min, wid: "w1", reply: nil), .ask)
        XCTAssertEqual(Idle.verdict(since: 0, now: 300 * min, wid: "w1", reply: nil), .ask, "hours later still only asks")
        // Before that the phone is not asked at all: the watch's own clock decides.
        XCTAssertEqual(Idle.verdict(since: 0, now: 10 * min, wid: "w1", reply: nil), .active)
        XCTAssertEqual(Idle.verdict(since: 0, now: 25 * min, wid: "w1", reply: nil), .ask)
    }

    func testThePhoneStillLoggingKeepsTheWorkoutGoing() {
        // The issue's case: the phone's last tick 24 s ago.
        let reply = Idle.PhoneReply(wid: "w1", activeAt: 45 * min - 24_000)
        XCTAssertEqual(Idle.verdict(since: 0, now: 45 * min, wid: "w1", reply: reply), .active)
        // Used 30 minutes ago there: asked about, not ended.
        XCTAssertEqual(Idle.verdict(since: 0, now: 50 * min, wid: "w1", reply: Idle.PhoneReply(wid: "w1", activeAt: 20 * min)), .ask)
    }

    func testAWorkoutForgottenOnBothSidesEnds() {
        XCTAssertEqual(Idle.verdict(since: 0, now: 45 * min, wid: "w1", reply: Idle.PhoneReply(wid: "w1", activeAt: 0)), .end)
        XCTAssertEqual(Idle.verdict(since: 0, now: 45 * min, wid: "w1", reply: Idle.PhoneReply(wid: "w1", activeAt: nil)), .end)
        // The phone runs another workout or none: nothing of this one goes on there.
        XCTAssertEqual(Idle.verdict(since: 0, now: 45 * min, wid: "w1", reply: Idle.PhoneReply(wid: nil, activeAt: 44 * min)), .end)
        XCTAssertEqual(Idle.verdict(since: 0, now: 45 * min, wid: "w1", reply: Idle.PhoneReply(wid: "w2", activeAt: 44 * min)), .end)
    }

    func testAnIdleFinishSaysSoAndATappedOneDoesNot() {
        var s = SessionState()
        s.workout = workout(start: 0, ats: [3 * min])
        let (_, idle) = SessionCore.finish(s, at: 3 * min, id: "e1", idle: true)
        XCTAssertEqual(idle?["idle"] as? Bool, true)
        XCTAssertEqual(idle?["type"] as? String, "finish")
        let (_, tapped) = SessionCore.finish(s, at: 50 * min, id: "e2")
        XCTAssertNil(tapped?["idle"])
        let (_, dropped) = SessionCore.finish(s, at: 50 * min, id: "e3", discard: true, idle: true)
        XCTAssertNil(dropped?["idle"], "a discard is never an idle finish")
    }
}
