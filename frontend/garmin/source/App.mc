// openGym on Garmin: the app, the link to the phone, the heart rate and the Garmin Connect copy.
// docs/GARMIN.md has the whole picture; Core.mc has the session logic.
import Toybox.Activity;
import Toybox.ActivityRecording;
import Toybox.Application;
import Toybox.Application.Storage;
import Toybox.Attention;
import Toybox.Communications;
import Toybox.Lang;
import Toybox.Sensor;
import Toybox.System;
import Toybox.Timer;
import Toybox.WatchUi;

//! What every screen shares: the state (Core.mc), and the summary of the workout just ended.
module G {
    var state = null;
    var ended = null;
    //! Heart rate shown live, or null.
    var bpm = null;
    //! The last time the phone could not be reached (ms), for "Phone out of reach".
    var awayAt = null;
    //! The session's page: :over (Overview) <- :set (the set, its rest and hold) -> :met (Metrics).
    var page = :set;
    //! System.getTimer() until which the buttons wait (the thumb that hit Done is still there).
    var lock = 0;
    //! The set logged last here, [exId, si, side], and the effort given to it (the rest's chips).
    var last = null;
    var rated = null;
    //! The done set being fixed, [exId, si, side] (‹ on the set, "Previous set" in the menu), or null.
    var fix = null;
    //! A hold running: [System.getTimer() at its start, seconds to hold]; its 3-2-1 began at hcd.
    var hold = null;
    var hcd = null;
    //! The workout's own 3-2-1: [System.getTimer() at its start, the session to start].
    var cd = null;
    //! "Still training?": up, because the phone left the gym (askLeft), and when the lifter last
    //! said "Keep going" (ms).
    var ask = false;
    var askLeft = false;
    var snooze = null;
    //! When the summary came up (System.getTimer()): its Done waits a second.
    var endedAt = 0;

    function locked() {
        return System.getTimer() < lock;
    }

    //! The state, stored in parts: the workout, what can be started and the outbox each under a
    //! key of their own, the rest under "s". Storing one value takes a copy of it for a moment, so
    //! smaller parts keep that peak low on the watches with the least memory.
    const PARTS = ["w", "rd", "ob"];

    function save() {
        var keep = [];
        for (var i = 0; i < PARTS.size(); i += 1) {
            keep.add(state[PARTS[i]]);
            state[PARTS[i]] = null;
        }
        try {
            Storage.setValue("s", state);
            for (var j = 0; j < PARTS.size(); j += 1) {
                Storage.setValue(PARTS[j], keep[j]);
            }
        } catch (ex) {
            // A full store: the state stays in memory, the next save tries again.
        }
        for (var k = 0; k < PARTS.size(); k += 1) {
            state[PARTS[k]] = keep[k];
        }
    }

    //! Only the outbox (an event added or sent).
    function saveOb() {
        try {
            Storage.setValue("ob", state["ob"]);
        } catch (ex) {
            // the next save tries again
        }
    }

    //! The state as save() stored it (or as an older app stored it, whole under "s").
    function load() {
        var s = null;
        try {
            s = Storage.getValue("s");
            if (s instanceof Lang.Dictionary && s["w"] == null && s["ob"] == null) {
                for (var i = 0; i < PARTS.size(); i += 1) {
                    s[PARTS[i]] = Storage.getValue(PARTS[i]);
                }
            }
        } catch (ex) {
            s = null;
        }
        return s;
    }

    //! Something changed: saved, and the screen follows the state.
    function changed() {
        save();
        Nav.follow();
        WatchUi.requestUpdate();
    }
}

class OpenGymApp extends Application.AppBase {
    private var _timer = null;

    function initialize() {
        AppBase.initialize();
    }

    function onStart(state) {
        G.state = Core.normalize(G.load());
        if (Link.wired() && (Communications has :registerForPhoneAppMessages)) {
            Communications.registerForPhoneAppMessages(method(:onPhone));
        }
        _timer = new Timer.Timer();
        _timer.start(method(:onTick), 1000, true);
        // A workout that was running when the app closed: measured and recorded again.
        if (G.state["w"] != null) {
            Workout.begin();
        }
        // Ask the phone for the latest; anything still unsent goes along.
        Link.hello();
        simStart();
    }

