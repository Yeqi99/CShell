package org.canpshell.mobile;

import java.util.*;
import java.util.function.Function;
import java.util.function.Predicate;

/** Preserve opaque protocols while applying the mobile list's explicit order. */
final class CloudProfileOrder {
  static <T> List<T> merge(List<T> previous, List<T> mobile, Function<T,String> id, Predicate<T> supported) {
    Set<String> incoming = new HashSet<>(), opaque = new HashSet<>();
    for (T item : previous) if (!supported.test(item)) opaque.add(id.apply(item));
    for (T item : mobile) {
      if (!supported.test(item) || opaque.contains(id.apply(item)) || !incoming.add(id.apply(item)))
        throw new IllegalArgumentException("Invalid mobile profile identity");
    }
    List<T> result = new ArrayList<>();
    int cursor = 0;
    for (T item : previous) {
      if (!supported.test(item)) result.add(item);
      // A deleted profile does not leave a slot that moves another profile across an opaque one.
      else if (incoming.contains(id.apply(item)) && cursor < mobile.size()) result.add(mobile.get(cursor++));
    }
    while (cursor < mobile.size()) result.add(mobile.get(cursor++));
    return result;
  }
}
