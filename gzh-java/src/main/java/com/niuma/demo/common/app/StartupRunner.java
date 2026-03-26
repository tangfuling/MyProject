package com.niuma.demo.common.app;

import com.niuma.demo.common.log.LoggerUtil;
import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;

@Component
public class StartupRunner implements CommandLineRunner {
    @Override
    public void run(String... args) {
        LoggerUtil.info("startup package=" + AppConfig.APP_PACKAGE);
    }
}
