package com.niuma.demo.modules.order.converter;

import com.niuma.demo.modules.order.model.entity.OrderEntity;
import com.niuma.demo.modules.order.model.vo.OrderVO;
import org.springframework.stereotype.Component;

@Component
public class OrderConverter {
    public OrderVO toVO(OrderEntity entity) {
        return new OrderVO(entity.getId(), entity.getOrderNo(), entity.getAmount());
    }
}
