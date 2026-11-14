// swift-tools-version:5.9
// The gym reminder's no-nag rule (#614): plain Foundation, compiled straight into the iPhone app
// (App.xcodeproj references Sources/GymReminderCore/GymReminderRules.swift); this package exists
// so CI can test it with `swift test` on the Mac, no simulator needed.
import PackageDescription

let package = Package(
    name: "GymReminderCore",
    platforms: [.macOS(.v13), .iOS(.v15)],
    products: [.library(name: "GymReminderCore", targets: ["GymReminderCore"])],
    targets: [
        .target(name: "GymReminderCore"),
        .testTarget(name: "GymReminderCoreTests", dependencies: ["GymReminderCore"]),
    ]
)
