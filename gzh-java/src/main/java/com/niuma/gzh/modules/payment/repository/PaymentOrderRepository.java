package com.niuma.gzh.modules.payment.repository;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.niuma.gzh.common.base.BaseRepository;
import com.niuma.gzh.modules.payment.mapper.PaymentOrderMapper;
import com.niuma.gzh.modules.payment.model.entity.PaymentOrderEntity;
import java.time.LocalDateTime;
import org.springframework.stereotype.Repository;

@Repository
public class PaymentOrderRepository extends BaseRepository {
    private final PaymentOrderMapper paymentOrderMapper;

    public PaymentOrderRepository(PaymentOrderMapper paymentOrderMapper) {
        this.paymentOrderMapper = paymentOrderMapper;
    }

    public void save(PaymentOrderEntity entity) {
        if (entity.getId() == null) {
            paymentOrderMapper.insert(entity);
        } else {
            paymentOrderMapper.updateById(entity);
        }
    }

    public PaymentOrderEntity findByOrderNo(String orderNo) {
        return paymentOrderMapper.selectOne(new LambdaQueryWrapper<PaymentOrderEntity>()
            .eq(PaymentOrderEntity::getOrderNo, orderNo)
            .last("limit 1"));
    }

    public Page<PaymentOrderEntity> pageByUser(Long userId, long pageNo, long pageSize) {
        return paymentOrderMapper.selectPage(new Page<>(pageNo, pageSize),
            new LambdaQueryWrapper<PaymentOrderEntity>()
                .eq(PaymentOrderEntity::getUserId, userId)
                .orderByDesc(PaymentOrderEntity::getCreatedAt));
    }

    public int expirePendingOrders(LocalDateTime expireBefore) {
        return paymentOrderMapper.update(
            null,
            new LambdaUpdateWrapper<PaymentOrderEntity>()
                .set(PaymentOrderEntity::getStatus, "EXPIRED")
                .set(PaymentOrderEntity::getUpdatedAt, LocalDateTime.now())
                .eq(PaymentOrderEntity::getStatus, "PENDING")
                .lt(PaymentOrderEntity::getCreatedAt, expireBefore)
        );
    }
}
