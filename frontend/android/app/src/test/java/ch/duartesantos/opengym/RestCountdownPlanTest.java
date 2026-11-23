package ch.duartesantos.opengym;

import static org.junit.Assert.*;

import org.junit.Test;

/** The rest countdown's battery plan (RestCountdownPlan): wake lock, loop and Chronometer. */
public class RestCountdownPlanTest {
    @Test
    public void exactAlarmMeansNoWakeLockDuringTheRest() {
        assertEquals(0, RestCountdownPlan.cpuHoldMs(true, 90_000));
        assertEquals(0, RestCountdownPlan.cpuHoldMs(true, 0));
    }

    @Test
    public void withoutExactAlarmsTheCpuIsHeldToTheEndAndTenSecondsPast() {
        assertEquals(100_000, RestCountdownPlan.cpuHoldMs(false, 90_000));
        assertEquals(10_000, RestCountdownPlan.cpuHoldMs(false, -500));
    }

    @Test
    public void screenOnTicksOnWholeSecondsAndLandsOnTheEnd() {
        assertEquals(1000, RestCountdownPlan.nextTickMs(90_000, true, false));
        assertEquals(500, RestCountdownPlan.nextTickMs(89_500, true, false));
        assertEquals(1, RestCountdownPlan.nextTickMs(1, true, false));
        // Walk a whole 90 s rest: 90 runs, the last exactly on the end.
        long left = 90_000;
        int runs = 0;
        while (left > 0) {
            left -= RestCountdownPlan.nextTickMs(left, true, false);
            runs++;
        }
        assertEquals(90, runs);
        assertEquals(0, left);
    }

    @Test
    public void appInFrontRepostsTheBarEveryFiveSecondsAndStillLandsOnTheEnd() {
        long left = 90_000;
        int runs = 0;
        while (left > 0) {
            left -= RestCountdownPlan.nextTickMs(left, true, true);
            runs++;
        }
        assertEquals(18, runs);
        assertEquals(0, left);
        // The last wait is the remainder, so the end is not late; a short rest has one run.
        assertEquals(2_500, RestCountdownPlan.nextTickMs(2_500, true, true));
        assertEquals(5_000, RestCountdownPlan.nextTickMs(7_500, true, true));
        // Screen off wins over in front: no reposts, only the end.
        assertEquals(90_000, RestCountdownPlan.nextTickMs(90_000, false, true));
    }

    @Test
    public void screenOffWakesOnlyForTheEnd() {
        assertEquals(90_000, RestCountdownPlan.nextTickMs(90_000, false, false));
        assertEquals(0, RestCountdownPlan.nextTickMs(0, false, false));
    }

    @Test
    public void chronometerShowsWhatTheOldClockPrinted() {
        long now = 5_000_000;
        for (long total : new long[] {1_000, 45_000, 90_000, 180_000, 61_500}) {
            long base = RestCountdownPlan.chronometerBase(now, total);
            // Every 10 ms of the rest, the Chronometer and the in-app clock agree.
            for (long passed = 0; passed <= total; passed += 10) {
                long left = total - passed;
                assertEquals("total " + total + " passed " + passed,
                        RestCountdownPlan.clockSeconds(left),
                        RestCountdownPlan.chronometerShows(base, now + passed));
            }
        }
    }

    @Test
    public void chronometerOfA90sRestStartsAt1_30AndEndsAt0_00() {
        long base = RestCountdownPlan.chronometerBase(0, 90_000);
        assertEquals("1:30", RestAlert.clock((int) RestCountdownPlan.chronometerShows(base, 0)));
        assertEquals("1:30", RestAlert.clock((int) RestCountdownPlan.chronometerShows(base, 999)));
        assertEquals("1:29", RestAlert.clock((int) RestCountdownPlan.chronometerShows(base, 1000)));
        assertEquals("0:00", RestAlert.clock((int) RestCountdownPlan.chronometerShows(base, 90_000)));
    }

