package ch.duartesantos.opengym;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class RestTimerReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        String action = intent.getAction();
        RestTimerManager manager = RestTimerManager.getInstance(context);

        if ("ch.duartesantos.opengym.ACTION_START".equals(action)) {
            int seconds = intent.getIntExtra("seconds", 90);
            String exercise = intent.getStringExtra("exercise");
            String set = intent.getStringExtra("set");
            String accentColor = intent.getStringExtra("accentColor");
            manager.start(seconds, exercise != null ? exercise : "Bench Press", set != null ? set : "Set 2/4", accentColor != null ? accentColor : "#30D158");
            manager.notifyActionListener("start");
        } else if (RestTimerManager.ACTION_MINUS_15.equals(action)) {
            manager.addSeconds(-15);
            manager.notifyActionListener("minus15");
        } else if (RestTimerManager.ACTION_PLUS_15.equals(action)) {
            manager.addSeconds(15);
            manager.notifyActionListener("plus15");
        } else if (RestTimerManager.ACTION_SKIP.equals(action)) {
            manager.stop();
            manager.notifyActionListener("skip");
        }
    }
}
