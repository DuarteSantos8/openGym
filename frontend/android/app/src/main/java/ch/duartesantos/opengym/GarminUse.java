package ch.duartesantos.opengym;

/**
 * What opening Settings → Garmin (it asks every 3 s) does to the Garmin link's state (GarminLink,
 * src/ciq). Plain Java so the JVM tests reach it from every build.
 */
final class GarminUse {
    private GarminUse() {}

    /**
     * The state after an ask. Only "off" and "no-gcm" move, and only while the SDK is not up:
     * to "starting" when Garmin Connect is on the phone (the SDK starts), else "no-gcm" at once.
     * Setting "starting" without Garmin Connect, as before, made every ask answer "starting" and
     * left the page on "Checking…" for good (QA66).
     */
    static String stateOnUse(String state, boolean sdkUp, boolean gcmInstalled) {
        if (sdkUp || !("off".equals(state) || "no-gcm".equals(state))) return state;
        return gcmInstalled ? "starting" : "no-gcm";
    }
}
