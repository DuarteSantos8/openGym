import XCTest
@testable import WatchCore

/// Every routine reaches the watch as a file; the snapshot names the file it goes with.
final class RoutinesFileTests: XCTestCase {
    func session(_ id: String, _ folder: String? = nil) -> ReadySession {
        ReadySession(routineIds: [id], name: id, entries: [], folder: folder)
    }
    func file(_ h: String, _ n: Int) -> RoutinesFile {
        RoutinesFile(h: h, others: (0..<n).map { session("f\($0)", $0 > 1 ? "Legs" : nil) })
    }

    func testTheFileReadsAsThePhoneWritesIt() throws {
        let json = #"{"h":"abc.12","others":[{"routineIds":["r1"],"name":"Push","entries":[],"folder":"Legs"},{"routineIds":["r2"],"name":"Pull","entries":[]}]}"#
        let f = try JSONDecoder().decode(RoutinesFile.self, from: Data(json.utf8))
        XCTAssertEqual(f.h, "abc.12")
        XCTAssertEqual(f.others.map(\.folder), ["Legs", nil], "the folders come with the file")
    }

    func testTheSnapshotNamesTheFile() throws {
        let json = #"{"v":1,"routinesHash":"abc.12","ready":null,"active":null}"#
        XCTAssertEqual(try JSONDecoder().decode(Snapshot.self, from: Data(json.utf8)).routinesHash, "abc.12")
        let old = #"{"v":1,"ready":null,"active":null}"#
        XCTAssertNil(try JSONDecoder().decode(Snapshot.self, from: Data(old.utf8)).routinesHash, "an older phone names none")
    }

    func testAFileThatMatchesTheSnapshotsHashReplacesItsShortList() {
        let ready = Ready(today: session("t"), others: [session("s0")])
        let r = Plan.merged(ready, hash: "h1", file: file("h1", 30))
        XCTAssertEqual(r?.others.count, 30)
        XCTAssertEqual(r?.today?.routineIds, ["t"], "today's session stays the snapshot's")
    }

    func testWithoutAMatchingFileTheSnapshotsListStands() {
        let ready = Ready(today: nil, others: [session("s0"), session("s1")])
        XCTAssertEqual(Plan.merged(ready, hash: "h2", file: file("h1", 30)), ready, "an old file: the phone has sent a newer one")
        XCTAssertEqual(Plan.merged(ready, hash: "h1", file: nil), ready, "first launch, the file still on its way")
        XCTAssertEqual(Plan.merged(ready, hash: nil, file: file("h1", 30)), ready, "an older phone names no file")
        XCTAssertNil(Plan.merged(nil, hash: "h1", file: file("h1", 3)), "nothing ready, nothing to show")
    }

    func testTheSnapshotsHashIsKeptWithTheState() {
        var snap = Snapshot(v: 1, unit: "kg", restSec: 90, active: nil, ready: nil, settings: nil)
        snap.routinesHash = "h1"
        XCTAssertEqual(SessionCore.applySnapshot(SessionState(), snap).routinesHash, "h1")
        snap.routinesHash = nil
        XCTAssertNil(SessionCore.applySnapshot(SessionState(), snap).routinesHash)
    }
}
