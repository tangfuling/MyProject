package com.niuma.gzh.common.mq;

import com.niuma.gzh.common.log.LoggerUtil;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

@Component
public class KafkaConsumer {
    @KafkaListener(topics = "order-paid-topic", groupId = "niuma-demo")
    public void consume(String message) {
        LoggerUtil.info("consume message=" + message);
    }
}
