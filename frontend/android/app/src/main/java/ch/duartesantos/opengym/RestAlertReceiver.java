package ch.duartesantos.opengym;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Fired by AlarmManager when a rest ends, including while the screen is locked. */
public class RestAlertReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        final PendingResult pending = goAsync();
        final Context app = context.getApplicationContext();
        new Thread(() -> {
            try {
                RestAlert.fire(app, intent);
            } finally {
                pending.finish();
            }
        }, "opengym-rest").start();
    }
}
