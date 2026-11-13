package ch.duartesantos.opengym.wear

import android.content.ComponentName
import android.content.Context
import android.content.SharedPreferences
import android.provider.Settings
import androidx.wear.tiles.TileService
import androidx.wear.watchface.complications.datasource.ComplicationDataSourceUpdateRequester
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.util.UUID
import kotlin.math.roundToInt

/** A rest running on the watch: until `endsAt` (ms), out of `total` seconds, started at `startedAt`. */
data class Rest(val endsAt: Long, val total: Int, val startedAt: Long = endsAt - total * 1000L)

/** A timed set running: from `startedAt` until `endsAt` (ms). */
data class Hold(val startedAt: Long, val endsAt: Long)

/** The 3-2-1 before a workout started here: when it began, and what starts after it. */
data class CountIn(val from: Long, val session: ReadySession? = null, val bw: Double? = null)

/** A done set open on the set page to be fixed: its numbers, the side, and what was logged. */
data class Fix(val ref: SetRef, val side: String?, val w: Double, val r: Double, val sec: Double,
               val from: SetFix.Numbers, val effort: Double? = null) {
    val changed get() = w != (from.w ?: 0.0) || r != (from.r ?: 0.0) || sec != (from.sec ?: 0.0) || effort != null
}

/** The session screen's pages, side by side like Apple Workout: Overview ← Set → Metrics → Media. */
enum class Page { OVERVIEW, SET, METRICS, MEDIA }

/**
 * The watch app's one copy of the session (the Apple Watch's SessionStore): the state, saved after
 * every change so a relaunch mid-workout loses nothing; the rest, the hold and the 3-2-1; ‹ › and
 * the set being fixed; the effort chips; the weigh-in; "All done?"; the summary at the end. The
 * rules are SessionCore's and WatchLogic's; the events they return go to the phone (PhoneLink).
 */
object WearStore {
    private lateinit var app: Context
    private lateinit var prefs: SharedPreferences
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    private val _state = MutableStateFlow(SessionState())
    val state: StateFlow<SessionState> = _state
    private val _rest = MutableStateFlow<Rest?>(null)
    val rest: StateFlow<Rest?> = _rest
    private val _hold = MutableStateFlow<Hold?>(null)
    val hold: StateFlow<Hold?> = _hold
    private val _countIn = MutableStateFlow<CountIn?>(null)
    val countIn: StateFlow<CountIn?> = _countIn
    /** The hold's 3-2-1 (the phone's "timed holds start by themselves"): when it began. */
    private val _holdCountIn = MutableStateFlow<Long?>(null)
    val holdCountIn: StateFlow<Long?> = _holdCountIn
    /** "Go!" in the full ring, for a moment as a workout or a hold starts. */
    val goAt = MutableStateFlow<Long?>(null)
    private val _summary = MutableStateFlow<WorkoutSummary?>(null)
    val summary: StateFlow<WorkoutSummary?> = _summary
    private val _heartRate = MutableStateFlow<Int?>(null)
    val heartRate: StateFlow<Int?> = _heartRate
    /** Whether the phone is connected right now. */
    val phoneNear = MutableStateFlow(true)

    val page = MutableStateFlow(Page.SET)
    val draft = MutableStateFlow(Draft())
    val fix = MutableStateFlow<Fix?>(null)
    /** The set logged last here (its side), and what the rest's chips rated it. */
    val lastLogged = MutableStateFlow<SetRef?>(null)
    private var lastSide: String? = null
    val lastRated = MutableStateFlow<Double?>(null)
    /** Which way the set page last moved (‹ -1, › and Done +1): the set's lines come in from there. */
    val lastStep = MutableStateFlow(1)
    /** The weigh-in before a workout started here, and the body weight on its crown. */
    val weighInFor = MutableStateFlow<ReadySession?>(null)
    val bodyWeight = MutableStateFlow(70.0)
    /** "Still training?": no set for a while (forgotten workouts, WatchLogic Idle). */
    val askDone = MutableStateFlow(false)
    val idleMinutes = MutableStateFlow(0)
    /** The question is "Looks like you left the gym" (the phone walked out of the gym). */
    val idleLeft = MutableStateFlow(false)
    /** When the workout ends by itself if nobody answers (ms), null when it never does (an older phone). */
    val idleEndsAt = MutableStateFlow<Long?>(null)
    /** Always On (wrist down): outlines, nothing moves (MainActivity's AmbientLifecycleObserver). */
    val ambient = MutableStateFlow(false)

    // Heart-rate readings since the workout started, for a set's avg/max and the summary's.
    private val readings = ArrayDeque<Pair<Long, Int>>()
    private var setFrom = 0L
    private var seenAt = 0L
    /** The last change to the running workout, made here or from the phone (the Apple Watch's activityAt). */
    private var activityAt = 0L
    /** Three hours with nothing happening in the workout: the heart-rate sensor rests (SensorPlan, WorkoutService.sync). */
    @Volatile var sensorsResting = false
        private set
    private var idleSnooze = 0L
    /** The screenshot rig put a screen up (debug builds): the idle clock leaves it alone. */
    private var demoOn = false
    private val picked = mutableMapOf<Int, Int>()
    private var phoneRestEnd: Double? = null
    /** The id of the last set ticked here until a snapshot names it applied (the phone's rest for it is ours). */
    private var echoOf: String? = null
    private var lastTickAt = 0L
    private val touchLock = TouchLock()
    private val homeLock = TouchLock()
    private var restJob: Job? = null
    private var holdJob: Job? = null
    private var countJob: Job? = null
    private var idleJob: Job? = null
    private var refreshJob: Job? = null

