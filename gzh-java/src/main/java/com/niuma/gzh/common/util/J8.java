package com.niuma.gzh.common.util;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

public final class J8 {
    private J8() {
    }

    public static <T> List<T> listOf() {
        return Collections.emptyList();
    }

    @SafeVarargs
    public static <T> List<T> listOf(T... items) {
        if (items == null || items.length == 0) {
            return Collections.emptyList();
        }
        return Collections.unmodifiableList(Arrays.asList(items.clone()));
    }

    public static <T> List<T> listCopyOf(List<? extends T> source) {
        if (source == null || source.isEmpty()) {
            return Collections.emptyList();
        }
        return Collections.unmodifiableList(new ArrayList<T>(source));
    }

    public static <T> Set<T> setOf() {
        return Collections.emptySet();
    }

    @SafeVarargs
    public static <T> Set<T> setOf(T... items) {
        if (items == null || items.length == 0) {
            return Collections.emptySet();
        }
        return Collections.unmodifiableSet(new LinkedHashSet<T>(Arrays.asList(items.clone())));
    }

    public static <K, V> Map<K, V> mapOf() {
        return Collections.emptyMap();
    }

    @SuppressWarnings("unchecked")
    public static <K, V> Map<K, V> mapOf(Object... keyValues) {
        if (keyValues == null || keyValues.length == 0) {
            return Collections.emptyMap();
        }
        if (keyValues.length % 2 != 0) {
            throw new IllegalArgumentException("mapOf requires an even number of key/value arguments");
        }
        LinkedHashMap<K, V> map = new LinkedHashMap<K, V>();
        for (int i = 0; i < keyValues.length; i += 2) {
            map.put((K) keyValues[i], (V) keyValues[i + 1]);
        }
        return Collections.unmodifiableMap(map);
    }
}
