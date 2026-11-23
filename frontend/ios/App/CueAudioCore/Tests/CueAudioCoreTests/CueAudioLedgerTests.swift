import XCTest
@testable import CueAudioCore

/// The alert settings matrix from REDDIT-146 ("it stops Spotify"): every combination mixes, the
/// session is let go once the last sound ended, whatever the order, and a lost ending never
/// leaves the music ducked.
final class CueAudioLedgerTests: XCTestCase {
    private func activated(_ step: CueSessionStep) -> CueSessionShape? {
        if case .activate(let s) = step { return s }
        return nil
    }

    private func isDeactivate(_ step: CueSessionStep) -> Bool {
        if case .deactivate = step { return true }
        return false
    }

    func testEveryShapeMixes() {
        for onSilent in [false, true] {
            for speechOnly in [false, true] {
                let s = CueSessionShape.sounding(onSilent: onSilent, speechOnly: speechOnly)
                XCTAssertTrue(s.mixes, "onSilent \(onSilent) speech \(speechOnly)")
                // Ducking only where iOS allows it: .playback.
                XCTAssertEqual(s.duckOthers, onSilent)
                XCTAssertEqual(s.category, onSilent ? .playback : .ambient)
            }
        }
        XCTAssertTrue(CueSessionShape.resting.mixes)
        XCTAssertFalse(CueSessionShape.resting.duckOthers)
    }

    func testToneActivatesThenLetsGo() {
        var l = CueAudioLedger()
        let (id, step) = l.begin(.tone, onSilent: false)
        let shape = activated(step)
        XCTAssertEqual(shape, CueSessionShape.sounding(onSilent: false, speechOnly: false))
        l.didActivate(shape!)
        XCTAssertTrue(isDeactivate(l.end(id)))
        XCTAssertEqual(l.end(id), .none, "a second end of the same tone does nothing")
    }

    func testOverlapEndsInEitherOrder() {
        for toneFirst in [true, false] {
            var l = CueAudioLedger()
            let tone = l.begin(.tone, onSilent: false)
            l.didActivate(activated(tone.step)!)
            let line = l.begin(.speech, onSilent: false)
            XCTAssertEqual(line.step, .none, "the same shape is already active")
            let first = toneFirst ? tone.id : line.id
            let second = toneFirst ? line.id : tone.id
            XCTAssertEqual(l.end(first), .none, "the other sound still plays")
            XCTAssertTrue(isDeactivate(l.end(second)))
        }
    }

    func testOnSilentWinsWhileAnySoundWantsIt() {
        var l = CueAudioLedger()
        let quiet = l.begin(.tone, onSilent: false)
        l.didActivate(activated(quiet.step)!)
        let loud = l.begin(.speech, onSilent: true)
        let shape = activated(loud.step)
        XCTAssertEqual(shape?.category, .playback)
        XCTAssertEqual(shape?.mode, .standard, "a tone is playing too, so not the voice-prompt mode")
        l.didActivate(shape!)
        let again = l.begin(.tone, onSilent: false)
        XCTAssertEqual(again.step, .none, "a quieter sound never steps the session back mid-cue")
    }

    func testSpeechOnlyUsesVoicePrompt() {
        var l = CueAudioLedger()
        let line = l.begin(.speech, onSilent: true)
        XCTAssertEqual(activated(line.step)?.mode, .voicePrompt)
    }

    func testHushEndsOnlySpeech() {
        var l = CueAudioLedger()
        let tone = l.begin(.tone, onSilent: false)
        l.didActivate(activated(tone.step)!)
        _ = l.begin(.speech, onSilent: false)
        _ = l.begin(.speech, onSilent: false)
        XCTAssertEqual(l.endAll(.speech), .none, "the tone still plays")
        XCTAssertEqual(l.count, 1)
        XCTAssertTrue(isDeactivate(l.end(tone.id)))
    }

    func testEndAllWithNothingOpen() {
        var l = CueAudioLedger()
        XCTAssertEqual(l.endAll(), .none)
    }

    func testReactivatesAfterTheSystemTookTheSession() {
        var l = CueAudioLedger()
        let a = l.begin(.tone, onSilent: false)
        l.didActivate(activated(a.step)!)
        l.didDeactivate()
        let b = l.begin(.tone, onSilent: false)
        XCTAssertNotNil(activated(b.step), "inactive now, so the next sound activates again")
    }

