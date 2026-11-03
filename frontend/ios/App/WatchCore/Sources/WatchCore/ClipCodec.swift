// ImageIO only exists on Apple platforms; the session logic is also tested on Linux.
#if canImport(ImageIO)
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

/*
 * Exercise animations for the watch, both ends (ImageIO only, so it builds on iOS, watchOS and the
 * Mac that tests it):
 *
 *   phone  makeGif: the app's own clip (animated WebP, or a GIF) into a small looping GIF, frame by
 *          frame with each frame's own delay, scaled to `maxPixels`. The MP4 clips of other builds
 *          go through AVFoundation in WatchBridgePlugin and come out the same way.
 *   watch  decode: that GIF back into frames and their total duration, to cycle on screen.
 *
 * Never a source of media itself: it converts what the phone already has for the running workout.
 */
enum ClipCodec {
    struct Frames {
        let images: [CGImage]
        let delays: [Double]
        var duration: Double { delays.reduce(0, +) }
    }

    static let minDelay = 0.02
    static let fallbackDelay = 0.1

    private static func delay(_ props: [String: Any]?) -> Double {
        let webp = props?[kCGImagePropertyWebPDictionary as String] as? [String: Any]
        let gif = props?[kCGImagePropertyGIFDictionary as String] as? [String: Any]
        let d = (webp?[kCGImagePropertyWebPUnclampedDelayTime as String] as? Double)
            ?? (webp?[kCGImagePropertyWebPDelayTime as String] as? Double)
            ?? (gif?[kCGImagePropertyGIFUnclampedDelayTime as String] as? Double)
            ?? (gif?[kCGImagePropertyGIFDelayTime as String] as? Double)
            ?? fallbackDelay
        return d >= minDelay ? d : fallbackDelay
    }

    /// Frames and delays of an animated (or still) image file, each scaled to `maxPixels` at most.
    static func decode(_ url: URL, maxPixels: Int? = nil) -> Frames? {
        guard let src = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
        return decode(src, maxPixels: maxPixels)
    }

    /// The same from bytes in memory (a file of a downloaded animation pack, read by the phone).
    static func decode(data: Data, maxPixels: Int? = nil) -> Frames? {
        guard let src = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        return decode(src, maxPixels: maxPixels)
    }

    private static func decode(_ src: CGImageSource, maxPixels: Int?) -> Frames? {
        let count = CGImageSourceGetCount(src)
        guard count > 0 else { return nil }
        var images: [CGImage] = []
        var delays: [Double] = []
        let thumb: CFDictionary? = maxPixels.map {
            [kCGImageSourceCreateThumbnailFromImageAlways as String: true,
             kCGImageSourceThumbnailMaxPixelSize as String: $0,
             kCGImageSourceCreateThumbnailWithTransform as String: true] as CFDictionary
        }
        for i in 0..<count {
            let img = thumb != nil ? CGImageSourceCreateThumbnailAtIndex(src, i, thumb) : CGImageSourceCreateImageAtIndex(src, i, nil)
            guard let image = img else { continue }
            images.append(image)
            delays.append(delay(CGImageSourceCopyPropertiesAtIndex(src, i, nil) as? [String: Any]))
        }
        return images.isEmpty ? nil : Frames(images: images, delays: delays)
    }

    /// Writes `frames` as a looping GIF. False when nothing could be written.
    static func writeGif(_ frames: Frames, to out: URL) -> Bool {
        guard let dest = CGImageDestinationCreateWithURL(out as CFURL, UTType.gif.identifier as CFString, frames.images.count, nil) else { return false }
        CGImageDestinationSetProperties(dest, [kCGImagePropertyGIFDictionary as String: [kCGImagePropertyGIFLoopCount as String: 0]] as CFDictionary)
        for (img, d) in zip(frames.images, frames.delays) {
            CGImageDestinationAddImage(dest, img, [kCGImagePropertyGIFDictionary as String: [kCGImagePropertyGIFDelayTime as String: d]] as CFDictionary)
        }
        return CGImageDestinationFinalize(dest)
    }

    /// The phone's conversion: an animated WebP or GIF into a small looping GIF.
    static func makeGif(from source: URL, to out: URL, maxPixels: Int = 160) -> Bool {
        write(decode(source, maxPixels: maxPixels), to: out)
    }

    static func makeGif(data: Data, to out: URL, maxPixels: Int = 160) -> Bool {
        write(decode(data: data, maxPixels: maxPixels), to: out)
    }

    private static func write(_ frames: Frames?, to out: URL) -> Bool {
        guard let frames = frames else { return false }
        if writeGif(frames, to: out) { return true }
        try? FileManager.default.removeItem(at: out)
        return false
    }
}
#endif
