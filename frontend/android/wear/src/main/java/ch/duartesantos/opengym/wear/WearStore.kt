package ch.duartesantos.opengym.wear

import android.content.Context
import android.content.SharedPreferences
import androidx.wear.tiles.TileService
import androidx.wear.watchface.complications.datasource.ComplicationDataSourceUpdateRequester
import android.content.ComponentName
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import java.util.UUID
import kotlin.math.roundToInt

/** A rest running on the watch: until `endsAt` (ms), out of `total` seconds. */
data class Rest(val endsAt: Long, val total: Int)

/**
 * The watch app's one copy of the session (the Apple Watch's SessionStore): the state, saved after
 * every change so a relaunch mid-workout loses nothing; the rest; the heart rate; the summary at the
 * end. The changes themselves are SessionCore's; the events they return go to the phone (PhoneLink).
 */
object WearStore {
    private lateinit var app: Context
    private lateinit var prefs: SharedPreferences
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    private val _state = MutableStateFlow(SessionState())
    val state: StateFlow<SessionState> = _state
    private val _rest = MutableStateFlow<Rest?>(null)
    val rest: StateFlow<Rest?> = _rest
    private val _summary = MutableStateFlow<WorkoutSummary?>(null)
    val summary: StateFlow<WorkoutSummary?> = _summary
    private val _heartRate = MutableStateFlow<Int?>(null)
    val heartRate: StateFlow<Int?> = _heartRate
    /** Whether the phone is connected right now (a small sign when it is not). */
    val phoneNear = MutableStateFlow(true)

    // Heart-rate readings since the workout started, for a set's avg/max and the summary's.
    private val readings = ArrayDeque<Pair<Long, Int>>()
    private var setFrom = 0L
    private var restJob: Job? = null
    private var refreshJob: Job? = null

    fun init(ctx: Context) {
        if (::app.isInitialized) return
        app = ctx.applicationContext
        prefs = app.getSharedPreferences("opengym-wear", Context.MODE_PRIVATE)
        prefs.getString("state", null)?.let { json ->
            try { _state.value = WireJson.decodeFromString(SessionState.serializer(), json) } catch (_: Exception) {}
        }
        val endsAt = prefs.getLong("restEndsAt", 0)
        if (endsAt > System.currentTimeMillis()) armRest(Rest(endsAt, prefs.getInt("restTotal", 90)))
        setFrom = System.currentTimeMillis()
    }

    val lang: String? get() = _state.value.settings.lang

    /* ---------- from the phone ---------- */

    /** The phone's snapshot (the Apple Watch's JSON), over what the watch has. */
    fun applySnapshotJson(json: String) {
        val snap = Snapshot.parse(json) ?: return
        val before = _state.value
        val after = SessionCore.applySnapshot(before, snap)
        val gone = before.workout
        // The phone ended the workout the watch had (finished or discarded there).
        if (gone != null && after.workout == null) {
            _summary.value = SessionCore.summary(gone, now().toDouble(), endedOnPhone = true, hr = hrOf(0))
            stopRest()
            readings.clear()
        }
        if (gone?.id != after.workout?.id && after.workout != null) { readings.clear(); setFrom = now(); _summary.value = null }
        // A rest running on the phone: the watch counts down the same one.
        snap.active?.rest?.endsAt?.toLong()?.let { end ->
            val cur = _rest.value
            if (end > now() && (cur == null || kotlin.math.abs(cur.endsAt - end) > 2000)) {
                startRest(((end - now()) / 1000).toInt().coerceAtLeast(1), end)
            }
        }
        commit(after)
    }

    /* ---------- the lifter's actions ---------- */

    fun setEntryIndex(i: Int) {
        val s = _state.value
        val count = s.workout?.entries?.size ?: return
        commit(s.copy(entryIndex = i.coerceIn(0, count)))
    }

    /** A set done here with these numbers: logged, sent, and on to what comes next. */
    fun tick(ei: Int, si: Int, side: String?, w: Double?, r: Double?, sec: Double? = null) {
        val at = now()
        val (s1, event) = SessionCore.tick(_state.value, ei, si, side, w, r, sec, at.toDouble(), UUID.randomUUID().toString(), hrOf(setFrom))
        event ?: return
        PhoneLink.send(app, event)
        Haptics.tick(app)
        val (nextEi, rest) = SessionCore.next(s1, ei, si)
        commit(s1.copy(entryIndex = nextEi))
        setFrom = at
        val workout = s1.workout
        val count = workout?.entries?.size ?: 0
        if (rest && nextEi < count) {
            val e = workout?.entries?.getOrNull(ei)
            val sec0 = e?.restSec ?: workout?.restSec?.takeIf { it > 0 } ?: s1.restSec
            if (sec0 > 0) startRest(sec0.roundToInt())
        }
    }

