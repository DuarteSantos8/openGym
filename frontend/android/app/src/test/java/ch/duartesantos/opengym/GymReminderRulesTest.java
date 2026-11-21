package ch.duartesantos.opengym;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.Calendar;
import org.junit.Test;

/** The no-nag rule, case for case the same as frontend src/lib/gym-reminder.test.js. */
public class GymReminderRulesTest {
    private static Calendar at(int h, int m) {
        Calendar c = Calendar.getInstance();
        c.clear();
        c.set(2026, Calendar.OCTOBER, 15, h, m, 0);
        return c;
    }

    private static String reason(boolean on, int gyms, String from, String to, String trained, String quiet, long active, String fired, Calendar now) {
        return GymReminderRules.skipReason(on, gyms, from, to, trained, quiet, active, fired, now);
    }

    @Test
    public void goesOffOnANormalDay() {
        assertNull(reason(true, 1, null, null, "2026-10-14", "", 0, "", at(18, 0)));
    }

    @Test
    public void offOrNoGym() {
        assertEquals("off", reason(false, 1, null, null, "", "", 0, "", at(18, 0)));
        assertEquals("off", reason(true, 0, null, null, "", "", 0, "", at(18, 0)));
    }

    @Test
    public void onceADay() {
        assertEquals("fired", reason(true, 1, null, null, "", "", 0, "2026-10-15", at(18, 0)));
        assertNull(reason(true, 1, null, null, "", "", 0, "2026-10-14", at(18, 0)));
    }

    @Test
    public void notAfterTrainingNorOnAnExcusedDay() {
        assertEquals("trained", reason(true, 1, null, null, "2026-10-15", "", 0, "", at(18, 0)));
        assertEquals("quiet", reason(true, 1, null, null, "", "2026-10-15", 0, "", at(18, 0)));
    }

    @Test
    public void notWhileAWorkoutRuns() {
        Calendar now = at(18, 0);
        assertEquals("active", reason(true, 1, null, null, "", "", now.getTimeInMillis() - 3_600_000L, "", now));
        assertNull(reason(true, 1, null, null, "", "", now.getTimeInMillis() - 13 * 3_600_000L, "", now));
    }

    @Test
    public void timeWindowAlsoOvernight() {
        assertEquals("window", reason(true, 1, "06:00", "12:00", "", "", 0, "", at(18, 0)));
        assertNull(reason(true, 1, "06:00", "12:00", "", "", 0, "", at(7, 0)));
        assertTrue(GymReminderRules.inWindow("22:00", "02:00", 23 * 60 + 30));
        assertTrue(GymReminderRules.inWindow("22:00", "02:00", 90));
        assertFalse(GymReminderRules.inWindow("22:00", "02:00", 12 * 60));
        assertTrue(GymReminderRules.inWindow("06:00", "06:00", 3 * 60));
        assertTrue(GymReminderRules.inWindow("6:00", "22:00", 3 * 60));
        assertFalse(GymReminderRules.inWindow("06:00", "22:00", 22 * 60));
    }

    @Test
    public void isoDate() {
        assertEquals("2026-10-15", GymReminderRules.isoOf(at(0, 0)));
        assertEquals(-1, GymReminderRules.minuteOf("24:00"));
        assertEquals(6 * 60 + 5, GymReminderRules.minuteOf("06:05"));
    }

    @Test
    public void approachZoneIsAtLeast800Metres() {
        assertEquals(800, GymReminderRules.approachOf(100), 0.01);
        assertEquals(2500, GymReminderRules.approachOf(500), 0.01);
    }

    @Test
    public void insideNeedsTheRadiusAndAGoodEnoughFix() {
        double[] r = { 100, 100 };
        assertEquals(-1, GymReminderRules.insideOf(new double[] { 400, 900 }, r, 10));
        assertEquals(0, GymReminderRules.insideOf(new double[] { 80, 900 }, r, 10));
        assertEquals(1, GymReminderRules.insideOf(new double[] { 90, 30 }, r, 10));   // the nearer one
        assertEquals(-1, GymReminderRules.insideOf(new double[] { 80, 900 }, r, 350)); // a vague network fix
    }

    @Test
    public void theCheckStopsOnceEveryGymIsBehind() {
        double[] r = { 100, 100 };
        assertFalse(GymReminderRules.awayFromAll(new double[] { 1000, 5000 }, r));
        assertTrue(GymReminderRules.awayFromAll(new double[] { 1100, 5000 }, r));
    }

