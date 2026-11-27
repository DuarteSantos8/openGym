package ch.duartesantos.opengym;

/**
 * When the Huawei link looks for watches again while it hears none (HuaweiLink, src/hms): Huawei
 * Health's first list at launch may come back empty or fail, and then nobody would ever register a
 * receiver. The wait doubles from a few seconds to a few minutes, so Huawei Health is never hammered,
 * and it stops as soon as a receiver is registered. Plain Java so the JVM tests reach it.
 */
final class HuaweiLook {
    private HuaweiLook() {}

    static final long FIRST_MS = 5000;
    static final long MAX_MS = 300000;

    /** The wait after `waitMs` (0: none yet). */
    static long next(long waitMs) { return waitMs <= 0 ? FIRST_MS : Math.min(waitMs * 2, MAX_MS); }

    /** Looking again is needed while the link is up and no watch has a receiver. */
    static boolean deaf(boolean ready, int receivers) { return ready && receivers == 0; }
}