    @Synchronized fun init(ctx: Context) {
        if (::app.isInitialized) return
        app = ctx.applicationContext
        prefs = app.getSharedPreferences("opengym-wear", Context.MODE_PRIVATE)
        prefs.getString("state", null)?.let { json ->
            try { _state.value = WireJson.decodeFromString(SessionState.serializer(), json) } catch (_: Exception) {}
        }
        // Events still waiting from the last run (sent then, never applied on the phone): out again.
        PhoneLink.flush(app)
        val endsAt = prefs.getLong("restEndsAt", 0)
        if (endsAt > now()) armRest(Rest(endsAt, prefs.getInt("restTotal", 90)))
        phoneRestEnd = prefs.getString("phoneRestEnd", null)?.toDoubleOrNull()
        setFrom = now()
        seenAt = now()
        // A workout restored from yesterday, never finished: the sensor waits for something to happen in it.
        sensorsResting = SensorPlan.idle(_state.value.workout, null, now().toDouble(), busy = _rest.value != null)
        loadTargets()
        watchIdle()
    }

    val lang: String? get() = _state.value.settings.lang

    /**
     * The watch says it is there (CheckIn): the phone's Settings then show when it last heard from
     * the watch, the one sign that the two really talk. From the app coming to the front.
     */
    fun checkIn(version: String) {
        if (!::app.isInitialized || demoOn) return
        val at = now()
        if (!CheckIn.due(prefs.getLong("checkInAt", 0), prefs.getString("checkInVersion", null), version, at)) return
        prefs.edit().putLong("checkInAt", at).putString("checkInVersion", version).apply()
        PhoneLink.send(app, CheckIn.event(version, at, UUID.randomUUID().toString()))
    }

