import SwiftUI

// openGym on the Apple Watch: the set to do next and the rest between sets, from the iPhone app.
// The log stays on the phone; see PhoneLink.swift and docs/MOBILE.md ("Apple Watch").
@main
struct OpenGymWatchApp: App {
    @StateObject private var link = PhoneLink.shared
    @Environment(\.scenePhase) private var phase

    init() {
        PhoneLink.shared.start()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(link)
        }
        .onChange(of: phase) { p in
            if p == .active { link.hello() }
        }
    }
}
