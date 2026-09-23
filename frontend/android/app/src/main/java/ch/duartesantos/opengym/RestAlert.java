package ch.duartesantos.opengym;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.res.ColorStateList;
import android.content.Intent;
import android.widget.RemoteViews;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioTrack;
import android.os.Build;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Log;

/**
 * Alarm for the rest between sets. The WebView timer does not run with the screen locked.
 * This posts a notification for the countdown and, when the rest ends, the end alert and tone.
 * The shade shows it when notifications are allowed. The lock screen shows it only when
 * the user also allows notifications there.
 */
public final class RestAlert {
    static final String ACTION = "ch.duartesantos.opengym.action.REST_OVER";
    static final String ACTION_PAUSE = "ch.duartesantos.opengym.rest.PAUSE";
    static final String ACTION_MINUS = "ch.duartesantos.opengym.rest.MINUS";
    static final String ACTION_PLUS = "ch.duartesantos.opengym.rest.PLUS";
    static final String ACTION_SKIP = "ch.duartesantos.opengym.rest.SKIP";
    static final String ACTION_ACCENT = "ch.duartesantos.opengym.rest.ACCENT";
    static final String CHANNEL_ID = "rest-over";
    private static volatile boolean toneSuppressed;
    private static String lastAlertTitle = "Rest over";
    private static boolean lastSound = true;
    private static String lastChannel = CHANNEL_ID;
    private static String labPause = "Pause";
    private static String labResume = "Resume";
    private static String labMinus = "\u2212 15s";
    private static String labPlus = "+ 15s";
    private static String labSkip = "Skip";
    private static int lastAccent = 0xFF30D158;
    private static int lastInk = 0xFF000000;
    static final int COUNTDOWN_ID = 41;
    static final int NOTIFICATION_ID = 42;
    static final String COUNTDOWN_CHANNEL_ID = "rest-countdown";
    private static final int FLAGS = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
    private static final int RATE = 22050;
    private static final long[] VIBRATE = new long[] {0, 200, 100, 200, 100, 400};

    private static AudioTrack current;

    private RestAlert() {}

