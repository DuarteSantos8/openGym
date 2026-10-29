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

    function save() {
        try {
            Storage.setValue("s", state);
        } catch (ex) {
            // A full store: the state stays in memory, the next save tries again.
        }
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
        var saved = null;
        try {
            saved = Storage.getValue("s");
        } catch (ex) {
            saved = null;
        }
        G.state = Core.normalize(saved);
        if (Communications has :registerForPhoneAppMessages) {
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
    function onPhone(msg) {
        var data = msg.data;
        if (!(data instanceof Lang.Dictionary)) {
            return;
        }
        G.awayAt = null;
        var had = G.state["w"];
        var ended = Core.applySnapshot(G.state, data);
        if (ended != null) {
            Workout.end(true);
            ended["hr"] = Workout.hrTotals();
            G.ended = ended;
        } else if (had == null && G.state["w"] != null) {
            // Started on the phone: the watch measures and records it too.
            Workout.begin();
        }
        G.changed();
        // The phone heard from us: anything still waiting goes now.
        Link.flush();
    }

    //! Once a second: the rest, the heart rate, a retry of what the phone has not had yet.
    function onTick() as Void {
        Workout.sample();
        Rest.tick();
        Link.retry();
        WatchUi.requestUpdate();
    }
}

//! Events to the phone (Communications.transmit), kept in the state until the phone has them: a set
//! ticked with the phone away is not lost. The phone applies each event once, by its id, so one
//! sent twice does no harm.
module Link {
    var busy = false;
    var lastTry = 0;

    //! An event for the phone: stored, then sent.
    function send(ev) {
        if (ev == null) {
            return;
        }
        G.state["ob"].add(ev);
        G.save();
        flush();
    }

    //! "Send me the latest": the phone's bridge answers with a snapshot (docs/GARMIN.md).
    function hello() {
        if (!(Communications has :transmit) || busy) {
            return;
        }
        busy = true;
        Communications.transmit({ "events" => [{ "id" => Core.newId(), "type" => "hello", "at" => Core.nowMs() }] }, null, new SendListener(0));
    }

    function flush() {
        var ob = G.state["ob"];
        if (busy || ob.size() == 0 || !(Communications has :transmit)) {
            return;
        }
        busy = true;
        lastTry = System.getTimer();
        // A few at a time: a Connect IQ message is small.
        var n = ob.size() > 4 ? 4 : ob.size();
        Communications.transmit({ "events" => ob.slice(0, n) }, null, new SendListener(n));
    }

    function retry() {
        if (!busy && G.state["ob"].size() > 0 && System.getTimer() - lastTry > 30000) {
            flush();
        }
    }

    function sent(n) {
        busy = false;
        if (n > 0) {
            var ob = G.state["ob"];
            G.state["ob"] = ob.size() > n ? ob.slice(n, null) : [];
            G.save();
        }
        flush();
    }

    function failed() {
        busy = false;
        G.awayAt = Core.nowMs();
        WatchUi.requestUpdate();
    }
}

class SendListener extends Communications.ConnectionListener {
    private var _n;

    function initialize(n) {
        ConnectionListener.initialize();
        _n = n;
    }

    function onComplete() {
        Link.sent(_n);
    }

    function onError() {
        Link.failed();
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
module Rest {
    var nudged = false;
    var over = false;

    function start(sec) {
        G.state["rest"] = Core.nowMs() + (sec.toNumber() * 1000).toLong();
        nudged = false;
        over = false;
        G.save();
    }

    function add(sec) {
        var r = G.state["rest"];
        if (r != null) {
            G.state["rest"] = r + (sec * 1000).toLong();
            nudged = false;
            G.save();
        }
    }

    function stop() {
        G.state["rest"] = null;
        G.save();
        // The next set's heart rate counts from here, not from the rest.
        Workout.newSet();
    }

    //! Seconds left, or null without a rest.
    function left() {
        var r = G.state["rest"];
        if (r == null) {
            return null;
        }
        var ms = r - Core.nowMs();
        return ms <= 0 ? 0 : ((ms + 999) / 1000).toNumber();
    }

    function tick() {
        var l = left();
        if (l == null) {
            return;
        }
        if (l <= 10 && l > 0 && !nudged) {
            nudged = true;
            buzz([[50, 150]]);
        }
        if (l == 0 && !over) {
            over = true;
            buzz([[100, 400], [0, 200], [100, 400]]);
            stop();
            Nav.follow();
        }
    }

    function hapticsOn() {
        var st = G.state["set"];
        return st == null || !(st instanceof Lang.Dictionary) || st["restHaptics"] != false;
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