    // #995: a 3:00 rest rang "Rest's over" a minute in, with the card still at 2:00.
    @Test
    public void anAlarmThatComesEarlyIsBookedAgainForItsEnd() {
        long end = 1_000_000;
        assertEquals(RestCountdownPlan.REBOOK, RestCountdownPlan.alarmVerdict(end, end - 120_000, end, false));
        assertEquals(RestCountdownPlan.REBOOK, RestCountdownPlan.alarmVerdict(end, end - 30_000, 0, false));
    }

    @Test
    public void secondsEarlyItWaitsAndOnTimeItRings() {
        long end = 1_000_000;
        assertEquals(RestCountdownPlan.WAIT, RestCountdownPlan.alarmVerdict(end, end - 4_000, end, false));
        assertEquals(RestCountdownPlan.FIRE, RestCountdownPlan.alarmVerdict(end, end - 1_000, end, false));
        assertEquals(RestCountdownPlan.FIRE, RestCountdownPlan.alarmVerdict(end, end + 5_000, end, false));
    }

    @Test
    public void anAlarmForAnotherEndIsLeftOver() {
        assertEquals(RestCountdownPlan.STALE, RestCountdownPlan.alarmVerdict(900_000, 900_000, 1_000_000, false));
        // The card's own clock is always the rest on screen, also after a skip into a hold chain.
        assertEquals(RestCountdownPlan.FIRE, RestCountdownPlan.alarmVerdict(900_000, 900_000, 1_000_000, true));
    }

    @Test
    public void anEndRingsOnceBetweenThePageAndTheAlarm() {
        long end = 1_000_000;
        // Nothing rang yet, or no end given: ring.
        assertFalse(RestCountdownPlan.alreadyRang(end, 0, true));
        assertFalse(RestCountdownPlan.alreadyRang(0, end, true));
        // The page and the alarm on the same rest, a thawed WebView's clock a second off (#1007).
        assertTrue(RestCountdownPlan.alreadyRang(end + 1_200, end, true));
        assertTrue(RestCountdownPlan.alreadyRang(end - 2_000, end, true));
        assertFalse(RestCountdownPlan.alreadyRang(end + 2_001, end, true));
        // Two native callers: only the very same end, a chain's cues are seconds apart.
        assertTrue(RestCountdownPlan.alreadyRang(end, end, false));
        assertFalse(RestCountdownPlan.alreadyRang(end + 1_000, end, false));
    }

    @Test
    public void withTheAppOpenTheCountdownLeavesTheEndToThePageWhichRingsIt() {
        // Android 1.4.5: the card's countdown reached the end first, claimed it and kept quiet
        // because the app was in front; the page's tone a few hundred ms later was refused as
        // already rung. Beeps for the last seconds, then silence (reported by mail, 2026-11-17).
        RestCountdownPlan.EndLedger ledger = new RestCountdownPlan.EndLedger();
        long end = 1_800_000_000_000L;
        assertFalse(ledger.claimNative(end, true));
        assertTrue(ledger.claimPage(end + 400));
        // and once the page rang it, an alarm landing after the app went away stays quiet (#1007)
        assertFalse(ledger.claimNative(end, false));
        assertTrue(ledger.pageRang(end));
    }

    @Test
    public void inTheBackgroundTheEndRingsOnceWhoeverComesFirst() {
        long end = 1_800_000_000_000L;
        // countdown and exact alarm at the same instant: one rings
        RestCountdownPlan.EndLedger both = new RestCountdownPlan.EndLedger();
        assertTrue(both.claimNative(end, false));
        assertFalse(both.claimNative(end, false));
        assertFalse(both.pageRang(end));
        // the alarm rang, then the WebView thaws and catches up: no second chime (#1007)
        RestCountdownPlan.EndLedger thaw = new RestCountdownPlan.EndLedger();
        assertTrue(thaw.claimNative(end, false));
        assertFalse(thaw.claimPage(end + 1_500));
        // the next rest is its own end
        assertTrue(thaw.claimPage(end + 90_000));
    }
}
