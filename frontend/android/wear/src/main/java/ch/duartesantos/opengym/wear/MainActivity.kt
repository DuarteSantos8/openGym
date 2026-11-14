package ch.duartesantos.opengym.wear

import android.content.Context
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.lifecycle.lifecycleScope
import androidx.wear.compose.material3.AppScaffold
import androidx.wear.compose.material3.TimeText
import ch.duartesantos.opengym.wear.ui.OpenGymTheme
import ch.duartesantos.opengym.wear.ui.WearApp
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

/**
 * The watch app: one activity, the screen picked from the state (ui/Screens.kt). It speaks the
 * app's language (Lang), asks for the heart rate the first time a workout shows up, and keeps the
 * workout service running while one does.
 */
class MainActivity : ComponentActivity() {
    private var askedHr = false

    private val askHr = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        WorkoutService.sync(this)
    }

    override fun attachBaseContext(base: Context) {
        WearStore.init(base)
        super.attachBaseContext(Lang.wrap(base, WearStore.lang))
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // The app's language changed on the phone: drawn again in it.
        lifecycleScope.launch {
            WearStore.state.map { it.settings.lang }.distinctUntilChanged().drop(1).collect { recreate() }
        }
        setContent {
            OpenGymTheme {
                AppScaffold(timeText = { TimeText() }) {
                    WearApp(onWorkoutShown = { onWorkout() })
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        PhoneLink.pull(this)
        WorkoutService.sync(this)
    }

    /** A workout is on screen: heart rate asked for once (Health Services), then the service. */
    private fun onWorkout() {
        if (!WorkoutService.hasHrPermission(this) && !askedHr) {
            askedHr = true
            // The heart rate, and the notification that keeps the workout on the watch face.
            askHr.launch(arrayOf(WorkoutService.hrPermission(), android.Manifest.permission.POST_NOTIFICATIONS))
        } else WorkoutService.sync(this)
    }
}
