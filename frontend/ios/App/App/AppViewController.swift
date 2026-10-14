import UIKit
import Capacitor

/**
 * The app's bridge view controller (Main.storyboard). Capacitor registers on its own only the
 * plugins in the list `cap sync` generates from npm packages; a plugin that lives in this app
 * target is registered here.
 */
class AppViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(HealthKitPlugin())
    }
}
