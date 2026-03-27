package com.niuma.gzh.common.util;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.UUID;

public final class IdUtil {
    private static final DateTimeFormatter ORDER_FMT = DateTimeFormatter.ofPattern("yyyyMMddHHmmss");

    private IdUtil() {
    }

    public static String orderNo() {
        return "GZH" + LocalDateTime.now().format(ORDER_FMT) + UUID.randomUUID().toString().replace("-", "").substring(0, 8).toUpperCase();
    }

    public static String sessionId() {
        return UUID.randomUUID().toString().replace("-", "");
    }
}
