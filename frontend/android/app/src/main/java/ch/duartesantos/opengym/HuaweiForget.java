package ch.duartesantos.opengym;

import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

/**
 * When a Huawei watch is forgotten (HuaweiLink, src/hms): when Huawei Health's list of watches has
 * left it out twice in a row. An empty list forgets nothing and counts for nothing: Huawei Health
 * that has just restarted may answer with nothing, or with part of the list, once. Forgetting drops
 * what is remembered of a watch (that it has the app), so it must not happen by accident. Plain
 * Java so the JVM tests reach it from every build.
 */
final class HuaweiForget {
    private final Map<String, Integer> missed = new HashMap<>();

    /** The watches in `have` to forget now, given the list Huawei Health just answered with. */
    Set<String> missing(Set<String> have, Set<String> listed) {
        Set<String> out = new HashSet<>();
        if (listed.isEmpty()) return out;
        missed.keySet().retainAll(have);
        for (String id : have) {
            if (listed.contains(id)) { missed.remove(id); continue; }
            int n = missed.merge(id, 1, Integer::sum);
            if (n >= 2) { out.add(id); missed.remove(id); }
        }
        return out;
    }
}