    public static void schedule(Context ctx, long at, int id, String title, boolean sound,
                                String channelId, String visibility, String importance, boolean localOnly,
                                String countdownTitle, long totalMs) {
        if (channelId == null || channelId.isEmpty()) channelId = CHANNEL_ID;
        // A new rest may play its tone. The in-app beep sets this only for the one it covers.
        toneSuppressed = false;
        Intent intent = alarmIntent(ctx);
        intent.putExtra("id", id);
        intent.putExtra("title", title == null ? "" : title);
        intent.putExtra("sound", sound);
        intent.putExtra("channelId", channelId);
        intent.putExtra("visibility", visibility == null ? "public" : visibility);
        intent.putExtra("importance", importance == null ? "high" : importance);
        intent.putExtra("localOnly", localOnly);
        PendingIntent pi = PendingIntent.getBroadcast(ctx, id, intent, FLAGS);
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        boolean exact = canExact(am);
        try {
            if (exact) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        } catch (SecurityException e) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            exact = false;
        }
        if (!exact) Log.w("openGym", "exact alarms not allowed; rest alert may be late with the screen off");
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            ensureChannel(ctx, nm, channelId, importanceOf(importance), visibilityOf(visibility));
        }
        lastAlertTitle = title == null ? "Rest over" : title;
        lastSound = sound;
        lastChannel = channelId;
        startCountdown(ctx, at, totalMs, countdownTitle);
    }

    public static void suppressTone() { toneSuppressed = true; }

    public static void allowTone() { toneSuppressed = false; }

    public static void setAccentColor(int accent, int ink) {
        lastAccent = accent;
        lastInk = ink;
    }

    public static void setLabels(String pause, String resume, String minus, String plus, String skip) {
        if (pause != null && !pause.isEmpty()) labPause = pause;
        if (resume != null && !resume.isEmpty()) labResume = resume;
        if (minus != null && !minus.isEmpty()) labMinus = minus;
        if (plus != null && !plus.isEmpty()) labPlus = plus;
        if (skip != null && !skip.isEmpty()) labSkip = skip;
    }

    public static void cancel(Context ctx, int id) {
        stopCountdown(ctx);
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pi = PendingIntent.getBroadcast(ctx, id, alarmIntent(ctx), FLAGS);
        am.cancel(pi);
        pi.cancel();
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        nm.cancel(id);
    }

    /** Runs off the main thread. Holds the CPU until the tone has finished. */
    public static void fire(Context ctx, Intent intent) {
        PowerManager.WakeLock cpu = null;
        try {
            PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
            cpu = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "opengym:rest");
            cpu.acquire(10_000);
        } catch (Exception ignored) { /* tone still attempts without the lock */ }
        try {
            pokeScreen(ctx);
            boolean shown = showNotification(ctx, intent);
            if (!shown) vibrateFallback(ctx);
            // One beep. The in-app tone already played if the page was visible, and it asked
            // us to skip this one. Locked, the page never gets there, so this is the beep.
            boolean play = intent.getBooleanExtra("sound", true) && !toneSuppressed;
            toneSuppressed = false;
            if (play) playSound(ctx);
            // The countdown card is the foreground-service notification. Drop it once the
            // "rest over" alert is up, including when the WebView is frozen.
            stopCountdown(ctx);
        } finally {
            if (cpu != null && cpu.isHeld()) cpu.release();
        }
    }

    private static Intent alarmIntent(Context ctx) {
        Intent intent = new Intent(ctx, RestAlertReceiver.class);
        intent.setAction(ACTION);
        return intent;
    }

    private static boolean canExact(AlarmManager am) {
        if (Build.VERSION.SDK_INT < 31) return true;
        return am.canScheduleExactAlarms();
    }

    @SuppressWarnings("deprecation")
    private static void pokeScreen(Context ctx) {
        // Best effort so the notification is already lit. Newer Android builds ignore
        // ACQUIRE_CAUSES_WAKEUP; the posted notification is what the shade still shows.
        try {
            PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
            PowerManager.WakeLock screen = pm.newWakeLock(
                    PowerManager.SCREEN_DIM_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP,
                    "opengym:rest-screen");
            screen.acquire(3000);
        } catch (Exception ignored) { /* */ }
    }

    @SuppressWarnings("deprecation")
    private static boolean showNotification(Context ctx, Intent intent) {
        String title = intent.getStringExtra("title");
        if (title == null || title.isEmpty()) title = "Rest over — next set!";
        String channelId = intent.getStringExtra("channelId");
        if (channelId == null || channelId.isEmpty()) channelId = CHANNEL_ID;
        int id = intent.getIntExtra("id", NOTIFICATION_ID);
        boolean localOnly = intent.getBooleanExtra("localOnly", false);
        int visibility = visibilityOf(intent.getStringExtra("visibility"));
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 24 && !nm.areNotificationsEnabled()) return false;
        ensureChannel(ctx, nm, channelId, importanceOf(intent.getStringExtra("importance")), visibility);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(ctx, channelId)
                : new Notification.Builder(ctx);
        b.setSmallIcon(R.drawable.ic_stat_dumbbell)
                .setContentTitle(title)
                .setWhen(System.currentTimeMillis())
                .setShowWhen(true)
                .setAutoCancel(true)
                .setCategory(Notification.CATEGORY_ALARM)
                .setVisibility(visibility)
                .setColor(lastAccent)
                .setContentIntent(openApp(ctx))
                .setVibrate(VIBRATE);
        if (Build.VERSION.SDK_INT >= 26) b.setOnlyAlertOnce(false);
        else b.setPriority(Notification.PRIORITY_HIGH);
        if (localOnly) b.setLocalOnly(true);
        try {
            nm.notify(id, b.build());
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private static void ensureChannel(Context ctx, NotificationManager nm, String channelId, int importance, int visibility) {
        if (Build.VERSION.SDK_INT < 26) return;
        if (nm.getNotificationChannel(channelId) != null) return;
        NotificationChannel channel = new NotificationChannel(
                channelId, ctx.getString(R.string.rest_channel_name), importance);
        channel.setDescription(ctx.getString(R.string.rest_channel_desc));
        channel.setLockscreenVisibility(visibility);
        channel.enableVibration(true);
        channel.setVibrationPattern(VIBRATE);
        // Silent on purpose. The beep is the in-app tone or playSound(), not a second ding
        // from this channel.
        channel.setSound(null, null);
        nm.createNotificationChannel(channel);
    }

    private static PendingIntent openApp(Context ctx) {
        Intent open = new Intent(ctx, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(ctx, NOTIFICATION_ID + 1, open, FLAGS);
    }

    private static int importanceOf(String name) {
        if ("max".equals(name)) return NotificationManager.IMPORTANCE_MAX;
        if ("low".equals(name)) return NotificationManager.IMPORTANCE_LOW;
        if ("min".equals(name)) return NotificationManager.IMPORTANCE_MIN;
        if ("default".equals(name)) return NotificationManager.IMPORTANCE_DEFAULT;
        return NotificationManager.IMPORTANCE_HIGH;
    }

    private static int visibilityOf(String name) {
        if ("secret".equals(name)) return Notification.VISIBILITY_SECRET;
        if ("private".equals(name)) return Notification.VISIBILITY_PRIVATE;
        return Notification.VISIBILITY_PUBLIC;
    }

    @SuppressWarnings("deprecation")
    private static void vibrateFallback(Context ctx) {
        try {
            Vibrator vibrator = (Vibrator) ctx.getSystemService(Context.VIBRATOR_SERVICE);
            if (vibrator == null) return;
            if (Build.VERSION.SDK_INT >= 26) vibrator.vibrate(VibrationEffect.createWaveform(VIBRATE, -1));
            else vibrator.vibrate(VIBRATE, -1);
        } catch (Exception ignored) { /* */ }
    }

    static void updateAlarm(Context ctx, long at) {
        if (at <= System.currentTimeMillis()) {
            cancelAlarmOnly(ctx, NOTIFICATION_ID);
            return;
        }
        Intent intent = alarmIntent(ctx);
        intent.putExtra("id", NOTIFICATION_ID);
        intent.putExtra("title", lastAlertTitle);
        intent.putExtra("sound", lastSound);
        intent.putExtra("channelId", lastChannel);
        intent.putExtra("visibility", "public");
        intent.putExtra("importance", "high");
        intent.putExtra("localOnly", false);
        PendingIntent pi = PendingIntent.getBroadcast(ctx, NOTIFICATION_ID, intent, FLAGS);
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        try {
            if (canExact(am)) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        } catch (SecurityException e) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        }
    }

    static void cancelAlarmOnly(Context ctx, int id) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pi = PendingIntent.getBroadcast(ctx, id, alarmIntent(ctx), FLAGS);
        am.cancel(pi);
    }

    static void startCountdown(Context ctx, long endsAt, long totalMs, String title) {
        Intent i = new Intent(ctx, RestTimerService.class);
        i.putExtra("endsAt", endsAt);
        i.putExtra("totalMs", totalMs);
        i.putExtra("title", title == null || title.isEmpty() ? "Rest" : title);
        i.putExtra("pause", labPause);
        i.putExtra("resume", labResume);
        i.putExtra("minus", labMinus);
        i.putExtra("plus", labPlus);
        i.putExtra("skip", labSkip);
        i.putExtra("accent", lastAccent);
        i.putExtra("ink", lastInk);
        try {
            if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i);
            else ctx.startService(i);
        } catch (Exception e) {
            Log.w("openGym", "rest countdown not started", e);
        }
    }

    static void stopCountdown(Context ctx) {
        try {
            ctx.stopService(new Intent(ctx, RestTimerService.class));
        } catch (Exception ignored) { /* already gone */ }
    }

    /**
     * One clock and one bar, in both the collapsed and the expanded card. The standard
     * title/text/subtext slots are left empty: Samsung prints each of them, which stacked
     * the same time three times next to the bar.
     */
    @SuppressWarnings("deprecation")
    static Notification countdownNotification(Context ctx, long leftMs, long totalMs, boolean paused,
                                              String pause, String resume, String minus, String plus, String skip,
                                              int accent, int ink) {
        int max = (int) Math.max(1, Math.round(totalMs / 1000.0));
        int left = (int) Math.min(max, (Math.max(0, leftMs) + 999) / 1000);
        String clock = clock(left);
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        ensureCountdownChannel(ctx, nm);
        RemoteViews compact = new RemoteViews(ctx.getPackageName(), R.layout.rest_countdown);
        fillClock(compact, clock, max, left, accent);
        RemoteViews expanded = new RemoteViews(ctx.getPackageName(), R.layout.rest_countdown_big);
        fillClock(expanded, clock, max, left, accent);
        applyAccent(expanded, accent, ink);
        expanded.setTextViewText(R.id.rest_pause, paused ? resume : pause);
        expanded.setTextViewText(R.id.rest_minus, minus);
        expanded.setTextViewText(R.id.rest_plus, plus);
        expanded.setTextViewText(R.id.rest_skip, skip);
        expanded.setOnClickPendingIntent(R.id.rest_pause, control(ctx, ACTION_PAUSE, 51));
        expanded.setOnClickPendingIntent(R.id.rest_minus, control(ctx, ACTION_MINUS, 52));
        expanded.setOnClickPendingIntent(R.id.rest_plus, control(ctx, ACTION_PLUS, 53));
        expanded.setOnClickPendingIntent(R.id.rest_skip, control(ctx, ACTION_SKIP, 54));
        Notification.Builder b = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(ctx, COUNTDOWN_CHANNEL_ID)
                : new Notification.Builder(ctx);
        b.setSmallIcon(R.drawable.ic_stat_dumbbell)
                .setShowWhen(false)
                .setOngoing(true)
                .setCategory(Notification.CATEGORY_PROGRESS)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setColor(accent)
                .setContentIntent(openApp(ctx))
                .setLocalOnly(true);
        if (Build.VERSION.SDK_INT >= 24) {
            b.setCustomContentView(compact);
            b.setCustomBigContentView(expanded);
            b.setStyle(new Notification.DecoratedCustomViewStyle());
        } else {
            b.setContentTitle(clock);
            b.setProgress(max, left, false);
        }
        if (Build.VERSION.SDK_INT >= 26) b.setOnlyAlertOnce(true);
        else b.setPriority(Notification.PRIORITY_DEFAULT);
        // Android 12+ holds the first foreground-service notification for 10 seconds
        // unless the notification asks to be shown immediately. Later rests in the
        // same process skip that hold, which is why only the first one looked late.
        if (Build.VERSION.SDK_INT >= 31) {
            b.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
        }
        return b.build();
    }

    private static void fillClock(RemoteViews views, String clock, int max, int left, int accent) {
        views.setTextViewText(R.id.rest_clock, clock);
        views.setProgressBar(R.id.rest_bar, max, left, false);
        if (Build.VERSION.SDK_INT >= 31) {
            views.setColorStateList(R.id.rest_bar, "setProgressTintList", ColorStateList.valueOf(accent));
        }
    }

    private static void applyAccent(RemoteViews views, int accent, int ink) {
        views.setTextColor(R.id.rest_pause, accent);
        views.setTextColor(R.id.rest_minus, accent);
        views.setTextColor(R.id.rest_plus, accent);
        views.setTextColor(R.id.rest_skip, ink);
        if (Build.VERSION.SDK_INT >= 31) {
            views.setColorStateList(R.id.rest_skip, "setBackgroundTintList", ColorStateList.valueOf(accent));
        }
    }

    private static PendingIntent control(Context ctx, String action, int code) {
        Intent i = new Intent(ctx, RestTimerService.class);
        i.setAction(action);
        return PendingIntent.getService(ctx, code, i, FLAGS);
    }

    static String clock(int sec) {
        return (sec / 60) + ":" + (sec % 60 < 10 ? "0" : "") + (sec % 60);
    }

    private static void ensureCountdownChannel(Context ctx, NotificationManager nm) {
        if (Build.VERSION.SDK_INT < 26) return;
        if (nm.getNotificationChannel(COUNTDOWN_CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(
                COUNTDOWN_CHANNEL_ID,
                ctx.getString(R.string.rest_countdown_channel_name),
                NotificationManager.IMPORTANCE_DEFAULT);
        channel.setDescription(ctx.getString(R.string.rest_channel_desc));
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        channel.setSound(null, null);
        channel.enableVibration(false);
        nm.createNotificationChannel(channel);
    }

    private static void playSound(Context ctx) {
        playClip(ctx, renderBeeps());
    }

    private static void playClip(Context ctx, short[] samples) {
        AudioTrack track = null;
        try {
            int bytes = samples.length * 2;
            int min = AudioTrack.getMinBufferSize(RATE, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT);
            if (min > bytes) {
                short[] padded = new short[(min / 2) + 1];
                System.arraycopy(samples, 0, padded, 0, samples.length);
                samples = padded;
                bytes = samples.length * 2;
            }
            track = new AudioTrack.Builder()
                    .setAudioAttributes(new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_MEDIA)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                            .build())
                    .setAudioFormat(new AudioFormat.Builder()
                            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                            .setSampleRate(RATE)
                            .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                            .build())
                    .setBufferSizeInBytes(bytes)
                    .setTransferMode(AudioTrack.MODE_STATIC)
                    .build();
            if (track.getState() != AudioTrack.STATE_INITIALIZED) return;
            track.write(samples, 0, samples.length);
            track.setVolume(1f);
            stopCurrent();
            current = track;
            track.play();
            Thread.sleep((samples.length * 1000L / RATE) + 60);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } catch (Exception ignored) { /* the notification still posted */ }
        finally {
            if (track != null) {
                try { track.pause(); } catch (Exception ignored) { /* */ }
                try { track.release(); } catch (Exception ignored) { /* */ }
                if (current == track) current = null;
            }
        }
    }

    private static synchronized void stopCurrent() {
        if (current == null) return;
        try { current.pause(); } catch (Exception ignored) { /* */ }
        try { current.release(); } catch (Exception ignored) { /* */ }
        current = null;
    }

    /** Same three tones the in-page beep uses (880, 880, 1320), at full scale. */
    static short[] renderBeeps() {
        int[] freq = {880, 880, 1320};
        double[] dur = {0.15, 0.15, 0.40};
        double[] gap = {0.10, 0.10, 0};
        int total = 0;
        for (int i = 0; i < freq.length; i++) total += (int) (RATE * (dur[i] + gap[i]));
        short[] out = new short[total];
        int pos = 0;
        for (int i = 0; i < freq.length; i++) {
            int n = (int) (RATE * dur[i]);
            int g = (int) (RATE * gap[i]);
            int fade = Math.max(1, RATE / 200);
            for (int s = 0; s < n; s++) {
                double env = 1;
                if (s < fade) env = s / (double) fade;
                else if (s > n - fade) env = (n - s) / (double) fade;
                double wave = Math.sin(2 * Math.PI * freq[i] * s / RATE);
                out[pos++] = (short) Math.max(-32767, Math.min(32767, wave * env * 0.85 * 32767));
            }
            pos += g;
        }
        return out;
    }
}
