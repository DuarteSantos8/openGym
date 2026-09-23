package ch.duartesantos.opengym;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.widget.RemoteViews;

import androidx.core.app.NotificationCompat;

public class RestTimerManager {
    public static final String ACTION_MINUS_15 = "ch.duartesantos.opengym.ACTION_MINUS_15";
    public static final String ACTION_PLUS_15 = "ch.duartesantos.opengym.ACTION_PLUS_15";
    public static final String ACTION_SKIP = "ch.duartesantos.opengym.ACTION_SKIP";

    private static final String CHANNEL_ID = "opengym_rest_timer_v3";
    private static final int NOTIFICATION_ID = 200;

    private static RestTimerManager instance;
    private final Context context;
    private final NotificationManager notificationManager;
    private final Handler handler = new Handler(Looper.getMainLooper());

    private long endsAtMs = 0;
    private int totalDurationSec = 0;
    private String exerciseName = "";
    private String setInfo = "";
    private String accentColor = "#30D158";
    private boolean isRunning = false;

    public interface RestActionListener {
        void onAction(String actionId);
    }
    private RestActionListener listener;

    public static synchronized RestTimerManager getInstance(Context ctx) {
        if (instance == null) {
            instance = new RestTimerManager(ctx.getApplicationContext());
        }
        return instance;
    }

    private RestTimerManager(Context ctx) {
        this.context = ctx;
        this.notificationManager = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        createNotificationChannel();
    }

    public void setActionListener(RestActionListener l) {
        this.listener = l;
    }

    public void notifyActionListener(String actionId) {
        if (listener != null) {
            listener.onAction(actionId);
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Rest Timer",
                    NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("Workout rest timer notification widget");
            channel.setShowBadge(true);
            channel.setSound(null, null);
            channel.enableVibration(false);
            channel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
            notificationManager.createNotificationChannel(channel);
        }
    }

    public synchronized void start(int seconds, String exercise, String set) {
        start(seconds, exercise, set, "#30D158");
    }

    public synchronized void start(int seconds, String exercise, String set, String accent) {
        this.totalDurationSec = Math.max(1, seconds);
        this.endsAtMs = System.currentTimeMillis() + (seconds * 1000L);
        this.exerciseName = exercise != null ? exercise : "";
        this.setInfo = set != null ? set : "";
        this.accentColor = (accent != null && !accent.isEmpty()) ? accent : "#30D158";
        this.isRunning = true;

        android.util.Log.d("RestTimer", "start() called: seconds=" + seconds + ", ex=" + exerciseName + ", set=" + setInfo + ", accent=" + accentColor);
        handler.removeCallbacks(tickRunnable);
        handler.post(tickRunnable);
    }

    public synchronized void addSeconds(int delta) {
        if (!isRunning) return;
        this.endsAtMs += (delta * 1000L);
        int remaining = getRemainingSeconds();
        if (remaining <= 0) {
            stop();
            triggerCompletionAlert();
            notifyActionListener("completed");
            return;
        }
        if (remaining > totalDurationSec) {
            totalDurationSec = remaining;
        }
        updateNotification();
    }

    public synchronized void stop() {
        this.isRunning = false;
        handler.removeCallbacks(tickRunnable);
        try {
            notificationManager.cancel(NOTIFICATION_ID);
        } catch (Exception ignored) {}
        WorkoutWidgetManager.updateAllWidgets(context);
    }

    public synchronized boolean isRunning() {
        return isRunning;
    }

    public synchronized int getRemainingSeconds() {
        if (!isRunning) return 0;
        long now = System.currentTimeMillis();
        return (int) Math.max(0, (endsAtMs - now + 999) / 1000);
    }

    public synchronized int getTotalDurationSec() {
        return totalDurationSec;
    }

    public synchronized String getExerciseName() {
        return exerciseName;
    }

    public synchronized String getSetInfo() {
        return setInfo;
    }

    public synchronized String getAccentColor() {
        return accentColor;
    }

