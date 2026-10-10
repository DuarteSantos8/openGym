import UIKit
import Capacitor

// The plugins that live in this app rather than in an npm package. Capacitor registers only the
// classes `cap sync` lists in capacitor.config.json (packageClassList), which are the npm plugins,
// so these are registered by hand once the bridge is up — as MainActivity does on Android.
// Main.storyboard names this class as its view controller.
class OpenGymViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(PrintPlugin())
        bridge?.registerPluginInstance(AppleHealthPlugin())
    }
}