    @Test
    public void atMostThreeChecksADay() {
        assertTrue(GymReminderRules.mayScan("", 0, "2026-10-15"));
        assertTrue(GymReminderRules.mayScan("2026-10-15", 2, "2026-10-15"));
        assertFalse(GymReminderRules.mayScan("2026-10-15", 3, "2026-10-15"));
        assertTrue(GymReminderRules.mayScan("2026-10-14", 3, "2026-10-15"));
    }

    @Test
    public void leavingAsksOnlyWithAWorkoutRunningAndTheSwitchOn() {
        long now = at(19, 0).getTimeInMillis();
        long started = now - 50 * 60_000L;
        assertTrue(GymReminderRules.asksOnLeave(true, true, started, now));
        assertFalse(GymReminderRules.asksOnLeave(false, true, started, now));
        assertFalse(GymReminderRules.asksOnLeave(true, false, started, now));
        assertFalse(GymReminderRules.asksOnLeave(true, true, 0, now));
        // A session left running since yesterday is not one this leave is about.
        assertFalse(GymReminderRules.asksOnLeave(true, true, now - 13 * 3600_000L, now));
        assertFalse(GymReminderRules.asksOnLeave(true, true, now + 60_000L, now));
    }

    @Test
    public void onlyPlacesOnEarthAreWatched() {
        // LocationManager throws IllegalArgumentException for any other (v1.4.5).
        assertTrue(GymReminderRules.validPlace(47.37, 8.54));
        assertTrue(GymReminderRules.validPlace(-90, 180));
        assertFalse(GymReminderRules.validPlace(91, 8));
        assertFalse(GymReminderRules.validPlace(47, -181));
        assertFalse(GymReminderRules.validPlace(Double.NaN, 8));
        assertFalse(GymReminderRules.validPlace(47, Double.POSITIVE_INFINITY));
    }

    // ---------------------------------------------------------------- cheap checks (#gym-gps)

    @Test
    public void farFromEveryGymAsksForTheCheapFix() {
        assertTrue(GymReminderRules.farFromAll(new double[] { 800, 5000 }, true));
        assertTrue(GymReminderRules.farFromAll(new double[] { 401, 5000 }, true));
        // The first gym 400 m away is close enough for the good fix.
        assertFalse(GymReminderRules.farFromAll(new double[] { 400, 5000 }, true));
        assertFalse(GymReminderRules.farFromAll(new double[] { 1000, 300 }, true));
        // Hovering around 400 m does not flip it every fix: back to cheap only past 500 m.
        assertFalse(GymReminderRules.farFromAll(new double[] { 450, 5000 }, false));
        assertFalse(GymReminderRules.farFromAll(new double[] { 500, 5000 }, false));
        assertTrue(GymReminderRules.farFromAll(new double[] { 501, 5000 }, false));
        assertTrue(GymReminderRules.farFromAll(new double[0], true));
    }

    @Test
    public void farMeansHalfAsOften() {
        assertEquals(30_000L, GymReminderRules.intervalFor(true));
        assertEquals(15_000L, GymReminderRules.intervalFor(false));
    }

    @Test
    public void farNeverUsesGpsBelowAndroid12() {
        assertArrayEquals(new String[] { "network" }, GymReminderRules.providersFor(true, 30));
        assertArrayEquals(new String[] { "gps", "network" }, GymReminderRules.providersFor(false, 30));
        assertArrayEquals(new String[] { "fused", "network" }, GymReminderRules.providersFor(true, 31));
        assertArrayEquals(new String[] { "fused", "gps", "network" }, GymReminderRules.providersFor(false, 34));
    }

    private static final double LAT = 47.37, LNG = 8.54;
    private static final double DEG_PER_M = 1 / 111_320.0;

    /** A fix {at, lat, lng, accuracy} `m` metres north of the base point. */
    private static double[] fix(long at, double m, double acc) {
        return new double[] { at, LAT + m * DEG_PER_M, LNG, acc };
    }

    @Test
    public void distanceBetweenTwoPoints() {
        assertEquals(100, GymReminderRules.metersBetween(LAT, LNG, LAT + 100 * DEG_PER_M, LNG), 0.5);
        assertEquals(0, GymReminderRules.metersBetween(LAT, LNG, LAT, LNG), 0.001);
    }

