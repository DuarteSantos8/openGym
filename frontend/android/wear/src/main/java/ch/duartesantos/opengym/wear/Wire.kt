package ch.duartesantos.opengym.wear

import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/**
 * JSON in and out: what the phone sends (index, snapshot), the finished session the watch sends
 * back, and the watch's own persisted copy of a workout in progress. Version 1; the other end of
 * every shape here is frontend/src/lib/wear-bridge.js, and the two are pinned to the same fixtures
 * (src/test/resources) so neither can drift from the other unnoticed.
 */
object Wire {
    const val SCHEMA = 1

    // ---------------------------------------------------------------- from the phone

    fun parseIndex(json: String): Index? = try {
        val o = JSONObject(json)
        if (o.optInt("v") != SCHEMA || o.optString("kind") != "index") null
        else {
            val list = o.optJSONArray("routines") ?: JSONArray()
            Index(
                unit = o.optString("unit", "kg"),
                ts = o.optLong("ts"),
                routines = (0 until list.length()).mapNotNull { i ->
                    val r = list.optJSONObject(i) ?: return@mapNotNull null
                    val id = r.optString("id")
                    if (id.isEmpty()) null else RoutineRef(id, r.optString("name"), r.optInt("exercises"))
                },
            )
        }
    } catch (e: JSONException) {
        null
    }

    /** The routine id of an answer saying the routine is gone, else null. */
    fun missingRoutine(json: String): String? = try {
        val o = JSONObject(json)
        if (o.optInt("v") == SCHEMA && o.optString("kind") == "missing") o.optString("routineId") else null
    } catch (e: JSONException) {
        null
    }

    fun parseSnapshot(json: String): Snapshot? = try {
        val o = JSONObject(json)
        if (o.optInt("v") != SCHEMA || o.optString("kind") != "snapshot") null
        else {
            val exs = o.optJSONArray("exercises") ?: JSONArray()
            val skipped = o.optJSONArray("skipped") ?: JSONArray()
            Snapshot(
                routineId = o.getString("routineId"),
                name = o.optString("name"),
                unit = o.optString("unit", "kg"),
                ts = o.optLong("ts"),
                skipped = (0 until skipped.length()).map { skipped.optJSONObject(it)?.optString("name").orEmpty() },
                exercises = (0 until exs.length()).map { exercise(exs.getJSONObject(it)) },
            )
        }
    } catch (e: JSONException) {
        null
    }

    private fun exercise(o: JSONObject): Exercise {
        val timed = o.optString("mode") == "time"
        val sets = o.optJSONArray("sets") ?: JSONArray()
        return Exercise(
            id = o.getString("id"),
            name = o.optString("name", o.getString("id")),
            timed = timed,
            perSide = o.optBoolean("perSide"),
            step = o.optDouble("step", if (timed) 5.0 else 2.5).takeIf { it > 0 } ?: 2.5,
            ctx = (o.optJSONObject("ctx") ?: JSONObject()).toString(),
            sets = (0 until sets.length()).map { plannedSet(sets.getJSONObject(it), timed) },
        )
    }

    private fun plannedSet(o: JSONObject, timed: Boolean): PlannedSet {
        val drops = o.optJSONArray("drops") ?: JSONArray()
        val clusters = o.optJSONArray("clusters") ?: JSONArray()
        return PlannedSet(
            w = o.optDouble("w", 0.0),
            r = o.optInt("r", 0),
            sec = o.optInt("sec", 0),
            timed = timed,
            warmup = o.optString("phase") == "warmup",
            side = o.optString("side").ifEmpty { null },
            type = o.optString("type").ifEmpty { "straight" },
            failure = o.optBoolean("failure"),
            max = o.optBoolean("max"),
            rest = o.optInt("rest", 0),
            drops = (0 until drops.length()).map { drops.getJSONObject(it).let { d -> Drop(d.optDouble("w", 0.0), d.optInt("r", 0)) } },
            clusters = (0 until clusters.length()).map { clusters.getJSONObject(it).let { c -> Cluster(c.optInt("r", 0), c.optInt("restSec", 0)) } },
        )
    }

    // ---------------------------------------------------------------- to the phone

    /**
     * The finished session, as lib/wear-bridge.js watchSessionToActive reads it. A set that was not
     * logged goes back as planned and not done; the exercises' ctx goes back exactly as it came.
     */
    fun sessionPayload(snapshot: Snapshot, s: Session, end: Long): JSONObject {
        val exercises = JSONArray()
        snapshot.exercises.forEachIndexed { xi, ex ->
            val sets = JSONArray()
            ex.sets.forEachIndexed { si, planned ->
                val r = s.results.lastOrNull { it.ex == xi && it.set == si }
                sets.put(loggedSet(ex, planned, r))
            }
            exercises.put(JSONObject().put("id", ex.id).put("ctx", JSONObject(ex.ctx)).put("sets", sets))
        }
        return JSONObject()
            .put("v", SCHEMA)
            .put("id", s.id)
            .put("routineId", s.routineId)
            .put("name", s.name)
            .put("unit", s.unit)
            .put("start", s.start)
            .put("end", end)
            .put("exercises", exercises)
    }

