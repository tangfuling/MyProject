package com.niuma.gzh.integrations.scheduler;

import com.niuma.gzh.common.log.LoggerUtil;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class OrderReconcileScheduler {
    @Scheduled(cron = "0 0/30 * * * ?")
    public void run() {
        LoggerUtil.info("reconcile start");
    }
}
