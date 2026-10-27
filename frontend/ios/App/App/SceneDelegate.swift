import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    // The window and root view controller are created automatically from
    // Main.storyboard via the UISceneStoryboardFile key in Info.plist.
    // These callbacks just forward deep links / Universal Links to Capacitor,
    // since AppDelegate's equivalents are not called under the scene lifecycle.

    // A link that started the app (a tap on a widget while openGym was closed) arrives here, not
    // in openURLContexts: handed on the same way, Capacitor keeps it as the launch URL the page
    // asks for (lib/widget-links.js, App.getLaunchUrl).
    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        if let url = connectionOptions.urlContexts.first?.url {
            _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: url, options: [:])
        }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        guard let url = URLContexts.first?.url else { return }
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: url, options: [:])
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, continue: userActivity) { _ in }
    }
}
