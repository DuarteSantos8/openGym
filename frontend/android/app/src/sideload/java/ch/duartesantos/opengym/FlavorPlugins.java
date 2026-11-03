package ch.duartesantos.opengym;


/** The APK from GitHub and opengym.ch installs its own updates (InstallPlugin). */
final class FlavorPlugins {
    private FlavorPlugins() {}

    static void register(MainActivity activity) {
        activity.registerFlavorPlugin(InstallPlugin.class);
    }
}
