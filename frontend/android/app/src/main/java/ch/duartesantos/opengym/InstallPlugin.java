package ch.duartesantos.opengym;

import android.content.Intent;
import android.net.Uri;
import androidx.core.content.FileProvider;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;

/**
 * Minimal local Capacitor plugin that opens the Android package installer
 * for an APK file stored in the app's cache directory.
 *
 * Usage from JS:
 *   import { registerPlugin } from '@capacitor/core';
 *   const Install = registerPlugin('Install');
 *   await Install.installApk({ fileName: 'opengym-update.apk' });
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
}
