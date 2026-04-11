package com.niuma.gzh.common.app;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

import java.util.Arrays;

@Component
public class HttpConfig {
    private static final String RELEASE_BASE_URL = "https://api-gzh.niumatech.com";

    private final boolean isDebug;
    private final String baseUrl;

    public HttpConfig(Environment environment,
                      @Value("${server.port:8081}") Integer serverPort,
                      @Value("${HTTP_IS_DEBUG:#{null}}") Boolean debugOverride,
                      @Value("${HTTP_BASE_URL:}") String baseUrlOverride) {
        boolean profileDebug = Arrays.stream(environment.getActiveProfiles())
                .anyMatch(profile -> "dev".equalsIgnoreCase(profile));
        this.isDebug = debugOverride != null ? debugOverride : profileDebug;
        String debugBaseUrl = "http://127.0.0.1:" + (serverPort == null ? 8081 : serverPort);

        String resolvedBaseUrl = (baseUrlOverride == null || baseUrlOverride.trim().isEmpty())
                ? (this.isDebug ? debugBaseUrl : RELEASE_BASE_URL)
                : baseUrlOverride;
        this.baseUrl = trimTrailingSlash(resolvedBaseUrl);
    }

    public boolean isDebug() {
        return isDebug;
    }

    public String getBaseUrl() {
        return baseUrl;
    }

    public String getApiUrl(String path) {
        if (path == null || path.isEmpty()) {
            return baseUrl;
        }
        String normalized = path.startsWith("/") ? path : "/" + path;
        return baseUrl + normalized;
    }

    private String trimTrailingSlash(String value) {
        if (value == null) {
            return "";
        }
        String result = value.trim();
        while (result.endsWith("/")) {
            result = result.substring(0, result.length() - 1);
        }
        return result;
    }
}
