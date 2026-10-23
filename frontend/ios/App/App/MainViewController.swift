import Capacitor
import UIKit
import UserNotifications
import WebKit

/**
 * The app's own bridge view controller (Main.storyboard). Since Capacitor 6 the bridge only loads
 * the plugins that come from npm packages (packageClassList in capacitor.config.json); plugins
 * that live in the app itself are registered here, or the page finds none of them.
 */
class MainViewController: CAPBridgeViewController {
    /// The downloaded animation packs, read through Background Assets (AnimationPacksPlugin.swift).
    private let packFiles = AnimationPackSchemeHandler()

    override open func webViewConfiguration(for instanceConfiguration: InstanceConfiguration) -> WKWebViewConfiguration {
        let config = super.webViewConfiguration(for: instanceConfiguration)
        config.setURLSchemeHandler(packFiles, forURLScheme: AnimationPackSchemeHandler.scheme)
        return config
    }

    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(PrintPlugin())
        bridge?.registerPluginInstance(RestAlertPlugin())
        bridge?.registerPluginInstance(DeviceAuthPlugin())
        bridge?.registerPluginInstance(AnimationPacksPlugin())
        bridge?.registerPluginInstance(NudgeCheckPlugin())
        bridge?.registerPluginInstance(WatchBridgePlugin())
        bridge?.registerPluginInstance(AppleHealthPlugin())
        bridge?.registerPluginInstance(WidgetBridgePlugin())
        bridge?.registerPluginInstance(LiveActivityPlugin())
        WidgetPreview.runIfAsked()
        // After loadView has finished: the view is the web view only once it has.
        if ProcessInfo.processInfo.arguments.contains(MainViewController.pendingProbeArgument) {
            DispatchQueue.main.async { [weak self] in self?.showPendingProbe() }
        }
    }

    /**
     * For the UI tests only (ios/App/AppUITests): launched with this argument, the app shows the
     * ids of the local notifications iOS holds for it, as a tiny label a test can read. A UI test
     * runs in its own process and cannot ask UNUserNotificationCenter about another app, and this
     * is what iOS really has pending, not what the page meant to schedule. Never shown otherwise:
     * nothing but XCUIApplication.launchArguments passes the argument.
     */
    static let pendingProbeArgument = "-OpenGymUITestPending"

    private func showPendingProbe() {
        // On the window, not inside the web view: what a WKWebView holds is its page as far as
        // accessibility goes, and a label among its subviews may never reach the test.
        guard let host = view.window else {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in self?.showPendingProbe() }
            return
        }
        let label = UILabel()
        label.accessibilityIdentifier = "og-pending-notifications"
        label.font = .systemFont(ofSize: 8)
        label.textColor = .systemGray
        label.numberOfLines = 1
        label.isUserInteractionEnabled = false
        label.text = "pending:"
        label.translatesAutoresizingMaskIntoConstraints = false
        host.addSubview(label)
        NSLayoutConstraint.activate([
            label.leadingAnchor.constraint(equalTo: host.leadingAnchor, constant: 2),
            label.bottomAnchor.constraint(equalTo: host.bottomAnchor, constant: -2),
        ])
        Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak label] _ in
            UNUserNotificationCenter.current().getPendingNotificationRequests { requests in
                let ids = requests.map { $0.identifier }.sorted().joined(separator: ",")
                DispatchQueue.main.async {
                    guard let label = label else { return }
                    label.text = "pending:" + ids
                    label.accessibilityLabel = "pending:" + ids
                    label.superview?.bringSubviewToFront(label)
                }
            }
        }
    }
}
