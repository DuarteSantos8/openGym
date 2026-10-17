package ch.duartesantos.opengym.wear

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import androidx.wear.ambient.AmbientLifecycleObserver
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.wear.compose.material.MaterialTheme

class MainActivity : ComponentActivity() {
    private val ambientCallback = object : AmbientLifecycleObserver.AmbientLifecycleCallback {
        override fun onEnterAmbient(ambientDetails: AmbientLifecycleObserver.AmbientDetails) {
            Ambient.on.value = true
        }

        override fun onExitAmbient() {
            Ambient.on.value = false
            Ambient.tick.value += 1
        }

        override fun onUpdateAmbient() {
            Ambient.tick.value += 1
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        lifecycle.addObserver(AmbientLifecycleObserver(this, ambientCallback))
        Repository.init(applicationContext)
        setContent { WatchApp() }
    }

    override fun onStart() {
        super.onStart()
        Repository.onForeground()
    }
}

@Composable
fun WatchApp() {
    MaterialTheme {
        val loaded by Repository.loaded.collectAsStateWithLifecycle()
        val active by Repository.active.collectAsStateWithLifecycle()
        var menu by rememberSaveable { mutableStateOf(false) }
        val a = active

        // The ongoing-activity notification needs the permission on Wear OS 4+; asked once, when a workout starts.
        val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
        val context = androidx.compose.ui.platform.LocalContext.current
        LaunchedEffect(a != null) {
            if (a != null && Build.VERSION.SDK_INT >= 33 &&
                ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
            ) ask.launch(Manifest.permission.POST_NOTIFICATIONS)
        }

        if (!loaded) EmptyScreen()
        else if (a == null) HomeScreen()
        else if (menu) MenuScreen(a, onClose = { menu = false })
        else if (a.session.finished) DoneScreen(a)
        else WorkoutScreen(a, onMenu = { menu = true })
    }
}
