package ch.duartesantos.opengym.wear

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import androidx.wear.ongoing.OngoingActivity
import androidx.wear.ongoing.Status
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Runs for as long as a workout is in progress. It does two things the screen cannot: it ends the
 * rest on time (with a buzz) when the screen is off and the app is not in front, and it keeps the
 * workout on the watch face and in the recents as an ongoing activity, with the rest counting down
 * there. The rest itself is just a time in the session ([Session.restEndsAt]); this only watches
 * the clock for it.
 */
class WorkoutService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var restJob: Job? = null
    private var scheduledFor = 0L
    private var wake: PowerManager.WakeLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Repository.init(applicationContext)
        ensureChannel()
        // A foreground service has to show a notification within seconds of being started; the real one follows.
        ServiceCompat.startForeground(
            this, NOTIFICATION_ID, build(null), ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
        )
        scope.launch {
            Repository.awaitLoaded()
            Repository.active.collect { a ->
                if (a == null) {
                    stopForeground(STOP_FOREGROUND_REMOVE)
                    stopSelf()
                    return@collect
                }
                getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, build(a))
                scheduleRest(a.session.restEndsAt, a.session)
            }
        }
        return START_STICKY
    }

    private fun scheduleRest(endsAt: Long, session: Session) {
        if (endsAt == scheduledFor) return
        scheduledFor = endsAt
        restJob?.cancel()
        releaseWake()
        if (endsAt <= 0) return
        val burst = session.partial.isNotEmpty()
        restJob = scope.launch {
            val wait = maxOf(0L, endsAt - System.currentTimeMillis())
            // Held only for this rest, so the delay below is not stretched by the watch dozing.
            wake = getSystemService(PowerManager::class.java)
                .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "opengym:rest")
                .apply { acquire(wait + 5_000) }
            delay(wait)
            if (Repository.restFinished(endsAt)) if (burst) Haptics.burstReady(applicationContext) else Haptics.restOver(applicationContext)
            releaseWake()
        }
    }

    private fun releaseWake() {
        wake?.let { if (it.isHeld) it.release() }
        wake = null
    }

    private fun ensureChannel() {
        val nm = getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL_ID) == null) {
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, getString(R.string.channel_name), NotificationManager.IMPORTANCE_LOW),
            )
        }
    }

    private fun build(a: ActiveWorkout?): Notification {
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_dumbbell)
            .setCategory(NotificationCompat.CATEGORY_WORKOUT)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(open)
        val status = Status.Builder()
        if (a == null || a.session.finished) {
            builder.setContentTitle(getString(R.string.app_name))
            status.addTemplate(getString(R.string.app_name))
        } else {
            val s = a.session
            val ex = a.snapshot.exercises[s.ex]
            val (n, of) = Engine.numberAmong(a.snapshot, s.ex, s.set)
            val line = getString(R.string.notification_set, n, of, ex.name)
            builder.setContentTitle(ex.name)
            if (s.restEndsAt > 0) {
                builder.setContentText(getString(R.string.notification_resting))
                    .setUsesChronometer(true).setChronometerCountDown(true).setShowWhen(true).setWhen(s.restEndsAt)
                status.addTemplate(getString(R.string.notification_resting) + " #t#").addPart("t", Status.TimerPart(s.restEndsAt))
            } else {
                builder.setContentText(line)
                status.addTemplate("#s#").addPart("s", Status.TextPart(line))
            }
        }
        OngoingActivity.Builder(applicationContext, NOTIFICATION_ID, builder)
            .setStaticIcon(R.drawable.ic_stat_dumbbell)
            .setTouchIntent(open)
            .setStatus(status.build())
            .build()
            .apply(applicationContext)
        return builder.build()
    }

    override fun onDestroy() {
        releaseWake()
        scope.cancel()
        super.onDestroy()
    }

    companion object {
        private const val CHANNEL_ID = "workout"
        private const val NOTIFICATION_ID = 1

        fun start(context: Context) {
            try {
                ContextCompat.startForegroundService(context, Intent(context, WorkoutService::class.java))
            } catch (e: RuntimeException) {
                // Not allowed to start from the background just now; the screen does it when it opens.
            }
        }
    }
}