    /** Android's "Remove animations": only short fades then (ui/Motion.kt). */
    fun reduceMotion(ctx: Context): Boolean = try {
        Settings.Global.getFloat(ctx.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
    } catch (_: Exception) { false }

    /* ---------- what the screens read ---------- */

    val entryIndex get() = _state.value.entryIndex
    fun entry(): Entry? = _state.value.workout?.entries?.getOrNull(entryIndex)
    fun setIndex(ei: Int = entryIndex): Int? = SessionCore.setIndex(_state.value, ei, picked[ei])
    /** The set on the set page: the one being fixed, else the one up next. */
    fun shownRef(): SetRef? = fix.value?.ref ?: setIndex()?.let { SetRef(entryIndex, it) }
    fun touchAllowed() = touchLock.allows(now())
    fun canStep(d: Int) = target(d) != null

    /** When the workout started (the phone's start, else when this watch first had it). */
    fun workoutStart(): Long? = _state.value.workout?.let { w -> w.start?.takeIf { it > 0 }?.toLong() ?: seenAt }

    /** The rest's chips: the profile rates effort and the set just done is a work set. */
    fun canRateLast(): Boolean {
        val kind = _state.value.settings.effort ?: return false
        if (Effort.notches(kind) == null) return false
        val ref = lastLogged.value ?: return false
        val e = _state.value.workout?.entries?.getOrNull(ref.entry) ?: return false
        val row = e.sets.getOrNull(ref.set) ?: return false
        return !e.isCardio && !row.warmup
    }

    /* ---------- from the phone ---------- */

    /** The phone's snapshot (the Apple Watch's JSON), over what the watch has. */
    fun applySnapshotJson(json: String) {
        val snap = Snapshot.parse(json) ?: return
        val before = _state.value
        val after = SessionCore.applySnapshot(before, snap)
        val gone = before.workout
        // The phone ended the workout the watch had (finished or discarded there).
        if (gone != null && after.workout == null) {
            closeRest(now())
            val discarded = snap.discarded?.contains(gone.id) == true
            _summary.value = if (discarded) null else SessionCore.summary(gone, now().toDouble(), endedOnPhone = true, hr = hrOf(0))
            stopHold(); stopHoldCount(); stopRest(); closeFix()
            readings.clear()
        }
        if (gone?.id != after.workout?.id && after.workout != null) {
            readings.clear(); setFrom = now(); seenAt = now(); _summary.value = null; restAfter = null
            picked.clear(); closeFix(); page.value = Page.SET; lastLogged.value = null
        }
        // Sets ticked on the phone while this watch runs the workout: their heart rate is the watch's (setHr).
        val ticks = SessionCore.phoneTicks(before.workout, after.workout)
        after.workout?.id?.let { wid -> ticks.forEach { phoneTicked(it, wid, snap.active?.rest != null) } }
        // Only a rest end the phone has not sent before: the same one again (with some other
        // change) would undo a ±15 here, or bring back a rest skipped here (RestMath.follows).
        val active = snap.active
        val phoneRest = active?.rest?.endsAt
        // The first snapshot that applied our latest tick carries the rest the phone started for
        // it: an echo of the watch's own rest, which must not undo a ±15 or Skip pressed since.
        val echo = echoOf != null && snap.acked?.contains(echoOf) == true
        if (echo) echoOf = null
        if (phoneRest != null && after.workout?.id == active.id) {
            if (echo && RestMath.follows(phoneRest, phoneRestEnd)) {
                phoneRestEnd = phoneRest
                prefs.edit().putString("phoneRestEnd", phoneRest.toString()).apply()
            } else if (RestMath.follows(phoneRest, phoneRestEnd)) {
                phoneRestEnd = phoneRest
                prefs.edit().putString("phoneRestEnd", phoneRest.toString()).apply()
                val end = phoneRest.toLong()
                if (end > now() && _rest.value?.endsAt != end) startRest(((end - now()) / 1000).toInt().coerceAtLeast(1), end)
            }
        } else if (phoneRestEnd != null) {
            // Skipped on the phone: the watch's rest ends too, as the rest's own end would (#1149).
            if (active != null && after.workout?.id == active.id && _rest.value != null &&
                RestMath.phoneSkipped(phoneRestEnd, phoneRest, active.restPaused == true, now())) {
                closeRest(now()); stopRest(); setFrom = now(); autoHoldIfDue()
            }
            // Paused is not over: keep the end so a Skip pressed while paused is still seen.
            if (active?.restPaused != true) { phoneRestEnd = null; prefs.edit().remove("phoneRestEnd").apply() }
        }
        commit(after)
        // A set being fixed that is no longer done (unticked on the phone): nothing left to fix.
        fix.value?.let { f -> if (fixRow(f.ref) == null) closeFix() }
        ticks.lastOrNull()?.let { followPhoneTick(it) }
        if (after.workout != null && after.workout != before.workout) noteActivity()
        loadTargets()
        // What the phone has applied leaves the outbox; what it lacks goes out again.
        PhoneLink.acked(app, snap.acked)
    }

    /* ---------- the set up next ---------- */

    /** The numbers the crown starts from: the set's own target, kept while the same set is up. */
    fun loadTargets(force: Boolean = false) {
        val s = _state.value
        val e = entry() ?: return
        val si = setIndex()
        val row = si?.let { e.sets[it] } ?: e.sets.lastOrNull() ?: return
        val side = row.sideUp
        val key = Drafts.key(s.workout?.id, e.id, entryIndex, si, side)
        val one = side?.let { row.sides?.get(it) }
        // The same set keeps what the crown made of it; a plan changed on the phone under numbers
        // nobody touched here comes through (Drafts.next).
        draft.value = Drafts.next(draft.value, key, one?.w ?: row.w ?: 0.0, one?.r ?: row.r ?: 0.0, row.sec?.takeIf { it > 0 } ?: 30.0, force)
    }

    fun setDraft(d: Draft) { ackRestOver(); draft.value = d }

    /** Another exercise on the set page, picked by hand (an Overview row). */
    fun jump(ei: Int) {
        ackRestOver()
        if (_hold.value != null) return            // its seconds belong to the exercise on the set page
        closeFix()
        val s = _state.value
        val count = s.workout?.entries?.size ?: return
        commit(s.copy(entryIndex = ei.coerceIn(0, count)))
        touchLock.unlock()                         // picked by hand: the page is the lifter's own choice
        loadTargets(force = true)
        page.value = Page.SET
    }

    /** Where ‹ (-1) or › (+1) goes from the set on the page; from an exercise with nothing left, ‹ is its last set. */
    private fun target(d: Int): SetRef? {
        val w = _state.value.workout ?: return null
        val ref = shownRef()
        if (ref != null) {
            val e = w.entries.getOrNull(ref.entry) ?: return null
            return SetNav.step(e, ref.set, d)?.let { SetRef(ref.entry, it) }
        }
        val e = entry() ?: return null
        return if (d < 0 && e.sets.isNotEmpty()) SetRef(entryIndex, e.sets.lastIndex) else null
    }

    fun step(d: Int) {
        ackRestOver()
        val to = target(d) ?: return
        lastStep.value = if (d < 0) -1 else 1
        open(to)
    }

    /** A set on the set page: a done one opens to be fixed, one still to do becomes the set up next. */
    fun open(ref: SetRef) {
        ackRestOver()
        val row = fixRow(ref)
        if (row != null) {
            loadFix(ref, if (row.sides != null) "L" else null)
        } else {
            closeFix()
            if (ref.entry != entryIndex) commit(_state.value.copy(entryIndex = ref.entry))
            picked[ref.entry] = ref.set
            loadTargets(force = true)
        }
    }

    private fun fixRow(ref: SetRef): SetRow? =
        _state.value.workout?.entries?.getOrNull(ref.entry)?.sets?.getOrNull(ref.set)?.takeIf { it.done }

    private fun loadFix(ref: SetRef, side: String?) {
        val row = fixRow(ref)
        val n = row?.let { SetFix.logged(it, side) }
        if (n == null) { closeFix(); return }
        fix.value = Fix(ref, side, n.w ?: 0.0, n.r ?: 0.0, n.sec ?: 0.0, n)
    }

    fun setFixSide(side: String) { fix.value?.let { loadFix(it.ref, side) } }
    fun editFix(f: Fix) { ackRestOver(); fix.value = f }
    fun closeFix() { fix.value = null }

    /** Save on a set being fixed: the phone gets it as the set done again (SetFix.correct). */
    fun saveFix() {
        val f = fix.value ?: return
        if (!f.changed) return
        val kind = _state.value.settings.effort
        val rated = if (kind != null && f.effort != null) EffortRating(kind, f.effort) else null
        val (next, event) = SetFix.correct(_state.value, f.ref.entry, f.ref.set, f.side, SetFix.Numbers(f.w, f.r, f.sec), rated,
            now().toDouble(), UUID.randomUUID().toString())
        event ?: return
        PhoneLink.send(app, event)
        commit(next)
        if (f.ref == lastLogged.value && f.effort != null) lastRated.value = f.effort
        closeFix()
        noteActivity()
        Haptics.tick(app)
        loadTargets(force = true)
    }

    /** ‹ on the rest: the set just done, open to be fixed while the rest runs on. */
    fun fixLast() {
        ackRestOver()
        val ref = lastLogged.value ?: return
        lastStep.value = -1
        open(ref)
        val side = lastSide
        if (side != null && fix.value != null) setFixSide(side)
    }

    /** A chip during the rest: the set just done gets this effort (its setDone again, as logged). */
    fun rateLast(v: Double) {
        ackRestOver()
        if (!touchAllowed()) return
        val kind = _state.value.settings.effort ?: return
        val ref = lastLogged.value ?: return
        val row = _state.value.workout?.entries?.getOrNull(ref.entry)?.sets?.getOrNull(ref.set) ?: return
        val n = SetFix.logged(row, lastSide) ?: return
        val (next, event) = SetFix.correct(_state.value, ref.entry, ref.set, lastSide, n, EffortRating(kind, v),
            now().toDouble(), UUID.randomUUID().toString())
        event ?: return
        PhoneLink.send(app, event)
        commit(next)
        lastRated.value = v
        Haptics.tick(app)
    }

    /** The set up next, done: the numbers on the screen (a hold's seconds as it lasted). */
    fun completeSet(heldFor: Double? = null) {
        val s0 = _state.value
        val w = s0.workout ?: return
        val e = entry() ?: return
        val si = setIndex() ?: return
        val at = now()
        // A double tap on Done (a sweaty finger) is one set, not this one and the next; in a
        // superset the page flips to the partner, so a slower second tap waits too.
        if (heldFor == null && (at - lastTickAt < 700 || !touchAllowed())) return
        lastTickAt = at
        val from = setFrom
        closeRest(at)
        val d = draft.value
        val side = e.sets[si].sideUp
        var tw: Double? = null; var tr: Double? = null; var tsec: Double? = null
        if (e.isTimed) {
            tsec = heldFor ?: d.sec
            if ((e.sets[si].w ?: 0.0) > 0) tw = d.w        // a weighted hold keeps its weight
        } else if (!e.isCardio) { tw = d.w; tr = d.r }
        val ei = entryIndex
        val (s1, event) = SessionCore.tick(s0, ei, si, side, tw, tr, tsec, at.toDouble(), UUID.randomUUID().toString(), hrOf(from))
        event ?: return
        PhoneLink.send(app, event)
        echoOf = (event["id"] as? kotlinx.serialization.json.JsonPrimitive)?.content
        ackRestOver()
        picked.remove(ei)
        val (nextEi, rest) = SessionCore.next(s1, ei, si)
        if (side != null && !rest) Haptics.side(app) else Haptics.tick(app)
        commit(s1.copy(entryIndex = nextEi))
        setFrom = at
        noteActivity()
        var rested = false
        if (rest && nextEi < w.entries.size) {
            val sec0 = e.restSec ?: w.restSec.takeIf { it > 0 } ?: s1.restSec
            if (sec0 > 0) {
                startRest(sec0.roundToInt())
                restAfter = RestAfter(e.id, ei, si, w.id ?: "", at)
                rested = true
                // The thumb that hit Done is still there: the rest's buttons wait a second for it.
                touchLock.lock(at)
            }
        }
        lastLogged.value = SetRef(ei, si)
        lastSide = side
        lastRated.value = null
        lastStep.value = 1
        loadTargets(force = true)
        // Every set done or passed over: the Overview, where Finish is.
        if (Overview.atEnd(_state.value)) page.value = Page.OVERVIEW
        if (heldFor != null && !rested) autoHoldIfDue()
    }

    /** A set passed over (a long press on Done): not done, the next one comes up. */
    fun skipSet() {
        if (!touchAllowed()) return
        val si = setIndex() ?: return
        val ei = entryIndex
        var s1 = SessionCore.skip(_state.value, ei, si)
        picked.remove(ei)
        if (SessionCore.setIndex(s1, ei) == null) s1 = s1.copy(entryIndex = SessionCore.next(s1, ei, si).first)
        ackRestOver()
        commit(s1)
        Haptics.skip(app)
        noteActivity()
        loadTargets(force = true)
        if (Overview.atEnd(_state.value)) page.value = Page.OVERVIEW
    }

    /* ---------- starting: the weigh-in, the 3-2-1, Go! ---------- */

    /** A routine started here: first the weigh-in, as on the phone, unless it is off there. */
    fun start(session: ReadySession) {
        if (!homeLock.allows(now())) return
        val st = _state.value.settings
        if (st.weighIn != false) {
            bodyWeight.value = st.lastBw ?: if (_state.value.unit == "lb") 160.0 else 70.0
            weighInFor.value = session
            return
        }
        countIn(session, null)
    }

    /** The weigh-in answered: saved (a weigh-in event and the session's body weight) or skipped. */
    fun finishWeighIn(save: Boolean) {
        val session = weighInFor.value ?: return
        weighInFor.value = null
        var bw: Double? = null
        if (save) WeighIn.event(bodyWeight.value, now().toDouble(), UUID.randomUUID().toString())?.let {
            PhoneLink.send(app, it); bw = bodyWeight.value
        }
        countIn(session, bw)
    }

    fun cancelWeighIn() { weighInFor.value = null }

    /** 3-2-1 before the workout: the heart rate sensor warms up meanwhile, a tick each second. */
    private fun countIn(session: ReadySession, bw: Double?) {
        val from = now()
        _countIn.value = CountIn(from, session, bw)
        Haptics.count(app)
        countJob?.cancel()
        countJob = scope.launch {
            while (isActive) {
                delay(1000 - (now() - from) % 1000)
                if (_countIn.value?.from != from) return@launch
                if (Countdown.number(now() - from + 50) == 0) { startNow(); return@launch } else Haptics.count(app)
            }
        }
    }

    /** The countdown ran out, or a tap on it: the workout starts. */
    fun startNow() {
        val c = _countIn.value ?: return
        countJob?.cancel()
        _countIn.value = null
        // A workout came from the phone meanwhile: that one runs.
        if (_state.value.workout != null) return
        startSession(c.session ?: return, c.bw)
        showGo()
    }

    fun cancelCountIn() { if (_countIn.value != null) countJob?.cancel(); _countIn.value = null }

    private fun showGo() {
        val at = now()
        goAt.value = at
        scope.launch { delay(700); if (goAt.value == at) goAt.value = null }
    }

    private fun startSession(session: ReadySession, bw: Double?) {
        val at = now()
        val (s1, event) = SessionCore.start(_state.value, session, "watch-" + UUID.randomUUID(), at.toDouble(), UUID.randomUUID().toString(), bw)
        PhoneLink.send(app, event)
        readings.clear()
        setFrom = at; seenAt = at; idleSnooze = 0
        picked.clear()
        _summary.value = null
        lastLogged.value = null
        page.value = Page.SET
        commit(s1)
        loadTargets(force = true)
        Haptics.start(app)
    }

    /* ---------- finishing ---------- */

    /** Finish (a 1 s hold on the Overview): saved on the phone, as its Finish and save. */
    fun finish(at: Long = now(), idle: Boolean = false, left: Boolean = false) {
        // Finished mid-hold: the seconds held so far are that set, not lost.
        if (!idle && _hold.value != null) endHold(early = true)
        val before = _state.value
        val w = before.workout ?: return
        closeRest(minOf(at, now()))
        val (s1, event) = SessionCore.finish(before, at.toDouble(), UUID.randomUUID().toString(), idle = idle, left = left)
        event?.let { PhoneLink.send(app, it) }
        _summary.value = SessionCore.summary(w, at.toDouble(), hr = hrOf(0))
        endAll()
        commit(s1)
        Haptics.finished(app)
    }

    fun discard() {
        val before = _state.value
        if (before.workout == null) return
        closeRest(now())
        val (s1, event) = SessionCore.finish(before, now().toDouble(), UUID.randomUUID().toString(), discard = true)
        event?.let { PhoneLink.send(app, it) }
        _summary.value = null
        endAll()
        commit(s1)
        Haptics.discarded(app)
    }

    private fun endAll() {
        stopHoldCount(); stopHold(); stopRest(); closeFix()
        readings.clear()
        lowerIdle()
        lastLogged.value = null
        page.value = Page.SET
    }

    /** Done on the summary; Start waits a second after it (the thumb is still on the glass). */
    fun dismissSummary() { _summary.value = null; homeLock.lock(now()) }

    /* ---------- the rest ---------- */

    fun startRest(seconds: Int, endsAt: Long = now() + seconds * 1000L) = armRest(Rest(endsAt, seconds, now()))

    fun addRest(seconds: Int) {
        if (!touchAllowed()) return
        val r = _rest.value ?: return
        armRest(r.copy(endsAt = (r.endsAt + seconds * 1000L).coerceAtLeast(now() + 1000), total = (r.total + seconds).coerceAtLeast(1)))
    }

    /** −15 s; with 15 s or less left, a Skip (as on the phone). */
    fun minusRest() {
        if (!touchAllowed()) return
        val r = _rest.value ?: return
        val to = RestMath.minus(r.endsAt, now())
        if (to == null) { skipRest(); return }
        armRest(r.copy(endsAt = to))
    }

    /** Skip: the rest ends, and a hold that starts by itself counts in. */
    fun skipRest() {
        if (!touchAllowed()) return
        closeRest(now())
        stopRest()
        touchLock.lock(now())       // the set page comes back under the finger that hit Skip
        autoHoldIfDue()
    }

    fun stopRest() {
        restJob?.cancel()
        _rest.value = null
        Awake.release(REST)
        prefs.edit().remove("restEndsAt").apply()
        ackRestOver()
    }

    private fun armRest(r: Rest) {
        restJob?.cancel()
        ackRestOver()                              // a new rest (from the phone too) ends the last one's second buzz
        _rest.value = r
        prefs.edit().putLong("restEndsAt", r.endsAt).putInt("restTotal", r.total).apply()
        // Awake until the buzz: with the screen off the watch sleeps, and the rest's end came late (AwakePlan).
        Awake.until(app, REST, r.endsAt)
        restJob = scope.launch {
            val soon = r.endsAt - 10_000 - now()
            if (soon > 0 && r.total >= 30) { delay(soon); if (buzz()) Haptics.restSoon(app) }
            delay((r.endsAt - now()).coerceAtLeast(0))
            if (buzz()) {
                Haptics.restOver(app)
                // Once more after a few seconds if nobody reacts (a set, a skip, a hold), as on the Apple Watch.
                restOverRepeat?.cancel()
                Awake.until(app, REST_AGAIN, now() + 5_000)
                restOverRepeat = scope.launch {
                    try { delay(5_000); if (buzz()) Haptics.restOver(app) } finally { Awake.release(REST_AGAIN) }
                }
            }
            _rest.value = null
            Awake.release(REST)
            prefs.edit().remove("restEndsAt").apply()
            // The rest is part of no set: its heart rate goes to the set before it, the next set's counts from here.
            closeRest(now())
            setFrom = now()
            touchLock.lock(now())
            autoHoldIfDue()
        }
    }

    private fun buzz() = _state.value.settings.restHaptics != false

    private var restOverRepeat: Job? = null

    /** Someone reacted to the rest being over (any touch, the crown, a set): no second buzz. */
    fun ackRestOver() { restOverRepeat?.cancel(); restOverRepeat = null; Awake.release(REST_AGAIN) }

    /* ---------- holds ---------- */

    /** The hold starts: a countdown from the seconds on the screen; at zero it is done by itself. */
    fun startHold(auto: Boolean = false) {
        ackRestOver()
        if (!auto && !touchAllowed()) return
        val e = entry() ?: return
        val seconds = draft.value.sec
        if (!e.isTimed || setIndex() == null || seconds <= 0) return
        stopHoldCount()
        stopRest()
        noteActivity()
        val start = now()
        val end = start + (seconds * 1000).toLong()
        _hold.value = Hold(start, end)
        Awake.until(app, HOLD, end)
        Haptics.start(app)
        holdJob?.cancel()
        holdJob = scope.launch {
            // The last three seconds, one click each, so the wrist knows without a look.
            for (left in listOf(3, 2, 1)) {
                val at = end - left * 1000L
                if (seconds > left + 1 && at > now()) { delay(at - now()); Haptics.count(app) }
            }
            delay((end - now()).coerceAtLeast(0))
            endHold(early = false)
        }
    }

    /** Stopped by hand: done with the seconds it lasted (a hold under a second is not one). */
    fun endHold(early: Boolean) {
        val h = _hold.value ?: return
        val lasted = Math.round(((if (early) now() else h.endsAt) - h.startedAt) / 1000.0).toDouble()
        stopHold()
        if (lasted >= 1) completeSet(heldFor = lasted)
    }

    fun stopHold() { holdJob?.cancel(); _hold.value = null; if (::app.isInitialized) Awake.release(HOLD) }

    private const val REST = "rest"
    private const val REST_AGAIN = "restAgain"
    private const val HOLD = "hold"

    /** With the phone's "timed holds start by themselves" on and a hold up next: 3-2-1, then the hold. */
    fun autoHoldIfDue() {
        val s = _state.value
        if (s.settings.autoHolds != true || s.workout == null || entry()?.isTimed != true || setIndex() == null) return
        if (_hold.value != null || _rest.value != null || _holdCountIn.value != null || draft.value.sec <= 0) return
        val from = now()
        _holdCountIn.value = from
        Haptics.count(app)
        countJob?.cancel()
        countJob = scope.launch {
            while (isActive) {
                delay(1000 - (now() - from) % 1000)
                if (_holdCountIn.value != from) return@launch
                if (Countdown.number(now() - from + 50) == 0) {
                    _holdCountIn.value = null
                    startHold(auto = true)
                    if (_hold.value != null) showGo()
                    return@launch
                } else Haptics.count(app)
            }
        }
    }

    fun stopHoldCount() {
        if (_holdCountIn.value != null) countJob?.cancel()
        _holdCountIn.value = null
    }

    /* ---------- a workout left running ---------- */

    private fun noteActivity() {
        if (askDone.value) askDone.value = false
    }

    /** Checked every 30 s: "All done?" after 20 minutes without a set (asked, never ended here). */
    private fun watchIdle() {
        idleJob?.cancel()
        idleJob = scope.launch {
            while (isActive) {
                checkIdle()
                // The link looked after while it matters: whether the phone is in reach (it walked
                // off, it came back), and what is due goes out again (OutboxCore.due).
                if (Reach.upkeep(_state.value.workout != null, PhoneLink.waiting.value)) PhoneLink.upkeep(app)
                delay(30_000)
            }
        }
    }

    private fun checkIdle() {
        val w = _state.value.workout
        if (w == null) { lowerIdle(); return }
        val busy = _hold.value != null || _rest.value != null
        if (!sensorsResting && SensorPlan.idle(w, maxOf(seenAt, activityAt).toDouble(), now().toDouble(), busy)) {
            sensorsResting = true
            WorkoutService.sync(app)
        }
        // A rest or a hold running is a workout going on, however long it takes.
        if (busy) return
        // Paused on the phone: not forgotten.
        if ((w.pausedAt ?: 0.0) > 0) { lowerIdle(); return }
        if (demoOn) return
        val t = now().toDouble()
        val since = Idle.since(Idle.lastSet(w) ?: seenAt.toDouble(), seenAt.toDouble(), activityAt.toDouble(), idleSnooze.toDouble())
        idleMinutes.value = Idle.minutes(since, t)
        val rules = Idle.Rules.from(_state.value.settings.forgotten)
        when (Idle.state(since, t, rules, w.leftGymAt)) {
            Idle.State.ACTIVE -> lowerIdle()
            Idle.State.ASK -> raiseIdle(false, Idle.endsAt(since, rules, w.leftGymAt))
            Idle.State.LEFT -> raiseIdle(true, Idle.endsAt(since, rules, w.leftGymAt))
            Idle.State.END -> {
                // Nobody answered: saved on the phone, ending at the last set plus its rest. The
                // phone keeps it running instead if it was used there (staleWatchFinish).
                val left = rules.leaveGym && (w.leftGymAt ?: 0.0) > since
                lowerIdle()
                finish(at = Idle.endAt(w, t).toLong(), idle = true, left = left)
            }
        }
    }

    private fun raiseIdle(left: Boolean, endsAt: Double?) {
        idleEndsAt.value = endsAt?.toLong()
        if (!askDone.value || idleLeft.value != left) {
            idleLeft.value = left
            Haptics.ask(app)
            // With the screen off or another app in front, the card alone is not seen: a notification too.
            IdleNotice.post(app, left, endsAt?.toLong())
        }
        askDone.value = true
    }

    private fun lowerIdle() {
        if (askDone.value) IdleNotice.cancel(app)
        askDone.value = false
        idleLeft.value = false
    }

    /** "Keep going" on "Still training?": idle counts from now, here and on the phone. */
    fun keepGoing() {
        val at = now()
        idleSnooze = at
        lowerIdle()
        SessionCore.stillHere(_state.value, at.toDouble(), UUID.randomUUID().toString())?.let { PhoneLink.send(app, it) }
    }

    /* ---------- heart rate (WorkoutService) ---------- */

    fun onHeartRate(bpm: Int, at: Long = now()) {
        if (bpm !in 25..250) return
        _heartRate.value = bpm
        readings.addLast(at to bpm)
        while (readings.size > 20_000) readings.removeFirst()
    }

    fun clearHeartRate() { _heartRate.value = null }

    /**
     * A set ticked on the phone: measured here like a tick on the wrist, from when the set started
     * up to the phone's tick, and sent as a setHr (the Apple Watch's phoneTicked). The next set
     * starts at that tick.
     */
    private fun phoneTicked(t: PhoneTick, wid: String, resting: Boolean) {
        val at = t.at.toLong()
        // From before this set started (made while the watch was away), or from a clock ahead of this one: no window.
        if (at <= setFrom || at > now() + 60_000) return
        val from = setFrom
        closeRest(at)
        hrOf(from, at)?.let { PhoneLink.send(app, SessionCore.setHrEvent(wid, t.exId, t.entryIdx, t.setIdx, UUID.randomUUID().toString(), hr = it)) }
        setFrom = at
        // The phone started a rest after it: that rest's heart rate is this set's.
        if (resting) restAfter = RestAfter(t.exId, t.entryIdx, t.setIdx, wid, at)
    }

    /**
     * The phone ticked a set: the watch moves on as its own Done would (the next set, the superset
     * partner, the next exercise, the Overview at the end), on whichever exercise it was (#1149), and
     * the rest's effort chips rate that set.
     */
    private fun followPhoneTick(t: PhoneTick) {
        lastLogged.value = SetRef(t.entryIdx, t.setIdx)
        lastRated.value = null
        if (fix.value != null || _hold.value != null || _holdCountIn.value != null) return
        val s = _state.value
        SessionCore.followTick(s, t.entryIdx, t.setIdx)?.let { nextEi -> picked.remove(entryIndex); picked.remove(nextEi); commit(s.copy(entryIndex = nextEi)); loadTargets(force = true) }
        if (Overview.atEnd(_state.value)) page.value = Page.OVERVIEW
    }

    /** The set a running rest follows, and since when (ms): the rest's heart rate goes to it (the Apple Watch's restAfter). */
    private data class RestAfter(val exId: String, val entryIdx: Int, val setIdx: Int, val wid: String, val from: Long)
    private var restAfter: RestAfter? = null

    /**
     * The rest after a set is over (it ran out, was skipped, the next set was logged, the workout
     * ended): its heart rate goes to that set as a setHr's restHr, and the next set counts from here.
     */
    private fun closeRest(end: Long) {
        val r = restAfter ?: return
        restAfter = null
        setFrom = end
        hrOf(r.from, end)?.let { PhoneLink.send(app, SessionCore.setHrEvent(r.wid, r.exId, r.entryIdx, r.setIdx, UUID.randomUUID().toString(), restHr = it)) }
    }

    /** avg and max of the readings from `from` up to `to` (ms), or null without any (the phone's sanitizeHr shape). */
    private fun hrOf(from: Long, to: Long = Long.MAX_VALUE): Pair<Int, Int>? {
        val xs = readings.filter { it.first in from..to }.map { it.second }
        if (xs.isEmpty()) return null
        return xs.average().roundToInt() to xs.max()
    }

    /* ---------- saving and telling the rest of the watch ---------- */

    private fun commit(s: SessionState) {
        val had = _state.value.workout != null
        val wasId = _state.value.workout?.id
        // Any change to the running workout, a tap here or an edit on the phone, is the workout going on.
        // The phone walking out of the gym is not: it would hide "Looks like you left the gym".
        if (s.workout != null && s.workout.copy(leftGymAt = null) != _state.value.workout?.copy(leftGymAt = null)) {
            activityAt = now(); sensorsResting = false
        }
        _state.value = s
        if (wasId != s.workout?.id) dropStaleStills(s.workout?.id)
        prefs.edit().putString("state", WireJson.encodeToString(SessionState.serializer(), s)).apply()
        if (had != (s.workout != null) || s.workout != null) WorkoutService.sync(app)
        refreshSurfacesSoon()
    }

    /* ---------- the exercises' stills (Stills in WatchLogic.kt) ---------- */

    /** Up by one when a still arrives or goes: the Overview loads its pictures again. */
    val stillsVersion = MutableStateFlow(0)

    private fun stillsDir() = java.io.File(app.filesDir, "stills")

    /** Where this workout's still of that exercise is (or would be); none for a name that is not plain. */
    fun stillFile(wid: String?, exId: String?): java.io.File? =
        if (::app.isInitialized && Stills.safe(wid) && Stills.safe(exId)) java.io.File(stillsDir(), "$wid/$exId.webp") else null

    /** A still from the phone, kept for its workout (written to a temp file, then renamed). */
    fun saveStill(wid: String?, exId: String?, bytes: ByteArray) {
        if (bytes.isEmpty() || bytes.size > Stills.MAX_BYTES) return
        val f = stillFile(wid, exId) ?: return
        try {
            f.parentFile?.mkdirs()
            val tmp = java.io.File(f.path + ".tmp")
            tmp.writeBytes(bytes)
            if (tmp.renameTo(f)) stillsVersion.value++
        } catch (_: Exception) {}
    }

    /** Another workout runs, or none: the stills of every other go. */
    private fun dropStaleStills(running: String?) {
        if (!::app.isInitialized) return
        val dirs = stillsDir().list()?.toList() ?: return
        Stills.stale(dirs, running).forEach { java.io.File(stillsDir(), it).deleteRecursively() }
        stillsVersion.value++
    }

    /** The Tile and the complication, at most twice a second. */
    fun refreshSurfacesSoon() {
        if (!::app.isInitialized) return
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

    /* ---------- the screenshot rig (debug builds only: adb ... --es demo <screen>) ---------- */

    /** Puts the store on one of the screens the docs and the store listing show. Debug builds only. */
    fun demo(screen: String, snapshot: String) {
        if (!BuildConfig.DEBUG) return
        demoOn = true
        _summary.value = null; stopRest(); stopHold(); closeFix(); weighInFor.value = null; cancelCountIn()
        askDone.value = false; idleLeft.value = false; touchLock.unlock(); lastTickAt = 0; goAt.value = null; stopHoldCount()
        applySnapshotJson(snapshot)
        when (screen) {
            "start" -> commit(_state.value.copy(workout = null))
            "rest" -> completeSet()
            "overview" -> page.value = Page.OVERVIEW
            "metrics" -> page.value = Page.METRICS
            "media" -> page.value = Page.MEDIA
            "fix" -> { completeSet(); stopRest(); fixLast() }
            "hold" -> { _state.value.workout?.entries?.indexOfFirst { it.isTimed }?.takeIf { it >= 0 }?.let { jump(it) }; startHold(auto = true) }
            "summary" -> {
                val w = _state.value.workout
                if (w != null) {
                    _summary.value = SessionCore.summary(w, (w.start ?: now().toDouble()) + 52 * 60_000, hr = 128 to 164)
                    commit(_state.value.copy(workout = null))
                }
            }
            "weighin" -> _state.value.ready?.today?.let { commit(_state.value.copy(workout = null)); weighInFor.value = it; bodyWeight.value = 78.4 }
            "countdown" -> _state.value.ready?.today?.let { commit(_state.value.copy(workout = null)); _countIn.value = CountIn(now() - 1200, it) }
            "go" -> goAt.value = now() + 600_000
            "idle" -> { askDone.value = true; idleMinutes.value = 47; idleEndsAt.value = now() + 180_000 }
            "left" -> { askDone.value = true; idleLeft.value = true; idleEndsAt.value = now() + 240_000 }
        }
    }
}
