package com.niuma.gzh.modules.order.repository;

import com.niuma.gzh.common.base.BaseRepository;
import com.niuma.gzh.modules.order.mapper.OrderMapper;
import com.niuma.gzh.modules.order.model.entity.OrderEntity;
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
