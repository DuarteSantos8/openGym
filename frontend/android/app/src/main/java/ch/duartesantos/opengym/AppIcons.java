package ch.duartesantos.opengym;

/**
 * The home-screen icons and the launcher entry each one is (AppIconPlugin). Every icon is an
 * activity-alias of MainActivity in AndroidManifest.xml with the MAIN/LAUNCHER filter, and exactly
 * one of them is enabled; the ids and alias names are the ones in src/lib/app-icon-variants.js,
 * which scripts/app-icons.mjs draws the mipmaps from. Plain Java, so the JVM tests can reach it.
 */
final class AppIcons {
    private AppIcons() {}

    static final String[] IDS = {"default", "light", "mono", "neon", "sky", "orange", "pink", "violet", "halloween", "christmas"};
    static final String[] ALIASES = {"IconDefault", "IconLight", "IconMono", "IconNeon", "IconSky", "IconOrange", "IconPink", "IconViolet", "IconHalloween", "IconChristmas"};

    /** The alias for an icon id, or null for an id this build does not have. */
    static String aliasFor(String id) {
        for (int i = 0; i < IDS.length; i++) if (IDS[i].equals(id)) return ALIASES[i];
        return null;
    }

    /**
     * The icon in use, from which aliases were enabled by hand (setComponentEnabledSetting); the
     * flags are in the order of ALIASES. Until the first switch none is, and the manifest's own
     * choice holds: the original.
     */
    static String current(boolean[] enabledByHand) {
        for (int i = 0; i < ALIASES.length && i < enabledByHand.length; i++) if (enabledByHand[i]) return IDS[i];
        return IDS[0];
    }
}
