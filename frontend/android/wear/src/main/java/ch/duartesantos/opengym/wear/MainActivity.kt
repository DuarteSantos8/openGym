package ch.duartesantos.opengym.wear

import android.content.Context
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.offset
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.lifecycle.lifecycleScope
import androidx.wear.ambient.AmbientLifecycleObserver
import androidx.wear.compose.material3.AppScaffold
import ch.duartesantos.opengym.wear.ui.Accent
import ch.duartesantos.opengym.wear.ui.OgTimeText
import ch.duartesantos.opengym.wear.ui.OpenGymTheme
import ch.duartesantos.opengym.wear.ui.WearApp
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

/**
 * The watch app: one activity, the screen picked from the state (ui/Screens.kt), in the app's
 * accent and language (Lang). With the wrist down it stays on screen in Always On, drawn as
 * outlines (AmbientLifecycleObserver). It asks for the heart rate the first time a workout shows
 * up and keeps the workout service running while one does.
 */
class MainActivity : ComponentActivity() {
    private var askedHr = false
    private var demoShown = false
    private val reduceMotion = mutableStateOf(false)

    private val askHr = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        WorkoutService.sync(this)
    }

    private var burnIn = false
    private val minute = mutableIntStateOf(0)

    private val ambient = AmbientLifecycleObserver(this, object : AmbientLifecycleObserver.AmbientLifecycleCallback {
        override fun onEnterAmbient(ambientDetails: AmbientLifecycleObserver.AmbientDetails) {
            burnIn = ambientDetails.burnInProtectionRequired
            minute.intValue = 0
            WearStore.ambient.value = true
        }
        override fun onExitAmbient() { WearStore.ambient.value = false; minute.intValue = 0 }
        // Once a minute in Always On: a screen that can burn in moves a little (BurnIn).
        override fun onUpdateAmbient() { if (burnIn) minute.intValue++ }
    })

    override fun attachBaseContext(base: Context) {
        WearStore.init(base)
        super.attachBaseContext(Lang.wrap(base, WearStore.lang))
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        lifecycle.addObserver(ambient)
        // The app's language changed on the phone: drawn again in it.
        lifecycleScope.launch {
            WearStore.state.map { it.settings.lang }.distinctUntilChanged().drop(1).collect { recreate() }
        }
        val round = resources.configuration.isScreenRound
        setContent {
            val s by WearStore.state.collectAsState()
            val dim by WearStore.ambient.collectAsState()
            OpenGymTheme(accent = Accent.of(s.settings), ambient = dim, reduceMotion = reduceMotion.value, round = round) {
                Box(Modifier.offset { BurnIn.offset(minute.intValue).let { (x, y) -> IntOffset(x.dp.roundToPx(), y.dp.roundToPx()) } }) {
                    AppScaffold(timeText = { OgTimeText() }) {
                        WearApp(onWorkoutShown = { onWorkout() })
                    }
                }
            }
        }
        demo(intent)
        openPage(intent)
    }

    // Any touch is a reaction to "rest over", as on the Apple Watch: no second buzz.
    override fun dispatchTouchEvent(ev: android.view.MotionEvent): Boolean {
        if (ev.actionMasked == android.view.MotionEvent.ACTION_DOWN) WearStore.ackRestOver()
        return super.dispatchTouchEvent(ev)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        demo(intent)
        openPage(intent)
    }

    /** Finish on the "Still training?" notification: the Overview, where the hold finishes. */
    private fun openPage(intent: Intent?) {
        if (intent?.getStringExtra(IdleNotice.EXTRA_PAGE) != "overview") return
        intent.removeExtra(IdleNotice.EXTRA_PAGE)
        WearStore.keepGoing()
        WearStore.page.value = Page.OVERVIEW
    }

    override fun onResume() {
        super.onResume()
        reduceMotion.value = WearStore.reduceMotion(this)
        if (!demoShown) { PhoneLink.pull(this); WearStore.checkIn(BuildConfig.VERSION_NAME) }
        WorkoutService.sync(this)
    }

    /** A workout is on screen: heart rate asked for once (Health Services), then the service. */
    private fun onWorkout() {
        if (demoShown) return
        if (!WorkoutService.hasHrPermission(this) && !askedHr) {
            askedHr = true
            // The heart rate, and the notification that keeps the workout on the watch face.
            askHr.launch(arrayOf(WorkoutService.hrPermission(), android.Manifest.permission.POST_NOTIFICATIONS))
        } else WorkoutService.sync(this)
    }

    /**
     * Debug builds only: `adb shell am start -n <pkg>/ch.duartesantos.opengym.wear.MainActivity --es demo rest`
     * shows one screen with the demo workout in src/debug/assets (text and numbers, no media), for
     * the screenshots in the docs and the store listing. `--es ambient 1` draws it as Always On,
     * `--es lang de` in another of the app's languages.
     */
    private fun demo(intent: Intent?) {
        if (!BuildConfig.DEBUG) return
        val screen = intent?.getStringExtra("demo") ?: return
        demoShown = true
        val json = try { assets.open("demo-snapshot.json").bufferedReader().readText() } catch (_: Exception) { return }
        val now = System.currentTimeMillis()
        val filled = json.replace("\"__START__\"", "${now - 25 * 60_000}").replace("\"__AT1__\"", "${now - 20 * 60_000}")
            .replace("\"__AT2__\"", "${now - 16 * 60_000}")
            .replace("\"lang\": \"en\"", "\"lang\": \"${intent.getStringExtra("lang") ?: "en"}\"")
        WearStore.ambient.value = intent.getStringExtra("ambient") == "1"
        WearStore.demo(screen, filled)
    }
}
