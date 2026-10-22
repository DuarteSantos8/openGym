import SwiftUI

/// The build this watch app came from (CFBundleVersion, stamped by the install script), shown in a
/// corner so a phone and a watch can be checked against each other after an update.
struct BuildStamp: View {
    private static let version: String = {
        let info = Bundle.main.infoDictionary ?? [:]
        let short = info["CFBundleShortVersionString"] as? String ?? "?"
        let build = info["CFBundleVersion"] as? String ?? "?"
        return "\(short) (\(build))"
    }()

    var body: some View {
        Text(Self.version)
            .font(.system(size: 9))
            .foregroundStyle(.tertiary)
    }
}
