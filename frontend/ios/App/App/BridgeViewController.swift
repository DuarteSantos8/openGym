import Foundation
import Capacitor

/**
 * The storyboard's view controller. Capacitor registers the plugins listed in the generated
 * capacitor.config.json (packageClassList) on its own, but `cap sync` builds that list from the
 * npm packages only: a plugin that lives in this folder, like PrintPlugin, HealthKitPlugin or WatchLinkPlugin, never appears in it and
 * the CAP_PLUGIN macro in its .m file declares the bridge without registering anything. Local
 * plugins are registered here instead, which Capacitor calls before the web view loads.
 */
class BridgeViewController: CAPBridgeViewController {

    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(PrintPlugin())
        bridge?.registerPluginInstance(HealthKitPlugin())
        bridge?.registerPluginInstance(WatchLinkPlugin())
    }
}
