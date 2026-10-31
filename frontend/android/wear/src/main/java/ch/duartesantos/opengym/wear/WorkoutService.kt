package ch.duartesantos.opengym.wear

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.health.services.client.ExerciseUpdateCallback
import androidx.health.services.client.HealthServices
import androidx.health.services.client.data.Availability
import androidx.health.services.client.data.DataType
import androidx.health.services.client.data.ExerciseConfig
import androidx.health.services.client.data.ExerciseLapSummary
import androidx.health.services.client.data.ExerciseType
import androidx.health.services.client.data.ExerciseUpdate
import androidx.wear.ongoing.OngoingActivity
import androidx.wear.ongoing.Status
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.guava.await
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

/**
 * The running workout, kept alive with the screen off: heart rate from Health Services (an
 * exercise of the strength-training type, the sensor at workout rate), the rest's buzz on time, and
 * the workout on the watch face as an ongoing activity (a tap opens the app). It runs only while a
 * workout does, and only with the heart-rate permission (a health-type foreground service needs
 * it). Without it the same ongoing notification is shown without the service.
 */
class WorkoutService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var exerciseOn = false

    private val hrCallback = object : ExerciseUpdateCallback {
        override fun onExerciseUpdateReceived(update: ExerciseUpdate) {
            val bpm = update.latestMetrics.getData(DataType.HEART_RATE_BPM).lastOrNull()?.value ?: return
            WearStore.onHeartRate(bpm.roundToInt())
        }
        override fun onLapSummaryReceived(lapSummary: ExerciseLapSummary) {}
        override fun onRegistered() {}
        override fun onRegistrationFailed(throwable: Throwable) {}
        override fun onAvailabilityChanged(dataType: DataType<*, *>, availability: Availability) {}
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        alive = true
        WearStore.init(this)
        val n = notification(this, WearStore.state.value, WearStore.rest.value)
        try {
            startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH)
        } catch (_: Exception) {
            // Not allowed now (no permission, or started from the background): the plain notification.
            post(this)
            stopSelf()
            return
        }
        scope.launch { startHeartRate() }
        scope.launch {
            WearStore.state.combine(WearStore.rest) { s, r -> s to r }.collect { (s, r) ->
                if (s.workout == null) { stopSelf(); return@collect }
                getSystemService(NotificationManager::class.java).notify(NOTIF_ID, notification(this@WorkoutService, s, r))
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int) = START_STICKY

    private suspend fun startHeartRate() {
        if (!hasHrPermission(this)) return
        try {
            val client = HealthServices.getClient(this).exerciseClient
            val caps = client.getCapabilitiesAsync().await()
            val type = listOf(ExerciseType.STRENGTH_TRAINING, ExerciseType.WEIGHTLIFTING, ExerciseType.WORKOUT)
                .firstOrNull { it in caps.supportedExerciseTypes && DataType.HEART_RATE_BPM in caps.getExerciseTypeCapabilities(it).supportedDataTypes }
                ?: return
            client.setUpdateCallback(hrCallback)
            val config = ExerciseConfig.builder(type)
                .setDataTypes(setOf(DataType.HEART_RATE_BPM))
                .setIsAutoPauseAndResumeEnabled(false)
                .setIsGpsEnabled(false)
                .build()
            client.startExerciseAsync(config).await()
            exerciseOn = true
        } catch (_: Exception) { /* another app's exercise, or no sensor: the workout goes on without */ }
    }

    override fun onDestroy() {
        if (exerciseOn) {
            val client = HealthServices.getClient(this).exerciseClient
            try { client.endExerciseAsync() } catch (_: Exception) {}
            try { client.clearUpdateCallbackAsync(hrCallback) } catch (_: Exception) {}
            exerciseOn = false
        }
        alive = false
        WearStore.clearHeartRate()
        scope.cancel()
        if (WearStore.state.value.workout == null) getSystemService(NotificationManager::class.java).cancel(NOTIF_ID)
        super.onDestroy()
    }

    companion object {
        const val NOTIF_ID = 7
        private const val CHANNEL = "workout"
        @Volatile private var alive = false

        fun hasHrPermission(ctx: Context): Boolean {
            val perm = if (Build.VERSION.SDK_INT >= 36) "android.permission.health.READ_HEART_RATE" else Manifest.permission.BODY_SENSORS
            return ContextCompat.checkSelfPermission(ctx, perm) == PackageManager.PERMISSION_GRANTED
        }

        fun hrPermission(): String =
            if (Build.VERSION.SDK_INT >= 36) "android.permission.health.READ_HEART_RATE" else Manifest.permission.BODY_SENSORS

        /**
         * The service follows the workout: started when one runs (with the permission; not from a
         * phone message, which may not start one in the background), stopped when none does.
         * Otherwise the plain ongoing notification, whose tap opens the app, which starts it.
         */
        fun sync(ctx: Context, fromPhone: Boolean = false) {
            val app = ctx.applicationContext
            val active = WearStore.state.value.workout != null
            if (!active) {
                app.stopService(Intent(app, WorkoutService::class.java))
                app.getSystemService(NotificationManager::class.java).cancel(NOTIF_ID)
                return
            }
            if (alive) return
            if (hasHrPermission(app) && !fromPhone) {
                try { ContextCompat.startForegroundService(app, Intent(app, WorkoutService::class.java)); return } catch (_: Exception) {}
            }
            post(app)
        }

        /** The ongoing activity without the service. */
        fun post(ctx: Context) {
            try {
                ctx.getSystemService(NotificationManager::class.java).notify(NOTIF_ID, notification(ctx, WearStore.state.value, WearStore.rest.value))
            } catch (_: SecurityException) { /* notifications off */ }
        }

        fun notification(ctx: Context, s: SessionState, rest: Rest?): android.app.Notification {
            val c = Lang.wrap(ctx, s.settings.lang)
            val nm = ctx.getSystemService(NotificationManager::class.java)
            if (nm.getNotificationChannel(CHANNEL) == null) {
                nm.createNotificationChannel(NotificationChannel(CHANNEL, c.getString(R.string.workout), NotificationManager.IMPORTANCE_LOW))
            }
            val touch = PendingIntent.getActivity(ctx, 0,
                Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            val w = s.workout
            val title = w?.name?.takeIf { it.isNotBlank() } ?: c.getString(R.string.workout)
            val (done, total) = SessionCore.progress(s)
            val line = if (total > 0) c.getString(R.string.sets_of, done, total) else c.getString(R.string.notif_running)
            val builder = NotificationCompat.Builder(ctx, CHANNEL)
                .setSmallIcon(R.drawable.ic_barbell)
                .setContentTitle(title)
                .setContentText(line)
                .setCategory(NotificationCompat.CATEGORY_WORKOUT)
                .setOngoing(true)
                .setSilent(true)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setContentIntent(touch)
            // On the watch face: the rest counting down, else the sets so far.
            val status = if (rest != null && rest.endsAt > System.currentTimeMillis()) {
                val end = SystemClock.elapsedRealtime() + (rest.endsAt - System.currentTimeMillis())
                Status.Builder().addTemplate("#rest#").addPart("rest", Status.TimerPart(end)).build()
            } else Status.Builder().addTemplate(line).build()
            OngoingActivity.Builder(ctx, NOTIF_ID, builder)
                .setStaticIcon(R.drawable.ic_barbell)
                .setTouchIntent(touch)
                .setStatus(status)
                .build()
                .apply(ctx)
            return builder.build()
        }
    }
}
