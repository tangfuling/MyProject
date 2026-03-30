package com.niuma.gzh.modules.payment.model.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableLogic;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

@Data
@TableName("gzh_payment_order")
public class PaymentOrderEntity {
    @TableId(type = IdType.AUTO)
    private Long id;
    private Long userId;
    private String orderNo;
    private Integer amountCent;
    private String channel;
    private String status;
    private String subject;
    private String payUrl;
    private String alipayTradeNo;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
    @TableLogic
    @TableField("deleted")
    private Integer deleted;
}
