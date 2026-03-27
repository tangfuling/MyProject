package com.niuma.gzh.modules.payment.repository;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.niuma.gzh.common.base.BaseRepository;
import com.niuma.gzh.modules.payment.mapper.PaymentOrderMapper;
import com.niuma.gzh.modules.payment.model.entity.PaymentOrderEntity;
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
}