    //! The simulator build (sim/monkey.jungle) plays the phone's part; the real one has nothing here.
    (:live)
    function simStart() as Void {
    }
    (:sim)
    function simStart() as Void {
        Sim.begin();
    }

    function onStop(state) {
        if (_timer != null) {
            _timer.stop();
        }
        // The app closing mid-workout keeps what Garmin Connect recorded so far.
        Workout.end(true);
        G.save();
    }

    function getInitialView() {
        return Nav.initial();
    }

    //! A message from the phone: the snapshot (lib/garmin-snapshot.js), as a dictionary.
    function onPhone(msg as Communications.PhoneAppMessage) as Void {
        var data = msg.data;
        if (!(data instanceof Lang.Dictionary)) {
            return;
        }
        G.awayAt = null;
        var had = G.state["w"];
        var r0 = G.state["rest"];
        var ended = Core.applySnapshot(G.state, data);
        if (ended != null) {
            Workout.end(true);
            ended["hr"] = Workout.hrTotals();
            Actions.ended(ended);
        } else if (G.state["w"] == null) {
            Actions.reset();
        } else {
            if (had == null) {
                // Started on the phone: the watch measures and records it too.
                Workout.begin();
            }
            Rest.followed(r0);
            Actions.followTick();
        }
        // Room in the outbox again (the phone took some): pending ticks it had no room for go in.
        Core.refill(G.state, false);
        G.changed();
        // The phone is there: anything still waiting goes now.
        Link.heard();
    }

    //! Once a second: the rest, the heart rate, a retry of what the phone has not had yet.
    function onTick() as Void {
        Workout.sample();
        Rest.tick();
        Actions.holdTick();
        Actions.askTick();
        Link.retry();
        WatchUi.requestUpdate();
    }
}

//! Events to the phone (Communications.transmit), kept in the state until the phone has them: a set
//! ticked with the phone away is not lost. Sent once, then kept until the snapshot names it
//! (`acked`, Core.ackOutbox): a message Garmin Connect took while openGym on the phone was not
//! running goes again after a minute. The phone applies each event once, by its id, so one sent
//! twice does no harm.
module Link {
    var busy = false;
    var lastTry = 0;
    //! When the transmit still running began (System.getTimer()), and which one it is: one that
    //! never calls back is given up on (retry), and its listener is not heard any more.
    var began = 0;
    var gen = 0;
    //! The phone's latest is still to come: asked for at the start, and again until it answers.
    var ask = true;
    //! Asked or sent again in a row without a word from the phone: each wait is twice the last
    //! (1, 2, 4, 8, then 16 minutes), so a phone that never answers does not cost the battery.
    var quiet = 0;
    //! The most events kept for a phone that never answers: the oldest sent ones go first; with
    //! none sent, HARD is the end (Core.room).
    const MAX = 60;
    const HARD = 90;

    //! Whether there is a phone link at all. The simulator build has none: without an Android
    //! phone on ADB, the Linux simulator's first transmit puts up a dialog and then crashes, so
    //! there sim/Sim.mc plays the phone and events stay in the outbox.
    (:live)
    function wired() as Boolean {
        return Communications has :transmit;
    }
    (:sim)
    function wired() as Boolean {
        return false;
    }

    //! An event for the phone: stored, then sent.
    function send(ev) {
        if (ev == null) {
            return;
        }
        // The Instinct 2 family: past 6 sets waiting, the set stays a pending tick (Core.refill).
        if (Core.full(G.state, ev)) {
            return;
        }
        Core.supersede(G.state, ev);
        Core.room(G.state, MAX, HARD);
        G.state["ob"].add(Core.pack(ev));
        G.saveOb();
        flush();
    }

    //! "Send me the latest": the phone's bridge answers with a snapshot (docs/GARMIN.md).
    function hello() {
        if (!wired() || busy) {
            return false;
        }
        began = System.getTimer();
        gen += 1;
        busy = true;
        Communications.transmit({ "events" => [{ "id" => Core.newId(), "type" => "hello", "at" => Core.nowMs() }] }, null, new SendListener(0, gen));
        return true;
    }

