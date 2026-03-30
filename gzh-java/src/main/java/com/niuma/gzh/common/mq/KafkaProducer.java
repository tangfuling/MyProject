package com.niuma.gzh.common.mq;

import com.niuma.gzh.common.log.LoggerUtil;
import org.springframework.stereotype.Component;

@Component
public class KafkaProducer {
    public void send(String topic, String payload) {
        // Keep method signature for compatibility; Kafka is not enabled in this project.
        LoggerUtil.info("kafka disabled, skip send topic=" + topic + ", payload=" + payload);
    }
}
