// ImageIO only exists on Apple platforms; the session logic is also tested on Linux.
#if canImport(ImageIO)
import XCTest
@testable import WatchCore

/// The animation path, end to end, on a synthetic clip (Fixtures/synthetic-square.webp: a green
/// square moving across black, made with ffmpeg for this test; no exercise media anywhere):
/// the phone's WebP → GIF conversion, then the watch's decoding of that GIF.
final class ClipCodecTests: XCTestCase {
    func fixture() throws -> URL {
        try XCTUnwrap(Bundle.module.url(forResource: "synthetic-square", withExtension: "webp", subdirectory: "Fixtures"))
    }

    func testTheAnimatedWebPDecodesWithItsFramesAndDelays() throws {
        let frames = try XCTUnwrap(ClipCodec.decode(try fixture()))
        XCTAssertGreaterThan(frames.images.count, 5, "every frame of the animation")
        XCTAssertEqual(frames.images.count, frames.delays.count)
        XCTAssertEqual(frames.duration, 1.2, accuracy: 0.25)
        XCTAssertNotEqual(frames.images.first?.dataProvider?.data as Data?, frames.images.last?.dataProvider?.data as Data?, "it moves")
    }

    func testThePhoneMakesASmallLoopingGifTheWatchReadsBack() throws {
        let out = FileManager.default.temporaryDirectory.appendingPathComponent("clip-\(UUID().uuidString).gif")
        defer { try? FileManager.default.removeItem(at: out) }
        XCTAssertTrue(ClipCodec.makeGif(from: try fixture(), to: out, maxPixels: 120))
        let back = try XCTUnwrap(ClipCodec.decode(out))
        let source = try XCTUnwrap(ClipCodec.decode(try fixture()))
        XCTAssertEqual(back.images.count, source.images.count)
        XCTAssertLessThanOrEqual(back.images[0].width, 120)
        XCTAssertEqual(back.duration, source.duration, accuracy: 0.1)
    }

    func testFromBytesInMemoryAsAPackFileIsRead() throws {
        let data = try Data(contentsOf: try fixture())
        let out = FileManager.default.temporaryDirectory.appendingPathComponent("clip-\(UUID().uuidString).gif")
        defer { try? FileManager.default.removeItem(at: out) }
        XCTAssertTrue(ClipCodec.makeGif(data: data, to: out))
        XCTAssertGreaterThan(try XCTUnwrap(ClipCodec.decode(out)).images.count, 5)
    }

    /// What the watch gets (and what CI's watch screenshots show): Fixtures/synthetic-square.gif,
    /// the same moving square as a GIF, as the phone sends it.
    func testTheWatchReadsAGifAsThePhoneSendsIt() throws {
        let gif = try XCTUnwrap(Bundle.module.url(forResource: "synthetic-square", withExtension: "gif", subdirectory: "Fixtures"))
        let frames = try XCTUnwrap(ClipCodec.decode(gif))
        XCTAssertEqual(frames.images.count, 12)
        XCTAssertEqual(frames.duration, 1.2, accuracy: 0.25)
    }

    func testSomethingThatIsNotAnImageGivesNothing() throws {
        let junk = FileManager.default.temporaryDirectory.appendingPathComponent("junk-\(UUID().uuidString).webp")
        try Data("not an image".utf8).write(to: junk)
        defer { try? FileManager.default.removeItem(at: junk) }
        XCTAssertNil(ClipCodec.decode(junk))
        XCTAssertFalse(ClipCodec.makeGif(from: junk, to: junk.appendingPathExtension("gif")))
    }
}
#endif
