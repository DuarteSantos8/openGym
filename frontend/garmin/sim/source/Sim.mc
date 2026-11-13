// The simulator build plays the phone (sim/run.sh, docs/GARMIN.md "Simulator"): every run starts
// clean, as if openGym on the phone had just sent its snapshot (sim/gen.mjs, from
// test/snapshot.json). From there the watch is driven with its own buttons: START starts today's
// routine, START logs a set and the rest begins, MENU (UP held) opens the workout menu with Finish.
// Events the watch sends stay in its outbox (Link.wired() is false here). Every 2 s the memory in
// use goes to the console (monkeydo's output: "mem <used> <peak> <total>").
import Toybox.Lang;
import Toybox.System;
import Toybox.Timer;

(:sim)
module Sim {
    var timer = null;
    var peak = 0;

    function begin() as Void {
        G.state = Core.normalize(null);
        G.ended = null;
        if (!SimData.none()) {
            Core.applySnapshot(G.state, SimData.snapshot());
        }
        G.save();
        timer = new Timer.Timer();
        timer.start(new Lang.Method(Sim, :mem), 2000, true);
    }

    function mem() as Void {
        var st = System.getSystemStats();
        var used = st.usedMemory;
        if (used > peak) {
            peak = used;
        }
        System.println("mem " + used + " " + peak + " " + st.totalMemory);
    }
}
