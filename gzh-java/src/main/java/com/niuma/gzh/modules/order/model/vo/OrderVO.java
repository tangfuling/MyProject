package com.niuma.gzh.modules.order.model.vo;

import java.math.BigDecimal;

public record OrderVO(Long id, String orderNo, BigDecimal amount) {
}
