package com.niuma.demo.modules.order.repository;

import com.niuma.demo.common.base.BaseRepository;
import com.niuma.demo.modules.order.mapper.OrderMapper;
import com.niuma.demo.modules.order.model.entity.OrderEntity;
import org.springframework.stereotype.Repository;

@Repository
public class OrderRepository extends BaseRepository {
    private final OrderMapper orderMapper;

    public OrderRepository(OrderMapper orderMapper) {
        this.orderMapper = orderMapper;
    }

    public OrderEntity findById(Long id) {
        OrderEntity entity = orderMapper.selectById(id);
        if (entity == null) {
            entity = new OrderEntity();
            entity.setId(id);
            entity.setOrderNo("DEMO-" + id);
        }
        return entity;
    }
}
