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
import androidx.health.services.client.MeasureCallback
import androidx.health.services.client.data.DataPointContainer
import androidx.health.services.client.data.DeltaDataType
import androidx.health.services.client.data.ExerciseTrackedStatus
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
            // A late update from the exercise just ended must not land in the next workout.
            if (update.exerciseStateInfo.state.isEnded) return
            update.latestMetrics.getData(DataType.CALORIES_TOTAL)?.total?.let { if (it.isFinite()) WearStore.onCalories(it) }
            val bpm = update.latestMetrics.getData(DataType.HEART_RATE_BPM).lastOrNull()?.value ?: return
            // roundToInt() throws for NaN: a reading that is not a number is no reading.
            if (!bpm.isFinite()) return
            WearStore.onHeartRate(bpm.roundToInt())
        }
        override fun onLapSummaryReceived(lapSummary: ExerciseLapSummary) {}
        override fun onRegistered() {}
        override fun onRegistrationFailed(throwable: Throwable) {}
        override fun onAvailabilityChanged(dataType: DataType<*, *>, availability: Availability) {}
    }

    /** The heart rate alone, while another app (Samsung Health, Fitbit…) records the exercise. */
    private var measuring = false
    private val measureCallback = object : MeasureCallback {
        override fun onAvailabilityChanged(dataType: DeltaDataType<*, *>, availability: Availability) {}
        override fun onDataReceived(data: DataPointContainer) {
            val bpm = data.getData(DataType.HEART_RATE_BPM).lastOrNull()?.value ?: return
            if (bpm.isFinite()) WearStore.onHeartRate(bpm.roundToInt())
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        alive = true
        starting = false
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
        // Restarted by Android for a workout idle for hours (SensorPlan): no sensor, the plain notification.
        if (WearStore.sensorsResting) { stopSelf(); return }
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
            // Health Services runs one exercise at a time: starting ours would end the workout
            // another app is recording (Samsung Health next to openGym is common). Then the heart
            // rate is only measured, and that app's workout is left alone (HrPlan).
            val tracked = try { client.getCurrentExerciseInfoAsync().await().exerciseTrackedStatus } catch (_: Exception) { null }
            if (HrPlan.measureOnly(tracked, ExerciseTrackedStatus.OTHER_APP_IN_PROGRESS)) {
                HealthServices.getClient(this).measureClient.registerMeasureCallback(DataType.HEART_RATE_BPM, measureCallback)
                measuring = true
                return
            }
            val caps = client.getCapabilitiesAsync().await()
            // The workout's own type first (a run, a ride, yoga: the phone's healthType), then strength.
            val own = TYPES[WearStore.state.value.workout?.healthType]
            val type = (listOfNotNull(own) + listOf(ExerciseType.STRENGTH_TRAINING, ExerciseType.WEIGHTLIFTING, ExerciseType.WORKOUT))
                .firstOrNull { it in caps.supportedExerciseTypes && DataType.HEART_RATE_BPM in caps.getExerciseTypeCapabilities(it).supportedDataTypes }
                ?: return
            client.setUpdateCallback(hrCallback)
            WearStore.startCalories()
            // The calories too where this type has them and physical activity is allowed: asking for
            // one it lacks, or without the permission, fails the start, and the heart rate with it.
            val kcal = DataType.CALORIES_TOTAL.takeIf {
                it in caps.getExerciseTypeCapabilities(type).supportedDataTypes &&
                    ContextCompat.checkSelfPermission(this, Manifest.permission.ACTIVITY_RECOGNITION) == PackageManager.PERMISSION_GRANTED
            }
            fun config(types: Set<DataType<*, *>>) = ExerciseConfig.builder(type)
                .setDataTypes(types)
                .setIsAutoPauseAndResumeEnabled(false)
                .setIsGpsEnabled(false)
                .build()
            try {
                client.startExerciseAsync(config(setOfNotNull(DataType.HEART_RATE_BPM, kcal))).await()
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                // Refused with the calories: the heart rate alone, as before calories came.
                if (kcal == null) throw e
                client.startExerciseAsync(config(setOf(DataType.HEART_RATE_BPM))).await()
            }
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
        if (measuring) {
            try { HealthServices.getClient(this).measureClient.unregisterMeasureCallbackAsync(DataType.HEART_RATE_BPM, measureCallback) } catch (_: Exception) {}
            measuring = false
        }
        alive = false
        WearStore.clearHeartRate()
        scope.cancel()
        val running = WearStore.state.value.workout != null
        if (!running) getSystemService(NotificationManager::class.java).cancel(NOTIF_ID)
        super.onDestroy()
        // Stopped with the workout still on (the sensor resting): the system took the service's
        // notification with it, so the plain one comes back.
        if (running) post(this)
    }

    companion object {
        const val NOTIF_ID = 7

        /** The phone's names for a workout's type (lib/health-connect.js, #799), as the Apple Watch's WorkoutManager.activityTypes. */
        private val TYPES = mapOf(
            "strength_training" to ExerciseType.STRENGTH_TRAINING, "walking" to ExerciseType.WALKING, "running" to ExerciseType.RUNNING,
            "biking_stationary" to ExerciseType.BIKING_STATIONARY, "biking" to ExerciseType.BIKING, "elliptical" to ExerciseType.ELLIPTICAL,
            "stair_climbing_machine" to ExerciseType.STAIR_CLIMBING_MACHINE, "rowing" to ExerciseType.ROWING_MACHINE,
            "jump_rope" to ExerciseType.JUMP_ROPE, "hiit" to ExerciseType.HIGH_INTENSITY_INTERVAL_TRAINING,
            "mixed_cardio" to ExerciseType.WORKOUT, "yoga" to ExerciseType.YOGA, "flexibility" to ExerciseType.STRETCHING,
            "other_workout" to ExerciseType.WORKOUT,
        )
        private const val CHANNEL = "workout"
        @Volatile private var alive = false
        /** Asked to start, onCreate not run yet: Android kills the app if it is stopped before startForeground. */
        @Volatile private var starting = false

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
                // A start still on its way stops itself in onCreate, once it is in the foreground.
                if (!starting) app.stopService(Intent(app, WorkoutService::class.java))
                app.getSystemService(NotificationManager::class.java).cancel(NOTIF_ID)
                return
            }
            // Nothing happened in the workout for three hours (SensorPlan): the sensor rests, the
            // workout stays on the watch face, and the next set or phone change starts it again.
            if (WearStore.sensorsResting) {
                if (!starting) app.stopService(Intent(app, WorkoutService::class.java))
                post(app)
                return
            }
            if (alive || starting) return
            if (hasHrPermission(app) && !fromPhone) {
                starting = true
                try { ContextCompat.startForegroundService(app, Intent(app, WorkoutService::class.java)); return } catch (_: Exception) { starting = false }
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
