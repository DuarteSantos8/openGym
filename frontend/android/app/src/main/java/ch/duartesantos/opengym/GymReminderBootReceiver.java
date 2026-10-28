package ch.duartesantos.opengym;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Proximity alerts are gone after a restart or an app update; this registers the saved gyms again
 * (GymReminder.register does nothing with the reminder off). Listens for system broadcasts only.
 */
public class GymReminderBootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String a = intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(a) && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(a)) return;
        GymReminder.register(context.getApplicationContext());
    }
}