    func testResetForgetsEverything() {
        var l = CueAudioLedger()
        let a = l.begin(.speech, onSilent: true)
        l.didActivate(activated(a.step)!)
        l.reset()
        XCTAssertTrue(l.isIdle)
        XCTAssertNil(l.activeShape)
        XCTAssertFalse(l.holdsSession)
        XCTAssertEqual(l.end(a.id), .none)
    }

    func testRetriesEndAndSpeechCapIsBounded() {
        XCTAssertEqual(CueAudioLedger.retryDelay(attempt: 0), 0.3)
        XCTAssertNil(CueAudioLedger.retryDelay(attempt: 4))
        XCTAssertNil(CueAudioLedger.retryDelay(attempt: -1))
        XCTAssertEqual(CueAudioLedger.speechCap(text: "", rate: 1), 3)
        XCTAssertEqual(CueAudioLedger.speechCap(text: String(repeating: "a", count: 5000), rate: 1), 60)
        XCTAssertGreaterThan(CueAudioLedger.speechCap(text: String(repeating: "a", count: 120), rate: 0.5), CueAudioLedger.speechCap(text: String(repeating: "a", count: 120), rate: 2))
        XCTAssertEqual(CueAudioLedger.speechCap(text: "", rate: .nan), 3)
    }

    /// A refused activation leaves nothing active (RestAlertPlugin's catch calls didFailActivation):
    /// the tone may still start the session when it plays, so its end lets the session go, and
    /// the next cue of the same shape, ambient or through the switch, tries the activation again.
    func testRefusedActivationIsTriedAgain() {
        for onSilent in [false, true] {
            var ledger = CueAudioLedger()
            let (first, step) = ledger.begin(.tone, onSilent: onSilent)
            guard case .activate = step else { return XCTFail("first cue activates") }
            ledger.didFailActivation()  // setActive(true) threw
            XCTAssertNil(ledger.activeShape)
            guard case .deactivate = ledger.end(first) else { return XCTFail("onSilent \(onSilent): let go") }
            ledger.didDeactivate()
            let (_, again) = ledger.begin(.tone, onSilent: onSilent)
            guard case .activate(let shape) = again else { return XCTFail("onSilent \(onSilent): tried again") }
            XCTAssertEqual(shape, CueSessionShape.sounding(onSilent: onSilent, speechOnly: false))
        }
    }

    /// A shape set again over .soloAmbient that is refused also leaves nothing active, and the
    /// session is still let go.
    func testReappliedShapeRefusedIsTriedAgain() {
        var l = CueAudioLedger()
        let first = l.begin(.tone, onSilent: true)
        l.didActivate(activated(first.step)!)
        l.didFailActivation()  // reapplied, setActive(true) threw
        XCTAssertTrue(l.holdsSession)
        let again = l.begin(.tone, onSilent: true)
        XCTAssertNotNil(activated(again.step), "tried again")
        _ = l.end(first.id)
        XCTAssertTrue(isDeactivate(l.end(again.id)))
    }

    /// Hushing the spoken lines after their activation was refused still lets the session go.
    func testHushAfterRefusedActivationLetsGo() {
        var l = CueAudioLedger()
        let line = l.begin(.speech, onSilent: true)
        XCTAssertNotNil(activated(line.step))
        l.didFailActivation()
        XCTAssertTrue(isDeactivate(l.endAll(.speech)))
    }

    /// A session already active when a new activation is refused (a spoken line, then a tone)
    /// is still let go once nothing sounds, so the music comes back up.
    func testRefusedActivationStillLetsGo() {
        var ledger = CueAudioLedger()
        let (line, step) = ledger.begin(.speech, onSilent: true)
        guard case .activate(let shape) = step else { return XCTFail("activates") }
        ledger.didActivate(shape)
        let (tone, next) = ledger.begin(.tone, onSilent: true)
        if case .activate = next { ledger.didFailActivation() }
        XCTAssertTrue(ledger.holdsSession)
        _ = ledger.end(line)
        guard case .deactivate = ledger.end(tone) else { return XCTFail("let go") }
        ledger.didDeactivate()
        XCTAssertFalse(ledger.holdsSession)
    }
}
