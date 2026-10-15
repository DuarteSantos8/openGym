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
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.AudioFormat;
import android.media.AudioTrack;
import android.os.Build;
import android.os.PowerManager;
import android.os.VibrationAttributes;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
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
    static final String ACTION_HOLD = "ch.duartesantos.opengym.rest.HOLD";
    static final String CHANNEL_ID = "rest-over";
    /**
     * Settings → Vibrate off. Android keeps a channel's vibration as it was when the channel was
     * created (after that it is the user's, in the system settings), so "rest-over" buzzes for
     * good and an end that must not buzz goes out on this channel, which never vibrates.
     */
    static final String QUIET_CHANNEL_ID = "rest-over-quiet";
    private static String lastAlertTitle = "Rest over";
    private static boolean lastSound = true;
    private static String lastTone = "chime";
    private static boolean lastVibrate = true;
    private static boolean lastAlarmBuzz = false;
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
    private static final int RATE = RestTone.RATE;
    private static final long[] VIBRATE = new long[] {0, 200, 100, 200, 100, 400};

    private static AudioTrack current;
    private static long firedFor;

    private RestAlert() {}

    /**
     * `alarmBuzz` is Settings → "Vibrate when the phone is on silent" (#375): the end buzzes as an
     * alarm, which silent mode lets through, and the notification goes out on the quiet channel so
     * a phone with its ringer on does not buzz twice.
     */
    public static void schedule(Context ctx, long at, int id, String title, boolean sound, String tone, boolean vibrate,
                                boolean alarmBuzz, String channelId, String visibility, String importance,
                                boolean localOnly, String countdownTitle, long totalMs) {
        alarmBuzz = vibrate && alarmBuzz;
        channelId = channelFor(channelId, vibrate);
        Intent intent = alarmIntent(ctx);
        intent.putExtra("id", id);
        intent.putExtra("title", title == null ? "" : title);
        intent.putExtra("sound", sound);
        intent.putExtra("tone", tone == null ? "chime" : tone);
        intent.putExtra("vibrate", vibrate);
        intent.putExtra("alarmBuzz", alarmBuzz);
        intent.putExtra("channelId", channelId);
        intent.putExtra("visibility", visibility == null ? "public" : visibility);
        intent.putExtra("importance", importance == null ? "high" : importance);
        intent.putExtra("localOnly", localOnly);
        intent.putExtra("at", at);
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
        if (!exact) Log.w("openGym", "exact alarms not allowed; the rest countdown sounds the end itself");
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            String posted = alarmBuzz ? QUIET_CHANNEL_ID : channelId;
            ensureChannel(ctx, nm, posted, importanceOf(importance), visibilityOf(visibility), !alarmBuzz && vibrate);
        }
        lastAlertTitle = title == null ? "Rest over" : title;
        lastSound = sound;
        lastTone = tone == null ? "chime" : tone;
        lastVibrate = vibrate;
        lastAlarmBuzz = alarmBuzz;
        lastChannel = channelId;
        startCountdown(ctx, at, totalMs, countdownTitle);
    }

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

    /**
     * The countdown reached the end itself. Without the exact-alarm permission, which Android 14
     * no longer grants at install, the alarm may be batched up to three quarters of the rest late
     * (on an emulator it came 50 seconds after a 90-second rest), so the countdown sounds the end
     * and the alarm is only the fallback for a countdown that was not running.
     */
    static void fireFromCountdown(Context ctx, long at) {
        cancelAlarmOnly(ctx, NOTIFICATION_ID);
        Intent intent = alarmIntent(ctx);
        intent.putExtra("id", NOTIFICATION_ID);
        intent.putExtra("title", lastAlertTitle);
        intent.putExtra("sound", lastSound);
        intent.putExtra("tone", lastTone);
        intent.putExtra("vibrate", lastVibrate);
        intent.putExtra("alarmBuzz", lastAlarmBuzz);
        intent.putExtra("channelId", lastChannel);
        intent.putExtra("at", at);
        new Thread(() -> fire(ctx, intent), "opengym-rest").start();
    }

    /** One alert per end: the countdown and an exact alarm reach the same end in the same instant. */
    private static synchronized boolean claim(long at) {
        if (at > 0 && at == firedFor) return false;
        firedFor = at;
        return true;
    }

    /** Runs off the main thread. Holds the CPU until the tone has finished. */
    public static void fire(Context ctx, Intent intent) {
        if (!claim(intent.getLongExtra("at", 0))) return;
        PowerManager.WakeLock cpu = null;
        try {
            PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
            cpu = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "opengym:rest");
            cpu.acquire(10_000);
        } catch (Exception ignored) { /* tone still attempts without the lock */ }
        try {
            // The app is on screen: the page has chimed, buzzed and flashed the end itself, and
            // its bar says Ready. A tone and a banner on top would say it twice. Asking the page
            // to hush this alarm instead raced it: the page's last tick and this alarm land in
            // the same few milliseconds, and whichever came first decided.
            if (RestAlertPlugin.appInFront()) {
                stopCountdown(ctx);
                return;
            }
            pokeScreen(ctx);
            boolean vibrate = intent.getBooleanExtra("vibrate", true);
            boolean alarmBuzz = vibrate && intent.getBooleanExtra("alarmBuzz", false);
            boolean shown = showNotification(ctx, intent, alarmBuzz);
            // On silent the channel's buzz is muted; an alarm's is not (#375). The notification
            // went out on the quiet channel, so this is the one buzz with the ringer on too.
            if (alarmBuzz) buzz(ctx, VIBRATE);
            // Settings → Vibrate off is off here too: without notifications this buzz is the alert.
            else if (!shown && vibrate) vibrateFallback(ctx);
            // Locked or in the background, the page does not play its chime, so this is the one:
            // the same sound as Settings → Sound picks for the page (RestTone.render).
            boolean play = intent.getBooleanExtra("sound", true);
            if (play) playSound(ctx, toneOf(intent));
            // The countdown card is the foreground-service notification. Drop it once the
            // "rest over" alert is up and the tone has played, including when the WebView is
            // frozen. Not before the tone: the service is what keeps this process in the
            // foreground, and a process that has just dropped out of it can be frozen or cut
            // off mid-tone with the screen off.
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
    private static boolean showNotification(Context ctx, Intent intent, boolean alarmBuzz) {
        String title = intent.getStringExtra("title");
        if (title == null || title.isEmpty()) title = "Rest’s over. Next set!";
        // With the alarm buzz on, the notification itself stays still: the buzz comes from buzz().
        boolean vibrate = intent.getBooleanExtra("vibrate", true) && !alarmBuzz;
        String channelId = channelFor(intent.getStringExtra("channelId"), vibrate);
        int id = intent.getIntExtra("id", NOTIFICATION_ID);
        boolean localOnly = intent.getBooleanExtra("localOnly", false);
        int visibility = visibilityOf(intent.getStringExtra("visibility"));
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 24 && !nm.areNotificationsEnabled()) return false;
        ensureChannel(ctx, nm, channelId, importanceOf(intent.getStringExtra("importance")), visibility, vibrate);
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
                .setContentIntent(openApp(ctx));
        // Android 8+ takes the vibration from the channel; before that, from the notification.
        if (vibrate) b.setVibrate(VIBRATE);
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

    /** The quiet channel when Vibrate is off, whatever channel the page named. */
    static String channelFor(String channelId, boolean vibrate) {
        if (!vibrate) return QUIET_CHANNEL_ID;
        if (channelId == null || channelId.isEmpty() || QUIET_CHANNEL_ID.equals(channelId)) return CHANNEL_ID;
        return channelId;
    }

    private static void ensureChannel(Context ctx, NotificationManager nm, String channelId, int importance, int visibility, boolean vibrate) {
        if (Build.VERSION.SDK_INT < 26) return;
        if (nm.getNotificationChannel(channelId) != null) return;
        NotificationChannel channel = new NotificationChannel(
                channelId, ctx.getString(vibrate ? R.string.rest_channel_name : R.string.rest_quiet_channel_name), importance);
        channel.setDescription(ctx.getString(R.string.rest_channel_desc));
        channel.setLockscreenVisibility(visibility);
        if (vibrate) {
            channel.enableVibration(true);
            channel.setVibrationPattern(VIBRATE);
        } else {
            channel.enableVibration(false);
            channel.setVibrationPattern(null);
        }
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

    /**
     * A buzz silent mode lets through (#375): vibration with the alarm usage, which the system
     * plays in silent and vibrate-only modes like the clock app's alarm. `pattern` is Android's
     * waveform (off, on, off, on…). Do Not Disturb still decides, as it does for alarms.
     */
    @SuppressWarnings("deprecation")
    static void buzz(Context ctx, long[] pattern) {
        try {
            Vibrator vibrator;
            if (Build.VERSION.SDK_INT >= 31) {
                VibratorManager vm = (VibratorManager) ctx.getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
                vibrator = vm == null ? null : vm.getDefaultVibrator();
            } else {
                vibrator = (Vibrator) ctx.getSystemService(Context.VIBRATOR_SERVICE);
            }
            if (vibrator == null || !vibrator.hasVibrator()) return;
            if (Build.VERSION.SDK_INT >= 33) {
                vibrator.vibrate(VibrationEffect.createWaveform(pattern, -1),
                        VibrationAttributes.createForUsage(VibrationAttributes.USAGE_ALARM));
                return;
            }
            AudioAttributes alarm = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build();
            if (Build.VERSION.SDK_INT >= 26) vibrator.vibrate(VibrationEffect.createWaveform(pattern, -1), alarm);
            else vibrator.vibrate(pattern, -1, alarm);
        } catch (Exception ignored) { /* nothing else to fall back on here */ }
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
        intent.putExtra("tone", lastTone);
        intent.putExtra("vibrate", lastVibrate);
        intent.putExtra("alarmBuzz", lastAlarmBuzz);
        intent.putExtra("channelId", lastChannel);
        intent.putExtra("visibility", "public");
        intent.putExtra("importance", "high");
        intent.putExtra("localOnly", false);
        intent.putExtra("at", at);
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

    /**
     * The end tone with the app on screen. The page's Web Audio cannot turn other apps down, so
     * over music it was lost (Discord: "the bell doesn't ring while I have music on"); played
     * here it ducks the music like the screen-off alarm does. Off the main thread: playClip
     * waits until the clip has been heard.
     */
    static void playNow(Context ctx, String tone) {
        new Thread(() -> playSound(ctx, tone), "opengym-tone").start();
    }

    private static void playSound(Context ctx, String tone) {
        playClip(ctx, RestTone.render(tone));
    }

    /**
     * The sound an alarm asks for: its "tone" (#306), or for an alarm armed by the app before it,
     * still pending across the update, its "classic" switch.
     */
    private static String toneOf(Intent intent) {
        String tone = intent.getStringExtra("tone");
        if (tone != null) return tone;
        return intent.getBooleanExtra("classic", false) ? "classic" : "chime";
    }

    /**
     * Plays a whole clip and returns once it has been heard. Over music the clip asks for a
     * short duck, as a navigation prompt does: the music app turns itself down for the tone
     * and back up after it. A web page cannot do that, which is half of why the chime got lost
     * under music (Discord: "Rest Timer Sound Notification too Quiet").
     *
     * The track used to be let go a fixed 60 ms after the clip's length. With the screen off the
     * output wakes from standby and runs through a low-power buffer first, and Bluetooth adds its
     * own delay, so the last, longest note was cut off or the whole tone never reached the
     * speaker. Now the track is held until the mixer has taken every sample (the clip ends in
     * RestTone.TAIL_SEC of silence for what sits behind the mixer), with a cap.
     */
    private static void playClip(Context ctx, short[] samples) {
        AudioTrack track = null;
        AudioManager am = null;
        Object focus = null;
        try {
            int bytes = samples.length * 2;
            int min = AudioTrack.getMinBufferSize(RATE, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT);
            if (min > bytes) {
                short[] padded = new short[(min / 2) + 1];
                System.arraycopy(samples, 0, padded, 0, samples.length);
                samples = padded;
                bytes = samples.length * 2;
            }
            AudioAttributes attrs = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build();
            track = buildTrack(attrs, bytes, AudioTrack.MODE_STATIC);
            // A static track holds the whole clip, the surest way to have it all heard. Some audio
            // stacks refuse one (the Android emulator does, and so do some phones in some output
            // modes) and the tone was then silently skipped: stream the same clip instead.
            boolean streaming = false;
            if (track.getState() != AudioTrack.STATE_INITIALIZED) {
                Log.w("openGym", "rest tone: static track refused, streaming it");
                track.release();
                track = buildTrack(attrs, Math.max(min * 2, 8192), AudioTrack.MODE_STREAM);
                streaming = true;
            }
            // Each way out says why in logcat: a rest tone that never plays is otherwise silent twice.
            if (track.getState() != AudioTrack.STATE_INITIALIZED) { Log.w("openGym", "rest tone: track not initialized"); return; }
            int frames = samples.length;
            if (!streaming) {
                frames = track.write(samples, 0, samples.length);
                if (frames <= 0) { Log.w("openGym", "rest tone: write returned " + frames); return; }
            }
            track.setVolume(1f);
            am = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
            focus = duck(am, attrs);
            stopCurrent();
            current = track;
            track.play();
            // A streaming track is fed after play(); write() blocks until the mixer has room.
            if (streaming) {
                int written = track.write(samples, 0, samples.length);
                if (written <= 0) { Log.w("openGym", "rest tone: stream write returned " + written); return; }
            }
            long clipMs = frames * 1000L / RATE;
            long deadline = System.currentTimeMillis() + clipMs + 3000;
            while (System.currentTimeMillis() < deadline
                    && track.getPlayState() == AudioTrack.PLAYSTATE_PLAYING
                    && track.getPlaybackHeadPosition() < frames) {
                Thread.sleep(25);
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } catch (Exception e) {
            Log.w("openGym", "rest tone failed", e);   // the notification still posted
        }
        finally {
            if (track != null) {
                try { track.stop(); } catch (Exception ignored) { /* */ }
                try { track.release(); } catch (Exception ignored) { /* */ }
                if (current == track) current = null;
            }
            unduck(am, focus);
        }
    }

    private static AudioTrack buildTrack(AudioAttributes attrs, int bytes, int mode) {
        return new AudioTrack.Builder()
                .setAudioAttributes(attrs)
                .setAudioFormat(new AudioFormat.Builder()
                        .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .setSampleRate(RATE)
                        .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                        .build())
                .setBufferSizeInBytes(bytes)
                .setTransferMode(mode)
                .build();
    }

    /** Asks other apps to turn down for the tone. Returns what unduck needs, or null. */
    @SuppressWarnings("deprecation")
    private static Object duck(AudioManager am, AudioAttributes attrs) {
        if (am == null) return null;
        try {
            if (Build.VERSION.SDK_INT >= 26) {
                AudioFocusRequest req = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                        .setAudioAttributes(attrs)
                        .setOnAudioFocusChangeListener(change -> { /* a tone this short just plays on */ })
                        .build();
                am.requestAudioFocus(req);
                return req;
            }
            AudioManager.OnAudioFocusChangeListener listener = change -> { /* */ };
            am.requestAudioFocus(listener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK);
            return listener;
        } catch (Exception e) {
            return null;
        }
    }

    @SuppressWarnings("deprecation")
    private static void unduck(AudioManager am, Object focus) {
        if (am == null || focus == null) return;
        try {
            if (Build.VERSION.SDK_INT >= 26 && focus instanceof AudioFocusRequest) am.abandonAudioFocusRequest((AudioFocusRequest) focus);
            else if (focus instanceof AudioManager.OnAudioFocusChangeListener) am.abandonAudioFocus((AudioManager.OnAudioFocusChangeListener) focus);
        } catch (Exception ignored) { /* the duck ends with the process anyway */ }
    }

    private static synchronized void stopCurrent() {
        if (current == null) return;
        try { current.pause(); } catch (Exception ignored) { /* */ }
        try { current.release(); } catch (Exception ignored) { /* */ }
        current = null;
    }
}
