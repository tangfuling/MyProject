package com.niuma.gzh.common.app;

import com.niuma.gzh.common.log.LoggerUtil;
import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;

@Component
public class StartupRunner implements CommandLineRunner {
    private final HttpConfig httpConfig;

    public StartupRunner(HttpConfig httpConfig) {
        this.httpConfig = httpConfig;
    }

    @Override
    public void run(String... args) {
        LoggerUtil.info("startup package=" + AppConfig.APP_PACKAGE);
        LoggerUtil.info("startup http isDebug=" + httpConfig.isDebug() + ", baseUrl=" + httpConfig.getBaseUrl());
    }
}
