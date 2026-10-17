package ch.duartesantos.opengym.wear

import android.content.Context
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

private val Context.watchStore by preferencesDataStore("opengym_watch")

/**
 * The watch's whole state, in one place both the screens and the services read: the routine list,
 * the routines' snapshots, the workout in progress and the sessions not yet acknowledged by the
 * phone. It lives in DataStore, so a workout survives the app being closed or the watch restarting,
 * and none of it needs the phone once a routine has been fetched.
 *
 * The StateFlows are the truth in this process and every change is written through; a change
 * made by a service that woke the process without any screen goes the same way.
 */
object Repository {
    sealed interface Fetch {
        data object Idle : Fetch
        /** Waiting for the phone's answer; [routineId] null means the routine list. */
        data class Waiting(val routineId: String?) : Fetch
        data class Failed(val routineId: String?, val reason: Reason, val hasCopy: Boolean) : Fetch
    }
    enum class Reason { UNREACHABLE, MISSING }

    private val KEY_INDEX = stringPreferencesKey("index")
    private val KEY_ACTIVE = stringPreferencesKey("active")
    private val KEY_OUTBOX = stringPreferencesKey("outbox")
    private fun snapKey(routineId: String) = stringPreferencesKey("snapshot:$routineId")

    private const val ASK_EVERY_MS = 8_000L
    private const val ASK_TIMES = 6

    private lateinit var app: Context
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val lock = Mutex()
    private var started = false
    private var fetchJob: Job? = null

    private val _loaded = MutableStateFlow(false)
    val loaded: StateFlow<Boolean> = _loaded.asStateFlow()
    val index = MutableStateFlow<Index?>(null)
    val active = MutableStateFlow<ActiveWorkout?>(null)
    /** Finished sessions (their JSON) the phone has not acknowledged yet. */
    val outbox = MutableStateFlow<List<String>>(emptyList())
    val fetch = MutableStateFlow<Fetch>(Fetch.Idle)

    @Synchronized
    fun init(context: Context) {
        if (started) return
        started = true
        app = context.applicationContext
        scope.launch {
            load()
            _loaded.value = true
            reconcile()
        }
    }

    suspend fun awaitLoaded() {
        loaded.first { it }
    }

    private suspend fun load() = lock.withLock {
        val prefs = app.watchStore.data.first()
        index.value = prefs[KEY_INDEX]?.let(Wire::parseIndex)
        active.value = prefs[KEY_ACTIVE]?.let(Wire::activeFromJson)
        outbox.value = prefs[KEY_OUTBOX]?.let(::readList) ?: emptyList()
    }

    private fun readList(json: String): List<String> = try {
        val a = JSONArray(json)
        (0 until a.length()).map { a.getString(it) }
    } catch (e: JSONException) {
        emptyList()
    }

    private suspend fun save(block: (androidx.datastore.preferences.core.MutablePreferences) -> Unit) {
        app.watchStore.edit { block(it) }
    }

    private fun idOf(payload: String): String? = try { JSONObject(payload).getString("id") } catch (e: JSONException) { null }

    /** On start: pick up what happened while the watch app was not running. */
    private suspend fun reconcile() {
        // The phone publishes the list and every routine ahead of time; whatever it put while this
        // app was not running is in the Data Layer, newest first-hand.
        PhoneLink.allSnapshots(app).forEach { (path, text) -> onItem(path, text.toByteArray()) }
        PhoneLink.lastIndex(app)?.let { onItem(Paths.INDEX, it.toByteArray()) }
        PhoneLink.pendingAcks(app).forEach { onAck(it) }
        resendOutbox()
    }

    /** The session items are kept by the Data Layer; putting them again only matters if one was lost. */
    fun resendOutbox() {
        val pending = outbox.value
        scope.launch { pending.forEach { p -> idOf(p)?.let { PhoneLink.putSession(app, it, p) } } }
    }

    /** The app came to the front: a workout in progress needs its service. */
    fun onForeground() {
        scope.launch {
            awaitLoaded()
            if (active.value != null) WorkoutService.start(app)
            else PhoneLink.nudge(app)
        }
    }

    // ---------------------------------------------------------------- what the phone sends

    /** One Data Layer item from the phone, from [WatchDataService]. */
    suspend fun onItem(path: String, data: ByteArray?) {
        awaitLoaded()
        val text = data?.toString(Charsets.UTF_8) ?: return
        when {
            path == Paths.INDEX -> Wire.parseIndex(text)?.let { parsed ->
                lock.withLock {
                    index.value = parsed
                    save { it[KEY_INDEX] = text }
                    if ((fetch.value as? Fetch.Waiting)?.routineId == null && fetch.value is Fetch.Waiting) fetch.value = Fetch.Idle
                }
            }
            path.startsWith(Paths.SNAPSHOT) -> onSnapshot(Paths.idOf(path, Paths.SNAPSHOT), text)
            path.startsWith(Paths.ACK) -> onAck(Paths.idOf(path, Paths.ACK))
        }
    }

    private suspend fun onSnapshot(routineId: String, text: String) {
        val waiting = (fetch.value as? Fetch.Waiting)?.takeIf { it.routineId == routineId }
        if (Wire.missingRoutine(text) != null) {
            if (waiting != null) {
                fetchJob?.cancel()
                fetch.value = Fetch.Failed(routineId, Reason.MISSING, hasCopy = hasCopy(routineId))
            }
            return
        }
        val snapshot = Wire.parseSnapshot(text) ?: return
        lock.withLock { save { it[snapKey(routineId)] = text } }
        if (waiting != null) {
            fetchJob?.cancel()
            begin(snapshot, text)
        }
    }

