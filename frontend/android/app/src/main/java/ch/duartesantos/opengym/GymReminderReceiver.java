package ch.duartesantos.opengym;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** A gym's proximity alert fired, or the alarm that starts the approach check (GymReminder). Explicit and not exported: only the system's alert and alarm reach it. */
public class GymReminderReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        if (GymReminder.actionCheck(context).equals(intent.getAction())) {
            // The exact alarm GymReminder.launchCheck set: its delivery may start the check.
            boolean ok = GymReminder.startScan(context.getApplicationContext());
            if (!ok) GymReminder.note(context.getApplicationContext(), "check: refused at the alarm too");
            return;
        }
        if (!GymReminder.actionEnter(context).equals(intent.getAction())) return;
        final PendingResult pending = goAsync();
        final Context app = context.getApplicationContext();
        new Thread(() -> {
            try {
                GymReminder.onAlert(app, intent);
            } finally {
                pending.finish();
            }
        }, "opengym-gym").start();
    }
}
