package ch.duartesantos.opengym;

import android.app.Notification;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;

/**
 * Foreground while a rest is running. Shows one clock and one bar, and applies the same controls
 * as the in-app timer: pause, −15s, +15s, skip. The clock is a Chronometer the system runs; the
 * card is reposted every second only while the screen is on (for the bar), see RestCountdownPlan.
 */
public class RestTimerService extends Service {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private long endsAt;
    private long totalMs;
    private long pausedLeft;
    private boolean paused;
    private boolean running;
    private String pauseLabel = "Pause";
    private String resumeLabel = "Resume";
    private String minusLabel = "\u2212 15s";
    private String plusLabel = "+ 15s";
    private String skipLabel = "Skip";
    private int accent = 0xFF30D158;
    private int ink = 0xFF000000;
    private PowerManager.WakeLock cpu;
    private PowerManager power;
    private BroadcastReceiver screenOn;
    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            if (!running || paused || endsAt <= 0) return;
            long left = endsAt - System.currentTimeMillis();
            if (left <= 0) {
                reachEnd();
                return;
            }
            // Screen off: nobody sees the card, and the Chronometer keeps the clock right anyway.
            // Turning the screen on runs this loop at once (screenOn), so the bar catches up.
            boolean interactive = interactive();
            if (interactive) show();
            handler.postDelayed(this, RestCountdownPlan.nextTickMs(left, interactive));
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        power = (PowerManager) getSystemService(POWER_SERVICE);
        screenOn = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (!running || paused) return;
                handler.removeCallbacks(tick);
                tick.run();
            }
        };
        try {
            IntentFilter f = new IntentFilter(Intent.ACTION_SCREEN_ON);
            if (Build.VERSION.SDK_INT >= 33) registerReceiver(screenOn, f, Context.RECEIVER_NOT_EXPORTED);
            else registerReceiver(screenOn, f);
        } catch (Exception e) {
            screenOn = null;
        }
    }

    private boolean interactive() {
        try {
            return power == null || power.isInteractive();
        } catch (Exception e) {
            return true;
        }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        if (RestAlert.ACTION_ACCENT.equals(action)) {
            if (!running) {
                // Only this start: a countdown asked for right behind it must still come up.
                stopSelf(startId);
                return START_NOT_STICKY;
            }
            accent = intent.getIntExtra("accent", accent);
            ink = intent.getIntExtra("ink", ink);
            RestAlert.setAccentColor(accent, ink);
            show();
            return START_NOT_STICKY;
        }
        if (RestAlert.ACTION_HOLD.equals(action)) {
            if (running) hold(intent.getLongExtra("leftMs", 0), intent.getLongExtra("totalMs", 0));
            else stopSelf(startId);
            return START_NOT_STICKY;
        }
        if (RestAlert.ACTION_SKIP.equals(action)) {
            finishSkip();
            return START_NOT_STICKY;
        }
        if (RestAlert.ACTION_PAUSE.equals(action)) {
            if (running) togglePause();
            return START_NOT_STICKY;
        }
        if (RestAlert.ACTION_MINUS.equals(action)) {
            if (running) nudge(-15_000);
            return START_NOT_STICKY;
        }
        if (RestAlert.ACTION_PLUS.equals(action)) {
            if (running) nudge(15_000);
            return START_NOT_STICKY;
        }
        long nextEnd = intent == null ? 0 : intent.getLongExtra("endsAt", 0);
        if (nextEnd <= System.currentTimeMillis()) {
            stopForegroundCompat();
            stopSelf();
            return START_NOT_STICKY;
        }
        endsAt = nextEnd;
        long passed = intent.getLongExtra("totalMs", 0);
        totalMs = passed > 0 ? passed : Math.max(1000, endsAt - System.currentTimeMillis());
        paused = false;
        running = true;
        holdCpuUntilEnd();
        pauseLabel = text(intent, "pause", pauseLabel);
        resumeLabel = text(intent, "resume", resumeLabel);
        minusLabel = text(intent, "minus", minusLabel);
        plusLabel = text(intent, "plus", plusLabel);
        skipLabel = text(intent, "skip", skipLabel);
        if (intent != null && intent.hasExtra("accent")) accent = intent.getIntExtra("accent", accent);
        if (intent != null && intent.hasExtra("ink")) ink = intent.getIntExtra("ink", ink);
        handler.removeCallbacks(tick);
        tick.run();
        // A foreground service must post its card now, whether or not the screen is on.
        if (running && !interactive()) show();
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        handler.removeCallbacks(tick);
        releaseCpu();
        if (screenOn != null) {
            try { unregisterReceiver(screenOn); } catch (Exception ignored) { /* not registered */ }
            screenOn = null;
        }
        endsAt = 0;
        stopForegroundCompat();
        super.onDestroy();
    }

    private void togglePause() {
        if (!paused) {
            pausedLeft = Math.max(0, endsAt - System.currentTimeMillis());
            paused = true;
            handler.removeCallbacks(tick);
            releaseCpu();
            RestAlert.cancelAlarmOnly(this, RestAlert.NOTIFICATION_ID);
        } else {
            endsAt = System.currentTimeMillis() + pausedLeft;
            paused = false;
            holdCpuUntilEnd();
            RestAlert.updateAlarm(this, endsAt);
            handler.removeCallbacks(tick);
            tick.run();
        }
        show();
        emit("pause");
    }

    /**
     * Paused in the app. The clock stops at the time the app holds, so the two read the same,
     * and the button offers Resume. No event goes back: the app made this change. The plugin
     * has already called off the alarm.
     */
    private void hold(long leftMs, long total) {
        if (leftMs <= 0) return;
        paused = true;
        pausedLeft = leftMs;
        if (total > 0) totalMs = total;
        handler.removeCallbacks(tick);
        releaseCpu();
        show();
    }

    private void nudge(long deltaMs) {
        long now = System.currentTimeMillis();
        // endsAt may already be in the past when +15 lands on the last second.
        // Adding the delta to that old deadline would leave the clock stuck.
        long left = paused ? pausedLeft : Math.max(0, endsAt - now);
        left += deltaMs;
        if (left > totalMs) totalMs = left;
        if (left <= 0) {
            finishSkip();
            return;
        }
        if (paused) pausedLeft = left;
        else {
            endsAt = now + left;
            holdCpuUntilEnd();
            RestAlert.updateAlarm(this, endsAt);
            handler.removeCallbacks(tick);
            handler.post(tick);
        }
        show();
        emit("adjust");
    }

    /**
     * The end, reached by this countdown. The alert (or, with the app on screen, just the end of
     * this card) comes from RestAlert, which stops this service once it is up. The CPU is held
     * until then (a short lock when the rest itself held none): letting go here could let the
     * phone sleep before that alert holds its own, with the alarm already called off.
     */
    private void reachEnd() {
        running = false;
        holdCpuBriefly();
        RestAlert.fireFromCountdown(getApplicationContext(), endsAt);
    }

    /**
     * With exact alarms allowed, the alarm wakes the phone at the end (also in Doze) and
     * RestAlert.fire holds the CPU for the alert, so the rest itself holds nothing. Without
     * them the alarm may come most of a rest late: then the CPU is kept running until the end,
     * and ten seconds past it, so this countdown sounds the end on time with the screen off.
     * Released on pause, on skip and when the service stops after the end.
     */
    private void holdCpuUntilEnd() {
        long hold = RestCountdownPlan.cpuHoldMs(
                RestAlert.exactAllowed(this), endsAt - System.currentTimeMillis());
        if (hold <= 0) {
            releaseCpu();
            return;
        }
        try {
            if (cpu == null) {
                PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
                cpu = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "opengym:rest-countdown");
                cpu.setReferenceCounted(false);
            }
            cpu.acquire(hold);
        } catch (Exception ignored) { /* the alarm is still set */ }
    }

    private void holdCpuBriefly() {
        try {
            if (cpu == null) {
                PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
                cpu = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "opengym:rest-countdown");
                cpu.setReferenceCounted(false);
            }
            if (!cpu.isHeld()) cpu.acquire(RestCountdownPlan.END_GRACE_MS);
        } catch (Exception ignored) { /* the alert takes its own */ }
    }

    private void releaseCpu() {
        try {
            if (cpu != null && cpu.isHeld()) cpu.release();
        } catch (Exception ignored) { /* already released by its timeout */ }
    }

    private void finishSkip() {
        running = false;
        handler.removeCallbacks(tick);
        releaseCpu();
        RestAlert.cancelAlarmOnly(this, RestAlert.NOTIFICATION_ID);
        RestAlertPlugin.emit("skip", 0, 0, 0, false);
        stopForegroundCompat();
        stopSelf();
    }

    private void emit(String type) {
        long left = paused ? pausedLeft : Math.max(0, endsAt - System.currentTimeMillis());
        RestAlertPlugin.emit(type, endsAt, totalMs, left, paused);
    }

    private void show() {
        try {
            long left = paused ? pausedLeft : Math.max(0, endsAt - System.currentTimeMillis());
            Notification n = RestAlert.countdownNotification(
                    this, left, totalMs, paused, pauseLabel, resumeLabel, minusLabel, plusLabel, skipLabel, accent, ink);
            if (Build.VERSION.SDK_INT >= 34) {
                startForeground(RestAlert.COUNTDOWN_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
            } else {
                startForeground(RestAlert.COUNTDOWN_ID, n);
            }
        } catch (Exception e) {
            stopSelf();
        }
    }

    private static String text(Intent intent, String key, String fallback) {
        if (intent == null) return fallback;
        String v = intent.getStringExtra(key);
        return v == null || v.isEmpty() ? fallback : v;
    }

    @SuppressWarnings("deprecation")
    private void stopForegroundCompat() {
        if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE);
        else stopForeground(true);
    }
}
