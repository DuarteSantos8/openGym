import XCTest
@testable import WatchCore

final class SetMenuTests: XCTestCase {
    func row(done: Bool = false, warmup: Bool = false) -> SetRow {
        SetRow(w: 60, r: 8, sec: nil, done: done, warmup: warmup, at: nil)
    }
    func entry(_ sets: [SetRow], mode: String = "reps") -> Entry {
        Entry(id: "x", name: "X", mode: mode, restSec: nil, last: nil, sets: sets)
    }
    let dec = JSONDecoder()

    func testOldSnapshotDecodes() throws {
        let r = try dec.decode(SetRow.self, from: Data(#"{"w":60,"r":8,"done":false,"warmup":false}"#.utf8))
        XCTAssertNil(r.failure); XCTAssertNil(r.drop); XCTAssertNil(r.drops); XCTAssertNil(r.rp)
        XCTAssertNil(try dec.decode(WatchSettings.self, from: Data("{}".utf8)).setMenu)
    }

    func testNewFieldsDecode() throws {
        let r = try dec.decode(SetRow.self, from: Data(#"{"w":60,"r":8,"done":false,"warmup":false,"failure":true,"drop":50,"drops":2,"rp":true}"#.utf8))
        XCTAssertEqual(r.failure, true); XCTAssertEqual(r.drop, 50); XCTAssertEqual(r.drops, 2); XCTAssertEqual(r.rp, true)
        XCTAssertEqual(try dec.decode(WatchSettings.self, from: Data(#"{"setMenu":true}"#.utf8)).setMenu, true)
    }

    func testWorkSetOffersAllThree() {
        let o = SetMenu.offer(entry([row(), row()]), set: 0)
        XCTAssertEqual(o, MenuOffer(warmup: .off, failure: .off, drop: .off, dropWeight: nil, canAdd: true, canRemove: true))
    }

    func testWarmupLocksFailureAndDrop() {
        let o = SetMenu.offer(entry([row(warmup: true), row()]), set: 0)
        XCTAssertEqual(o.warmup, .on); XCTAssertEqual(o.failure, .locked); XCTAssertEqual(o.drop, .locked)
    }

    func testLastWorkSetCannotBecomeWarmup() {
        XCTAssertEqual(SetMenu.offer(entry([row(warmup: true), row()]), set: 1).warmup, .locked)
        XCTAssertEqual(SetMenu.offer(entry([row()]), set: 0).warmup, .locked)
    }

    func testDropSetAndRestPauseCannotBecomeWarmup() {
        var d = row(); d.drop = 50
        let od = SetMenu.offer(entry([d, row()]), set: 0)
        XCTAssertEqual(od.warmup, .locked); XCTAssertEqual(od.drop, .on); XCTAssertEqual(od.dropWeight, 50)
        var p = row(); p.rp = true
        let op = SetMenu.offer(entry([p, row()]), set: 0)
        XCTAssertEqual(op.warmup, .locked); XCTAssertEqual(op.drop, .hidden)
    }

    func testDoneSetHasNoWarmupSwitch() {
        XCTAssertEqual(SetMenu.offer(entry([row(done: true), row()]), set: 0).warmup, .locked)
    }

    func testTwoDropsLockTheDropDisc() {
        var d = row(); d.drop = 50; d.drops = 2
        let o = SetMenu.offer(entry([d, row()]), set: 0)
        XCTAssertEqual(o.drop, .locked); XCTAssertEqual(o.dropWeight, 50)
    }

    func testFailureMarkShowsOn() {
        var f = row(); f.failure = true
        XCTAssertEqual(SetMenu.offer(entry([f, row()]), set: 0).failure, .on)
    }

    func testTimedHasNoDropCardioOnlyNothing() {
        let t = SetMenu.offer(entry([row(), row()], mode: "time"), set: 0)
        XCTAssertEqual(t.drop, .hidden); XCTAssertEqual(t.warmup, .hidden); XCTAssertEqual(t.failure, .off); XCTAssertTrue(t.canAdd)
        let c = SetMenu.offer(entry([row(), row()], mode: "cardio"), set: 0)
        XCTAssertEqual(c.failure, .hidden); XCTAssertEqual(c.drop, .hidden); XCTAssertEqual(c.warmup, .hidden); XCTAssertFalse(c.canAdd)
    }

    func testOnlySetCannotBeRemoved() {
        XCTAssertFalse(SetMenu.offer(entry([row()]), set: 0).canRemove)
    }

    func testMenuNeedsThePhonesFlag() {
        var s = SessionState()
        XCTAssertFalse(SetMenu.available(s))
        s.settings.setMenu = true
        XCTAssertTrue(SetMenu.available(s))
        s.settings.setMenu = false
        XCTAssertFalse(SetMenu.available(s))
    }
}
