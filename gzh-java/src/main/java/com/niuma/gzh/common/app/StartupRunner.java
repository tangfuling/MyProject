package com.niuma.gzh.common.app;

import com.niuma.gzh.common.log.LoggerUtil;
import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;

@Component
public class StartupRunner implements CommandLineRunner {
    @Override
    public void run(String... args) {
        LoggerUtil.info("startup package=" + AppConfig.APP_PACKAGE);
    }
}