    function flush() {
        var ob = G.state["ob"];
        var from = Core.toI(G.state["obn"], 0);
        if (busy || from >= ob.size() || !wired()) {
            return;
        }
        busy = true;
        lastTry = System.getTimer();
        began = lastTry;
        gen += 1;
        // A few at a time: a Connect IQ message is small.
        var n = ob.size() - from > 4 ? 4 : ob.size() - from;
        var evs = [];
        for (var i = from; i < from + n; i += 1) {
            evs.add(Core.unpack(ob[i]));
        }
        Communications.transmit({ "events" => evs }, null, new SendListener(n, gen));
    }

    //! Once a second: what was not sent yet after 30 s, what the phone has not confirmed after 60 s.
    //! A transmit that never called back (the phone went away mid-message) is given up on after
    //! 45 s, or nothing would ever be sent again; and the phone is asked for its latest once a
    //! minute until it has answered once (the first hello can get lost like any message). Both
    //! that and the resend of what is unconfirmed wait longer each time the phone stays silent.
    function retry() {
        var now = System.getTimer();
        if (busy && now - began > 45000) {
            busy = false;
            gen += 1;
        }
        if (busy) {
            return;
        }
        var wait = 60000 << (quiet > 4 ? 4 : quiet);
        if (ask && now - began > wait && hello()) {
            quiet += 1;
            return;
        }
        if (G.state["ob"].size() == 0) {
            return;
        }
        var since = now - lastTry;
        if (Core.unsent(G.state) > 0 && since > 30000) {
            flush();
        } else if (Core.unsent(G.state) == 0 && since > wait) {
            G.state["obn"] = 0;
            quiet += 1;
            flush();
        }
    }

    //! The phone just spoke (a snapshot): it is there. What it did not name and was sent a while
    //! ago went nowhere (its app was not running then): that goes again now, not a minute later.
    function heard() {
        ask = false;
        quiet = 0;
        if (!busy && G.state["ob"].size() > 0 && Core.unsent(G.state) == 0 && System.getTimer() - lastTry > 10000) {
            G.state["obn"] = 0;
        }
        flush();
    }

    function sent(n, g) {
        if (g != gen) {
            return;
        }
        busy = false;
        if (n > 0) {
            var next = Core.toI(G.state["obn"], 0) + n;
            G.state["obn"] = next > G.state["ob"].size() ? G.state["ob"].size() : next;
            G.saveOb();
        }
        flush();
    }

    function failed(g) {
        if (g != gen) {
            return;
        }
        busy = false;
        G.awayAt = Core.nowMs();
        WatchUi.requestUpdate();
    }
}

class SendListener extends Communications.ConnectionListener {
    private var _n;
    private var _gen;

    function initialize(n, gen) {
        ConnectionListener.initialize();
        _n = n;
        _gen = gen;
    }

    function onComplete() {
        Link.sent(_n, _gen);
    }

    function onError() {
        Link.failed(_gen);
    }
}

//! The workout on the watch's side: heart rate (Toybox.Sensor) and, when the setting is on, an
//! activity recorded as strength training so it lands in Garmin Connect as well (docs/GARMIN.md,
//! "Garmin Connect and the health apps").
module Workout {
    var session = null;
    // since the last set: sum, count, max; and over the whole workout
    var setSum = 0;
    var setN = 0;
    var setMax = 0;
    var allSum = 0;
    var allN = 0;
    var allMax = 0;

    function recordingOn() {
        try {
            var v = Application.Properties.getValue("recordGc");
            return v == null || v == true;
        } catch (ex) {
            return true;
        }
    }

    function begin() {
        if (Sensor has :setEnabledSensors) {
            Sensor.setEnabledSensors([Sensor.SENSOR_HEARTRATE]);
        }
        var w = G.state["w"];
        if (w == null || session != null || !recordingOn() || !(Toybox has :ActivityRecording)) {
            return;
        }
        // The app restarted mid-workout after saving what it had: that copy stays the only one.
        if (Core.same(G.state["rec"], w["id"])) {
            return;
        }
        try {
            session = ActivityRecording.createSession({
                :name => Core.strOf(w["name"]).length() > 0 ? Core.strOf(w["name"]) : "openGym",
                :sport => Activity.SPORT_TRAINING,
                :subSport => Activity.SUB_SPORT_STRENGTH_TRAINING
            });
            session.start();
            G.state["rec"] = w["id"];
        } catch (ex) {
            session = null;
        }
    }

