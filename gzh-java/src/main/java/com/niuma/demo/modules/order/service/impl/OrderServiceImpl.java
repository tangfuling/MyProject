package com.niuma.demo.modules.order.service.impl;

import com.niuma.demo.common.base.BaseService;
import com.niuma.demo.common.mq.KafkaProducer;
import com.niuma.demo.modules.order.converter.OrderConverter;
import com.niuma.demo.modules.order.model.dto.PayOrderDTO;
import com.niuma.demo.modules.order.model.vo.OrderVO;
import com.niuma.demo.modules.order.repository.OrderRepository;
import com.niuma.demo.modules.order.service.OrderService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class OrderServiceImpl extends BaseService implements OrderService {
    private final OrderRepository orderRepository;
    private final OrderConverter orderConverter;
    private final KafkaProducer kafkaProducer;

    public OrderServiceImpl(OrderRepository orderRepository, OrderConverter orderConverter, KafkaProducer kafkaProducer) {
        this.orderRepository = orderRepository;
        this.orderConverter = orderConverter;
        this.kafkaProducer = kafkaProducer;
    }

    @Override
    public OrderVO detail(Long id) {
        return execute("order.detail", () -> orderConverter.toVO(orderRepository.findById(id)));
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void pay(PayOrderDTO dto) {
        execute("order.pay", () -> {
            kafkaProducer.send("order-paid-topic", "orderId=" + dto.getOrderId());
            return null;
        });
    }
}
