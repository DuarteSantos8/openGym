import XCTest
@testable import WatchCore

/// The Overview's "Add note": the running workout's own note, said to the phone as `workoutNote`.
final class WorkoutNoteTests: XCTestCase {
    func state(note: String? = nil, flag: Bool? = true) -> SessionState {
        var s = SessionState()
        s.workout = ActiveWorkout(id: "w1", name: "Push", unit: "kg", cur: 0, restSec: 90, rest: nil, entries: [], note: note)
        s.settings.workoutNote = flag
        return s
    }

    func testSaysTheNoteToThePhoneWithWhatItSawAndShowsItAtOnce() throws {
        let (s, ev) = try XCTUnwrap(SessionCore.workoutNote(state(note: "old"), "  Left shoulder\u{7}tight ", at: 5, id: "n1"))
        XCTAssertEqual(ev["type"] as? String, "workoutNote")
        XCTAssertEqual(ev["wid"] as? String, "w1")
        XCTAssertEqual(ev["note"] as? String, "Left shoulder tight")
        XCTAssertEqual(ev["was"] as? String, "old")
        XCTAssertEqual(ev["at"] as? Double, 5)
        XCTAssertEqual(SessionCore.shownNote(s), "Left shoulder tight", "before the phone has heard")
    }

    func testAnEmptiedNoteClearsItAndNothingChangedSendsNothing() throws {
        let (s, ev) = try XCTUnwrap(SessionCore.workoutNote(state(note: "old"), "   ", at: 1, id: "n1"))
        XCTAssertEqual(ev["note"] as? String, "")
        XCTAssertEqual(SessionCore.shownNote(s), "")
        XCTAssertNil(SessionCore.workoutNote(state(note: "same"), " same ", at: 1, id: "n2"))
        XCTAssertNil(SessionCore.workoutNote(state(), "", at: 1, id: "n3"))
    }

    func testCutsAtTheWatchLimit() throws {
        let (_, ev) = try XCTUnwrap(SessionCore.workoutNote(state(), String(repeating: "x", count: 400), at: 1, id: "n1"))
        XCTAssertEqual((ev["note"] as? String)?.count, SessionCore.noteMax)
    }

    func testNoButtonWithoutTheFlagOrAWorkout() {
        XCTAssertTrue(SessionCore.canNote(state()))
        XCTAssertFalse(SessionCore.canNote(state(flag: nil)), "an older phone never says so")
        XCTAssertFalse(SessionCore.canNote(state(flag: false)))
        XCTAssertFalse(SessionCore.canNote(SessionState()))
        XCTAssertNil(SessionCore.workoutNote(state(flag: nil), "x", at: 1, id: "n"))
    }

    func testASecondEditBeforeTheAckSaysTheFirstAsWhatItSaw() throws {
        let (s1, _) = try XCTUnwrap(SessionCore.workoutNote(state(note: "a"), "b", at: 1, id: "n1"))
        let (_, ev2) = try XCTUnwrap(SessionCore.workoutNote(s1, "c", at: 2, id: "n2"))
        XCTAssertEqual(ev2["was"] as? String, "b", "the phone applies them in order")
    }

    func snap(_ w: ActiveWorkout?, acked: [String]? = nil) -> Snapshot {
        var sn = Snapshot(v: 1, unit: "kg", restSec: 90, active: w, ready: nil, settings: nil)
        sn.acked = acked
        return sn
    }
    func active(_ id: String, note: String?) -> ActiveWorkout {
        ActiveWorkout(id: id, name: "Push", unit: "kg", cur: 0, restSec: 90, rest: nil, entries: [], note: note)
    }

    func testTheEditStaysUntilThePhoneAcksThenThePhonesNoteIsShown() throws {
        var (s, _) = try XCTUnwrap(SessionCore.workoutNote(state(note: "old"), "mine", at: 1, id: "n1"))
        s = SessionCore.applySnapshot(s, snap(active("w1", note: "old")))
        XCTAssertEqual(SessionCore.shownNote(s), "mine", "an older snapshot cannot flash it away")
        s = SessionCore.applySnapshot(s, snap(active("w1", note: "mine"), acked: ["n1"]))
        XCTAssertEqual(SessionCore.shownNote(s), "mine")
        XCTAssertNil(s.noteDraft)
    }

    func testThePhoneWinningAClashShowsItsOwnText() throws {
        var (s, _) = try XCTUnwrap(SessionCore.workoutNote(state(note: "old"), "mine", at: 1, id: "n1"))
        s = SessionCore.applySnapshot(s, snap(active("w1", note: "typed on the phone"), acked: ["n1"]))
        XCTAssertEqual(SessionCore.shownNote(s), "typed on the phone")
    }

    func testAnotherWorkoutOrNoWorkoutDropsTheEdit() throws {
        var (s, _) = try XCTUnwrap(SessionCore.workoutNote(state(), "mine", at: 1, id: "n1"))
        let other = SessionCore.applySnapshot(s, snap(active("w2", note: nil)))
        XCTAssertEqual(SessionCore.shownNote(other), "")
        s = SessionCore.applySnapshot(s, snap(nil))
        XCTAssertNil(s.noteDraft)
    }

    func testTheSnapshotCarriesTheNoteAndTheFlag() throws {
        let json = #"{"v":1,"active":{"id":"w1","name":"Push","unit":"kg","cur":0,"restSec":90,"entries":[],"note":"tight"},"settings":{"workoutNote":true}}"#
        let sn = try JSONDecoder().decode(Snapshot.self, from: Data(json.utf8))
        XCTAssertEqual(sn.active?.note, "tight")
        XCTAssertEqual(sn.settings?.workoutNote, true)
    }
}
