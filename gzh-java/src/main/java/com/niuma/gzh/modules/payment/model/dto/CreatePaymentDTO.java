package com.niuma.gzh.modules.payment.model.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

@Data
public class CreatePaymentDTO {
    @NotNull(message = "充值金额不能为空")
    @Min(value = 100, message = "最低充值 1 元")
    @Max(value = 500000, message = "单次充值最高 5000 元")
    private Integer amountCent;

    private String subject;
}