    private fun loggedSet(ex: Exercise, p: PlannedSet, r: SetResult?): JSONObject {
        val o = JSONObject()
        val done = r?.done == true
        val w = if (done) r!!.w else p.w
        o.put("w", w)
        if (ex.timed) o.put("sec", if (done) r!!.sec else p.sec) else o.put("r", if (done) r!!.r else p.r)
        if (p.warmup) o.put("phase", "warmup")
        if (p.side != null) o.put("side", p.side)
        if (p.failure) o.put("failure", true)
        if (p.max) o.put("max", true)
        val drops = if (done) r!!.drops else p.drops
        val clusters = if (done) r!!.clusters else p.clusters
        if (p.type == "dropset" && drops.isNotEmpty()) {
            o.put("type", "dropset")
            o.put("drops", JSONArray(drops.map { JSONObject().put("w", it.w).put("r", it.r) }))
        } else if (p.type == "restpause" && clusters.isNotEmpty()) {
            o.put("type", "restpause")
            o.put("clusters", JSONArray(clusters.map { JSONObject().put("r", it.r).put("restSec", it.restSec) }))
        }
        o.put("done", done)
        if (done) o.put("at", r!!.at)
        return o
    }

    // ---------------------------------------------------------------- the watch's own copy

    fun sessionToJson(s: Session): JSONObject = JSONObject()
        .put("id", s.id).put("routineId", s.routineId).put("name", s.name).put("unit", s.unit).put("start", s.start)
        .put("ex", s.ex).put("set", s.set).put("step", s.step)
        .put("partial", JSONArray(s.partial.map { JSONObject().put("w", it.w).put("r", it.r).put("sec", it.sec) }))
        .put("results", JSONArray(s.results.map { r ->
            JSONObject().put("ex", r.ex).put("set", r.set).put("w", r.w).put("r", r.r).put("sec", r.sec)
                .put("done", r.done).put("at", r.at)
                .put("drops", JSONArray(r.drops.map { JSONObject().put("w", it.w).put("r", it.r) }))
                .put("clusters", JSONArray(r.clusters.map { JSONObject().put("r", it.r).put("restSec", it.restSec) }))
        }))
        .put("restEndsAt", s.restEndsAt).put("restTotalSec", s.restTotalSec).put("finished", s.finished)

    fun sessionFromJson(o: JSONObject): Session {
        val partial = o.optJSONArray("partial") ?: JSONArray()
        val results = o.optJSONArray("results") ?: JSONArray()
        return Session(
            id = o.getString("id"), routineId = o.optString("routineId"), name = o.optString("name"),
            unit = o.optString("unit", "kg"), start = o.getLong("start"),
            ex = o.optInt("ex"), set = o.optInt("set"), step = o.optInt("step"),
            partial = (0 until partial.length()).map { partial.getJSONObject(it).let { v -> StepValue(v.optDouble("w"), v.optInt("r"), v.optInt("sec")) } },
            results = (0 until results.length()).map { i ->
                val r = results.getJSONObject(i)
                val drops = r.optJSONArray("drops") ?: JSONArray()
                val clusters = r.optJSONArray("clusters") ?: JSONArray()
                SetResult(
                    r.optInt("ex"), r.optInt("set"), r.optDouble("w"), r.optInt("r"), r.optInt("sec"), r.optBoolean("done"), r.optLong("at"),
                    (0 until drops.length()).map { drops.getJSONObject(it).let { d -> Drop(d.optDouble("w"), d.optInt("r")) } },
                    (0 until clusters.length()).map { clusters.getJSONObject(it).let { c -> Cluster(c.optInt("r"), c.optInt("restSec")) } },
                )
            },
            restEndsAt = o.optLong("restEndsAt"), restTotalSec = o.optInt("restTotalSec"), finished = o.optBoolean("finished"),
        )
    }

    fun activeToJson(a: ActiveWorkout): String =
        JSONObject().put("snapshot", a.snapshotJson).put("session", sessionToJson(a.session)).toString()

    fun activeFromJson(json: String): ActiveWorkout? = try {
        val o = JSONObject(json)
        val raw = o.getString("snapshot")
        val snapshot = parseSnapshot(raw)
        if (snapshot == null) null else ActiveWorkout(raw, snapshot, sessionFromJson(o.getJSONObject("session")))
    } catch (e: JSONException) {
        null
    }
}
