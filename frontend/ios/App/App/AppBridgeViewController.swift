import Capacitor

@objc(AppBridgeViewController)
class AppBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        // App-local plugins need explicit registration with Capacitor 7.
        bridge?.registerPluginInstance(PrintPlugin())
        bridge?.registerPluginInstance(HealthSyncPlugin())
        bridge?.registerPluginInstance(WatchBridgePlugin())
    }
}
