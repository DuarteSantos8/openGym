package ch.duartesantos.opengym;

import android.content.Intent;
import android.net.Uri;
import androidx.core.content.FileProvider;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.security.MessageDigest;

/**
 * Minimal local Capacitor plugin that opens the Android package installer
 * for an APK file stored in the app's cache directory.
 *
 * Usage from JS:
 *   import { registerPlugin } from '@capacitor/core';
 *   const Install = registerPlugin('Install');
 *   await Install.installApk({ fileName: 'opengym-update.apk', sha256: '<64 hex>' });
 *
 * With `sha256` the file is streamed through SHA-256 first and a mismatch is refused (and the
 * file deleted) before the installer opens: the APK is ~300 MB, too big to hash in the WebView.
 */
@CapacitorPlugin(name = "Install")
public class InstallPlugin extends Plugin {

    @PluginMethod
    public void installApk(PluginCall call) {
        String fileName = call.getString("fileName");
        if (fileName == null || fileName.isEmpty()) {
            call.reject("fileName is required");
            return;
        }

        File file = new File(getContext().getCacheDir(), fileName);
        if (!file.exists()) {
            call.reject("APK file not found: " + fileName);
            return;
        }

        String expected = call.getString("sha256");
        if (expected != null && !expected.isEmpty()) {
            try {
                if (!expected.equalsIgnoreCase(sha256(file))) {
                    file.delete();
                    call.reject("SHA-256 mismatch: the download may be corrupted or tampered with");
                    return;
                }
            } catch (Exception e) {
                call.reject("Could not check the download: " + e.getMessage());
                return;
            }
        }

        Uri uri = FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                file
        );

        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, "application/vnd.android.package-archive");
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);

        getContext().startActivity(intent);
        call.resolve();
    }

    private static String sha256(File file) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        byte[] buf = new byte[1 << 16];
        try (InputStream in = new FileInputStream(file)) {
            for (int n; (n = in.read(buf)) > 0; ) md.update(buf, 0, n);
        }
        StringBuilder hex = new StringBuilder();
        for (byte b : md.digest()) hex.append(String.format("%02x", b));
        return hex.toString();
    }
}
