package ch.duartesantos.opengym;

import android.app.Activity;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * The sound of each kind of reminder (v1.4.5, lib/reminder-sounds.js, ReminderSounds):
 *
 *   channel({ kind, tone, uri, name, description })  -> { channelId }
 *       the notification channel that rings with this choice, made the first time it is asked
 *       for. `tone`: "none" (silent), a built-in one ("chime", "bell", ...), "u:<sha-256>" (a sound
 *       of one's own, from the app's media folder) or "sys" (one of the phone's, `uri`). The other
 *       channels of the kind go: Android cannot change a channel's sound, so a new choice is a new
 *       channel, and the old one would only sit in the system settings as a stray.
 *   pick({ uri })  -> { uri, title } | { }   the system's sound picker (notification sounds)
 *   preview({ uri })                          plays one of the phone's sounds once; stop() stops it
 *
 * A built-in tone or one of one's own is written as a WAV under files/reminder-sounds/ and handed
 * to the system through the FileProvider (file_paths.xml), with read access for the System UI,
 * which is what plays a channel's sound.
 */
@CapacitorPlugin(name = "ReminderSound")
public class ReminderSoundPlugin extends Plugin {
    private static final String DIR = "reminder-sounds";
    private Ringtone playing;

    @PluginMethod
    public void channel(PluginCall call) {
        String kind = call.getString("kind", "");
        String tone = call.getString("tone", "");
        String uri = call.getString("uri", null);
        if (!ReminderSounds.knownKind(kind) || tone.isEmpty()) {
            call.reject("unknown reminder kind or no sound");
            return;
        }
        if (Build.VERSION.SDK_INT < 26) {
            // No channels before Android 8: the notification's own sound would decide, and the app
            // posts reminders through Capacitor's default. Nothing to make.
            call.resolve(new JSObject());
            return;
        }
        Context ctx = getContext();
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) { call.reject("no notification manager"); return; }
        String id = ReminderSounds.channelId(kind, tone, uri);
        if (nm.getNotificationChannel(id) == null) {
            Uri sound;
            if ("none".equals(tone)) sound = null;
            else if ("sys".equals(tone)) sound = uri == null || uri.isEmpty() ? Settings.System.DEFAULT_NOTIFICATION_URI : Uri.parse(uri);
            else sound = soundFile(ctx, tone);
            if (sound == null && !"none".equals(tone)) {
                call.reject("that sound cannot be read");
                return;
            }
            String name = call.getString("name", kind);
            NotificationChannel ch = new NotificationChannel(id, name, NotificationManager.IMPORTANCE_DEFAULT);
            ch.setDescription(call.getString("description", ""));
            ch.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
            ch.enableVibration(true);
            AudioAttributes attrs = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build();
            ch.setSound(sound, sound == null ? null : attrs);
            nm.createNotificationChannel(ch);
        }
        for (NotificationChannel c : nm.getNotificationChannels()) {
            if (ReminderSounds.ofKind(c.getId(), kind) && !c.getId().equals(id)) nm.deleteNotificationChannel(c.getId());
        }
        JSObject ret = new JSObject();
        ret.put("channelId", id);
        call.resolve(ret);
    }

    /** Forgets every channel of `kind`: the reminder goes back to Capacitor's default one. */
    @PluginMethod
    public void reset(PluginCall call) {
        String kind = call.getString("kind", "");
        if (Build.VERSION.SDK_INT >= 26 && ReminderSounds.knownKind(kind)) {
            NotificationManager nm = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                for (NotificationChannel c : nm.getNotificationChannels()) {
                    if (ReminderSounds.ofKind(c.getId(), kind)) nm.deleteNotificationChannel(c.getId());
                }
            }
        }
        call.resolve();
    }

    /** The WAV for a built-in tone or one's own, as a content:// address the System UI may read. */
    private Uri soundFile(Context ctx, String tone) {
        String name = ReminderSounds.fileName(tone);
        if (name == null) return null;
        File dir = new File(ctx.getFilesDir(), DIR);
        if (!dir.isDirectory() && !dir.mkdirs()) return null;
        File out = new File(dir, name);
        try {
            if (!out.isFile()) {
                String hash = RestTone.userHash(tone);
                if (hash != null) {
                    File src = new File(new File(ctx.getFilesDir(), "opengym-media"), hash + ".wav");
                    if (!src.isFile() || src.length() > 4L * 1024 * 1024) return null;
                    try (InputStream in = new FileInputStream(src); OutputStream o = new FileOutputStream(out)) {
                        byte[] buf = new byte[16384];
                        int n;
                        while ((n = in.read(buf)) > 0) o.write(buf, 0, n);
                    }
                } else {
                    try (OutputStream o = new FileOutputStream(out)) {
                        o.write(ReminderSounds.toWav(RestTone.render(tone), RestTone.RATE));
                    }
                }
            }
            Uri u = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", out);
            ctx.grantUriPermission("com.android.systemui", u, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            return u;
        } catch (Exception e) {
            out.delete();
            return null;
        }
    }

    @PluginMethod
    public void pick(PluginCall call) {
        Intent intent = new Intent(RingtoneManager.ACTION_RINGTONE_PICKER);
        intent.putExtra(RingtoneManager.EXTRA_RINGTONE_TYPE, RingtoneManager.TYPE_NOTIFICATION);
        intent.putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_DEFAULT, true);
        intent.putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_SILENT, false);
        intent.putExtra(RingtoneManager.EXTRA_RINGTONE_DEFAULT_URI, Settings.System.DEFAULT_NOTIFICATION_URI);
        String current = call.getString("uri", null);
        if (current != null && !current.isEmpty()) intent.putExtra(RingtoneManager.EXTRA_RINGTONE_EXISTING_URI, Uri.parse(current));
        try {
            startActivityForResult(call, intent, "pickResult");
        } catch (Exception e) {
            call.reject("this phone has no sound picker", e);
        }
    }

    @ActivityCallback
    private void pickResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        Uri uri = data == null ? null : data.getParcelableExtra(RingtoneManager.EXTRA_RINGTONE_PICKED_URI);
        if (result.getResultCode() != Activity.RESULT_OK || uri == null) {
            call.resolve(new JSObject());   // cancelled: nothing changes
            return;
        }
        JSObject ret = new JSObject();
        ret.put("uri", uri.toString());
        ret.put("title", titleOf(uri));
        call.resolve(ret);
    }

    private String titleOf(Uri uri) {
        try {
            Ringtone r = RingtoneManager.getRingtone(getContext(), uri);
            return r == null ? "" : r.getTitle(getContext());
        } catch (Exception e) {
            return "";
        }
    }

    @PluginMethod
    public void preview(PluginCall call) {
        stopPlaying();
        String uri = call.getString("uri", null);
        try {
            Uri u = uri == null || uri.isEmpty() ? Settings.System.DEFAULT_NOTIFICATION_URI : Uri.parse(uri);
            playing = RingtoneManager.getRingtone(getContext(), u);
            if (playing != null) playing.play();
            call.resolve();
        } catch (Exception e) {
            call.reject("that sound cannot be played", e);
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        stopPlaying();
        call.resolve();
    }

    private void stopPlaying() {
        try { if (playing != null) playing.stop(); } catch (Exception ignored) { }
        playing = null;
    }

    @Override
    protected void handleOnDestroy() {
        stopPlaying();
    }
}