    //! A set done: a lap in the recording, so Garmin Connect shows the sets apart.
    function lap() {
        if (session != null && session.isRecording()) {
            session.addLap();
        }
    }

    //! The recording stopped: saved (finished) or thrown away (discarded).
    function end(keep) {
        if (session != null) {
            try {
                if (session.isRecording()) {
                    session.stop();
                }
                if (keep) {
                    session.save();
                } else {
                    session.discard();
                }
            } catch (ex) {
                // nothing to save
            }
            session = null;
        }
        if (G.state["w"] == null && (Sensor has :setEnabledSensors)) {
            Sensor.setEnabledSensors([]);
        }
    }

    function sample() {
        var info = Activity.getActivityInfo();
        var h = info == null ? null : info.currentHeartRate;
        G.bpm = h;
        if (h == null || h <= 0 || G.state["w"] == null) {
            return;
        }
        setSum += h; setN += 1; if (h > setMax) { setMax = h; }
        allSum += h; allN += 1; if (h > allMax) { allMax = h; }
    }

    //! The heart rate during the set just done, [avg, max], or null; and the count starts over.
    function hrForSet() {
        var out = setN > 0 ? [(setSum / setN).toNumber(), setMax] : null;
        setSum = 0; setN = 0; setMax = 0;
        return out;
    }

    function newSet() {
        setSum = 0; setN = 0; setMax = 0;
    }

    function hrTotals() {
        var out = allN > 0 ? [(allSum / allN).toNumber(), allMax] : null;
        allSum = 0; allN = 0; allMax = 0;
        setSum = 0; setN = 0; setMax = 0;
        return out;
    }
}

//! The rest between sets: a nudge ten seconds before the end, a clear double buzz at the end.
//! One rest for the phone and the watch (protocol 2, docs/WATCH_SYNC.md "One rest"): +15, -15 and
//! Skip pressed here reach the phone as a `rest` event; the rest running out, or ended or changed
//! on the phone, sends nothing back.
module Rest {
    var nudged = false;
    var over = false;

    //! The rest's length in seconds, for its ring (one started on the phone: its own, else what was
    //! left then).
    var total = null;
    //! The end the nudge and the end's buzz were for: a new end (+15, the phone's) has its own.
    var forEnd = null;

    //! A rest a set done here started (Core.tickRest), `sec` long; null for none.
    function begin(end, sec) {
        forEnd = end;
        nudged = false;
        over = false;
        total = end == null ? null : sec.toNumber();
    }

    //! +15 s, or -15 s (at 15 s or less that is a Skip, as on the phone).
    function add(sec) {
        var r = G.state["rest"];
        if (r == null) {
            return;
        }
        var to = sec > 0 ? r + (sec * 1000).toLong() : Core.restMinus(r, Core.nowMs(), (-sec * 1000).toLong());
        if (to == null) {
            skip();
            return;
        }
        G.state["rest"] = to;
        forEnd = to;
        if (total != null && sec > 0) {
            total += sec;
        }
        nudged = false;
        Link.send(Core.restEvent(G.state, to));
        G.save();
    }

    //! Skip (or -15 to nothing, or Next exercise mid-rest), pressed here: the rest ends on the
    //! phone too, and what follows a rest comes up. The set page waits a second under the thumb.
    function skip() {
        var had = G.state["rest"] != null || G.state["rh"] != null;
        stop();
        if (had) {
            Link.send(Core.restEvent(G.state, null));
            G.lock = System.getTimer() + 1000;
            after();
        }
        Nav.follow();
    }

    //! The rest is over: run out, a Skip, ended on the phone, a new workout. Nothing is sent.
    function stop() {
        G.state["rest"] = null;
        G.state["rh"] = null;
        total = null;
        G.save();
        // The next set's heart rate counts from here, not from the rest.
        Workout.newSet();
    }

    //! After a rest (run out or skipped, here or on the phone): "Timed holds start by themselves"
    //! (the phone's setting) brings up the hold's 3-2-1, as on the other watches.
    (:small)
    function after() {
    }
    (:big)
    function after() {
        if (G.fix == null && G.hold == null && G.hcd == null && Core.autoHold(G.state, Ui.big())) {
            Actions.holdCount();
        }
    }

