package ch.duartesantos.opengym;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import androidx.health.connect.client.records.HeartRateRecord;
import androidx.health.connect.client.records.WeightRecord;
import androidx.health.connect.client.records.metadata.DataOrigin;
import androidx.health.connect.client.records.metadata.Metadata;
import androidx.health.connect.client.units.Mass;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import org.junit.Test;

// v1.4.3: what HealthConnectPlugin hands to JS when it reads heart rate and weigh-ins back.
public class HealthReadTest {

    private static HeartRateRecord hr(long start, long end, long[][] samples) {
        HeartRateRecord.Sample[] s = new HeartRateRecord.Sample[samples.length];
        for (int i = 0; i < samples.length; i++) s[i] = new HeartRateRecord.Sample(Instant.ofEpochMilli(samples[i][0]), samples[i][1]);
        return new HeartRateRecord(Instant.ofEpochMilli(start), ZoneOffset.UTC, Instant.ofEpochMilli(end), ZoneOffset.UTC,
                Arrays.asList(s), Metadata.unknownRecordingMethod());
    }

    @Test
    public void samplesInsideTheWindowOldestFirst() {
        HeartRateRecord a = hr(10_000, 20_000, new long[][] { { 10_000, 120 }, { 15_000, 130 }, { 20_000, 140 } });
        HeartRateRecord b = hr(0, 9_000, new long[][] { { 0, 90 }, { 9_000, 100 } });
        List<long[]> out = HealthRead.samples(Arrays.asList(a, b), 5_000, 15_000);
        assertEquals(3, out.size());
        assertArrayEquals(new long[] { 9_000, 100 }, out.get(0));
        assertArrayEquals(new long[] { 10_000, 120 }, out.get(1));
        assertArrayEquals(new long[] { 15_000, 130 }, out.get(2));
    }

    @Test
    public void implausibleBeatsAreLeftOut() {
        HeartRateRecord a = hr(0, 3_000, new long[][] { { 0, 10 }, { 1_000, 300 }, { 2_000, 25 }, { 3_000, 250 } });
        List<long[]> out = HealthRead.samples(Collections.singletonList(a), 0, 3_000);
        assertEquals(2, out.size());
        assertEquals(25, out.get(0)[1]);
        assertEquals(250, out.get(1)[1]);
    }

    @Test
    public void weighInsCarryTheirOriginAndClientId() {
        Metadata scale = new Metadata(Metadata.RECORDING_METHOD_AUTOMATICALLY_RECORDED, "rec-1", new DataOrigin("com.withings.wiscale2"),
                Instant.ofEpochMilli(5), null, 0, null);
        Metadata ours = new Metadata(Metadata.RECORDING_METHOD_MANUAL_ENTRY, "rec-2", new DataOrigin("ch.duartesantos.opengym"),
                Instant.ofEpochMilli(5), "opengym-bw-2026-10-15", 1, null);
        List<HealthRead.Weight> out = HealthRead.weights(Arrays.asList(
                new WeightRecord(Instant.ofEpochMilli(1_000), ZoneOffset.UTC, Mass.kilograms(81.25), scale),
                new WeightRecord(Instant.ofEpochMilli(2_000), ZoneOffset.UTC, Mass.pounds(176), ours)));
        assertEquals(2, out.size());
        assertEquals(1_000, out.get(0).t);
        assertEquals(81.25, out.get(0).kg, 1e-9);
        assertEquals("com.withings.wiscale2", out.get(0).origin);
        assertNull(out.get(0).clientId);
        assertEquals("opengym-bw-2026-10-15", out.get(1).clientId);
        assertEquals(79.83, out.get(1).kg, 0.01);
    }

    @Test
    public void permissionNamesMatchTheManifest() {
        assertEquals("android.permission.health.READ_HEART_RATE", HealthRead.readPermission("heartRate"));
        assertEquals("android.permission.health.READ_WEIGHT", HealthRead.readPermission("weight"));
        assertEquals("android.permission.health.READ_HEALTH_DATA_HISTORY", HealthRead.readPermission("history"));
        assertEquals("android.permission.health.WRITE_EXERCISE", HealthRead.writePermission("exercise"));
        assertNull(HealthRead.readPermission("steps"));
    }
}
