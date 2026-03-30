package com.niuma.gzh.common.mq;

import com.niuma.gzh.common.log.LoggerUtil;
import org.springframework.stereotype.Component;

@Component
public class KafkaConsumer {
    public void consume(String message) {
        LoggerUtil.info("consume message=" + message);
    }
}
