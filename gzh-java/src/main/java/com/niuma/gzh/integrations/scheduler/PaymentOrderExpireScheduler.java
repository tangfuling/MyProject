package com.niuma.gzh.integrations.scheduler;

import com.niuma.gzh.modules.payment.repository.PaymentOrderRepository;
import java.time.LocalDateTime;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class PaymentOrderExpireScheduler {
    private static final Logger log = LoggerFactory.getLogger(PaymentOrderExpireScheduler.class);

    private final PaymentOrderRepository paymentOrderRepository;

    public PaymentOrderExpireScheduler(PaymentOrderRepository paymentOrderRepository) {
        this.paymentOrderRepository = paymentOrderRepository;
    }

    @Scheduled(fixedDelayString = "${app.payment.expire-check-ms:300000}")
    public void expirePendingOrders() {
        LocalDateTime expireBefore = LocalDateTime.now().minusMinutes(30);
        int affected = paymentOrderRepository.expirePendingOrders(expireBefore);
        if (affected > 0) {
            log.info("expired pending payment orders: {}", affected);
        }
    }
}
