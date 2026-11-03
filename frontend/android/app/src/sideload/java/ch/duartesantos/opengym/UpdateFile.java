package ch.duartesantos.opengym;

import java.util.regex.Pattern;

/**
 * What InstallPlugin agrees to hand the package installer: only the update the app itself
 * downloaded into its cache (lib/update.js names it opengym-update.apk; a per-size variant may
 * carry a short suffix), and only with the SHA-256 the release published next to it. Plain Java,
 * no Android types, so the rules are unit-tested on their own (src/testSideload).
 */
final class UpdateFile {
    private static final Pattern NAME = Pattern.compile("opengym-update(-[a-z0-9]{1,16})?\\.apk");
    private static final Pattern SHA256 = Pattern.compile("[0-9a-fA-F]{64}");

    private UpdateFile() {}

    /** A file name the updater writes: no directory part, no other file of the app's. */
    static boolean nameOk(String fileName) {
        return fileName != null && NAME.matcher(fileName).matches();
    }

    /** A SHA-256 in hex. Without one nothing is installed: a missing hash is not a pass. */
    static boolean hashOk(String sha256) {
        return sha256 != null && SHA256.matcher(sha256).matches();
    }
}
