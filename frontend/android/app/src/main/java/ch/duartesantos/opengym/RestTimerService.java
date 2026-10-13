package ch.duartesantos.opengym;

import android.app.Notification;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;

/**
 * Foreground while a rest is running. Reposts one clock and one bar every second, and
 * applies the same controls as the in-app timer: pause, −15s, +15s, skip.
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
    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            if (!running || paused || endsAt <= 0) return;
            long left = endsAt - System.currentTimeMillis();
            if (left <= 0) {
                reachEnd();
                return;
            }
            show();
            // Next on the clock's next whole second, so the last run lands on the end itself.
            handler.postDelayed(this, ((left - 1) % 1000) + 1);
        }
    };

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
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        handler.removeCallbacks(tick);
        releaseCpu();
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
     * this card) comes from RestAlert, which stops this service once it is up. The CPU stays held
     * until then: letting go here could let the phone sleep before that alert holds its own.
     */
    private void reachEnd() {
        running = false;
        RestAlert.fireFromCountdown(getApplicationContext(), endsAt);
    }

    /**
     * Keeps the CPU running until the end, and ten seconds past it. With the screen off a phone
     * otherwise sleeps through this countdown's last second, and the only thing left to wake it
     * is the alarm, which without the exact-alarm permission comes late. Released on pause,
     * on skip and when the service stops after the end, so a held rest costs nothing.
     */
    private void holdCpuUntilEnd() {
        try {
            if (cpu == null) {
                PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
                cpu = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "opengym:rest-countdown");
                cpu.setReferenceCounted(false);
            }
            cpu.acquire(Math.max(0, endsAt - System.currentTimeMillis()) + 10_000);
        } catch (Exception ignored) { /* the alarm is still set */ }
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