    private suspend fun hasCopy(routineId: String): Boolean = app.watchStore.data.first()[snapKey(routineId)] != null

    private suspend fun onAck(sessionId: String) {
        val had = lock.withLock {
            val kept = outbox.value.filter { idOf(it) != sessionId }
            if (kept.size == outbox.value.size) false
            else {
                outbox.value = kept
                save { it[KEY_OUTBOX] = JSONArray(kept).toString() }
                true
            }
        }
        // Whether or not the outbox still held it, the phone has it: the item can go.
        if (had) PhoneLink.deleteSession(app, sessionId)
    }

    // ---------------------------------------------------------------- starting a workout

    /**
     * A routine was picked. The phone has already put a copy on the watch (it keeps them current),
     * so the workout starts at once from it; only a routine with no copy yet is asked for, and that
     * needs the phone's app open.
     */
    fun start(routineId: String) {
        scope.launch {
            if (hasCopy(routineId)) startFromCopy(routineId) else ask(routineId)
        }
    }

    /** Asks the phone for the routine list, or for a routine; keeps asking for a minute, then says it could not. */
    fun ask(routineId: String?) {
        fetchJob?.cancel()
        fetch.value = Fetch.Waiting(routineId)
        fetchJob = scope.launch {
            repeat(ASK_TIMES) {
                PhoneLink.request(app, routineId)
                delay(ASK_EVERY_MS)
                if (fetch.value !is Fetch.Waiting) return@launch
            }
            fetch.value = Fetch.Failed(routineId, Reason.UNREACHABLE, hasCopy = routineId != null && hasCopy(routineId))
        }
    }

    fun cancelFetch() {
        fetchJob?.cancel()
        fetch.value = Fetch.Idle
    }

    /** Starts from the copy the watch already holds, with the phone out of reach. */
    fun startFromCopy(routineId: String) {
        scope.launch {
            val raw = app.watchStore.data.first()[snapKey(routineId)] ?: return@launch
            val snapshot = Wire.parseSnapshot(raw) ?: return@launch
            begin(snapshot, raw)
        }
    }

    private suspend fun begin(snapshot: Snapshot, raw: String) {
        lock.withLock {
            if (active.value != null) return
            val workout = ActiveWorkout(raw, snapshot, Engine.begin(snapshot, System.currentTimeMillis()))
            active.value = workout
            fetch.value = Fetch.Idle
            save { it[KEY_ACTIVE] = Wire.activeToJson(workout) }
        }
        WorkoutService.start(app)
    }

    // ---------------------------------------------------------------- during the workout

    /** Where a screen believes the workout is. A tap that arrives after the workout moved on is ignored. */
    data class Cursor(val ex: Int, val set: Int, val step: Int)

    private fun cursorOf(s: Session) = Cursor(s.ex, s.set, s.step)

    private fun change(expect: Cursor?, f: (ActiveWorkout, Long) -> Session) {
        scope.launch {
            lock.withLock {
                val a = active.value ?: return@withLock
                if (expect != null && cursorOf(a.session) != expect) return@withLock
                val moved = f(a, System.currentTimeMillis())
                if (moved == a.session) return@withLock
                val next = a.copy(session = moved)
                active.value = next
                save { it[KEY_ACTIVE] = Wire.activeToJson(next) }
            }
        }
    }

    fun confirm(value: StepValue, at: Cursor) = change(at) { a, now -> Engine.confirm(a.snapshot, a.session, value, now) }
    fun stopHere(at: Cursor) = change(at) { a, now -> Engine.stopHere(a.snapshot, a.session, now) }
    fun skip(at: Cursor) = change(at) { a, now -> Engine.skip(a.snapshot, a.session, now) }
    /** The exercise on screen changed (a swipe): the workout carries on from there. */
    fun goTo(ex: Int) = change(null) { a, _ -> Engine.goTo(a.snapshot, a.session, ex) }
    fun undo() = change(null) { a, _ -> Engine.undo(a.snapshot, a.session) }
    fun adjustRest(deltaSec: Int) = change(null) { a, now -> Engine.adjustRest(a.session, deltaSec, now) }
    fun skipRest() = change(null) { a, _ -> Engine.endRest(a.session) }

    /**
     * The rest that ends at [endsAt] has run out. True for whoever clears it first, so only one of
     * the service and the screen buzzes; false if it was adjusted or skipped in the meantime.
     */
    suspend fun restFinished(endsAt: Long): Boolean = lock.withLock {
        val a = active.value ?: return@withLock false
        if (a.session.restEndsAt != endsAt) return@withLock false
        val next = a.copy(session = Engine.endRest(a.session))
        active.value = next
        save { it[KEY_ACTIVE] = Wire.activeToJson(next) }
        true
    }

    // ---------------------------------------------------------------- the end

    /** Closes the workout: it goes to the outbox and to the phone. A workout with nothing logged is simply dropped. */
    fun finish() {
        scope.launch {
            val payload = lock.withLock {
                val a = active.value ?: return@withLock null
                val logged = a.session.results.any { it.done }
                val json = if (logged) Wire.sessionPayload(a.snapshot, a.session, System.currentTimeMillis()).toString() else null
                active.value = null
                save { it.remove(KEY_ACTIVE) }
                if (json != null) {
                    val queue = outbox.value.filter { idOf(it) != a.session.id } + json
                    outbox.value = queue
                    save { it[KEY_OUTBOX] = JSONArray(queue).toString() }
                }
                json
            }
            if (payload != null) idOf(payload)?.let { PhoneLink.putSession(app, it, payload) }
        }
    }

    fun discard() {
        scope.launch {
            lock.withLock {
                active.value = null
                save { it.remove(KEY_ACTIVE) }
            }
        }
    }
}
