package ch.duartesantos.opengym.wear

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import java.text.DateFormat
import java.util.Date

/**
 * "Still training?" / "Looks like you left the gym" as a notification too (forgotten workouts,
 * WatchLogic Idle): the card alone is not seen with the screen off or another app in front. Keep
 * going answers from the notification (IdleNoticeReceiver); Finish opens the app on the Overview,
 * where the 1 s hold finishes, so nothing ends in one tap. Gone as soon as the card is answered,
 * a set comes in or the workout ends.
 */
object IdleNotice {
    private const val CHANNEL = "still-training"
    private const val ID = 4100
    const val ACTION_KEEP = "ch.duartesantos.opengym.wear.KEEP_GOING"
    const val EXTRA_PAGE = "page"

    fun post(ctx: Context, left: Boolean, endsAt: Long?) {
        val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
        if (!nm.areNotificationsEnabled()) return
        if (nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL, ctx.getString(R.string.still_training), NotificationManager.IMPORTANCE_HIGH))
        }
        val open = PendingIntent.getActivity(ctx, ID,
            Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val finish = PendingIntent.getActivity(ctx, ID + 1,
            Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP).putExtra(EXTRA_PAGE, "overview"),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val keep = PendingIntent.getBroadcast(ctx, ID + 2,
            Intent(ctx, IdleNoticeReceiver::class.java).setAction(ACTION_KEEP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val clock = endsAt?.let { DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(it)) }
        val body = clock?.let { ctx.getString(if (left) R.string.left_ends_at else R.string.idle_ends_at, it) }
        val n = NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_barbell)
            .setContentTitle(ctx.getString(if (left) R.string.left_gym else R.string.still_training))
            .apply { if (body != null) setContentText(body).setStyle(NotificationCompat.BigTextStyle().bigText(body)) }
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(open)
            .addAction(0, ctx.getString(R.string.keep_going), keep)
            .addAction(0, ctx.getString(if (left) R.string.finish_now else R.string.finish_workout), finish)
            .build()
        try { nm.notify(ID, n) } catch (_: SecurityException) { /* no notification permission: the card is still there */ }
    }

    fun cancel(ctx: Context) {
        ctx.getSystemService(NotificationManager::class.java)?.cancel(ID)
    }
}

/** Keep going, right from the notification. */
class IdleNoticeReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != IdleNotice.ACTION_KEEP) return
        WearStore.init(context)
        WearStore.keepGoing()
    }
}
