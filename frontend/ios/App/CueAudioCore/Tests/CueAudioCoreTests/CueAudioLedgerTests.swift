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
                XCTAssertTrue(s.duckOthers)
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
}