    //! A snapshot from the phone changed the rest (App.onPhone; `was` its end before): ended there
    //! runs what a Skip here runs, without telling the phone; a new end there starts the ring over.
    (:small)
    function followed(was) {
        if (Core.rx) {
            Core.rx = false;
            Workout.newSet();
        }
        // only a rest the phone changed starts its ring over (an ack leaves it as it was)
        if (G.state["rest"] != was) {
            total = null;
        }
    }
    (:big)
    function followed(was) {
        if (Core.rx) {
            Core.rx = false;
            total = null;
            Workout.newSet();
            after();
            return;
        }
        var r = G.state["rest"];
        if (r != null && (was == null || r != was)) {
            var w = Core.dictOf(G.state["w"]);
            var pr = w == null ? null : Core.dictOf(w["rest"]);
            var t = pr == null ? null : Core.toF(pr["total"]);
            total = t != null && t > 0 ? t.toNumber() : null;
        }
    }

    //! Seconds left, or null without a rest (paused on the phone: what it holds at).
    function left() {
        var r = G.state["rest"];
        if (r == null) {
            var h = G.state["rh"];
            return h == null ? null : Core.toI(h, 0);
        }
        var ms = r - Core.nowMs();
        return ms <= 0 ? 0 : ((ms + 999) / 1000).toNumber();
    }

    //! Whether the rest is paused on the phone (it holds here, no buzz at its end).
    function paused() {
        return G.state["rest"] == null && G.state["rh"] != null;
    }

    function tick() {
        var r = G.state["rest"];
        if (r == null) {
            return;
        }
        if (r != forEnd) {
            forEnd = r;
            nudged = false;
            over = false;
        }
        var l = left();
        if (l <= 10 && l > 0 && !nudged) {
            nudged = true;
            buzz([[50, 150]]);
        }
        if (l == 0 && !over) {
            over = true;
            buzz([[100, 400], [0, 200], [100, 400]]);
            stop();
            after();
            Nav.follow();
        }
    }

    function hapticsOn() {
        var st = G.state["set"];
        return st == null || !(st instanceof Lang.Dictionary) || !Core.isOff(st["restHaptics"]);
    }

    function buzz(pattern) {
        if (!hapticsOn() || !(Attention has :vibrate)) {
            return;
        }
        var v = [];
        for (var i = 0; i < pattern.size(); i += 1) {
            v.add(new Attention.VibeProfile(pattern[i][0], pattern[i][1]));
        }
        Attention.vibrate(v);
    }
}

//! The 3-2-1 (the workout's, and a hold's): a faster tick while it runs, nothing otherwise. On a
//! screen that stays on (AMOLED) the ring drains smoothly; on MIP and black-and-white screens it
//! steps once a second (Ui.smooth), no animation there. The watches with the least memory have no
//! 3-2-1 at all ((:small)).
module Motion {
    var timer = null;
    var lastN = -1;

    (:small)
    function run() {
    }
    (:small)
    function stop() {
    }
    (:small)
    function tick() as Void {
    }

    (:big)
    function run() {
        lastN = -1;
        if (timer == null) {
            timer = new Timer.Timer();
            timer.start(new Lang.Method(Motion, :tick), Ui.smooth() ? 100 : 250, true);
        }
    }

    (:big)
    function stop() {
        if (timer != null) {
            timer.stop();
            timer = null;
        }
    }

    (:big)
    function tick() as Void {
        var from = G.cd != null ? G.cd[0] : G.hcd;
        if (from == null) {
            stop();
            return;
        }
        var el = System.getTimer() - from;
        var n = Core.countNumber(el);
        if (n != lastN) {
            lastN = n;
            Rest.buzz(n == 0 ? [[100, 250]] : [[30, 40]]);
        }
        // "Go!" stays up for 0.7 s, then it starts
        if (el >= 3700) {
            stop();
            if (G.cd != null) {
                Actions.startNow();
            } else {
                Actions.holdStart();
            }
            return;
        }
        WatchUi.requestUpdate();
    }
}