    @Test
    public void stayedPutAfterThreeMinutesWithinSixtyMetres() {
        double[][] still = { fix(0, 0, 20), fix(60_000, 10, 20), fix(120_000, 5, 20), fix(180_000, 30, 20) };
        assertTrue(GymReminderRules.stayedPut(still));
        // A window shorter than 3 minutes proves nothing yet.
        assertFalse(GymReminderRules.stayedPut(new double[][] { fix(0, 0, 20), fix(150_000, 0, 20) }));
        assertFalse(GymReminderRules.stayedPut(new double[][] { fix(0, 0, 20) }));
        assertFalse(GymReminderRules.stayedPut(new double[0][]));
    }

    @Test
    public void walkingIsNotStayingPut() {
        // 100 m in 3 minutes is a slow walk, still more than 60 m.
        assertFalse(GymReminderRules.stayedPut(new double[][] { fix(0, 0, 20), fix(90_000, 50, 20), fix(180_000, 100, 20) }));
        // Moved early, stopped since: only the last 3 minutes count.
        double[][] stopped = { fix(0, 0, 20), fix(30_000, 400, 20), fix(60_000, 800, 20), fix(100_000, 800, 20), fix(240_000, 805, 20), fix(280_000, 800, 20) };
        assertTrue(GymReminderRules.stayedPut(stopped));
    }

    @Test
    public void aVagueFixCannotProveStillness() {
        double[][] vague = { fix(0, 0, 20), fix(90_000, 0, 1500), fix(180_000, 0, 20) };
        assertFalse(GymReminderRules.stayedPut(vague));
    }

    @Test
    public void spotsAreRoundedKeptAndMerged() {
        long day = 24 * 3600_000L, t0 = 1_000 * day;
        double[][] none = new double[0][];
        double[][] one = GymReminderRules.addSpot(none, LAT, LNG, 30, t0);
        assertEquals(1, one.length);
        // Rounded to a 150 m grid: not the exact place.
        assertTrue(GymReminderRules.metersBetween(LAT, LNG, one[0][0], one[0][1]) < 110);
        assertFalse(LAT == one[0][0] && LNG == one[0][1]);
        // The same place again moves the time, it does not add a second spot.
        double[][] again = GymReminderRules.addSpot(one, LAT + 20 * DEG_PER_M, LNG, 30, t0 + day);
        assertEquals(1, again.length);
        assertEquals(t0 + day, (long) again[0][2]);
        // A vague fix is not a place worth remembering.
        assertEquals(1, GymReminderRules.addSpot(one, LAT + 1, LNG, 800, t0).length);
        // Old ones fall off after 30 days; at most 5 are kept, the newest.
        assertEquals(1, GymReminderRules.addSpot(one, LAT + 1, LNG, 30, t0 + 31 * day).length);
        double[][] many = none;
        for (int i = 0; i < 7; i++) many = GymReminderRules.addSpot(many, LAT + i * 0.01, LNG, 30, t0 + i * 1000L);
        assertEquals(5, many.length);
        assertEquals(t0 + 6000L, (long) many[4][2]);
        assertEquals(t0 + 2000L, (long) many[0][2]);
    }

    @Test
    public void aKnownSpotSkipsTheCheck() {
        long day = 24 * 3600_000L, t0 = 1_000 * day;
        double[][] spots = GymReminderRules.addSpot(new double[0][], LAT, LNG, 30, t0);
        long now = t0 + 2 * day;
        // Near it, with a fresh fix: no check.
        assertTrue(GymReminderRules.knownSpot(spots, LAT + 40 * DEG_PER_M, LNG, now - 60_000L, now));
        // Far from it: a check.
        assertFalse(GymReminderRules.knownSpot(spots, LAT + 400 * DEG_PER_M, LNG, now - 60_000L, now));
        // A fix from an hour ago says where the phone was, not where it is.
        assertFalse(GymReminderRules.knownSpot(spots, LAT, LNG, now - 3600_000L, now));
        // After 30 days it is forgotten.
        assertFalse(GymReminderRules.knownSpot(spots, LAT, LNG, t0 + 31 * day, t0 + 31 * day));
        assertFalse(GymReminderRules.knownSpot(new double[0][], LAT, LNG, now, now));
    }
}
