package com.niuma.gzh.modules.order.model.vo;

import java.math.BigDecimal;

public class OrderVO {
    private final Long id;
    private final String orderNo;
    private final BigDecimal amount;

    public OrderVO(Long id, String orderNo, BigDecimal amount) {
        this.id = id;
        this.orderNo = orderNo;
        this.amount = amount;
    }

    public Long id() {
        return id;
    }

    public String orderNo() {
        return orderNo;
    }

    public BigDecimal amount() {
        return amount;
    }

    public Long getId() {
        return id;
    }

    public String getOrderNo() {
        return orderNo;
    }

    public BigDecimal getAmount() {
        return amount;
    }
}
