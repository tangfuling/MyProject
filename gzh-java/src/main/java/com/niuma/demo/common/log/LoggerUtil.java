package com.niuma.demo.common.log;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public final class LoggerUtil {
    private static final Logger LOGGER = LoggerFactory.getLogger("NiumaDemo");

    private LoggerUtil() {
    }

    public static void info(String message) {
        LOGGER.info(message);
    }

    public static void error(String message, Throwable throwable) {
        LOGGER.error(message, throwable);
    }
}
