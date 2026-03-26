package com.niuma.demo.modules.order.model.dto;

import jakarta.validation.constraints.NotNull;

public class PayOrderDTO {
    @NotNull(message = "orderId_required")
    private Long orderId;

    public Long getOrderId() {
        return orderId;
    }

    public void setOrderId(Long orderId) {
        this.orderId = orderId;
    }
}
