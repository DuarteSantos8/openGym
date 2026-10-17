package ch.duartesantos.opengym;

/**
 * Google Play installs the updates itself: no updater in this build. The watch link is here: its
 * Wearable Data Layer is a part of Play services, which the sideloaded APK does not carry.
 */
final class FlavorPlugins {
    private FlavorPlugins() {}

    static void register(MainActivity activity) {
        activity.registerFlavorPlugin(WearBridgePlugin.class);
    }
}
