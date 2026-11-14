// swift-tools-version:5.9
// The watch app's logic that has no UI: the session as the watch keeps it, how it is reconciled
// with the phone's snapshots, and the animation codec. Compiled straight into the watch app (and
// the codec into the iPhone app) by ios/ci/add-watch-app.rb; this package exists so CI can test it
// with `swift test` on the Mac, no simulator needed.
import PackageDescription

let package = Package(
    name: "WatchCore",
    platforms: [.macOS(.v13), .watchOS(.v10), .iOS(.v15)],
    products: [.library(name: "WatchCore", targets: ["WatchCore"])],
    targets: [
        .target(name: "WatchCore"),
        .testTarget(name: "WatchCoreTests", dependencies: ["WatchCore"], resources: [.copy("Fixtures")]),
    ]
)
