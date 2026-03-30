package com.niuma.gzh.modules.payment.model.vo;

import java.time.LocalDateTime;
import lombok.Data;

@Data
public class PaymentOrderVO {
    private Long id;
    private String orderNo;
    private Integer amountCent;
    private String channel;
    private String status;
    private String alipayTradeNo;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
