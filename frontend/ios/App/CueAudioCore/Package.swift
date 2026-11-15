// swift-tools-version:5.9
// When the rest alerts hold the iPhone's audio session and when they give it back (Reddit: "it
// stops Spotify"): plain Foundation, compiled straight into the iPhone app (App.xcodeproj
// references Sources/CueAudioCore/CueAudioLedger.swift); this package lets CI run `swift test`.
import PackageDescription

let package = Package(
    name: "CueAudioCore",
    platforms: [.macOS(.v13), .iOS(.v15)],
    products: [.library(name: "CueAudioCore", targets: ["CueAudioCore"])],
    targets: [
        .target(name: "CueAudioCore"),
        .testTarget(name: "CueAudioCoreTests", dependencies: ["CueAudioCore"]),
    ]
)
