package ch.duartesantos.opengym;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import androidx.core.app.ActivityCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(InstallPlugin.class);
        registerPlugin(PrintPlugin.class);
        registerPlugin(RestTimerPlugin.class);
        registerPlugin(WorkoutWidgetPlugin.class);
        super.onCreate(savedInstanceState);

        RestTimerManager.getInstance(this);
        WorkoutWidgetManager.updateAllWidgets(this);

        handleAutoStartIntent(getIntent());

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.POST_NOTIFICATIONS}, 101);
            }
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleAutoStartIntent(intent);
    }

    private void handleAutoStartIntent(Intent intent) {
        if (intent == null) return;
        if ("ch.duartesantos.opengym.ACTION_START_WORKOUT".equals(intent.getAction())
                || intent.getBooleanExtra("autoStart", false)) {
            WorkoutWidgetPlugin.notifyAutoStartWorkout(this);
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        WorkoutWidgetManager.updateAllWidgets(this);
    }
}