    fun skip(ei: Int, si: Int) {
        val s1 = SessionCore.skip(_state.value, ei, si)
        val (nextEi, _) = SessionCore.next(s1, ei, si)
        commit(s1.copy(entryIndex = nextEi))
    }

    /** A routine started here (today's, or one picked). */
    fun startSession(session: ReadySession) {
        val at = now()
        val (s1, event) = SessionCore.start(_state.value, session, "watch-" + UUID.randomUUID(), at.toDouble(), UUID.randomUUID().toString())
        PhoneLink.send(app, event)
        readings.clear()
        setFrom = at
        _summary.value = null
        commit(s1)
        Haptics.tick(app)
    }

    /** Finish and save (on the phone, as its Finish and save), or discard. */
    fun finish(discard: Boolean = false) {
        val before = _state.value
        val w = before.workout ?: return
        val at = now()
        val (s1, event) = SessionCore.finish(before, at.toDouble(), UUID.randomUUID().toString(), discard)
        event?.let { PhoneLink.send(app, it) }
        _summary.value = if (discard) null else SessionCore.summary(w, at.toDouble(), hr = hrOf(0))
        stopRest()
        readings.clear()
        commit(s1)
    }

    fun dismissSummary() { _summary.value = null }

    /* ---------- the rest ---------- */

    fun startRest(seconds: Int, endsAt: Long = now() + seconds * 1000L) = armRest(Rest(endsAt, seconds))

    fun addRest(seconds: Int) {
        val r = _rest.value ?: return
        armRest(Rest((r.endsAt + seconds * 1000L).coerceAtLeast(now() + 1000), (r.total + seconds).coerceAtLeast(1)))
    }

    fun stopRest() {
        restJob?.cancel()
        _rest.value = null
        prefs.edit().remove("restEndsAt").apply()
    }

    private fun armRest(r: Rest) {
        restJob?.cancel()
        _rest.value = r
        prefs.edit().putLong("restEndsAt", r.endsAt).putInt("restTotal", r.total).apply()
        restJob = scope.launch {
            val soon = r.endsAt - 10_000 - now()
            if (soon > 0 && r.total >= 30) { delay(soon); if (buzz()) Haptics.restSoon(app) }
            delay((r.endsAt - now()).coerceAtLeast(0))
            if (buzz()) Haptics.restOver(app)
            _rest.value = null
            prefs.edit().remove("restEndsAt").apply()
            // The rest is part of no set: the next set's heart rate counts from here.
            setFrom = now()
        }
    }

    private fun buzz() = _state.value.settings.restHaptics != false

    /* ---------- heart rate (WorkoutService) ---------- */

    fun onHeartRate(bpm: Int, at: Long = now()) {
        if (bpm !in 25..250) return
        _heartRate.value = bpm
        readings.addLast(at to bpm)
        while (readings.size > 20_000) readings.removeFirst()
    }

    fun clearHeartRate() { _heartRate.value = null }

    /** avg and max of the readings since `from` (ms), or null without any (the phone's sanitizeHr shape). */
    private fun hrOf(from: Long): Pair<Int, Int>? {
        val xs = readings.filter { it.first >= from }.map { it.second }
        if (xs.isEmpty()) return null
        return xs.average().roundToInt() to xs.max()
    }

    /* ---------- saving and telling the rest of the watch ---------- */

    private fun commit(s: SessionState) {
        val had = _state.value.workout != null
        _state.value = s
        prefs.edit().putString("state", WireJson.encodeToString(SessionState.serializer(), s)).apply()
        if (had != (s.workout != null) || s.workout != null) WorkoutService.sync(app)
        refreshSurfaces()
    }

    /** The Tile and the complication, at most twice a second. */
    private fun refreshSurfaces() {
        refreshJob?.cancel()
        refreshJob = scope.launch {
            delay(500)
            try { TileService.getUpdater(app).requestUpdate(OpenGymTileService::class.java) } catch (_: Exception) {}
            try {
                ComplicationDataSourceUpdateRequester.create(app, ComponentName(app, ProgressComplicationService::class.java)).requestUpdateAll()
            } catch (_: Exception) {}
        }
    }

    private fun now() = System.currentTimeMillis()

    /** For the Tile and the complication, which may run before the app did. */
    fun peek(ctx: Context): SessionState { init(ctx); return _state.value }
}