    private final Runnable tickRunnable = new Runnable() {
        @Override
        public void run() {
            if (!isRunning) return;
            int remaining = getRemainingSeconds();
            if (remaining <= 0) {
                stop();
                triggerCompletionAlert();
                notifyActionListener("completed");
                return;
            }
            updateNotification();
            WorkoutWidgetManager.updateAllWidgets(context);
            handler.postDelayed(this, 1000);
        }
    };

    private void triggerCompletionAlert() {
        try {
            Vibrator vibrator = (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
            if (vibrator != null && vibrator.hasVibrator()) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    long[] timings = {0, 200, 100, 250};
                    int[] amplitudes = {0, 255, 0, 255};
                    vibrator.vibrate(VibrationEffect.createWaveform(timings, amplitudes, -1));
                } else {
                    vibrator.vibrate(new long[]{0, 200, 100, 250}, -1);
                }
            }

            Uri alertUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
            Ringtone ringtone = RingtoneManager.getRingtone(context, alertUri);
            if (ringtone != null) {
                ringtone.play();
            }
        } catch (Exception e) {
            android.util.Log.e("RestTimer", "Error in triggerCompletionAlert", e);
        }
    }

    public static String toTitleCase(String input) {
        if (input == null || input.isEmpty()) return "";
        StringBuilder sb = new StringBuilder();
        boolean nextTitleCase = true;
        for (char c : input.toCharArray()) {
            if (Character.isSpaceChar(c) || c == '-' || c == '/') {
                nextTitleCase = true;
                sb.append(c);
            } else if (nextTitleCase) {
                sb.append(Character.toTitleCase(c));
                nextTitleCase = false;
            } else {
                sb.append(Character.toLowerCase(c));
            }
        }
        return sb.toString();
    }

    private Bitmap createPillBitmap(int color, int widthDp, int heightDp, float cornerRadiusDp) {
        try {
            float density = context.getResources().getDisplayMetrics().density;
            int widthPx = Math.max(1, (int) (widthDp * density));
            int heightPx = Math.max(1, (int) (heightDp * density));
            float cornerRadiusPx = cornerRadiusDp * density;

            Bitmap bitmap = Bitmap.createBitmap(widthPx, heightPx, Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(bitmap);
            Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
            paint.setColor(color);
            paint.setStyle(Paint.Style.FILL);
            RectF rect = new RectF(0, 0, widthPx, heightPx);
            canvas.drawRoundRect(rect, cornerRadiusPx, cornerRadiusPx, paint);
            return bitmap;
        } catch (Exception e) {
            return null;
        }
    }

    private Bitmap createProgressBarBitmap(int color, int progressPercent, int widthDp, int heightDp) {
        try {
            float density = context.getResources().getDisplayMetrics().density;
            int widthPx = Math.max(10, (int) (widthDp * density));
            int heightPx = Math.max(2, (int) (heightDp * density));
            float radius = heightPx / 2f;

            Bitmap bitmap = Bitmap.createBitmap(widthPx, heightPx, Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(bitmap);

            // Track background (dark neutral)
            Paint trackPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
            trackPaint.setColor(Color.parseColor("#2C2C2E"));
            RectF fullRect = new RectF(0, 0, widthPx, heightPx);
            canvas.drawRoundRect(fullRect, radius, radius, trackPaint);

            // Progress fill (theme accent color)
            if (progressPercent > 0) {
                Paint progressPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
                progressPaint.setColor(color);
                float fillWidth = (widthPx * Math.min(100, Math.max(0, progressPercent))) / 100f;
                RectF progressRect = new RectF(0, 0, fillWidth, heightPx);
                canvas.drawRoundRect(progressRect, radius, radius, progressPaint);
            }
            return bitmap;
        } catch (Exception e) {
            return null;
        }
    }

    private int getContrastTextColor(int color) {
        double luminance = (0.299 * Color.red(color) + 0.587 * Color.green(color) + 0.114 * Color.blue(color)) / 255.0;
        return luminance > 0.5 ? Color.BLACK : Color.WHITE;
    }

    private void updateNotification() {
        int remaining = getRemainingSeconds();
        int minutes = remaining / 60;
        int seconds = remaining % 60;
        String timeStr = String.format("%d:%02d", minutes, seconds);

        int progress = totalDurationSec > 0 ? Math.min(100, Math.max(0, (remaining * 100) / totalDurationSec)) : 0;

        String formattedExercise = toTitleCase(exerciseName);
        if (formattedExercise.isEmpty()) formattedExercise = "Rest Timer";

        String subtitle = !setInfo.isEmpty() ? formattedExercise + " · " + setInfo : formattedExercise;

        // PendingIntent to launch app on body click
        Intent launchIntent = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent contentIntent = PendingIntent.getActivity(context, 0, launchIntent, flags);

        // Background broadcast PendingIntents for buttons
        Intent minusIntent = new Intent(context, RestTimerReceiver.class).setAction(ACTION_MINUS_15);
        PendingIntent minusPending = PendingIntent.getBroadcast(context, 1, minusIntent, flags);

        Intent plusIntent = new Intent(context, RestTimerReceiver.class).setAction(ACTION_PLUS_15);
        PendingIntent plusPending = PendingIntent.getBroadcast(context, 2, plusIntent, flags);

        Intent skipIntent = new Intent(context, RestTimerReceiver.class).setAction(ACTION_SKIP);
        PendingIntent skipPending = PendingIntent.getBroadcast(context, 3, skipIntent, flags);

        int themeColor = Color.parseColor("#30D158");
        try {
            if (accentColor != null && !accentColor.isEmpty()) {
                themeColor = Color.parseColor(accentColor);
            }
        } catch (Exception ignored) {}

        int skipTextColor = getContrastTextColor(themeColor);
        Bitmap skipPillBmpExpanded = createPillBitmap(themeColor, 96, 40, 20);
        Bitmap skipPillBmpCollapsed = createPillBitmap(themeColor, 64, 34, 17);
        Bitmap progressBarBmp = createProgressBarBitmap(themeColor, progress, 300, 5);

        // Expanded RemoteViews
        RemoteViews expandedView = new RemoteViews(context.getPackageName(), R.layout.notification_rest_timer);
        expandedView.setTextViewText(R.id.notification_exercise_name, formattedExercise);
        expandedView.setTextViewText(R.id.notification_set_info, setInfo);
        expandedView.setTextColor(R.id.notification_set_info, themeColor);
        expandedView.setTextViewText(R.id.notification_timer_text, timeStr);

        if (progressBarBmp != null) {
            expandedView.setImageViewBitmap(R.id.notification_progress_bar, progressBarBmp);
        }

        if (skipPillBmpExpanded != null) {
            expandedView.setImageViewBitmap(R.id.btn_skip_bg, skipPillBmpExpanded);
        }
        expandedView.setTextColor(R.id.btn_skip_text, skipTextColor);

        expandedView.setOnClickPendingIntent(R.id.btn_minus_15, minusPending);
        expandedView.setOnClickPendingIntent(R.id.btn_plus_15, plusPending);
        expandedView.setOnClickPendingIntent(R.id.btn_skip, skipPending);

        // Collapsed RemoteViews
        RemoteViews collapsedView = new RemoteViews(context.getPackageName(), R.layout.notification_rest_timer_collapsed);
        collapsedView.setTextViewText(R.id.notification_subtitle, subtitle);
        collapsedView.setTextViewText(R.id.notification_timer_text, timeStr);

        if (skipPillBmpCollapsed != null) {
            collapsedView.setImageViewBitmap(R.id.btn_skip_bg, skipPillBmpCollapsed);
        }
        collapsedView.setTextColor(R.id.btn_skip_text, skipTextColor);

        collapsedView.setOnClickPendingIntent(R.id.btn_plus_15, plusPending);
        collapsedView.setOnClickPendingIntent(R.id.btn_skip, skipPending);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_timer)
                .setContentTitle("Rest · " + timeStr)
                .setContentText(subtitle)
                .setCustomContentView(collapsedView)
                .setCustomBigContentView(expandedView)
                .setStyle(new NotificationCompat.DecoratedCustomViewStyle())
                .setContentIntent(contentIntent)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setColor(themeColor)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setPriority(NotificationCompat.PRIORITY_HIGH);

        try {
            notificationManager.notify(NOTIFICATION_ID, builder.build());
        } catch (Exception ex) {
            android.util.Log.e("RestTimer", "Error posting notification", ex);
        }
    }
}
