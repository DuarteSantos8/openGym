package ch.duartesantos.opengym;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Log;

public class WorkoutWidgetProvider extends AppWidgetProvider {
    private static final String TAG = "WorkoutWidgetProvider";

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        super.onUpdate(context, appWidgetManager, appWidgetIds);
        WorkoutWidgetManager.updateAllWidgets(context);
    }

    @Override
    public void onEnabled(Context context) {
        super.onEnabled(context);
        WorkoutWidgetManager.updateAllWidgets(context);
    }

    private void triggerHaptic(Context context, boolean isHeavy) {
        try {
            Vibrator vibrator = (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
            if (vibrator != null && vibrator.hasVibrator()) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    int effectId = isHeavy ? VibrationEffect.EFFECT_HEAVY_CLICK : VibrationEffect.EFFECT_CLICK;
                    vibrator.vibrate(VibrationEffect.createPredefined(effectId));
                } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vibrator.vibrate(VibrationEffect.createOneShot(isHeavy ? 35 : 15, VibrationEffect.DEFAULT_AMPLITUDE));
                } else {
                    vibrator.vibrate(isHeavy ? 35 : 15);
                }
            }
        } catch (Exception ignored) {}
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        String action = intent != null ? intent.getAction() : null;
        if (action == null) return;

        Log.d(TAG, "onReceive action: " + action);

        if (WorkoutWidgetManager.ACTION_WEIGHT_MINUS.equals(action)) {
            triggerHaptic(context, false);
            double step = intent.getDoubleExtra("step", 2.5);
            WorkoutWidgetManager.adjustActiveWeight(context, -step);
        } else if (WorkoutWidgetManager.ACTION_WEIGHT_PLUS.equals(action)) {
            triggerHaptic(context, false);
            double step = intent.getDoubleExtra("step", 2.5);
            WorkoutWidgetManager.adjustActiveWeight(context, step);
        } else if (WorkoutWidgetManager.ACTION_REPS_MINUS.equals(action)) {
            triggerHaptic(context, false);
            WorkoutWidgetManager.adjustActiveReps(context, -1);
        } else if (WorkoutWidgetManager.ACTION_REPS_PLUS.equals(action)) {
            triggerHaptic(context, false);
            WorkoutWidgetManager.adjustActiveReps(context, 1);
        } else if (WorkoutWidgetManager.ACTION_LOG_SET.equals(action)) {
            triggerHaptic(context, true);
            WorkoutWidgetManager.logActiveSet(context);
        } else if (WorkoutWidgetManager.ACTION_REST_PLUS_15.equals(action)) {
            triggerHaptic(context, false);
            WorkoutWidgetManager.addRest(context, 15);
        } else if (WorkoutWidgetManager.ACTION_REST_SKIP.equals(action)) {
            triggerHaptic(context, true);
            WorkoutWidgetManager.skipRest(context);
        } else if (AppWidgetManager.ACTION_APPWIDGET_UPDATE.equals(action)
                || WorkoutWidgetManager.ACTION_MIDNIGHT_RESET.equals(action)
                || "ch.duartesantos.opengym.WORKOUT_STATE_CHANGED".equals(action)
                || Intent.ACTION_DATE_CHANGED.equals(action)
                || Intent.ACTION_TIME_CHANGED.equals(action)
                || Intent.ACTION_TIMEZONE_CHANGED.equals(action)) {
            WorkoutWidgetManager.updateAllWidgets(context);
        }
    }
}
